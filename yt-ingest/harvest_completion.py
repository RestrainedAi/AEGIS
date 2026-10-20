"""Durable publication journal for the read-only Windows mirror consumer.

The CLI uses only Cloud Run metadata identity. Tests inject an in-memory store.
Receipts certify published catalog bytes, never complete source/media coverage.
"""
import argparse
import hashlib
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BUCKET = 'aeonimus-workspaces'
PREFIX = 'exports/suno/harvest-completions'
INDEX = PREFIX + '/index.json'
CATALOG = 'exports/suno/latest_catalog_wide.csv'
META = 'exports/suno/latest_catalog_wide.meta.json'


class Conflict(Exception):
    pass


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode('utf-8')


def digest(payload):
    return hashlib.sha256(payload).hexdigest()


class MetadataStorage:
    """GCS JSON REST client; get returns (exact bytes, generation) or None."""
    def __init__(self):
        if not os.environ.get('CLOUD_RUN_JOB'):
            raise RuntimeError('Completion publication requires Cloud Run workload identity')
        self.token = ''
        self.expiry = 0

    def request(self, url, data=None, method='GET', content_type='application/json'):
        if time.monotonic() >= self.expiry:
            req = urllib.request.Request(
                'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
                headers={'Metadata-Flavor': 'Google'})
            with urllib.request.urlopen(req, timeout=15) as response:
                token = json.load(response)
            self.token = token['access_token']
            self.expiry = time.monotonic() + max(0, int(token['expires_in']) - 60)
        req = urllib.request.Request(url, data=data, method=method, headers={
            'Authorization': 'Bearer ' + self.token, 'Content-Type': content_type})
        try:
            with urllib.request.urlopen(req, timeout=120) as response:
                return response.read()
        except urllib.error.HTTPError as exc:
            if exc.code == 412:
                raise Conflict('Object generation changed') from None
            raise RuntimeError('Storage request failed: HTTP ' + str(exc.code)) from None

    def get(self, name):
        url = 'https://storage.googleapis.com/storage/v1/b/' + BUCKET + '/o/' + urllib.parse.quote(name, safe='')
        try:
            metadata = json.loads(self.request(url))
        except RuntimeError as exc:
            if str(exc) == 'Storage request failed: HTTP 404':
                return None
            raise
        generation = str(metadata['generation'])
        # Pin reads to metadata generation; never silently read a newer object.
        payload = self.request(url + '?alt=media&generation=' + generation)
        return payload, generation

    def put(self, name, payload, generation=0, content_type='application/json'):
        url = ('https://storage.googleapis.com/upload/storage/v1/b/' + BUCKET + '/o?' +
               urllib.parse.urlencode({'uploadType': 'media', 'name': name,
                                       'ifGenerationMatch': str(generation)}))
        return str(json.loads(self.request(url, payload, 'POST', content_type))['generation'])


def create_exact(store, name, payload, content_type='application/json'):
    try:
        return store.put(name, payload, 0, content_type)
    except Conflict:
        existing = store.get(name)
        if existing is None or existing[0] != payload:
            raise ValueError('Immutable object conflicts with run: ' + name)
        return existing[1]


def index_receipt(store, receipt, receipt_payload, generation, retries=6, pause=time.sleep):
    entry = {'runId': receipt['runId'], 'receiptObject': receipt['receiptObject'],
             'generation': str(generation), 'sha256': digest(receipt_payload),
             'publishedAt': receipt['publishedAt'], 'catalogGeneratedAt': receipt['catalogGeneratedAt'],
             'status': receipt['status']}
    for attempt in range(retries):
        current = store.get(INDEX)
        index = json.loads(current[0]) if current else {'schemaVersion': 1, 'runs': []}
        if index.get('schemaVersion') != 1 or not isinstance(index.get('runs'), list):
            raise ValueError('Invalid completion journal index')
        matches = [item for item in index['runs'] if item.get('runId') == receipt['runId']]
        if matches:
            if matches != [entry]:
                raise ValueError('Conflicting completion journal entry')
            return
        index['runs'].append(entry)
        try:
            store.put(INDEX, encode(index), current[1] if current else 0)
            return
        except Conflict:
            if attempt + 1 < retries:
                pause(min(0.1 * (2 ** attempt), 2))
    raise Conflict('Completion receipt retained; journal index update exhausted retries')


