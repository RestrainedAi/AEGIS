import csv
import io
import json
import unittest
from unittest.mock import patch

from harvest_completion import (CATALOG, META, PREFIX, INDEX, Conflict, MetadataStorage,
                                encode, publish_completion)
from rebuild_catalog import FIELDNAMES, GCS_DEST


class Store:
    def __init__(self):
        self.objects = {}
        self.writes = []
        self.conflicts = 0
        self.counter = 0

    def get(self, name):
        return self.objects.get(name)

    def put(self, name, payload, generation=0, content_type=None):
        if name == INDEX and self.conflicts:
            self.conflicts -= 1
            raise Conflict()
        current = self.objects.get(name)
        if str(generation) != str(current[1] if current else 0):
            raise Conflict()
        self.counter += 1
        self.objects[name] = (payload, str(self.counter))
        self.writes.append(name)
        return str(self.counter)


class CompletionTests(unittest.TestCase):
    def setUp(self):
        self.store = Store()
        output = io.StringIO(newline='')
        writer = csv.DictWriter(output, fieldnames=FIELDNAMES)
        writer.writeheader()
        writer.writerow({'songKey': 'song-1', 'title': 'First'})
        self.csv = output.getvalue().encode()
        self.meta = encode({'artifact': GCS_DEST, 'generatedAt': '2026-09-28T00:00:00Z', 'rowCount': 1})
        self.store.put(CATALOG, self.csv)
        self.store.put(META, self.meta)

    def publish(self, run='run-1', **kwargs):
        return publish_completion(self.store, run, self.csv, self.meta,
                                  kwargs.pop('stages', {'media': 0, 'source': 0}),
                                  pause=lambda _: None, **kwargs)

    def test_exact_snapshot_and_partial_codes_preserved(self):
        receipt = self.publish(stages={'media': 2, 'source': 3, 'audioGaps': 4})
        self.assertEqual(receipt['status'], 'published_partial')
        self.assertEqual(receipt['stages'], {'media': 2, 'source': 3, 'audioGaps': 4})
        self.assertEqual(self.store.get(receipt['artifacts']['catalog']['object'])[0], self.csv)
        self.assertEqual(receipt['sourceCoverage'], {'status': 'unavailable'})
        self.assertEqual(json.loads(self.store.get(INDEX)[0])['runs'][0]['catalogGeneratedAt'],
                         receipt['catalogGeneratedAt'])

    def test_manual_run_id_supports_dots_and_200_characters(self):
        self.assertEqual(self.publish('a.' + 'b' * 198)['runId'], 'a.' + 'b' * 198)

    def test_concurrent_receipt_different_hash_or_stages_rejected(self):
        for mutation in ('hash', 'stages'):
            with self.subTest(mutation=mutation):
                self.setUp()
                original_put = self.store.put

                def interleaved(name, payload, generation=0, content_type=None):
                    if name.endswith('/receipt.json'):
                        winner = json.loads(payload)
                        if mutation == 'hash':
                            winner['artifacts']['catalog']['sha256'] = '0' * 64
                        else:
                            winner['stages']['media'] = 3
                        original_put(name, encode(winner), generation, content_type)
                    return original_put(name, payload, generation, content_type)

                self.store.put = interleaved
                with self.assertRaisesRegex(Conflict, 'differs'):
                    self.publish()
                self.assertIsNone(self.store.get(INDEX))

    def test_same_count_changed_csv_rejected_before_any_snapshot(self):
        self.store.put(CATALOG, self.csv.replace(b'First', b'Other'), self.store.get(CATALOG)[1])
        with self.assertRaisesRegex(ValueError, 'bytes differ'):
            self.publish()
        self.assertFalse(any(name.startswith(PREFIX) for name in self.store.objects))

    def test_bad_meta_rejected(self):
        self.meta = encode({'artifact': GCS_DEST, 'generatedAt': 'x', 'rowCount': 2})
        with self.assertRaises(ValueError):
            self.publish()

    def test_duplicate_run_does_not_write_again_even_when_latest_moves(self):
        first = self.publish()
        writes = len(self.store.writes)
        self.store.objects.pop(CATALOG)
        self.assertEqual(first, self.publish())
        self.assertEqual(writes, len(self.store.writes))

    def test_offline_index_keeps_all_runs_and_cas_retries(self):
        self.publish('run-1')
        self.store.conflicts = 2
        self.publish('run-2')
        index = json.loads(self.store.get(INDEX)[0])
        self.assertEqual([r['runId'] for r in index['runs']], ['run-1', 'run-2'])

    def test_index_failure_retains_receipt_and_replay_repairs_index(self):
        self.store.conflicts = 10
        with self.assertRaises(Conflict):
            self.publish(index_retries=2)
        self.assertIsNotNone(self.store.get(PREFIX + '/run-1/receipt.json'))
        self.store.conflicts = 0
        self.publish()
        self.assertEqual(len(json.loads(self.store.get(INDEX)[0])['runs']), 1)

    def test_concurrent_index_writer_is_preserved_after_conflict(self):
        original_put = self.store.put
        injected = False

        def interleaved(name, payload, generation=0, content_type=None):
            nonlocal injected
            if name == INDEX and not injected:
                injected = True
                original_put(INDEX, encode({'schemaVersion': 1, 'runs': [{'runId': 'other-run'}]}))
            return original_put(name, payload, generation, content_type)

        self.store.put = interleaved
        self.publish()
        self.assertEqual([r['runId'] for r in json.loads(self.store.get(INDEX)[0])['runs']],
                         ['other-run', 'run-1'])

    def test_interrupted_matching_snapshot_can_resume(self):
        self.store.put(PREFIX + '/run-1/catalog.csv', self.csv)
        self.publish()
        self.assertEqual(self.store.writes.count(PREFIX + '/run-1/catalog.csv'), 1)

    def test_conflicting_snapshot_is_preserved(self):
        name = PREFIX + '/run-1/catalog.csv'
        self.store.put(name, b'original')
        with self.assertRaisesRegex(ValueError, 'Immutable object'):
            self.publish()
        self.assertEqual(self.store.get(name)[0], b'original')

    def test_invalid_run_id_and_missing_stages_rejected(self):
        for run, stages in [('../outside', {'media': 0}), ('ok', {}), ('ok', {'media': True})]:
            with self.assertRaises(ValueError):
                self.publish(run, stages=stages)

    def test_cloud_identity_required_without_adc_fallback(self):
        with patch.dict('os.environ', {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, 'workload identity'):
                MetadataStorage()


if __name__ == '__main__':
    unittest.main()
