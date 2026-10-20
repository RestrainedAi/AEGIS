"""Additive tagging enqueue; never evidence registration or acceptance."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from datetime import datetime, timezone


def enqueue(handoff, adapter):
    manifest = Path(handoff['path']).resolve()
    digest = hashlib.sha256(manifest.read_bytes()).hexdigest()
    if digest != handoff['sha256']:
        raise ValueError('Tagging handoff hash changed')
    receipt = manifest.parent / 'tagging-callback.json'
    if receipt.exists():
        previous = json.loads(receipt.read_text(encoding='utf-8'))
        if previous.get('manifest_sha256') != digest:
            raise ValueError('Tagging callback baseline conflict')
        if previous.get('status') in ('queued', 'already_queued'):
            return previous
    completed = subprocess.run(
        [sys.executable, str(Path(adapter).resolve()), '--manifest', str(manifest), '--priority', '5'],
        capture_output=True, text=True, timeout=120,
        creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if completed.returncode:
        raise RuntimeError('Tagging adapter failed: ' + completed.stderr[-1000:])
    answer = json.loads(completed.stdout)
    if answer.get('status') not in ('queued', 'already_queued'):
        raise ValueError('Unexpected tagging adapter result')
    queued = Path(answer['path'])
    body = json.loads(queued.read_text(encoding='utf-8'))
    if body.get('source_manifest_sha256') != digest or len(body['items']) != int(answer['items']):
        raise ValueError('Tagging queue receipt mismatch')
    result = dict(answer, schema='sundrop-tagging-callback/1', manifest=str(manifest),
                  manifest_sha256=digest, queue_sha256=hashlib.sha256(queued.read_bytes()).hexdigest(),
                  at=datetime.now(timezone.utc).isoformat(), canonical_acceptance=False)
    temporary = receipt.with_suffix('.tmp')
    with temporary.open('w', encoding='utf-8') as stream:
        json.dump(result, stream, indent=2); stream.flush(); os.fsync(stream.fileno())
    os.replace(temporary, receipt)
    return result
