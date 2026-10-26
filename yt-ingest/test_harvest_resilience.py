import asyncio
import json
import os
import tempfile
import unittest
from unittest.mock import patch

import harvest_resilience as hr
import suno_wav


class PlaceholderTests(unittest.TestCase):
    def test_sil_placeholders_and_forbidden_are_not_ready(self):
        for url in ("https://cdn-o.suno.com/sil-100.mp3", "https://cdn1.suno.ai/sil-30.mp3?x=1",
                    "https://studio-api.prod.suno.com/api/forbidden"):
            self.assertTrue(hr.is_placeholder_audio_url(url), url)

    def test_real_audio_is_not_placeholder(self):
        for url in ("https://cdn1.suno.ai/682546f7-056b-46bd-8424-e6b8504f43de.mp3", "", None,
                    "https://cdn1.suno.ai/silence-song.mp3"):
            self.assertFalse(hr.is_placeholder_audio_url(url), url)

    def test_rate_limit_detection(self):
        self.assertTrue(hr.is_rate_limited({"detail": "Too many requests."}))
        self.assertTrue(hr.is_rate_limited({"status_code": 429}))
        self.assertFalse(hr.is_rate_limited({"clips": []}))
        self.assertFalse(hr.is_rate_limited(None))

    def test_backoff_grows_and_caps(self):
        self.assertEqual([hr.backoff_seconds(i) for i in (1, 2, 3, 4, 5, 9)], [15, 30, 60, 120, 240, 240])


class ChronicLedgerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, "ledger.json")

    def tearDown(self):
        self.tmp.cleanup()

    def night(self, results):
        ledger = hr.ChronicFailureLedger(self.path, threshold=2).load()
        out = ledger.classify(results)
        ledger.save()
        return out

    def test_repeat_failure_becomes_warning_after_threshold(self):
        bad = lambda: [{"clip_id": "a", "errors": ["audio not captured for a"]}]
        self.assertEqual(len(self.night(bad())[0]), 1)  # night 1: hard
        self.assertEqual(len(self.night(bad())[0]), 1)  # night 2: hard (now chronic)
        hard, warn = self.night(bad())                  # night 3: warning
        self.assertEqual((len(hard), len(warn)), (0, 1))

    def test_new_failure_is_still_hard_while_chronic_is_warned(self):
        for _ in range(2):
            self.night([{"clip_id": "old", "errors": ["x"]}])
        hard, warn = self.night([{"clip_id": "old", "errors": ["x"]}, {"clip_id": "new", "errors": ["y"]}])
        self.assertEqual([r["clip_id"] for r in hard], ["new"])
        self.assertEqual([r["clip_id"] for r in warn], ["old"])

    def test_success_clears_the_streak(self):
        for _ in range(2):
            self.night([{"clip_id": "a", "errors": ["x"]}])
        self.night([{"clip_id": "a", "errors": []}])
        self.assertEqual(len(self.night([{"clip_id": "a", "errors": ["x"]}])[0]), 1)
        data = json.load(open(self.path))
        self.assertEqual(data["clips"]["a"]["consecutive"], 1)

    def test_not_ready_is_always_a_warning(self):
        hard, warn = self.night([{"clip_id": "n", "errors": ["audio not ready"], "not_ready_only": True}])
        self.assertEqual((len(hard), len(warn)), (0, 1))

    def test_corrupt_ledger_starts_fresh(self):
        open(self.path, "w").write("{not json")
        ledger = hr.ChronicFailureLedger(self.path).load()
        self.assertEqual(ledger.entries, {})


