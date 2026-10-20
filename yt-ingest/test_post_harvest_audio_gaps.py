import unittest
from unittest.mock import Mock
from post_harvest_audio_gaps import reconcile


class ReconciliationTests(unittest.TestCase):
    def setUp(self):
        self.item = {'songKey': 'song', 'expected_duration': 180.,
                     'baseline': {'revision': ['1', 4844, 180.], 'status': 'blocked'}}

    def test_unchanged_truncation_never_downloaded(self):
        download = Mock()
        result = reconcile([self.item], {}, lambda _: {'generation': '1', 'bytes': 4844}, download)
        download.assert_not_called()
        self.assertEqual(result['changes'], [])
        self.assertEqual(result['records']['song']['status'], 'blocked')

    def test_new_valid_generation_checked_once_across_runs(self):
        download, validate = Mock(), Mock(return_value={'status': 'audio_verified'})
        inspect = lambda _: {'generation': '2', 'bytes': 3000000}
        first = reconcile([self.item], {}, inspect, download, validate)
        self.assertEqual(first['records']['song']['status'], 'audio_verified')
        second = reconcile([self.item], first['records'], inspect, download, validate)
        self.assertEqual(second['changes'], [])
        self.assertEqual(download.call_count, 1)

    def test_new_corrupt_generation_remains_blocked_without_repeated_decode(self):
        download, validate = Mock(), Mock(return_value={'status': 'blocked', 'reason': 'decode_failed'})
        inspect = lambda _: {'generation': '3', 'bytes': 3000000}
        first = reconcile([self.item], {}, inspect, download, validate)
        second = reconcile([self.item], first['records'], inspect, download, validate)
        self.assertEqual(second['records']['song']['status'], 'blocked')
        self.assertEqual(validate.call_count, 1)

    def test_service_failure_retains_prior_evidence(self):
        result = reconcile([self.item], {}, Mock(side_effect=PermissionError()), Mock())
        self.assertEqual(result['records']['song'], self.item['baseline'])
        self.assertEqual(len(result['errors']), 1)

    def test_missing_asset_is_not_downloaded(self):
        download = Mock()
        result = reconcile([self.item], {}, lambda _: {'generation': 'missing', 'bytes': 0}, download)
        download.assert_not_called()
        self.assertEqual(result['records']['song']['status'], 'blocked')


if __name__ == '__main__':
    unittest.main()
