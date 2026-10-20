import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from evidence_handoff import publish, read_ack


class EvidenceHandoffTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'library'
        self.root.mkdir()
        self.native = self.root / 'native.mp3'
        self.native.write_bytes(b'verified native fixture')
        self.result = {'run_id': 'fixture-run', 'catalog_sha256': 'a' * 64,
                       'added_files': [{'path': 'native.mp3', 'sha256': hashlib.sha256(self.native.read_bytes()).hexdigest(),
                                        'bytes': self.native.stat().st_size, 'songKey': 'song-1',
                                        'source': 'gs://aeonimus-suno-media/native.mp3'}]}
        self.outbox = Path(self.temp.name) / 'outbox'

    def handoff(self):
        return publish(self.root, self.result, self.outbox)

    def ack(self, handoff):
        body = json.loads(Path(handoff['path']).read_text())
        return {'schema_version': 'suno-evidence-ack/1', 'run_id': body['run_id'],
                'handoff_sha256': handoff['sha256'], 'sequence': 1, 'owner': 'Anchor',
                'at_utc': '2026-09-28T00:00:00Z', 'status': 'ACCEPTED', 'reasons': [],
                'verification': {'disk_hashes': 'verified', 'committed_mapping_readback': 'verified',
                                 'protected_rows': 'verified'}, 'exports': {'status': 'verified'},
                'mapping': [{'item_id': item['item_id'], 'path': item['path'], 'sha256': item['sha256'],
                             'evd_id': f'EVD-{i + 1}', 'disposition': 'new', 'verification_status': 'verified'}
                            for i, item in enumerate(body['items'])]}

    def write_ack(self, handoff, ack):
        path = Path(handoff['path']).parent / 'acknowledgment-0001.json'
        path.write_text(json.dumps(ack))

    def test_tampered_native_rejected_against_sync_baseline(self):
        self.native.write_bytes(b'changed after sync')
        with self.assertRaisesRegex(ValueError, 'sync verification'):
            self.handoff()
        self.assertFalse((self.outbox / 'fixture-run/evidence-handoff.json').exists())

    def test_tampered_handoff_cannot_rebind_acknowledgment(self):
        handoff = self.handoff()
        path = Path(handoff['path'])
        path.write_text(path.read_text() + '\n')
        forged = self.ack(handoff)
        forged['handoff_sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
        self.write_ack(handoff, forged)
        with self.assertRaisesRegex(ValueError, 'baseline changed'):
            read_ack(handoff)

    def test_incomplete_accepted_is_not_acceptance(self):
        handoff = self.handoff()
        complete = self.ack(handoff)
        for field in ('verification', 'exports'):
            with self.subTest(missing=field):
                incomplete = copy.deepcopy(complete)
                incomplete.pop(field)
                self.write_ack(handoff, incomplete)
                self.assertEqual(read_ack(handoff)['status'], 'UNACKNOWLEDGED')
        for field in ('path', 'sha256', 'evd_id', 'disposition', 'verification_status'):
            with self.subTest(mapping_missing=field):
                incomplete = copy.deepcopy(complete)
                incomplete['mapping'][0].pop(field)
                self.write_ack(handoff, incomplete)
                self.assertEqual(read_ack(handoff)['status'], 'UNACKNOWLEDGED')

    def test_complete_ack_acceptance_and_identical_dispatch(self):
        handoff = self.handoff()
        self.assertEqual(self.handoff(), handoff)
        self.write_ack(handoff, self.ack(handoff))
        self.assertEqual(read_ack(handoff)['status'], 'ACCEPTED')

    def test_deferred_canonical_hold_is_not_acceptance(self):
        handoff = self.handoff()
        ack = self.ack(handoff)
        ack.update(status='DEFERRED_HOLD', mapping=[], verification={}, exports={})
        self.write_ack(handoff, ack)
        self.assertEqual(read_ack(handoff)['status'], 'DEFERRED_HOLD')


if __name__ == '__main__':
    unittest.main()