class SunoWavTests(unittest.TestCase):
    def fake_http(self, routes):
        calls = []
        def http(url, method="GET", headers=None, data=None, timeout=30):
            calls.append((method, url, dict(headers or {})))
            for key, reply in routes:
                if key in url:
                    return reply() if callable(reply) else reply
            return 500, b"{}"
        return http, calls

    def clerk_routes(self):
        return [("/v1/client/sessions/", (200, json.dumps({"jwt": "JWT"}).encode())),
                ("/v1/client?", (200, json.dumps({"response": {"last_active_session_id": "sess"}}).encode()))]

    def test_only_listed_handles_with_cookie_are_enabled(self):
        with patch.dict(os.environ, {"SUNO_CLIENT_COOKIE": "c", "SUNO_WAV_HANDLES": "gravitystruth"}):
            self.assertTrue(suno_wav.wav_enabled_for("gravitystruth"))
            self.assertFalse(suno_wav.wav_enabled_for("nessihenize"))
        with patch.dict(os.environ, {"SUNO_CLIENT_COOKIE": ""}):
            self.assertFalse(suno_wav.wav_enabled_for("gravitystruth"))

    def test_owned_clip_returns_wav_url_and_cookie_is_only_sent_to_clerk(self):
        pending = iter([(200, b"{}"), (200, json.dumps({"wav_file_url": "https://cdn1.suno.ai/x.wav"}).encode())])
        routes = self.clerk_routes() + [("/convert_wav/", (204, b"")), ("/wav_file/", lambda: next(pending))]
        http, calls = self.fake_http(routes)
        with patch.dict(os.environ, {"SUNO_CLIENT_COOKIE": "secretvalue"}):
            url = suno_wav.wav_url_for_clip("clip", http=http, sleep=lambda s: None)
        self.assertEqual(url, "https://cdn1.suno.ai/x.wav")
        for method, u, headers in calls:
            if "studio-api" in u:
                self.assertNotIn("Cookie", headers)
                self.assertEqual(headers["Authorization"], "Bearer JWT")
            else:
                self.assertEqual(headers["Cookie"], "__client=secretvalue")

    def test_not_owned_clip_is_refused(self):
        routes = self.clerk_routes() + [("/convert_wav/", (403, b'{"detail":"Not allowed."}'))]
        http, _ = self.fake_http(routes)
        with patch.dict(os.environ, {"SUNO_CLIENT_COOKIE": "c"}):
            with self.assertRaises(suno_wav.WavUnavailable):
                suno_wav.wav_url_for_clip("clip", http=http, sleep=lambda s: None)

    def test_missing_cookie_is_unavailable(self):
        with patch.dict(os.environ, {"SUNO_CLIENT_COOKIE": ""}):
            with self.assertRaises(suno_wav.WavUnavailable):
                suno_wav.session_jwt(http=lambda *a, **k: (200, b"{}"))


class LaunchRetryTests(unittest.TestCase):
    def test_second_launch_attempt_is_used(self):
        import download_media_gcs as media

        class Chromium:
            def __init__(self):
                self.n = 0
            async def launch(self, **kw):
                self.n += 1
                if self.n == 1:
                    raise RuntimeError("Target page, context or browser has been closed")
                return "browser"

        class PW:
            chromium = Chromium()

        pw = PW()
        self.assertEqual(asyncio.run(media.launch_browser(pw, attempts=2, pause=0)), "browser")
        self.assertEqual(pw.chromium.n, 2)

    def test_launch_gives_up_after_attempts(self):
        import download_media_gcs as media

        class Chromium:
            async def launch(self, **kw):
                raise RuntimeError("boom")

        class PW:
            chromium = Chromium()

        with self.assertRaises(RuntimeError):
            asyncio.run(media.launch_browser(PW(), attempts=2, pause=0))


class ProcessClipNotReadyTests(unittest.TestCase):
    """A placeholder/stub is never uploaded and the song is a 'not ready' warning."""

    def run_clip(self, row, intercepted, wav=None):
        import download_media_gcs as media
        uploads = []

        def fake_stream(url, gs_uri, extra_headers=None, expected_seconds=None, rejects=None):
            uploads.append((url, gs_uri))
            if "sil-" in url or "stub" in url:
                if rejects is not None:
                    rejects.append("audio is a stub or too short: 0.060s")
                return False
            return gs_uri.endswith(".wav") and wav is not None

        async def fake_intercept(clip_id, handle):
            return intercepted

        patches = [
            patch.object(media, "gs_exists", side_effect=lambda uri: uri.endswith(".mp4") or uri.endswith(".jpg")),
            patch.object(media, "gs_audio_valid", return_value=False),
            patch.object(media, "gs_video_valid", return_value=False),
            patch.object(media, "stream_to_gcs", side_effect=fake_stream),
            patch.object(media, "stream_bytes_to_gcs", return_value=False),
            patch.object(media, "intercept_clip_media", side_effect=fake_intercept),
            patch.object(media.suno_wav, "wav_enabled_for", return_value=wav is not None),
            patch.object(media.suno_wav, "wav_url_for_clip", return_value=wav or ""),
            patch.object(media.time, "sleep", return_value=None),
        ]
        for p in patches:
            p.start()
        try:
            return asyncio.run(media.process_clip(row)), uploads
        finally:
            for p in reversed(patches):
                p.stop()

    def base_row(self, **kw):
        row = {"songKey": "682546f7-056b-46bd-8424-e6b8504f43de", "handle": "nessihenize",
               "reason": "missing_gcs:audio", "title": "The Volume Is Broken", "duration": "358.84",
               "audio_url": "https://cdn-o.suno.com/sil-100.mp3"}
        row.update(kw)
        return row

    def test_placeholder_manifest_url_is_skipped_and_reported_not_ready(self):
        result, uploads = self.run_clip(self.base_row(), {"audio_url": None, "placeholder_seen": True})
        self.assertFalse(result["audio"])
        self.assertTrue(result["not_ready_only"])
        self.assertFalse(any("sil-" in u for u, _ in uploads))  # never even fetched
        self.assertIn("not ready", result["errors"][0])

    def test_stub_stream_is_rejected_and_not_ready(self):
        result, _ = self.run_clip(self.base_row(audio_url=""),
                                  {"audio_url": "https://cdn1.suno.ai/stub.mp3", "audio_ext": "mp3"})
        self.assertTrue(result["not_ready_only"])

    def test_owned_song_uses_wav_fallback(self):
        row = self.base_row(handle="gravitystruth")
        result, uploads = self.run_clip(row, {"audio_url": None, "placeholder_seen": True},
                                        wav="https://cdn1.suno.ai/x.wav")
        self.assertTrue(result["audio"])
        self.assertEqual(result["audio_ext"], "wav")
        self.assertEqual(result["errors"], [])
        self.assertTrue(uploads[-1][1].endswith("/gravitystruth/682546f7-056b-46bd-8424-e6b8504f43de.wav"))


