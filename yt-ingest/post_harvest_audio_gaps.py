"""Reconcile known audio gaps after publication; inspect bytes only on change.

Runs inside the harvest job with its metadata service identity. Never downloads
from Suno, starts another job, replaces originals, or certifies native encoding.
"""
import hashlib
import json
import math
import os
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path


def validate_audio(path, expected):
    probe = subprocess.run(['ffprobe', '-v', 'error', '-show_format',
                            '-show_streams', '-of', 'json', str(path)],
                           capture_output=True, text=True, timeout=30)
    if probe.returncode:
        return {'status': 'blocked', 'reason': 'unreadable_audio'}
    data = json.loads(probe.stdout)
    duration = float(data['format']['duration'])
    if not math.isfinite(duration) or abs(duration - expected) > 2:
        return {'status': 'blocked', 'reason': 'duration_mismatch', 'duration': duration}
    decode = subprocess.run(['ffmpeg', '-v', 'error', '-xerror', '-i', str(path),
                             '-map', '0:a:0', '-f', 'null', '-'],
                            capture_output=True, timeout=120)
    if decode.returncode:
        return {'status': 'blocked', 'reason': 'decode_failed'}
    return {'status': 'audio_verified', 'duration': duration,
            'sha256': hashlib.sha256(Path(path).read_bytes()).hexdigest(),
            'native_encoding': 'not_established'}


def reconcile(items, previous, inspect, download, validate=validate_audio):
    """Errors never advance a generation, and unchanged failures are not retried."""
    records, changes, errors = {}, [], []
    for item in items:
        sid = item['songKey']
        baseline = previous.get(sid, item['baseline'])
        try:
            current = inspect(item)
            # Include the validation contract so changed duration requirements rerun.
            revision = [str(current['generation']), int(current['bytes']), item['expected_duration']]
            if revision == baseline['revision']:
                records[sid] = baseline
                continue
            if current['bytes'] < 16384:
                result = {'status': 'blocked', 'reason': 'missing_or_truncated'}
            elif current['bytes'] > 64 * 1024 * 1024:
                result = {'status': 'blocked', 'reason': 'manual_review_size_limit'}
            else:
                with tempfile.TemporaryDirectory(prefix='suno-gap-') as directory:
                    path = Path(directory) / 'audio'
                    download(item, current, path)
                    result = validate(path, item['expected_duration'])
            records[sid] = dict(result, revision=revision)
            changes.append({'songKey': sid, **records[sid]})
        except Exception as exc:
            records[sid] = baseline
            errors.append({'songKey': sid, 'error': type(exc).__name__})
    return {'records': records, 'changes': changes, 'errors': errors}


def main():
    from google.auth import compute_engine
    from google.cloud import storage
    from google.api_core.exceptions import NotFound
    # Explicit metadata credentials: never silently use a developer's personal ADC.
    if not os.environ.get('CLOUD_RUN_JOB'):
        raise RuntimeError('Run in the existing Cloud Run harvest job; local tests use fixtures')
    client = storage.Client(project=os.environ['PROJECT'], credentials=compute_engine.Credentials())
    root = Path(__file__).resolve().parent
    items = json.loads((root / 'fixtures/post_harvest_audio_gaps.json').read_text())
    bucket = client.bucket(os.environ.get('WORKSPACES_BUCKET', 'gs://aeonimus-workspaces').removeprefix('gs://'))
    state = bucket.blob('exports/suno/recovery/post-harvest-audio-gaps.json')
    try:
        state.reload(timeout=30)
        version = int(state.generation)
        previous = json.loads(state.download_as_text(if_generation_match=version, timeout=30))['records']
    except NotFound:
        version, previous = 0, {}

    def inspect(item):
        blob = client.bucket(item['bucket']).get_blob(item['object'], timeout=30)
        return {'generation': str(blob.generation), 'bytes': blob.size} if blob else {'generation': 'missing', 'bytes': 0}

    def download(item, current, path):
        blob = client.bucket(item['bucket']).blob(item['object'], generation=int(current['generation']))
        blob.download_to_filename(str(path), if_generation_match=int(current['generation']), timeout=120)

    result = reconcile(items, previous, inspect, download)
    result['checked_at'] = datetime.now(timezone.utc).isoformat()
    result['execution'] = os.environ.get('CLOUD_RUN_EXECUTION', '')
    result['scope'] = 'Known audio gaps only; full decode does not certify native encoding or Vault UI playback'
    Path('post_harvest_audio_gaps_status.json').write_text(json.dumps(result, indent=2))
    # Persist once initially, then only when evidence changes. CAS protects other writers.
    if version == 0 or result['changes']:
        state.upload_from_string(json.dumps(result, indent=2), content_type='application/json',
                                 if_generation_match=version, timeout=30)
    print(json.dumps({'audio_gap_changes': result['changes'], 'errors': result['errors'],
                      'unchanged': len(items) - len(result['changes']) - len(result['errors'])}))
    if result['errors']:
        raise SystemExit(2)


if __name__ == '__main__':
    main()
