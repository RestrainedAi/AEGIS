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
MODULE.BACKOFF_BASE_SECONDS = 0


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


class FailSoftTests(unittest.TestCase):
    def test_rate_limited_clip_backs_off_then_succeeds(self):
        error = urllib.error.HTTPError("https://example.invalid", 429, "Too Many", {"Retry-After": "0"}, None)
        with patch.object(MODULE, "http_json", side_effect=[error, {"id": "k"}]) as call, patch.object(MODULE.time, "sleep") as sleep:
            self.assertEqual(MODULE.fetch_clip("k"), {"id": "k"})
            self.assertEqual(call.call_count, 2)
            sleep.assert_called_once()

    def test_persistent_401_becomes_access_error_after_max_attempts(self):
        error = urllib.error.HTTPError("https://example.invalid", 401, "Unauthorized", {}, None)
        with patch.object(MODULE, "http_json", side_effect=error) as call, patch.object(MODULE.shutil, "which", return_value=None), patch.object(MODULE.time, "sleep"):
            with self.assertRaises(MODULE.StudioApiAccessError):
                MODULE.fetch_clip("k")
            self.assertEqual(call.call_count, MODULE.SOURCE_MAX_ATTEMPTS)

    def test_google_401_refreshes_token_once(self):
        calls = []
        class Resp:
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def read(self): return b"ok"
        def opener(req, timeout=30):
            calls.append(req.get_header("Authorization"))
            if len(calls) == 1:
                raise urllib.error.HTTPError(req.full_url, 401, "Unauthorized", {}, None)
            return Resp()
        tokens = iter(["old", "new"])
        with patch.object(MODULE, "get_access_token", side_effect=lambda: next(tokens)), patch.object(MODULE, "invalidate_access_token") as inv, patch.object(MODULE.urllib.request, "urlopen", side_effect=opener):
            out = MODULE.google_urlopen(lambda t: MODULE.urllib.request.Request("https://x.invalid", headers=MODULE.fire_headers(t)))
        self.assertEqual(out, b"ok")
        inv.assert_called_once()
        self.assertEqual(calls, ["Bearer old", "Bearer new"])

    def test_report_upload_failure_does_not_crash_run(self):
        docs = [{"name": "songs/first"}]
        original_dir = os.getcwd()
        with tempfile.TemporaryDirectory() as directory:
            try:
                os.chdir(directory)
                err = urllib.error.HTTPError("https://x.invalid", 401, "Unauthorized", {}, None)
                with patch("sys.argv", ["enrich", "--apply", "--sleep", "0"]), patch.object(MODULE, "get_access_token", return_value="t"), patch.object(MODULE, "fetch_all_docs", return_value=docs), patch.object(MODULE, "should_consider", return_value=True), patch.object(MODULE, "fetch_clip", side_effect=MODULE.StudioApiAccessError("denied")), patch.object(MODULE, "patch_doc") as write, patch.object(MODULE, "google_urlopen", side_effect=err):
                    self.assertEqual(MODULE.main(), 3)
                    marked = write.call_args[0][2]
                    self.assertEqual(marked["metadataRetryPending"], {"booleanValue": True})
                report = json.loads(pathlib.Path("metadata_enrichment_report.json").read_text())
                self.assertEqual(report["markedForRetry"], 1)
            finally:
                os.chdir(original_dir)


class TokenCacheTests(unittest.TestCase):
    def test_token_refreshes_when_expired_and_after_invalidate(self):
        import importlib, sys
        sys.path.insert(0, str(MODULE_PATH.parent))
        gat = importlib.import_module("gcp_access_token")
        seq = iter(["a", "b", "c"])
        with patch.dict(os.environ, {"ACCESS_TOKEN": "", "TOKEN": ""}), patch.object(gat, "_metadata_server_token", side_effect=lambda: next(seq)):
            gat.invalidate_access_token()
            self.assertEqual(gat.get_access_token(), "a")
            self.assertEqual(gat.get_access_token(), "a")
            gat._TOKEN_EXPIRES_AT = 0
            self.assertEqual(gat.get_access_token(), "b")
            gat.invalidate_access_token()
            self.assertEqual(gat.get_access_token(), "c")


if __name__ == "__main__":
    unittest.main()
