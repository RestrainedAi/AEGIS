import base64
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from local_mirror import ASSETS, SecureGcsTransport, csv_bytes, csv_rows, sync_catalog


def response(data):
    return data, {'Content-Length': str(len(data)), 'x-goog-generation': '1', 'x-goog-hash': 'md5=' + base64.b64encode(hashlib.md5(data).digest()).decode()}


class FakeTransport:
    def __init__(self, data=b'first', generation='1', fail=False):
        self.data, self.generation, self.fail = data, generation, fail
        self.bodies = 0

    def inspect(self, url):
        return {'generation': self.generation, 'size': len(self.data),
                'md5': base64.b64encode(hashlib.md5(self.data).digest()).decode()}

    def fetch(self, url, generation):
        self.bodies += 1
        if self.fail:
            raise OSError('Fake download failure')
        assert generation == self.generation
        data, headers = response(self.data)
        headers['x-goog-generation'] = generation
        return data, headers


class MirrorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.record = {'songKey': 'song-1', 'account_sourceId': 'suno_nessihenize',
                       'title': 'Hidden <song>', 'status': 'hidden',
                       **{k: 'gs://test-bucket/' + v for k, v in ASSETS.items()}}

    def catalog(self, records=None):
        return csv_bytes(records or [self.record], [])

    def test_hidden_selection_idempotence_backups_versions_and_handoff(self):
        other = dict(self.record, songKey='not-selected', account_sourceId='other')
        source = self.catalog([self.record, other])
        result = sync_catalog(self.root, source, 'run1', FakeTransport())
        self.assertEqual(result['status'], 'complete')
        self.assertEqual(result['selected_songs'], 1)
        self.assertEqual(len(result['assets']), 7)
        self.assertEqual(sync_catalog(self.root, source, 'run1', None), result)
        baseline = (self.root / 'catalog.csv').read_bytes()
        result2 = sync_catalog(self.root, source, 'run2', FakeTransport(b'second', '2'))
        self.assertTrue(all('/Versions/run2/' in f['path'] for f in result2['assets']))
        self.assertEqual((self.root / 'Catalog/Maintenance/run2/before/catalog.csv').read_bytes(), baseline)
        self.assertEqual((self.root / '02 - nessihenize/Songs/song-1/audio.mp3').read_bytes(), b'first')
        handoff = json.loads((self.root / result2['evidence_handoff']).read_text())
        self.assertFalse(handoff['canonical_evidence_database_modified'])
        self.assertIn('Hidden &lt;song&gt;', (self.root / 'index.html').read_text())

    def test_reuses_inventory_folder_and_preserves_native_gaps_and_derivatives(self):
        folder = '02 - nessihenize/Songs/Existing title -- song-1'
        (self.root / folder).mkdir(parents=True)
        (self.root / folder / 'audio.mp3').write_bytes(b'first')
        (self.root / 'Catalog').mkdir()
        rows = [{'songKey': 'song-1', 'kind': 'gcs_mp3', 'path': folder + '/audio.mp3',
                 'bytes': '5', 'sha256': hashlib.sha256(b'first').hexdigest(), 'source': 'old'},
                {'songKey': 'song-1', 'kind': 'derived_mp3_from_video', 'path': folder + '/Derived/audio.mp3', 'bytes': '6', 'sha256': 'old', 'source': 'video'}]
        (self.root / 'Catalog/files.csv').write_bytes(csv_bytes(rows, []))
        gap = {'songKey': 'song-1', 'asset': 'gcs_mp3', 'reason': 'Native MP3 incomplete'}
        (self.root / 'Catalog/missing-files.csv').write_bytes(csv_bytes([gap], []))
        result = sync_catalog(self.root, self.catalog(), 'run', FakeTransport())
        self.assertEqual(result['status'], 'partial')
        self.assertEqual(result['assets'][0]['status'], 'unchanged_verified')
        self.assertEqual(csv_rows((self.root / 'catalog.csv').read_bytes())[0]['local_folder'], folder)
        self.assertEqual(csv_rows((self.root / 'Catalog/missing-files.csv').read_bytes())[0]['reason'], gap['reason'])
        self.assertIn('derived listening copy', (self.root / 'index.html').read_text())

    def test_missing_reference_distinct_from_validation_failure(self):
        self.record['gcs_mp3'] = ''
        bad = FakeTransport()
        bad.fetch = lambda url, gen: (b'wrong', {'Content-Length': '1'})
        result = sync_catalog(self.root, self.catalog(), 'run', bad)
        self.assertEqual(result['assets'][0]['status'], 'absent_source')
        self.assertTrue(all(a['status'] == 'download_failed' for a in result['assets'][1:]))
        self.assertFalse(list(self.root.rglob('*.mp4')))

    def test_lock_and_traversal_rejected(self):
        maintenance = self.root / 'Catalog/Maintenance'
        maintenance.mkdir(parents=True)
        lock = maintenance / '.local-mirror.lock'
        from local_mirror import MirrorLock
        held = MirrorLock(lock)
        try:
            with self.assertRaises(FileExistsError):
                sync_catalog(self.root, self.catalog(), 'run', None)
        finally:
            held.close()
        self.assertTrue(lock.exists())
        lock.unlink()
        self.record['songKey'] = '../escape'
        with self.assertRaises(ValueError):
            sync_catalog(self.root, self.catalog(), 'run', None)

    def test_secure_transport_rejects_host_bucket_and_redirect_before_token(self):
        calls = []
        transport = SecureGcsTransport(['test-bucket'], lambda: calls.append(1) or 'SECRET')
        for source in ['https://evil.example/test-bucket/file', 'https://storage.googleapis.com.evil/test-bucket/file',
                       'https://storage.googleapis.com/other/file', 'http://storage.googleapis.com/test-bucket/file']:
            with self.assertRaises(ValueError):
                transport.inspect(source)
        self.assertEqual(calls, [])
        from local_mirror import _NoRedirect
        self.assertIsNone(_NoRedirect().redirect_request(None, None, 302, '', {}, 'https://evil.example'))

    def test_commit_interruption_keeps_backup_receipt_and_blocks_same_run(self):
        import local_mirror
        sync_catalog(self.root, self.catalog(), 'initial', FakeTransport())
        original = local_mirror.write_atomic
        def fail(path, data):
            if path == self.root / 'index.html':
                raise OSError('simulated crash')
            return original(path, data)
        with patch.object(local_mirror, 'write_atomic', side_effect=fail):
            result = sync_catalog(self.root, self.catalog(), 'interrupted', FakeTransport(b'next', '2'))
            self.assertEqual(result['status'], 'interrupted')
        receipt = json.loads((self.root / 'Catalog/Maintenance/interrupted/receipt.json').read_text())
        self.assertEqual(receipt['status'], 'interrupted')
        self.assertTrue((self.root / 'Catalog/Maintenance/interrupted/before/index.html').exists())
        self.assertEqual(sync_catalog(self.root, self.catalog(), 'interrupted', None)['status'], 'complete')
        self.assertEqual(sync_catalog(self.root, self.catalog(), 'another-run', FakeTransport(b'next', '2'))['status'], 'complete')

    def test_distinct_unchanged_run_downloads_no_bodies(self):
        transport = FakeTransport()
        sync_catalog(self.root, self.catalog(), 'first', transport)
        self.assertEqual(transport.bodies, 7)
        second = FakeTransport()
        result = sync_catalog(self.root, self.catalog(), 'second', second)
        self.assertEqual(second.bodies, 0)
        self.assertTrue(all(a['status'] == 'unchanged_verified' for a in result['assets']))

    def test_failed_generation_never_advances_state(self):
        sync_catalog(self.root, self.catalog(), 'first', FakeTransport())
        state = self.root / 'Catalog/local-mirror-source-state.json'
        before = json.loads(state.read_text())
        result = sync_catalog(self.root, self.catalog(), 'failed', FakeTransport(b'changed', '2', fail=True))
        self.assertEqual(result['failure_count'], 7)
        self.assertEqual(json.loads(state.read_text()), before)
        result = sync_catalog(self.root, self.catalog(), 'recovered', FakeTransport(b'changed', '2'))
        self.assertTrue(all('/Versions/recovered/' in a['path'] for a in result['added_files']))
        self.assertTrue(all(s['generation'] == '2' for s in json.loads(state.read_text()).values()))

    def test_generation_race_rejected_without_saving(self):
        fake = FakeTransport()
        def wrong_generation(url, generation):
            data, headers = response(b'first')
            headers['x-goog-generation'] = '2'
            return data, headers
        fake.fetch = wrong_generation
        result = sync_catalog(self.root, self.catalog(), 'race', fake)
        self.assertEqual(result['failure_count'], 7)
        self.assertEqual(result['added_files'], [])
        self.assertEqual(json.loads((self.root / 'Catalog/local-mirror-source-state.json').read_text()), {})

    def test_missing_and_corrupt_native_recovered_without_overwriting(self):
        sync_catalog(self.root, self.catalog(), 'initial', FakeTransport())
        folder = self.root / '02 - nessihenize/Songs/song-1'
        (folder / 'audio.mp3').write_bytes(b'corrupt-original')
        (folder / 'video.mp4').unlink()
        result = sync_catalog(self.root, self.catalog(), 'repair', FakeTransport())
        saved = result['added_files']
        self.assertEqual(len(saved), 2)
        self.assertEqual({a['baseline_issue']['status'] for a in saved}, {'missing', 'corrupt'})
        self.assertTrue(all('/Versions/repair/' in a['path'] for a in saved))
        self.assertEqual((folder / 'audio.mp3').read_bytes(), b'corrupt-original')

    def test_precommit_crash_reuses_saved_native_file(self):
        fake = FakeTransport()
        original = fake.fetch
        def interrupted(url, generation):
            if fake.bodies == 1:
                raise KeyboardInterrupt()
            return original(url, generation)
        fake.fetch = interrupted
        with self.assertRaises(KeyboardInterrupt):
            sync_catalog(self.root, self.catalog(), 'crash', fake)
        resumed = FakeTransport()
        result = sync_catalog(self.root, self.catalog(), 'crash', resumed)
        self.assertEqual(result['status'], 'complete')
        self.assertEqual(resumed.bodies, 6)
        self.assertEqual(len(result['added_files']), 7)

    def test_unknown_change_during_interrupted_commit_blocks(self):
        import local_mirror
        sync_catalog(self.root, self.catalog(), 'initial', FakeTransport())
        original = local_mirror.write_atomic
        def interrupted(path, data):
            if path == self.root / 'index.html':
                raise OSError()
            return original(path, data)
        with patch.object(local_mirror, 'write_atomic', side_effect=interrupted):
            sync_catalog(self.root, self.catalog(), 'crash', FakeTransport(b'new', '2'))
        (self.root / 'index.html').write_bytes(b'unrelated edit')
        result = sync_catalog(self.root, self.catalog(), 'crash', None)
        self.assertEqual(result['status'], 'blocked')
        self.assertEqual(result['conflict_path'], 'index.html')
        self.assertEqual((self.root / 'index.html').read_bytes(), b'unrelated edit')

    def test_latest_optional_distinct_and_search_preserved(self):
        self.record['gcs_latest_audio'] = 'gs://test-bucket/distinct.mp3'
        self.record['gcs_latest_mp4'] = self.record['gcs_mp4']
        result = sync_catalog(self.root, self.catalog(), 'latest', FakeTransport())
        self.assertEqual(len(result['assets']), 8)
        self.assertEqual(result['absent_reference_count'], 0)
        self.assertIn('type="search"', (self.root / 'index.html').read_text())
        handoff = json.loads((self.root / result['evidence_handoff']).read_text())
        self.assertTrue(all('/staged/' in a['path'] for a in handoff['generated']))

    def test_machine_auth_once_renewal_and_fail_fast(self):
        from unittest.mock import MagicMock
        import urllib.error
        from local_mirror import AuthenticationError
        refresh = []
        transport = SecureGcsTransport(['test-bucket'], lambda force=False: refresh.append(force) or 'token')
        opener = MagicMock()
        body = MagicMock()
        body.headers = response(b'first')[1]
        body.read.return_value = b'first'
        body.__enter__.return_value = body
        rejected = urllib.error.HTTPError('https://storage.googleapis.com/test-bucket/object', 401, 'Unauthorized', {}, None)
        opener.open.side_effect = [rejected, body]
        with patch('urllib.request.build_opener', return_value=opener):
            self.assertEqual(transport('gs://test-bucket/object')[0], b'first')
        self.assertEqual(refresh, [False, True])
        opener.open.side_effect = [rejected, rejected]
        with patch('urllib.request.build_opener', return_value=opener):
            result = sync_catalog(self.root, self.catalog(), 'auth', transport)
        self.assertEqual(result['status'], 'blocked')
        self.assertEqual(result['http_status'], 401)
        self.assertEqual(len(result['assets']), 1)
        self.assertNotIn('token', json.dumps(result))

    def test_absent_results_checkpoint_in_batches(self):
        import local_mirror
        records = [{'songKey': 'song-' + str(i), 'account_sourceId': 'suno_nessihenize'} for i in range(30)]
        original = local_mirror.write_atomic
        running_checkpoints = []
        def observe(path, data):
            if path.name == 'receipt.json':
                value = json.loads(data)
                if value['status'] == 'running':
                    running_checkpoints.append(len(value['assets']))
            return original(path, data)
        with patch.object(local_mirror, 'write_atomic', side_effect=observe):
            result = sync_catalog(self.root, self.catalog(records), 'batch', FakeTransport())
        self.assertEqual(running_checkpoints, [0, 100, 200])
        self.assertEqual(result['absent_reference_count'], 210)
        progress = json.loads((self.root / 'Catalog/Maintenance/batch/progress.json').read_text())
        self.assertEqual(progress['asset_results'], 210)
        self.assertEqual(progress['status'], 'partial')

    def test_http_missing_is_permanent_and_server_error_retryable(self):
        import urllib.error
        fake = FakeTransport()
        def missing(url):
            raise urllib.error.HTTPError(url, 404, 'not found', {}, None)
        fake.inspect = missing
        result = sync_catalog(self.root, self.catalog(), 'missing', fake)
        self.assertEqual(result['failure_count'], 7)
        self.assertEqual(result['retryable_failure_count'], 0)
        self.assertEqual(result['absent_reference_count'], 0)
        self.assertTrue(all(a['reason'] == 'source_object_missing' for a in result['failures']))
        def unavailable(url):
            raise urllib.error.HTTPError(url, 503, 'unavailable', {}, None)
        fake.inspect = unavailable
        result = sync_catalog(self.root, self.catalog(), 'unavailable', fake)
        self.assertEqual(result['retryable_failure_count'], 7)

    def test_disk_reserve_stops_before_download(self):
        from types import SimpleNamespace
        fake = FakeTransport()
        with patch('local_mirror.shutil.disk_usage', return_value=SimpleNamespace(free=100)):
            result = sync_catalog(self.root, self.catalog(), 'disk', fake, min_free_bytes=100)
        self.assertEqual(result['status'], 'blocked')
        self.assertEqual(result['blocker'], 'insufficient_disk_reserve')
        self.assertEqual(fake.bodies, 0)
        self.assertEqual(len(result['assets']), 1)


if __name__ == '__main__':
    unittest.main()
