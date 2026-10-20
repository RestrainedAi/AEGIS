"""Additive local mirror. Native byte integrity is not media completeness.

The caller owns authentication and scheduling. No evidence database is modified.
"""
from __future__ import annotations

import base64
import csv
import hashlib
import html
import io
import json
import os
from pathlib import Path
import re
import shutil
import urllib.parse
import urllib.request
import urllib.error
import uuid
import time
from datetime import datetime, timezone

ACCOUNTS = {
    'suno_unshakableechos2341': '01 - unshakableechos2341',
    'suno_nessihenize': '02 - nessihenize',
}
ASSETS = {'gcs_mp3': 'audio.mp3', 'gcs_mp4': 'video.mp4',
          'gcs_thumb': 'cover.jpg', 'gcsLyricsTxt': 'lyrics.txt',
          'gcsLyricsJson': 'lyrics.json', 'gcsLyricsVtt': 'lyrics.vtt',
          'rawClipJsonGcs': 'source.json'}
OPTIONAL_ASSETS = {'gcs_latest_audio': ('latest-audio.mp3', 'gcs_mp3'),
                   'gcs_latest_mp4': ('latest-video.mp4', 'gcs_mp4'),
                   'gcs_latest_thumb': ('latest-cover.jpg', 'gcs_thumb')}
FILE_FIELDS = ['songKey', 'kind', 'path', 'bytes', 'sha256', 'source']
GAP_FIELDS = ['songKey', 'account', 'asset', 'reason', 'source']


def digest(data):
    return hashlib.sha256(data).hexdigest()


def csv_rows(data):
    return list(csv.DictReader(io.StringIO(data.decode('utf-8-sig'))))


def csv_bytes(rows, defaults):
    fields = list(dict.fromkeys([*defaults, *(k for r in rows for k in r)]))
    out = io.StringIO(newline='')
    writer = csv.DictWriter(out, fields)
    writer.writeheader()
    writer.writerows(rows)
    return out.getvalue().encode('utf-8-sig')


def safe_path(root, relative):
    p = (root / relative).resolve()
    if p == root or not p.is_relative_to(root):
        raise ValueError('Path escapes mirror root')
    return p


