import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from receiver_hold import guard_receiver, hold_state, observe_once


class HoldTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.case = Path(self.tmp.name)
        self.root = self.case / '_SUNO/library'
        self.root.mkdir(parents=True)
        self.state = self.case / 'state'
        self.state.mkdir()
        self.hold = self.case / '_management/trial_preparation/2026-10-05/search/CATALOG_MAINTENANCE_PAUSED.json'
        self.hold.parent.mkdir(parents=True)
        self.hold.write_text(json.dumps({'status': 'PAUSED'}))

    def test_pause_observes_without_queue_master_or_hold_changes(self):
        before = self.hold.read_bytes()
        args = ['receiver.py', 'once', '--root', str(self.root), '--state', str(self.state)]
        with patch('builtins.print'):
            self.assertTrue(guard_receiver(args))
        status = json.loads((self.state / 'hold-status.json').read_text())
        self.assertFalse(status['case_writes_allowed'])
        self.assertFalse(status['sync_api_enabled'])
        self.assertFalse((self.state / 'queue.sqlite3').exists())
        self.assertEqual(list(self.root.iterdir()), [])
        self.assertEqual(self.hold.read_bytes(), before)

    def test_explicit_observer_does_not_release_with_file(self):
        self.hold.write_text(json.dumps({'status': 'RELEASED'}))
        self.assertTrue(hold_state(self.root)['case_writes_allowed'])
        self.assertFalse(observe_once(self.root, self.state, True)['case_writes_allowed'])

    def test_missing_malformed_hold_fails_closed(self):
        self.hold.unlink()
        self.assertFalse(hold_state(self.root)['case_writes_allowed'])
        self.hold.write_text('invalid')
        self.assertFalse(hold_state(self.root)['case_writes_allowed'])

    def test_watch_never_imports_receiver_or_dispatches(self):
        args = ['receiver.py', 'watch', '--observe-only', '--root', str(self.root), '--state', str(self.state)]
        with patch('receiver_hold.time.sleep', side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                guard_receiver(args)
        self.assertEqual(set(p.name for p in self.state.iterdir()), {'hold-status.json'})


if __name__ == '__main__':
    unittest.main()
