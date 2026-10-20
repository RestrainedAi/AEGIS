"""Offline derivative preservation and handoff regression tests."""
import base64
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from local_mirror import csv_bytes, csv_rows, sync_catalog
from evidence_handoff import publish


def sha(data):
    return hashlib.sha256(data).hexdigest()


class DerivedDeliveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / 'library'
        self.root.mkdir()
        self.urls = {'original': 'https://storage.googleapis.com/test/native.mp3',
                     'video': 'https://storage.googleapis.com/test/source.mp4',
                     'derived': 'https://storage.googleapis.com/test/derived/listening.mp3',
                     'provenance': 'https://storage.googleapis.com/test/derived/provenance.json'}
        self.data = {self.urls['original']: b'native incomplete original', self.urls['video']: b'preserved video',
                     self.urls['derived']: b'derived listening copy'}
        self.record = {'songKey': 'song-1', 'account_sourceId': 'suno_nessihenize', 'title': 'A song',
                       'audio_asset_role': 'derived-from-video', 'audio_url': self.urls['derived'],
                       'gcs_latest_audio': self.urls['derived'], 'audio_original_url': self.urls['original'],
                       'audio_provenance_url': self.urls['provenance'], 'gcs_mp3': self.urls['original'],
                       'gcs_mp4': self.urls['video']}
        self.recovery = {'kind': 'derived-from-video', 'nativeOriginal': False,
                         'derivedAudioUrl': self.urls['derived'], 'derivedSha256': sha(self.data[self.urls['derived']]),
                         'originalAudioUrl': self.urls['original'], 'originalGeneration': '1',
                         'originalSha256': sha(self.data[self.urls['original']]),
                         'sourceVideoUrl': self.urls['video'], 'sourceVideoGeneration': '1',
                         'sourceVideoSha256': sha(self.data[self.urls['video']]), 'provenanceUrl': self.urls['provenance']}
        self.update_provenance()

    def update_provenance(self):
        self.data[self.urls['provenance']] = json.dumps({'uuid': 'song-1', 'account_sourceId': 'suno_nessihenize', 'audioRecovery': self.recovery}).encode()

    def inspect(self, url):
        data = self.data[url]
        return {'generation': '1', 'size': len(data), 'md5': base64.b64encode(hashlib.md5(data).digest()).decode()}

    def fetch(self, url, generation):
        meta = self.inspect(url)
        return self.data[url], {'Content-Length': str(meta['size']), 'x-goog-generation': generation, 'x-goog-hash': 'md5=' + meta['md5']}

    def sync(self, run='derived-test'):
        return sync_catalog(self.root, csv_bytes([self.record], []), run, self)

    def test_derivative_separate_original_and_parent_relationship(self):
        (self.root / 'Catalog').mkdir()
        gap = {'songKey': 'song-1', 'asset': 'gcs_mp3', 'reason': 'Native original incomplete'}
        (self.root / 'Catalog/missing-files.csv').write_bytes(csv_bytes([gap], []))
        result = self.sync()
        files = {a['kind']: a for a in result['added_files']}
        self.assertEqual(files['derived_mp3_from_video']['native_or_derivative'], 'derivative')
        self.assertFalse(files['derived_mp3_from_video']['native_original'])
        self.assertIn('/Derived/', files['derived_mp3_from_video']['path'])
        self.assertEqual((self.root / files['gcs_mp3']['path']).read_bytes(), self.data[self.urls['original']])
        self.assertEqual(files['audio_provenance_json']['native_or_derivative'], 'provenance_manifest')
        self.assertNotIn('gcs_latest_audio', files)
        self.assertEqual(csv_rows((self.root / 'Catalog/missing-files.csv').read_bytes())[0]['reason'], gap['reason'])
        self.assertIn('derived listening copy', (self.root / 'index.html').read_text())
        packet = publish(self.root, result, Path(self.tmp.name) / 'outbox')
        items = json.loads(Path(packet['path']).read_text())['items']
        derivative = next(i for i in items if i['role'] == 'derivative')
        self.assertEqual(derivative['relationships'][0]['target_sha256'], self.recovery['sourceVideoSha256'])
        self.assertFalse(derivative['provenance']['native_original'])
        second = self.sync('derived-repeat')
        self.assertEqual(second['added_files'], [])

    def test_unlabeled_or_original_replaced_rejected_before_library_write(self):
        self.record['audio_asset_role'] = ''
        with self.assertRaises(ValueError): self.sync()
        self.assertFalse((self.root / 'Catalog').exists())
        self.record['audio_asset_role'] = 'derived-from-video'
        self.record['gcs_mp3'] = self.urls['derived']
        with self.assertRaises(ValueError): self.sync()

    def test_bad_provenance_identity_blocks_no_assets(self):
        self.recovery['nativeOriginal'] = True
        self.update_provenance()
        result = self.sync()
        self.assertEqual(result['status'], 'blocked')
        self.assertEqual(result['blocker'], 'derived_provenance_invalid')
        self.assertFalse((self.root / 'catalog.csv').exists())

    def test_tampered_derived_hash_never_saved(self):
        self.data[self.urls['derived']] = b'changed but cloud transport hash valid'
        result = self.sync()
        self.assertTrue(any(a['kind'] == 'derived_mp3_from_video' for a in result['failures']))
        self.assertFalse(any(a['kind'] == 'derived_mp3_from_video' for a in result['added_files']))

    def test_handoff_rejects_native_mislabel(self):
        result = self.sync()
        asset = next(a for a in result['added_files'] if a['kind'] == 'derived_mp3_from_video')
        asset['native_or_derivative'] = 'native'
        with self.assertRaisesRegex(ValueError, 'cannot be published as native'):
            publish(self.root, result, Path(self.tmp.name) / 'outbox')

    def test_bounded_derivative_batch_does_not_add_unrelated_gaps(self):
        kinds={'gcs_mp3','gcs_mp4','derived_mp3_from_video','audio_provenance_json'}
        result=sync_catalog(self.root,csv_bytes([self.record],[]),'bounded',self,asset_kinds=kinds)
        self.assertEqual({a['kind'] for a in result['assets']},kinds)
        self.assertEqual(result['remaining_gap_rows'],0)
        self.assertEqual(result['absent_reference_count'],0)


if __name__ == '__main__':
    unittest.main()