class SummarizeTests(unittest.TestCase):
    def test_without_ledger_not_ready_is_warning(self):
        import download_media_gcs as media
        hard, warn = media.summarize_failures(
            [{"clip_id": "a", "errors": ["x"]}, {"clip_id": "b", "errors": ["y"], "not_ready_only": True},
             {"clip_id": "c", "errors": []}], None)
        self.assertEqual([r["clip_id"] for r in hard], ["a"])
        self.assertEqual([r["clip_id"] for r in warn], ["b"])


class ProfileBackoffTests(unittest.TestCase):
    def test_too_many_requests_is_retried_with_backoff(self):
        import importlib.util, pathlib
        path = pathlib.Path(__file__).with_name("build_manifest_from_studio_api.py")
        spec = importlib.util.spec_from_file_location("bm_backoff", path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        song = "997ca73f-d7cc-429c-a03a-7af480a617a0"
        pages = [{"detail": "Too many requests."}, {"detail": "Too many requests."},
                 {"clips": [{"id": song}]}, {"clips": []}]
        waits = []
        with patch.object(mod, "curl_json", side_effect=pages):
            self.assertEqual(mod.fetch_profile_clip_ids("nessihenize", sleep=waits.append), [song])
        self.assertEqual(waits[:2], [15, 30])

    def test_gives_up_after_retries(self):
        import importlib.util, pathlib
        path = pathlib.Path(__file__).with_name("build_manifest_from_studio_api.py")
        spec = importlib.util.spec_from_file_location("bm_backoff2", path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        with patch.object(mod, "curl_json", return_value={"detail": "Too many requests."}):
            with self.assertRaises(mod.SunoProfileFetchError):
                mod.fetch_profile_clip_ids("nessihenize", sleep=lambda s: None)


class CatalogMediaExistenceTests(unittest.TestCase):
    def test_missing_objects_are_blanked(self):
        import rebuild_catalog as rc
        mp3 = "gs://aeonimus-suno-media/suno/handles/nessihenize/682546f7.mp3"
        mp4 = "gs://aeonimus-suno-media/suno/handles/nessihenize/682546f7.mp4"
        rows = [{"gcs_mp3": mp3, "gcs_latest_audio": mp3, "audio_url": mp3,
                 "gcs_mp4": mp4, "gcs_latest_mp4": mp4, "gcs_thumb": "", "gcs_latest_thumb": ""}]
        dropped = rc.drop_missing_media_paths(rows, {mp4})
        self.assertEqual(rows[0]["gcs_mp3"], "")
        self.assertEqual(rows[0]["gcs_latest_audio"], "")
        self.assertEqual(rows[0]["audio_url"], "")
        self.assertEqual(rows[0]["gcs_mp4"], mp4)
        self.assertEqual(dropped["gcs_mp3"], 1)

    def test_existing_and_non_gcs_paths_are_kept(self):
        import rebuild_catalog as rc
        mp3 = "gs://aeonimus-suno-media/suno/handles/a/b.mp3"
        rows = [{"gcs_mp3": mp3, "gcs_latest_audio": mp3, "audio_url": mp3, "gcs_thumb": "https://cdn/x.jpg"}]
        rc.drop_missing_media_paths(rows, {mp3})
        self.assertEqual(rows[0]["gcs_mp3"], mp3)
        self.assertEqual(rows[0]["gcs_thumb"], "https://cdn/x.jpg")


if __name__ == "__main__":
    unittest.main()
