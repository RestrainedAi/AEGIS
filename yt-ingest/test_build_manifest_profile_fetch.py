import importlib.util
import pathlib
import unittest
from unittest.mock import patch


MODULE_PATH = pathlib.Path(__file__).with_name("build_manifest_from_studio_api.py")
SPEC = importlib.util.spec_from_file_location("build_manifest_from_studio_api", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class ProfileFetchTests(unittest.TestCase):
    def test_empty_page_does_not_import_playlist_or_user_ids(self):
        song = "997ca73f-d7cc-429c-a03a-7af480a617a0"
        playlist = "0c532db2-9462-49a7-a02d-e61b52b27b29"
        pages = [
            {"clips": [{"id": song}], "playlists": [{"id": playlist}]},
            {"clips": [], "playlists": [{"id": playlist}]},
        ]
        with patch.object(MODULE, "curl_json", side_effect=pages) as fetch:
            self.assertEqual(MODULE.fetch_profile_clip_ids("example"), [song])
            self.assertEqual(fetch.call_count, 2)

    def test_rejects_malformed_clips_instead_of_scanning_other_sections(self):
        for clips in (None, {}, "unavailable"):
            with self.subTest(clips=clips):
                with patch.object(MODULE, "curl_json", return_value={"clips": clips}):
                    with self.assertRaises(MODULE.SunoProfileFetchError):
                        MODULE.fetch_profile_clip_ids("example")

    def test_rejects_failed_profile_response_instead_of_returning_empty_account(self):
        with patch.object(MODULE, "curl_json", return_value={"error": "forbidden"}):
            with self.assertRaises(MODULE.SunoProfileFetchError):
                MODULE.fetch_profile_clip_ids("example")

    def test_allows_a_real_empty_profile(self):
        with patch.object(MODULE, "curl_json", return_value={"clips": []}):
            self.assertEqual(MODULE.fetch_profile_clip_ids("example"), [])


if __name__ == "__main__":
    unittest.main()