def write_atomic(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.mirror-tmp')
    with temporary.open('xb') as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


class MirrorLock:
    """Kernel-held lock releases on process death; marker file stays in place."""
    def __init__(self, path):
        self.stream = path.open('a+b')
        try:
            if path.stat().st_size == 0:
                self.stream.write(b'\0')
                self.stream.flush()
            self.stream.seek(0)
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(self.stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            self.stream.close()
            raise FileExistsError('Another local mirror writer holds the OS lock') from exc

    def close(self):
        self.stream.close()


def gcs_url(source):
    if source.startswith('gs://'):
        source = 'https://storage.googleapis.com/' + source[5:]
    parsed = urllib.parse.urlsplit(source)
    if (parsed.scheme != 'https' or parsed.netloc != 'storage.googleapis.com'
            or parsed.username or parsed.password or parsed.fragment):
        raise ValueError('Only canonical GCS HTTPS references are supported')
    if len(parsed.path.strip('/').split('/')) < 2:
        raise ValueError('Missing bucket/object')
    return source


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class AuthenticationError(RuntimeError):
    def __init__(self, http_status=None):
        super().__init__('Machine authentication unavailable' if http_status is None else 'Cloud authorization rejected')
        self.http_status = http_status


class InsufficientDiskSpace(RuntimeError):
    def __init__(self, available, required):
        super().__init__('Insufficient mirror disk reserve')
        self.available = available
        self.required = required


def require_disk_space(root, size, reserve):
    available = shutil.disk_usage(root).free
    if available < size + reserve:
        raise InsufficientDiskSpace(available, size + reserve)


class SecureGcsTransport:
    """Explicit machine token provider only; no default credential discovery.

    Redirects are rejected before forwarding credentials. One response is bounded
    by max_bytes; callers must provision sufficient RAM for that configured bound.
    """
    def __init__(self, allowed_buckets, token_provider, timeout=90, max_bytes=512*1024*1024):
        self.allowed_buckets = frozenset(allowed_buckets)
        self.token_provider = token_provider
        self.timeout = timeout
        self.max_bytes = max_bytes

    def _request(self, source, method='GET'):
        url = gcs_url(source)
        bucket = urllib.parse.urlsplit(url).path.split('/')[1]
        if bucket not in self.allowed_buckets:
            raise ValueError('Bucket is outside configured scope')
        opener = urllib.request.build_opener(_NoRedirect())
        for attempt in range(2):
            try:
                token = self.token_provider(True) if attempt else self.token_provider()
            except Exception as exc:
                raise AuthenticationError() from exc
            request = urllib.request.Request(url, headers={
                'Authorization': 'Bearer ' + token, 'Accept-Encoding': 'identity'}, method=method)
            try:
                with opener.open(request, timeout=self.timeout) as response:
                    headers = {key.lower(): value for key, value in response.headers.items()}
                    # GCS sends CRC32C and MD5 as separate x-goog-hash fields.
                    # dict(HTTPMessage) silently keeps only the first field.
                    if hasattr(response.headers, 'get_all'):
                        headers['x-goog-hash'] = ', '.join(response.headers.get_all('x-goog-hash', []))
                    if method == 'HEAD':
                        return headers
                    data = response.read(self.max_bytes + 1)
                    if len(data) > self.max_bytes:
                        raise ValueError('Object exceeds configured byte bound')
                    return data, headers
            except urllib.error.HTTPError as exc:
                exc.close()
                if exc.code == 403 or (exc.code == 401 and attempt):
                    raise AuthenticationError(exc.code) from exc
                if exc.code != 401 or attempt:
                    raise

    def __call__(self, source):
        return self._request(source)

    def inspect(self, source):
        return object_metadata(self._request(source, 'HEAD'))

    def fetch(self, source, generation):
        parsed = urllib.parse.urlsplit(gcs_url(source))
        query = [(k, v) for k, v in urllib.parse.parse_qsl(parsed.query) if k not in ('generation', 'ifGenerationMatch')]
        query.extend([('generation', generation), ('ifGenerationMatch', generation)])
        return self._request(urllib.parse.urlunsplit(parsed._replace(query=urllib.parse.urlencode(query))))


def object_metadata(headers):
    headers = {k.lower(): v for k, v in headers.items()}
    hashes = dict(x.strip().split('=', 1) for x in headers.get('x-goog-hash', '').split(',') if '=' in x)
    generation = headers.get('x-goog-generation', '')
    size = int(headers.get('content-length', '-1'))
    md5 = hashes.get('md5', '')
    if not generation.isdigit() or size <= 0 or not md5:
        raise ValueError('Object metadata requires generation, positive size, and MD5')
    return {'generation': generation, 'size': size, 'md5': md5}


def validate_download(data, headers):
    headers = {k.lower(): v for k, v in headers.items()}
    if not data or int(headers.get('content-length', '-1')) != len(data):
        raise ValueError('Missing or mismatched Content-Length')
    hashes = dict(x.strip().split('=', 1) for x in headers.get('x-goog-hash', '').split(',') if '=' in x)
    if 'md5' not in hashes:
        raise ValueError('GCS MD5 unavailable; manual verification required')
    if hashes['md5'] != base64.b64encode(hashlib.md5(data).digest()).decode():
        raise ValueError('GCS MD5 mismatch')


def derivative_selection(record):
    """Fail closed rather than laundering a listening copy into a native alias."""
    role = record.get('audio_asset_role', '')
    latest = record.get('gcs_latest_audio', '')
    suspicious = any('/derived/' in record.get(k, '') for k in ('audio_url', 'gcs_mp3', 'gcs_latest_audio'))
    if not role and not suspicious:
        return False
    if role != 'derived-from-video':
        raise ValueError('Missing or unsupported derived audio role')
    required = ('audio_url', 'gcs_latest_audio', 'gcs_mp3', 'gcs_mp4', 'audio_original_url', 'audio_provenance_url')
    urls = {k: gcs_url(record.get(k, '')) for k in required}
    if urls['audio_url'] != urls['gcs_latest_audio'] or urls['gcs_mp3'] != urls['audio_original_url'] or urls['gcs_mp3'] == urls['audio_url'] or '/derived/' in urls['gcs_mp3']:
        raise ValueError('Derived audio selection does not preserve distinct native original')
    return True


def verified_recovery(record, transport):
    url = gcs_url(record['audio_provenance_url'])
    meta = transport.inspect(url)
    data, headers = transport.fetch(url, meta['generation'])
    validate_download(data, headers)
    if object_metadata(headers) != meta:
        raise ValueError('Provenance generation changed')
    body = json.loads(data)
    recovery = body.get('audioRecovery', {})
    if body.get('uuid') != record['songKey'] or body.get('account_sourceId') != record['account_sourceId'] or recovery.get('kind') != 'derived-from-video' or recovery.get('nativeOriginal') is not False:
        raise ValueError('Derived provenance identity or role mismatch')
    for field, column in (('derivedAudioUrl', 'gcs_latest_audio'), ('originalAudioUrl', 'gcs_mp3'), ('sourceVideoUrl', 'gcs_mp4'), ('provenanceUrl', 'audio_provenance_url')):
        if gcs_url(recovery.get(field, '')) != gcs_url(record[column]):
            raise ValueError('Derived provenance source mismatch')
    for field in ('derivedSha256', 'originalSha256', 'sourceVideoSha256'):
        if not re.fullmatch('[0-9a-f]{64}', recovery.get(field, '')):
            raise ValueError('Derived provenance hash missing')
    for field in ('originalGeneration', 'sourceVideoGeneration'):
        if not str(recovery.get(field, '')).isdigit():
            raise ValueError('Derived provenance generation missing')
    return recovery, (data, headers, meta)


def finish_commit(root, run, receipt):
    """Resume only when every generated file is a known before/after version."""
    receipt_path = run / 'receipt.json'
    manifest = receipt.get('commit_manifest', [])
    def blocked(reason, path=None):
        receipt.update(status='blocked', retryable=False, reconciliation_required=True,
                       blocker=reason, conflict_path=path)
        write_atomic(receipt_path, json.dumps(receipt, indent=2).encode())
        return receipt
    if not manifest:
        return blocked('missing_commit_manifest')
    for asset in receipt['assets']:
        if asset.get('status') == 'saved':
            path = safe_path(root, asset['path'])
            if not path.exists() or digest(path.read_bytes()) != asset['sha256']:
                return blocked('saved_asset_changed', asset['path'])
    for entry in manifest:
        target = safe_path(root, entry['path'])
        staged = safe_path(root, entry['staged_path'])
        if not staged.exists() or digest(staged.read_bytes()) != entry['sha256']:
            return blocked('staged_artifact_changed', entry['staged_path'])
        current = digest(target.read_bytes()) if target.exists() else None
        if current not in (entry['before_sha256'], entry['sha256']):
            receipt.update(status='blocked', retryable=False, reconciliation_required=True,
                           conflict_path=entry['path'])
            write_atomic(receipt_path, json.dumps(receipt, indent=2).encode())
            return receipt
        if entry['before_sha256'] is not None:
            backup = safe_path(root, entry['backup_path'])
            if not backup.exists() or digest(backup.read_bytes()) != entry['before_sha256']:
                return blocked('backup_baseline_changed', entry['backup_path'])
    receipt.update(status='committing', retryable=True)
    write_atomic(receipt_path, json.dumps(receipt, indent=2).encode())
    for entry in manifest:
        target = safe_path(root, entry['path'])
        if not target.exists() or digest(target.read_bytes()) != entry['sha256']:
            write_atomic(target, safe_path(root, entry['staged_path']).read_bytes())
        receipt['catalog_updates'] = [e for e in receipt['catalog_updates'] if e['path'] != entry['path']]
        receipt['catalog_updates'].append({'path': entry['path'], 'sha256': entry['sha256']})
        write_atomic(receipt_path, json.dumps(receipt, indent=2).encode())
    handoff = {'run_id': receipt['run_id'], 'status': 'pending_evidence_registration',
               'files': [a for a in receipt['assets'] if a['status'] == 'saved'],
               'generated': [{'path': e['staged_path'], 'current_path': e['path'], 'sha256': e['sha256']} for e in manifest],
               'backup_directory': str((run / 'before').relative_to(root)),
               'catalog_source_sha256': receipt['catalog_sha256'], 'canonical_evidence_database_modified': False}
    handoff_path = run / 'evidence-handoff.json'
    handoff_bytes = json.dumps(handoff, indent=2).encode()
    if handoff_path.exists() and handoff_path.read_bytes() != handoff_bytes:
        raise ValueError('Existing immutable handoff differs')
    if not handoff_path.exists():
        write_atomic(handoff_path, handoff_bytes)
    receipt.update(status=receipt['completion_status'], retryable=False, reconciliation_required=False,
                   evidence_handoff=str(handoff_path.relative_to(root)), evidence_status='pending')
    write_atomic(receipt_path, json.dumps(receipt, indent=2).encode())
    write_atomic(run / 'progress.json', json.dumps({'run_id': receipt['run_id'], 'status': receipt['status'],
                                                  'asset_results': len(receipt['assets']), 'at': datetime.now(timezone.utc).isoformat()}).encode())
    return receipt


def sync_catalog(root, catalog_bytes, run_id, transport, *, min_free_bytes=10 * 1024**3, asset_kinds=None):
    """Sync a frozen CSV snapshot, including hidden selected-account rows.

    Repeated committed run IDs return their receipt; changed snapshot bytes fail.
    Incomplete run IDs require inspection and a new run ID. All prior gaps remain
    unresolved pending independent content validation, even after byte acquisition.
    """
    root = Path(root).resolve()
    if min_free_bytes < 0:
        raise ValueError('Disk reserve cannot be negative')
    if asset_kinds is not None:
        asset_kinds = set(asset_kinds)
        if not asset_kinds or not asset_kinds <= (set(ASSETS) | set(OPTIONAL_ASSETS) | {'derived_mp3_from_video', 'audio_provenance_json'}):
            raise ValueError('Invalid bounded asset kinds')
    if not root.is_dir():
        raise ValueError('Mirror root must already exist')
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,95}', run_id):
        raise ValueError('Unsafe run ID')
    catalog_hash = digest(catalog_bytes)
    source_rows = csv_rows(catalog_bytes)
    if not source_rows or any('songKey' not in r or 'account_sourceId' not in r for r in source_rows):
        raise ValueError('Catalog must contain songKey and account_sourceId records')
    selected = [r for r in source_rows if r.get('account_sourceId') in ACCOUNTS]
    if not selected:
        raise ValueError('Catalog contains no configured account records')
    for record in selected:
        derivative_selection(record)
    keys = [r.get('songKey', '') for r in selected]
    if any(not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', k) for k in keys) or len(keys) != len(set(keys)):
        raise ValueError('Missing, unsafe, or duplicate selected songKey')
    maintenance = safe_path(root, 'Catalog/Maintenance')
    maintenance.mkdir(parents=True, exist_ok=True)
    lock = MirrorLock(maintenance / '.local-mirror.lock')
    run = safe_path(root, 'Catalog/Maintenance/' + run_id)
    receipt_path = run / 'receipt.json'
    try:
        for unfinished in maintenance.glob('*/receipt.json'):
            journal = json.loads(unfinished.read_text())
            if unfinished == receipt_path and journal.get('catalog_sha256') != catalog_hash:
                raise ValueError('Run ID already used with different snapshot')
            if journal.get('status') in ('committing', 'interrupted'):
                recovered = finish_commit(root, unfinished.parent, journal)
                if recovered['status'] == 'blocked':
                    return recovered
            elif journal.get('status') in ('blocked', 'running') and unfinished != receipt_path:
                return dict(journal, status='blocked', retryable=False,
                            reconciliation_required=True, receipt_path=str(unfinished.relative_to(root)),
                            staged_directory=str((unfinished.parent / 'staged').relative_to(root)),
                            backup_directory=str((unfinished.parent / 'before').relative_to(root)))
        if run.exists():
            previous = json.loads(receipt_path.read_text()) if receipt_path.exists() else {}
            if previous.get('catalog_sha256') != catalog_hash:
                raise ValueError('Run ID already used with different or incomplete snapshot')
            if previous.get('status') in ('complete', 'partial'):
                return previous
            if previous.get('status') == 'blocked':
                return previous
            receipt = previous
        else:
            run.mkdir()
            write_atomic(run / 'vault-catalog-source.csv', catalog_bytes)
            receipt = {'run_id': run_id, 'catalog_sha256': catalog_hash,
                   'at': datetime.now(timezone.utc).isoformat(), 'status': 'running',
                   'selected_songs': len(selected), 'assets': [], 'catalog_updates': [],
                   'limitations': 'Byte integrity only; no media completeness or evidence registration claim. Historical gaps retained. No source deletion propagation.'}

        checkpoint_count = 0
        checkpoint_at = time.monotonic()
        def save(force=True):
            nonlocal checkpoint_count, checkpoint_at
            checkpoint_count += 1
            now = time.monotonic()
            if not force and checkpoint_count < 100 and now - checkpoint_at < 10:
                return
            write_atomic(receipt_path, json.dumps(receipt, indent=2).encode())
            write_atomic(run / 'progress.json', json.dumps({'run_id': run_id, 'status': receipt['status'],
                                                          'asset_results': len(receipt['assets']),
                                                          'last_asset_status': receipt['assets'][-1].get('status') if receipt['assets'] else None,
                                                          'at': datetime.now(timezone.utc).isoformat()}).encode())
            checkpoint_count = 0
            checkpoint_at = now

        save()
        def read(relative):
            p = safe_path(root, relative)
            return csv_rows(p.read_bytes()) if p.exists() else []

        rows, files, gaps = read('catalog.csv'), read('Catalog/files.csv'), read('Catalog/missing-files.csv')
        state_path = safe_path(root, 'Catalog/local-mirror-source-state.json')
        source_state = json.loads(state_path.read_text()) if state_path.exists() else {}
        resumed = {}
        for asset in receipt['assets']:
            if asset.get('status') in ('saved', 'saving'):
                path = safe_path(root, asset['path'])
                if path.exists() and digest(path.read_bytes()) == asset['sha256']:
                    asset['status'] = 'saved'
                    resumed[(asset['songKey'], asset['kind'])] = asset
                    if not any(f.get('path') == asset['path'] for f in files):
                        files.append({k: asset[k] for k in FILE_FIELDS})
                    if asset.get('metadata'):
                        source_state[gcs_url(asset['source'])] = dict(asset['metadata'], path=asset['path'], sha256=asset['sha256'])
                elif path.exists():
                    receipt.update(status='blocked', retryable=False, reconciliation_required=True, conflict_path=asset['path'])
                    save()
                    return receipt
        receipt['assets'] = list(resumed.values())
        by_key = {r['songKey']: r for r in rows}
        prior = {}
        for item in files:
            prior[(item.get('songKey'), item.get('kind'))] = item
        for record in selected:
            key, account = record['songKey'], ACCOUNTS[record['account_sourceId']]
            existing = by_key.get(key, {})
            folder = existing.get('local_folder')
            if not folder:
                candidates = [f['path'] for f in files if f.get('songKey') == key and f.get('kind') in ASSETS]
                if candidates:
                    folder = str(Path(candidates[0]).parent).replace('\\', '/')
                    if '/Versions/' in folder:
                        folder = folder.split('/Versions/', 1)[0]
            folder = folder or account + '/Songs/' + key
            safe_path(root, folder)
            merged = dict(existing, **record)
            merged['local_folder'] = folder
            by_key[key] = merged
            active_assets = dict(ASSETS)
            derived = derivative_selection(record)
            recovery = None
            preloaded = {}
            if derived:
                try:
                    recovery, provenance_response = verified_recovery(record, transport)
                except AuthenticationError:
                    raise
                except Exception as exc:
                    receipt.update(status='blocked', retryable=False, blocker='derived_provenance_invalid',
                                   songKey=key, error_type=type(exc).__name__)
                    save()
                    return receipt
                preloaded[gcs_url(record['audio_provenance_url'])] = provenance_response
                active_assets['audio_provenance_json'] = 'Derived/audio-provenance.json'
                active_assets['derived_mp3_from_video'] = 'Derived/listening-copy.mp3'
            for optional, (name, base) in OPTIONAL_ASSETS.items():
                if derived and optional == 'gcs_latest_audio':
                    continue
                equivalent = record.get(optional) == record.get(base)
                if record.get(optional) and record.get(base):
                    try:
                        equivalent = gcs_url(record[optional]) == gcs_url(record[base])
                    except ValueError:
                        pass
                if record.get(optional) and not equivalent:
                    active_assets[optional] = name
            for kind, name in active_assets.items():
                if asset_kinds is not None and kind not in asset_kinds:
                    continue
                if (key, kind) in resumed:
                    continue
                column = {'derived_mp3_from_video': 'gcs_latest_audio', 'audio_provenance_json': 'audio_provenance_url'}.get(kind, kind)
                source = record.get(column, '')
                role = 'derivative' if kind == 'derived_mp3_from_video' else ('provenance_manifest' if kind == 'audio_provenance_json' else 'native')
                item = {'songKey': key, 'kind': kind, 'source': source, 'native_or_derivative': role}
                if recovery and role == 'derivative':
                    item['audio_recovery'] = recovery
                    item['native_original'] = False
                receipt['assets'].append(item)
                if not source:
                    item['status'] = 'absent_source'
                    external = record.get({'gcs_mp3': 'audio_url', 'gcs_mp4': 'video_url', 'gcs_thumb': 'image_url'}.get(kind, ''), '')
                    if external:
                        item['external_only_reference'] = external
                    if not any(g.get('songKey') == key and g.get('asset') == kind for g in gaps):
                        gaps.append(dict(songKey=key, account=account, asset=kind, reason='No cloud-native reference in frozen catalog', source=''))
                    save(force=False)
                    continue
                try:
                    url = gcs_url(source)
                    metadata = preloaded[url][2] if url in preloaded else transport.inspect(url)
                    if not str(metadata.get('generation', '')).isdigit() or int(metadata.get('size', 0)) <= 0 or not metadata.get('md5'):
                        raise ValueError('Incomplete object metadata')
                    item['generation'] = metadata['generation']
                    item['metadata'] = metadata
                    previous = prior.get((key, kind))
                    expected_hash = None
                    if recovery:
                        expected_hash = recovery.get({'gcs_mp3': 'originalSha256', 'gcs_mp4': 'sourceVideoSha256', 'derived_mp3_from_video': 'derivedSha256'}.get(kind, ''))
                        expected_generation = recovery.get({'gcs_mp3': 'originalGeneration', 'gcs_mp4': 'sourceVideoGeneration'}.get(kind, ''))
                        if expected_generation and str(metadata['generation']) != str(expected_generation):
                            raise ValueError('Preserved parent generation mismatch')
                        if role == 'derivative':
                            parent = prior.get((key, 'gcs_mp4'))
                            parent_verified = any(a.get('songKey') == key and a.get('kind') == 'gcs_mp4' and a.get('status') in ('saved', 'unchanged_verified') for a in receipt['assets'])
                            if not parent_verified or not parent or parent['sha256'] != recovery['sourceVideoSha256'] or digest(safe_path(root, parent['path']).read_bytes()) != parent['sha256']:
                                raise ValueError('Verified local parent video required for derivative')
                            item['source_video_path'] = parent['path']
                    baseline_ok = False
                    if previous:
                        previous_path = safe_path(root, previous['path'])
                        local = previous_path.read_bytes() if previous_path.exists() else b''
                        local_sha = digest(local)
                        baseline_ok = local_sha == previous.get('sha256') and len(local) == int(previous.get('bytes', -1))
                        if not baseline_ok:
                            item['baseline_issue'] = {'path': previous['path'], 'status': 'corrupt' if previous_path.exists() else 'missing',
                                                      'observed_sha256': local_sha if previous_path.exists() else None,
                                                      'expected_sha256': previous.get('sha256')}
                        if baseline_ok and (not expected_hash or local_sha == expected_hash) and len(local) == int(metadata['size']) and base64.b64encode(hashlib.md5(local).digest()).decode() == metadata['md5']:
                            item.update(status='unchanged_verified', path=previous['path'], bytes=len(local), sha256=local_sha,
                                        verification=getattr(transport, 'verification_context', 'Authenticated object metadata plus full local SHA256 and MD5; no body downloaded'))
                            source_state[url] = dict(metadata, path=previous['path'], sha256=local_sha)
                            save(force=False)
                            continue
                    require_disk_space(root, int(metadata['size']), min_free_bytes)
                    if shutil.disk_usage(root).free < int(metadata['size']) + 10 * 1024**3:
                        raise OSError('Insufficient disk reserve for preserved acquisition')
                    data, headers = preloaded[url][:2] if url in preloaded else transport.fetch(url, metadata['generation'])
                    validate_download(data, headers)
                    received = object_metadata(headers)
                    if received != metadata:
                        raise ValueError('Generation-pinned download metadata mismatch')
                    sha = digest(data)
                    if expected_hash and sha != expected_hash:
                        raise ValueError('Derived or original provenance SHA256 mismatch')
                    if previous and baseline_ok and previous.get('sha256') == sha:
                        previous_path = safe_path(root, previous['path'])
                        if not previous_path.exists() or digest(previous_path.read_bytes()) != sha:
                            raise ValueError('Existing inventory baseline failed; reconcile before recovery')
                        item.update(status='unchanged_verified', path=previous['path'], bytes=len(data), sha256=sha)
                    else:
                        relative = folder + '/' + name
                        path = safe_path(root, relative)
                        if previous or path.exists():
                            relative = folder + '/Versions/' + run_id + '/' + name
                            path = safe_path(root, relative)
                        path.parent.mkdir(parents=True, exist_ok=True)
                        item.update(status='saving', path=relative, bytes=len(data), sha256=sha)
                        require_disk_space(root, len(data), min_free_bytes)
                        save()
                        with path.open('xb') as stream:
                            stream.write(data)
                            stream.flush()
                            os.fsync(stream.fileno())
                        if digest(path.read_bytes()) != sha:
                            raise ValueError('Local SHA256 readback failed')
                        item.update(status='saved', path=relative, bytes=len(data), sha256=sha)
                        files.append({k: item[k] for k in FILE_FIELDS})
                        prior[(key, kind)] = files[-1]
                    source_state[url] = dict(metadata, path=item['path'], sha256=sha)
                except Exception as exc:
                    if isinstance(exc, InsufficientDiskSpace):
                        item.update(status='storage_blocked', required_free_bytes=exc.required, available_free_bytes=exc.available)
                        save()
                        raise
                    if isinstance(exc, AuthenticationError):
                        item.update(status='authentication_blocked', http_status=exc.http_status)
                        save()
                        raise
                    # No exception text: HTTP/proxy errors can embed signed URLs/tokens.
                    http_status = exc.code if isinstance(exc, urllib.error.HTTPError) else None
                    if isinstance(exc, urllib.error.HTTPError):
                        exc.close()
                    timed_out = isinstance(exc, TimeoutError) or (isinstance(exc, urllib.error.URLError) and isinstance(exc.reason, TimeoutError))
                    transient = timed_out or http_status == 429 or (http_status is not None and 500 <= http_status < 600)
                    item.update(status='download_failed', error_type=type(exc).__name__, http_status=http_status,
                                retryable=bool(transient), reason='source_object_missing' if http_status == 404 else
                                ('transient_transport_failure' if transient else 'download_or_integrity_failure'))
                    if not any(g.get('songKey') == key and g.get('asset') == kind for g in gaps):
                        gaps.append(dict(songKey=key, account=account, asset=kind, reason='Download or integrity validation failed; see run receipt', source=source))
                save(force=item.get('status') == 'saved')
        rows = list(by_key.values())
        updates = {'catalog.csv': csv_bytes(rows, ['songKey', 'account_sourceId', 'local_folder']),
                   'Catalog/files.csv': csv_bytes(files, FILE_FIELDS),
                   'Catalog/local-mirror-source-state.json': json.dumps(source_state, indent=2).encode(),
                   'Catalog/missing-files.csv': csv_bytes(gaps, GAP_FIELDS)}
        for sid, account in ACCOUNTS.items():
            updates[account + '/catalog.csv'] = csv_bytes([r for r in rows if r.get('account_sourceId') == sid], ['songKey', 'account_sourceId', 'local_folder'])
        latest = {}
        for f in files:
            if f.get('songKey'):
                latest[(f['songKey'], f['kind'])] = f
        page = ['<!doctype html><meta charset="utf-8"><title>Local SUNO library</title><h1>Local SUNO library</h1>',
                '<label>Search songs <input id="search" type="search" placeholder="Title, account, or file type"></label>',
                '<p>Native byte preservation; media completeness and historical gaps require review. Derived listening copies are labeled. <a href="Catalog/missing-files.csv">Unresolved gaps</a></p><table><thead><tr><th>Account</th><th>Title</th><th>Files</th></tr></thead><tbody>']
        unresolved = {(g.get('songKey'), g.get('asset')) for g in gaps}
        for row in rows:
            links = []
            for (key, kind), f in latest.items():
                if key == row['songKey']:
                    label = kind + (' (derived listening copy)' if kind.startswith('derived') else '')
                    if (key, kind) in unresolved:
                        label += ' (UNRESOLVED GAP; see inventory)'
                    links.append('<a href="' + urllib.parse.quote(f['path'], safe='/') + '">' + html.escape(label) + '</a>')
            page.append('<tr><td>' + html.escape(row.get('account_handle', '')) + '</td><td>' + html.escape(row.get('title', '')) + '</td><td>' + ' | '.join(links) + '</td></tr>')
        page.append('</tbody></table><script>document.getElementById("search").addEventListener("input",function(){const q=this.value.toLowerCase();document.querySelectorAll("tbody tr").forEach(r=>r.hidden=!r.textContent.toLowerCase().includes(q));});</script>')
        updates['index.html'] = '\n'.join(page).encode()
        # Stage every generated file and preserve all baselines before replacing any.
        receipt['commit_manifest'] = []
        for relative, data in updates.items():
            target = safe_path(root, relative)
            backup = run / 'before' / relative
            if target.exists():
                backup.parent.mkdir(parents=True, exist_ok=True)
                if not backup.exists():
                    shutil.copy2(target, backup)
                if digest(backup.read_bytes()) != digest(target.read_bytes()):
                    raise ValueError('Backup integrity failure')
            write_atomic(run / 'staged' / relative, data)
            receipt['commit_manifest'].append({'path': relative, 'sha256': digest(data),
                                               'before_sha256': digest(backup.read_bytes()) if backup.exists() else None,
                                               'backup_path': backup.relative_to(root).as_posix(),
                                               'staged_path': (run / 'staged' / relative).relative_to(root).as_posix()})
        receipt['status'] = 'committing'
        receipt['completion_status'] = 'partial' if gaps or any(a['status'] in ('download_failed', 'absent_source') for a in receipt['assets']) else 'complete'
        receipt['failures'] = [a for a in receipt['assets'] if a['status'] == 'download_failed']
        receipt['failure_count'] = len(receipt['failures'])
        receipt['retryable_failure_count'] = sum(a.get('retryable', False) for a in receipt['failures'])
        receipt['absent_reference_count'] = sum(a['status'] == 'absent_source' for a in receipt['assets'])
        receipt['added_files'] = [a for a in receipt['assets'] if a['status'] == 'saved']
        receipt['remaining_gap_rows'] = len(gaps)
        receipt['receipt_path'] = str(receipt_path.relative_to(root))
        receipt['evidence_status'] = 'pending'
        save()
        return finish_commit(root, run, receipt)
    except Exception as error:
        if receipt_path.exists():
            interrupted = json.loads(receipt_path.read_text())
            if isinstance(error, InsufficientDiskSpace):
                interrupted.update(status='blocked', retryable=False, blocker='insufficient_disk_reserve',
                                   required_free_bytes=error.required, available_free_bytes=error.available,
                                   receipt_path=str(receipt_path.relative_to(root)))
                write_atomic(receipt_path, json.dumps(interrupted, indent=2).encode())
                return interrupted
            if isinstance(error, AuthenticationError):
                interrupted.update(status='blocked', retryable=False, blocker='machine_authentication',
                                   http_status=error.http_status, error_type='AuthenticationError',
                                   receipt_path=str(receipt_path.relative_to(root)))
                write_atomic(receipt_path, json.dumps(interrupted, indent=2).encode())
                return interrupted
            if interrupted.get('status') == 'committing':
                interrupted.update(status='interrupted', retryable=True, reconciliation_required=False,
                                   receipt_path=str(receipt_path.relative_to(root)),
                                   staged_directory=str((run / 'staged').relative_to(root)),
                                   backup_directory=str((run / 'before').relative_to(root)))
                write_atomic(receipt_path, json.dumps(interrupted, indent=2).encode())
                return interrupted
        raise
    finally:
        lock.close()
