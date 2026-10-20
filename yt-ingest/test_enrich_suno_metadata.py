import importlib.util
import pathlib
import unittest
import urllib.error
import json
import tempfile
import os
from types import SimpleNamespace
from unittest.mock import patch


MODULE_PATH = pathlib.Path(__file__).with_name("enrich_suno_metadata_from_studio_api.py")
SPEC = importlib.util.spec_from_file_location("enrich_suno_metadata", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class StudioAccessTests(unittest.TestCase):
    def test_fills_missing_source_numbers_and_preserves_existing_values(self):
        doc = {"name": "songs/test", "fields": {"likes": {"integerValue": "0"}}}
        result = MODULE.build_patch(doc, {"metadata": {"duration": 123.5}, "play_count": 42, "upvote_count": 9})
        self.assertEqual(result["duration"], {"doubleValue": 123.5})
        self.assertEqual(result["views"], {"doubleValue": 42})
        self.assertNotIn("likes", result)

    def test_forbidden_clip_api_is_reported_as_an_access_failure(self):
        error = urllib.error.HTTPError("https://example.invalid", 403, "Forbidden", {}, None)
        with patch.object(MODULE, "http_json", side_effect=error), patch.object(MODULE.shutil, "which", return_value=None):
            with self.assertRaises(MODULE.StudioApiAccessError):
                MODULE.fetch_clip("00000000-0000-0000-0000-000000000000")

    def test_public_client_recovers_urllib_denial(self):
        key = "00000000-0000-0000-0000-000000000000"
        error = urllib.error.HTTPError("https://example.invalid", 403, "Forbidden", {}, None)
        response = SimpleNamespace(returncode=0, stdout=json.dumps({"id": key}) + "\n200")
        with patch.object(MODULE, "http_json", side_effect=error), patch.object(MODULE.shutil, "which", return_value="curl"), patch.object(MODULE.subprocess, "run", return_value=response):
            self.assertEqual(MODULE.fetch_clip(key), {"id": key})

    def test_rejects_mismatched_fallback_identity(self):
        error = urllib.error.HTTPError("https://example.invalid", 403, "Forbidden", {}, None)
        response = SimpleNamespace(returncode=0, stdout='{"id":"wrong"}\n200')
        with patch.object(MODULE, "http_json", side_effect=error), patch.object(MODULE.shutil, "which", return_value="curl"), patch.object(MODULE.subprocess, "run", return_value=response):
            with self.assertRaises(ValueError): MODULE.fetch_clip("expected")

    def test_denied_first_song_does_not_skip_later_songs(self):
        docs = [{"name": "songs/first"}, {"name": "songs/second"}]
        original_dir = os.getcwd()
        with tempfile.TemporaryDirectory() as directory:
            try:
                os.chdir(directory)
                with patch("sys.argv", ["enrich", "--dry-run", "--sleep", "0"]), patch.object(MODULE, "get_access_token", return_value="test"), patch.object(MODULE, "fetch_all_docs", return_value=docs), patch.object(MODULE, "should_consider", return_value=True), patch.object(MODULE, "fetch_clip", side_effect=[MODULE.StudioApiAccessError("denied"), {"id": "second"}]) as fetch, patch.object(MODULE, "build_patch", return_value={"title": {"stringValue": "Recovered"}}), patch.object(MODULE, "patch_doc") as write:
                    self.assertEqual(MODULE.main(), 3)
                    self.assertEqual(fetch.call_count, 2)
                    write.assert_not_called()
                report = json.loads(pathlib.Path("metadata_enrichment_report.json").read_text())
                self.assertEqual(report["attempted"], 2)
                self.assertEqual(report["patched"], 1)
                self.assertEqual(report["unresolved"][0]["songKey"], "first")
            finally:
                os.chdir(original_dir)


if __name__ == "__main__":
    unittest.main()
