import json
import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import test_receiver
from receiver_hold import guard_receiver


class LibraryOnlyTests(unittest.TestCase):
    def test_unresolved_download_failure_does_not_cache_verified_snapshot(self):
        with tempfile.TemporaryDirectory() as root:
            receiver, _, _ = test_receiver.Tests().setup_receiver(root, ['failed'],
                {'status':'partial','failure_count':1,'retryable_failure_count':0})
            self.addCleanup(receiver.db.close)
            receiver.library_only=True;receiver.discover()
            receiver.db.execute("INSERT INTO settings VALUES('catalog_sha256','old')");receiver.db.commit()
            event=receiver.db.execute('SELECT * FROM events').fetchone()
            receiver.integrate(event,b'catalog','2026-10-16T07:54:24Z',1)
            self.assertIsNone(receiver.db.execute("SELECT value FROM settings WHERE key='catalog_sha256'").fetchone())
            receiver.db.close()

    def test_equal_timestamp_skips_only_exact_verified_hash(self):
        from receiver import INDEX, PREFIX, object_url
        for same_hash in (True, False):
            with self.subTest(same_hash=same_hash), tempfile.TemporaryDirectory() as root:
                receiver, objects, calls = test_receiver.Tests().setup_receiver(root, ['equal'])
                self.addCleanup(receiver.db.close)
                receiver.library_only = True
                receipt_url = object_url(PREFIX+'equal/receipt.json', '3')
                receipt = json.loads(objects[receipt_url]); receipt['catalogGeneratedAt']='2026-10-16T07:54:24Z'
                objects[receipt_url] = json.dumps(receipt).encode()
                index = json.loads(objects[object_url(INDEX)])
                index['runs'][0]['sha256'] = hashlib.sha256(objects[receipt_url]).hexdigest()
                objects[object_url(INDEX)] = json.dumps(index).encode()
                expected_hash = receipt['artifacts']['catalog']['sha256']
                receiver.db.executemany('INSERT INTO settings VALUES(?,?)', [('catalog_watermark',receipt['catalogGeneratedAt']),('catalog_sha256',expected_hash if same_hash else '0'*64)])
                receiver.db.commit();receiver.discover()
                catalog_url=object_url(PREFIX+'equal/catalog.csv','2')
                if same_hash: del objects[catalog_url]  # Any catalog-body request would fail.
                result=receiver.process()
                self.assertEqual(len(calls),0 if same_hash else 1)
                if same_hash:self.assertEqual(result['status'],'already_verified_library_catalog')
                else:self.assertEqual(receiver.db.execute("SELECT value FROM settings WHERE key='catalog_sha256'").fetchone()[0],expected_hash)
                receiver.db.close()

    def test_old_receipt_skips_library_write_without_blocking_newer_events(self):
        with tempfile.TemporaryDirectory() as root:
            receiver, _, calls = test_receiver.Tests().setup_receiver(root, ['old1', 'old2'])
            self.addCleanup(receiver.db.close)
            receiver.library_only = True
            receiver.discover()
            receiver.db.execute("INSERT INTO settings VALUES('catalog_watermark','2026-10-16T01:00:00Z')")
            receiver.db.commit()
            for _ in range(2):
                self.assertEqual(receiver.process()['status'], 'superseded_library_catalog')
            self.assertIsNone(receiver.process())
            self.assertEqual(calls, [])
            receiver.db.close()

    def test_library_sync_never_dispatches_and_advances_watermark(self):
        with tempfile.TemporaryDirectory() as root:
            receiver, _, calls = test_receiver.Tests().setup_receiver(root, ['run1'])
            self.addCleanup(receiver.db.close)
            receiver.library_only = True
            receiver.outbox = 'must-not-use'
            receiver.tagging_adapter = 'must-not-use'
            receiver.discover()
            event = receiver.db.execute('SELECT * FROM events').fetchone()
            with patch('evidence_handoff.publish', side_effect=AssertionError('dispatch')), \
                 patch('evidence_handoff.read_ack', side_effect=AssertionError('ack')), \
                 patch('tagging_callback.enqueue', side_effect=AssertionError('tagging')):
                result = receiver.integrate(event, b'catalog', '2026-10-16T01:00:00Z', 1)
                receiver.enqueue_tagging({'anchor_handoff': 'old-handoff'})
                receiver.refresh_acknowledgments()
            self.assertEqual(len(calls), 1)
            self.assertEqual(receiver.status()[0]['status'], 'library_synced_evidence_held')
            self.assertEqual(result['evidence_status'], 'held')
            self.assertFalse(result['evidence_dispatch'])
            health = json.loads((receiver.state/'library-health.json').read_text())
            self.assertEqual(health['historical_gap_rows'], 310)
            self.assertFalse(health['historical_gap_rows_are_current_missing_files'])
            self.assertIsNone(health['current_absent_references'])
            self.assertEqual(receiver.db.execute('SELECT value FROM settings WHERE key="catalog_watermark"').fetchone()[0], '2026-10-16T01:00:00Z')
            receiver.db.close()

    def test_library_mode_preserves_historical_evidence_queue(self):
        with tempfile.TemporaryDirectory() as root:
            receiver, _, _ = test_receiver.Tests().setup_receiver(root, ['run1'])
            self.addCleanup(receiver.db.close)
            receiver.discover()
            receiver.db.execute("UPDATE events SET status='awaiting_evidence',result=?", (json.dumps({'anchor_handoff':'old'}),))
            receiver.db.commit()
            before = receiver.status()
            receiver.library_only = True
            receiver.refresh_acknowledgments()
            self.assertIsNone(receiver.process())
            self.assertEqual(before, receiver.status())
            receiver.db.close()

    def test_scoped_guard_preserves_hold_and_observer_wins(self):
        with tempfile.TemporaryDirectory() as directory:
            case = Path(directory)
            root = case / '_SUNO/library'; root.mkdir(parents=True)
            state = case / 'state'; state.mkdir()
            hold = case / '_management/trial_preparation/2026-10-05/search/CATALOG_MAINTENANCE_PAUSED.json'
            hold.parent.mkdir(parents=True); hold.write_text('{"status":"PAUSED"}')
            before = hold.read_bytes()
            args = ['receiver.py','once','--library-only','--root',str(root),'--state',str(state)]
            self.assertFalse(guard_receiver(args.copy()))
            status = json.loads((state/'hold-status.json').read_text())
            self.assertTrue(status['library_writes_allowed'])
            self.assertFalse(status['case_writes_allowed'])
            self.assertFalse(status['evidence_dispatch'])
            with patch('builtins.print'):
                self.assertTrue(guard_receiver(args + ['--observe-only']))
            self.assertFalse(json.loads((state/'hold-status.json').read_text())['receiver_processing'])
            self.assertEqual(before, hold.read_bytes())
            self.assertEqual(list(root.iterdir()), [])


if __name__ == '__main__': unittest.main()