def publish_completion(store, run_id, csv_bytes, meta_bytes, stages, source=None,
                       now=None, index_retries=6, pause=time.sleep):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,199}', run_id):
        raise ValueError('Invalid run ID')
    receipt_name = PREFIX + '/' + run_id + '/receipt.json'
    existing = store.get(receipt_name)
    if existing:
        receipt = json.loads(existing[0])
        if receipt.get('schemaVersion') != 1 or receipt.get('runId') != run_id or receipt.get('receiptObject') != receipt_name:
            raise ValueError('Invalid existing completion receipt')
        index_receipt(store, receipt, existing[0], existing[1], index_retries, pause)
        return receipt
    from validate_published_catalog_export import validate
    remote_csv, remote_meta = store.get(CATALOG), store.get(META)
    if remote_csv is None or remote_meta is None:
        raise ValueError('Published catalog unavailable')
    validate(csv_bytes, meta_bytes, remote_csv[0], remote_meta[0])
    if csv_bytes != remote_csv[0] or meta_bytes != remote_meta[0]:
        raise ValueError('Published catalog bytes differ from this run')
    if not isinstance(stages, dict) or not stages:
        raise ValueError('Explicit stage results required')
    if any(type(code) is not int or code < 0 for code in stages.values()):
        raise ValueError('Stage results must be nonnegative exit codes')
    meta = json.loads(meta_bytes)
    artifacts = {}
    for kind, payload, published, content_type in [
        ('catalog', csv_bytes, remote_csv, 'text/csv'),
        ('metadata', meta_bytes, remote_meta, 'application/json'),
    ]:
        name = PREFIX + '/' + run_id + ('/catalog.csv' if kind == 'catalog' else '/catalog.meta.json')
        generation = create_exact(store, name, payload, content_type)
        artifacts[kind] = {'bucket': BUCKET, 'object': name, 'generation': str(generation),
                           'sha256': digest(payload), 'bytes': len(payload),
                           'publishedGeneration': published[1]}
    receipt = {'schemaVersion': 1, 'runId': run_id, 'receiptObject': receipt_name,
               'publishedAt': now or datetime.now(timezone.utc).isoformat(),
               'catalogGeneratedAt': meta['generatedAt'], 'rowCount': int(meta['rowCount']),
               'status': 'published_partial' if any(stages.values()) else 'published',
               'stages': stages, 'sourceCoverage': source if source is not None else {'status': 'unavailable'},
               'artifacts': artifacts, 'scope': 'Verified catalog publication; not complete media or source coverage'}
    payload = encode(receipt)
    try:
        generation = store.put(receipt_name, payload, 0)
    except Conflict:
        # Another invocation may have committed the same run with a different timestamp.
        existing = store.get(receipt_name)
        if existing is None:
            raise Conflict('Receipt disappeared after concurrent publication')
        winner = json.loads(existing[0])
        if winner.get('schemaVersion') != 1 or winner.get('runId') != run_id or winner.get('receiptObject') != receipt_name:
            raise ValueError('Invalid concurrent completion receipt')
        if (winner.get('stages') != receipt['stages'] or
                any(winner.get('artifacts', {}).get(kind, {}).get('sha256') != artifact['sha256']
                    for kind, artifact in receipt['artifacts'].items())):
            raise Conflict('Concurrent completion differs in artifact hashes or stage results')
        receipt, payload, generation = winner, existing[0], existing[1]
    index_receipt(store, receipt, payload, generation, index_retries, pause)
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-id', default=os.environ.get('CLOUD_RUN_EXECUTION'))
    parser.add_argument('--local-csv', default='latest_catalog_wide.csv')
    parser.add_argument('--local-meta', default='latest_catalog_wide.meta.json')
    parser.add_argument('--stage', action='append', required=True, help='NAME=EXIT_CODE; repeat for every stage')
    parser.add_argument('--source-report', help='Optional delta report JSON retained as source coverage evidence')
    args = parser.parse_args()
    if not args.run_id:
        parser.error('--run-id or CLOUD_RUN_EXECUTION required')
    stages = {}
    for stage in args.stage:
        name, value = stage.split('=', 1)
        if not name or name in stages:
            parser.error('Stage names must be nonempty and unique')
        stages[name] = int(value)
    source = json.loads(Path(args.source_report).read_text(encoding='utf-8')) if args.source_report else None
    receipt = publish_completion(MetadataStorage(), args.run_id,
                                 Path(args.local_csv).read_bytes(), Path(args.local_meta).read_bytes(),
                                 stages, source)
    print(json.dumps({'runId': receipt['runId'], 'status': receipt['status'], 'receiptObject': receipt['receiptObject']}))


if __name__ == '__main__':
    main()
