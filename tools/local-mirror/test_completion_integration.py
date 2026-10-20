"""Real producer/receiver/mirror contract, replacing only storage network I/O."""
import base64
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from urllib.parse import parse_qs, unquote, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'yt-ingest'))
from harvest_completion import CATALOG, META, INDEX, Conflict, encode, publish_completion
from rebuild_catalog import FIELDNAMES, GCS_DEST
from local_mirror import ASSETS, SecureGcsTransport, csv_bytes, csv_rows, sync_catalog
from receiver import Receiver


class Storage:
    def __init__(self):
        self.objects = {}
        self.counter = 0

    def get(self, name):
        return self.objects.get(name)

    def put(self, name, payload, generation=0, content_type=None):
        prior = self.get(name)
        if str(generation) != str(prior[1] if prior else 0):
            raise Conflict()
        self.counter += 1
        self.objects[name] = (payload, str(self.counter))
        return str(self.counter)


class NetworkFixture(SecureGcsTransport):
    """Exercise real callable/inspect/fetch interfaces, never obtain a token."""
    def __init__(self, store):
        super().__init__({'aeonimus-workspaces', 'aeonimus-suno-media'},
                         lambda: (_ for _ in ()).throw(AssertionError('Network authentication attempted')))
        self.store = store
        self.bodies = 0

    def _request(self, source, method='GET'):
        parsed = urlsplit(source)
        bucket, name = unquote(parsed.path.lstrip('/')).split('/', 1)
        if bucket == 'aeonimus-workspaces':
            data, generation = self.store.get(name)
        elif bucket == 'aeonimus-suno-media':
            data, generation = ('native fixture ' + name).encode(), '1'
            if method != 'HEAD':
                self.bodies += 1
        else:
            raise AssertionError('Unexpected bucket')
        for field in ('generation', 'ifGenerationMatch'):
            if field in parse_qs(parsed.query):
                assert parse_qs(parsed.query)[field] == [generation]
        headers = {'Content-Length': str(len(data)), 'x-goog-generation': generation,
                   'x-goog-hash': 'md5=' + base64.b64encode(hashlib.md5(data).digest()).decode()}
        return headers if method == 'HEAD' else (data, headers)


class CompletionIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'library'
        self.root.mkdir()
        self.store = Storage()
        self.transport = NetworkFixture(self.store)
        self.receiver = Receiver(Path(self.temp.name) / 'receiver', self.root, self.transport, sync_catalog)
        self.addCleanup(self.receiver.db.close)

    def publish(self, run, day, title, published=None):
        row = {'songKey': 'song-1', 'account_sourceId': 'suno_nessihenize', 'title': title,
               **{kind: 'gs://aeonimus-suno-media/suno/nessihenize/' + name for kind, name in ASSETS.items()}}
        data = csv_bytes([row], FIELDNAMES)
        meta = encode({'artifact': GCS_DEST, 'generatedAt': f'2026-09-{day:02d}T00:00:00Z', 'rowCount': 1})
        for name, payload in [(CATALOG, data), (META, meta)]:
            current = self.store.get(name)
            self.store.put(name, payload, current[1] if current else 0)
        return publish_completion(self.store, run, data, meta, {'media': 0, 'source': 0},
                                  now=published or f'2026-09-{day:02d}T01:00:00Z', pause=lambda _: None)

    def drain(self):
        for _ in range(10):
            if self.receiver.process() is None:
                return
        self.fail('Queue did not settle within ten events')

    def test_two_offline_receipts_real_engine_and_duplicate_discovery(self):
        self.publish('manual.' + 'a' * 190, 27, 'Older')
        self.publish('run-new', 28, 'Newest')
        self.receiver.discover()
        self.drain()
        self.assertEqual(csv_rows((self.root / 'catalog.csv').read_bytes())[0]['title'], 'Newest')
        self.assertEqual(len(self.receiver.status()), 2)
        self.assertTrue(all(row['status'] == 'awaiting_evidence' for row in self.receiver.status()))
        self.assertEqual(self.transport.bodies, len(ASSETS))
        for event in self.receiver.status():
            result = json.loads(event['result'])
            self.assertTrue((self.root / result['evidence_handoff']).is_file())
        self.receiver.discover()
        self.drain()
        self.assertEqual(self.transport.bodies, len(ASSETS))

    def test_late_old_receipt_cannot_regress_published_catalog(self):
        self.publish('new', 28, 'Newest')
        self.receiver.discover()
        self.drain()
        before = (self.root / 'catalog.csv').read_bytes()
        # An older publication reaches the index after a newer one, with a later receipt clock.
        self.publish('late-old', 27, 'Older', published='2026-09-29T00:00:00Z')
        self.receiver.discover()
        with self.assertRaisesRegex(ValueError, 'reconciliation'):
            self.receiver.process()
        self.assertEqual((self.root / 'catalog.csv').read_bytes(), before)
        self.assertEqual(self.transport.bodies, len(ASSETS))
        old = next(row for row in self.receiver.status() if row['id'] == 'late-old')
        self.assertEqual(old['status'], 'blocked')

    def test_manual_request_uses_immutable_receipt_and_same_engine(self):
        self.publish('source-run', 28, 'Verified snapshot')
        self.receiver.enqueue_manual('a' * 32)
        self.store.objects.pop(CATALOG)
        self.store.objects.pop(META)
        self.drain()
        self.assertEqual(csv_rows((self.root / 'catalog.csv').read_bytes())[0]['title'], 'Verified snapshot')
        self.assertEqual(self.receiver.status()[0]['status'], 'awaiting_evidence')
        self.assertEqual(self.transport.bodies, len(ASSETS))

    def test_manual_stale_snapshot_uses_same_watermark_gate(self):
        self.publish('new', 28, 'Newest')
        self.receiver.discover()
        self.drain()
        before = (self.root / 'catalog.csv').read_bytes()
        self.publish('old', 27, 'Older')
        index, generation = self.store.get(INDEX)
        historical = json.loads(index)
        historical['runs'] = [row for row in historical['runs'] if row['runId'] == 'old']
        self.store.put(INDEX, encode(historical), generation)
        self.receiver.enqueue_manual('b' * 32)
        with self.assertRaisesRegex(ValueError, 'reconciliation'):
            self.receiver.process()
        self.assertEqual((self.root / 'catalog.csv').read_bytes(), before)
        self.assertEqual(self.receiver.status()[-1]['status'], 'blocked')
        watermark = self.receiver.db.execute("SELECT value FROM settings WHERE key='catalog_watermark'").fetchone()['value']
        self.assertEqual(watermark, '2026-09-28T00:00:00Z')


if __name__ == '__main__':
    unittest.main()
