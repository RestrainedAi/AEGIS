"""Exact approved 40-song local integration; default verifies local staged sources only.

Apply requires final cloud journals and authoritative frozen catalog. No network,
cloud writes, general queue processing, or canonical evidence writes are performed.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path
from datetime import datetime, timezone

from local_mirror import MirrorLock, csv_bytes, csv_rows, digest, gcs_url, sync_catalog, write_atomic
from evidence_handoff import publish

REPO = Path(__file__).resolve().parents[2]
VAULT = Path('E:/_Vanessa sux/___Divorce/_SUNO/Vanessa-Vault-decbb81b0b4a344b')
AUDIT = VAULT / 'runtime/latest20-audit-20261014'
MASTER = VAULT.parent / 'Vanessa-SUNO-Library'
PACKET = AUDIT / 'local-integration-20261015'
RUN_ID = 'suno-derived40-20261015'
KINDS = {'gcs_mp3', 'gcs_mp4', 'derived_mp3_from_video', 'audio_provenance_json'}


def sha_file(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def verify_plan(plan):
    items = plan['items']
    if len(items) != 40 or len({i['uuid'] for i in items}) != 40 or plan['counts']['remaining_stub_gaps'] != 33:
        raise ValueError('Exact approved 40/33 scope required')
    verified = []
    for item in items:
        if item.get('errors') or item['derived_audio'].get('native_original') is not False:
            raise ValueError('Invalid planned derivative')
        row = {'uuid': item['uuid'], 'account_sourceId': item['account_sourceId'], 'sources': {}}
        for kind in ('original_audio', 'source_video', 'derived_audio'):
            part = item[kind]; path = Path(part['local_path'])
            if not path.resolve().is_relative_to(AUDIT.resolve()) or sha_file(path) != part['sha256']:
                raise ValueError('Staged source path/hash mismatch: ' + item['uuid'])
            size = path.stat().st_size
            if part.get('bytes') is not None and size != part['bytes']:
                raise ValueError('Staged source size mismatch')
            row['sources'][kind] = {'path': str(path), 'sha256': part['sha256'], 'bytes': size}
        verified.append(row)
    return verified


class StagedRepairTransport:
    """Local bytes pinned to completed cloud-upload verification journals."""
    verification_context = 'Frozen completed cloud journal plus full local staged and destination SHA256/MD5; no network request'

    def __init__(self, objects):
        self.objects = objects

    def inspect(self, url):
        item = self.objects[gcs_url(url)]
        data = Path(item['path']).read_bytes()
        if digest(data) != item['sha256']:
            raise ValueError('Frozen local source changed')
        return {'generation': str(item['generation']), 'size': len(data), 'md5': base64.b64encode(hashlib.md5(data).digest()).decode()}

    def fetch(self, url, generation):
        item = self.objects[gcs_url(url)]
        meta = self.inspect(url)
        if meta['generation'] != str(generation):
            raise ValueError('Frozen local generation mismatch')
        data = Path(item['path']).read_bytes()
        if digest(data) != item['sha256']:
            raise ValueError('Frozen bytes changed before copy')
        return data, {'Content-Length': str(len(data)), 'x-goog-generation': str(generation), 'x-goog-hash': 'md5=' + meta['md5']}


def freeze_objects(items):
    objects = {}
    for item in items:
        journal_path = AUDIT / 'cloud-repair-journal' / (item['uuid'] + '.json')
        journal = json.loads(journal_path.read_text())
        if journal['status'] != 'stored_and_indexed_customer_verification_pending' or journal['item_sha256'] != digest(json.dumps(item, sort_keys=True).encode()):
            raise ValueError('Cloud journal not final for exact frozen plan')
        for kind, stage in (('original_audio', 'original_audio_verified'), ('source_video', 'source_video_verified'), ('derived_audio', 'derived_uploaded')):
            part, proof = item[kind], journal['stages'][stage]
            if proof['sha256'] != part['sha256'] or (part.get('generation') and str(proof['generation']) != str(part['generation'])):
                raise ValueError('Final journal source mismatch')
            url = item['upload']['target'] if kind == 'derived_audio' else part['source']
            objects[gcs_url(url)] = {'path': part['local_path'], **proof}
        recovery = journal['audioRecovery']
        provenance = {'uuid': item['uuid'], 'account_sourceId': item['account_sourceId'], 'audioRecovery': recovery,
                      'label': item['derived_audio']['label'], 'duration_seconds': item['derived_audio']['duration_seconds'],
                      'catalog_duration_seconds': item['derived_audio']['catalog_duration_seconds'],
                      'limitations': 'Derived listening copy; native MP3 remains incomplete. Semantic lyrics/identity not established by decode.'}
        data = json.dumps(provenance, sort_keys=True, indent=2).encode()
        proof = journal['stages']['provenance_uploaded']
        if digest(data) != proof['sha256'] or len(data) != proof['bytes']:
            raise ValueError('Reconstructed sidecar differs from verified uploaded bytes')
        frozen = PACKET / 'cloud-provenance' / (item['uuid'] + '.json')
        if frozen.exists():
            if frozen.read_bytes() != data: raise ValueError('Frozen sidecar conflict')
        else:
            write_atomic(frozen, data)
        objects[gcs_url(item['provenance_sidecar']['target'])] = {'path': str(frozen), **proof}
        frozen_journal = PACKET / 'cloud-journals' / journal_path.name
        data = journal_path.read_bytes()
        if frozen_journal.exists():
            if frozen_journal.read_bytes() != data: raise ValueError('Frozen journal conflict')
        else:
            write_atomic(frozen_journal, data)
    return objects


def bounded_rows(items, frozen_catalog, existing_rows):
    catalog_rows = csv_rows(frozen_catalog)
    source = {r['songKey']: r for r in catalog_rows}
    if len(source) != len(catalog_rows): raise ValueError('Duplicate authoritative catalog IDs')
    existing = {r['songKey']: r for r in existing_rows}
    selected = []
    for item in items:
        uid = item['uuid']; row = dict(existing[uid]); cloud = source[uid]
        if cloud['account_sourceId'] != item['account_sourceId'] or row['account_sourceId'] != item['account_sourceId']:
            raise ValueError('Account mismatch')
        expected = {'audio_url': item['upload']['target'], 'gcs_latest_audio': item['upload']['target'],
                    'gcs_mp3': item['original_audio']['source'], 'gcs_mp4': item['source_video']['source'],
                    'audio_original_url': item['original_audio']['source'], 'audio_provenance_url': item['provenance_sidecar']['target']}
        for field, expected_url in expected.items():
            if gcs_url(cloud.get(field, '')) != gcs_url(expected_url): raise ValueError('Authoritative catalog selection mismatch')
        for field in ('gcs_mp3', 'gcs_mp4'):
            if gcs_url(row[field]) != gcs_url(expected[field]): raise ValueError('Existing original locator differs')
        if cloud.get('audio_asset_role') != 'derived-from-video': raise ValueError('Derived catalog label missing')
        for field in ('audio_url','gcs_latest_audio','audio_original_url','audio_provenance_url','audio_asset_role'):
            row[field] = cloud[field]
        selected.append(row)
    return selected


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--catalog', type=Path)
    args = parser.parse_args()
    plan_path = AUDIT / 'cloud-repair-plan.json'; plan = json.loads(plan_path.read_text())
    verified = verify_plan(plan)
    PACKET.mkdir(exist_ok=True)
    report = {'at': datetime.now(timezone.utc).isoformat(), 'plan_sha256': sha_file(plan_path), 'verified_local_items': verified,
              'native_gaps_remaining': 33, 'master_mutated': False, 'cloud_calls': 0}
    source_report = PACKET / 'local-source-verification.json'
    if source_report.exists():
        previous = json.loads(source_report.read_text())
        if previous['plan_sha256'] != report['plan_sha256'] or previous['verified_local_items'] != verified:
            raise ValueError('Frozen source verification differs; reconcile rather than replace')
    else:
        write_atomic(source_report, json.dumps(report, indent=2).encode())
    if not args.apply:
        print(json.dumps({'status': 'PREPARED_NOT_INTEGRATED', 'verified': len(verified), 'packet': str(PACKET)})); return
    if args.catalog is None: raise ValueError('Authoritative frozen rebuilt catalog required')
    release = json.loads((PACKET / 'scoped-release.json').read_text())
    ids = {i['uuid'] for i in plan['items']}
    if set(release['song_ids']) != ids or release['plan_sha256'] != sha_file(plan_path) or release['status'] != 'AUTHORIZED_BOUNDED_INTEGRATION':
        raise ValueError('Exact scoped authorization required')
    lock = MirrorLock(VAULT / 'runtime/state/receiver.lock')
    try:
        objects = freeze_objects(plan['items'])
        before_rows = csv_rows((MASTER / 'catalog.csv').read_bytes())
        before_gaps = csv_rows((MASTER / 'Catalog/missing-files.csv').read_bytes())
        files = csv_rows((MASTER / 'Catalog/files.csv').read_bytes()); latest = {(f['songKey'],f['kind']):f for f in files}
        for item in plan['items']:
            for kind, part in (('gcs_mp3','original_audio'),('gcs_mp4','source_video')):
                baseline = latest[(item['uuid'],kind)]
                if baseline['sha256'] != item[part]['sha256'] or sha_file(MASTER / baseline['path']) != baseline['sha256']:
                    raise ValueError('Preserved native baseline requires reconciliation')
        catalog = args.catalog.read_bytes()
        subset = csv_bytes(bounded_rows(plan['items'], catalog, before_rows), [])
        result = sync_catalog(MASTER, subset, RUN_ID, StagedRepairTransport(objects), asset_kinds=KINDS)
        if result.get('status') not in ('complete','partial') or result.get('failure_count') or result.get('absent_reference_count'):
            raise ValueError('Bounded integration unfinished; inspect engine receipt')
        derivatives=[a for a in result['assets'] if a['kind']=='derived_mp3_from_video' and a['status'] in ('saved','unchanged_verified')]
        if len(derivatives)!=40 or any(a['kind'] not in ('derived_mp3_from_video','audio_provenance_json') for a in result['added_files']):
            raise ValueError('Unexpected acquired asset scope')
        if csv_rows((MASTER/'Catalog/missing-files.csv').read_bytes()) != before_gaps:
            raise ValueError('Historical gaps changed')
        after = {r['songKey']:r for r in csv_rows((MASTER/'catalog.csv').read_bytes())}
        if len(after)!=len(before_rows):raise ValueError('Catalog song count changed')
        for row in before_rows:
            if row['songKey'] not in ids and any(after[row['songKey']].get(k,'')!=row.get(k,'') for k in set(row)|set(after[row['songKey']])):
                raise ValueError('Unrelated catalog row changed')
        result['scoped_release']=str(PACKET/'scoped-release.json')
        result['authoritative_catalog_sha256']=digest(catalog)
        result['native_audio_unresolved_count']=33
        result['supporting_files']=[]
        supporting=[PACKET/'scoped-release.json',PACKET/'local-source-verification.json',PACKET/'transformation-provenance.json',
                    plan_path,AUDIT/'derived-recovery.json',AUDIT/'expanded-recovery/recovery.json',
                    VAULT/'runtime/recover_latest20.py',VAULT/'runtime/recover_stub_audio.py']
        supporting.extend(sorted((PACKET/'cloud-journals').glob('*.json')))
        for index,original in enumerate(supporting):
            data=original.read_bytes()
            destination=MASTER/'Catalog/Maintenance'/RUN_ID/'supporting'/f'{index:03d}-{original.name}'
            if destination.exists():
                if destination.read_bytes()!=data:raise ValueError('Immutable supporting provenance changed')
            else:write_atomic(destination,data)
            result['supporting_files'].append({'path':destination.relative_to(MASTER).as_posix(),'sha256':digest(data),'bytes':len(data)})
        handoff=publish(MASTER,result,VAULT.parent.parent/'_management/handoffs/suno_evidence')
        write_atomic(PACKET/'integration-result.json',json.dumps({'result':result,'anchor_handoff':handoff,'acceptance':'AWAITING_ANCHOR'},indent=2).encode())
        print(json.dumps({'status':'INTEGRATED_STAGED_AWAITING_ANCHOR','derivatives':len(derivatives),'added_files':len(result['added_files']),'historical_gap_rows':len(before_gaps),'handoff':handoff}))
    finally:
        lock.close()


if __name__ == '__main__':
    main()
