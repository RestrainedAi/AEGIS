import asyncio
import copy
import sys
import types
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import firestore_upsert as fu
from test_audio_recovery_upsert import DB, R

DERIVED = dict(R, originalMissing=True, originalGeneration="", originalSha256="")


def stub_firestore():
    stub = types.ModuleType("google.cloud.firestore")
    stub.transactional = lambda fn: fn
    return patch.dict(sys.modules, {"google.cloud.firestore": stub})


class UpsertWithDerivedRecovery(unittest.TestCase):
    def upsert(self, existing, **kw):
        db = DB([existing])
        with stub_firestore():
            ok = fu.upsert_song_after_download("uuid", "nessihenize", db=db, **kw)
        return ok, db

    def test_new_derived_recovery_selects_listening_copy(self):
        ok, db = self.upsert(None, has_audio=True, has_video=True, audio_recovery=dict(DERIVED, reused=True))
        self.assertTrue(ok)
        w = db.writes[0]
        self.assertEqual(w["media"]["audioUrl"], DERIVED["derivedAudioUrl"])
        self.assertTrue(w["gcs"]["audio"])
        self.assertTrue(w["media"]["audioRecovery"]["originalMissing"])
        self.assertNotIn("reused", w["media"]["audioRecovery"])

    def test_existing_recovery_wins_over_new_one(self):
        existing = {"media": {"audioUrl": R["derivedAudioUrl"], "audioRecovery": copy.deepcopy(R)}}
        other = dict(DERIVED, derivedAudioUrl="gs://bucket/derived/other.mp3")
        ok, db = self.upsert(existing, has_audio=True, audio_recovery=other)
        self.assertTrue(ok)
        self.assertEqual(db.writes[0]["media"]["audioUrl"], R["derivedAudioUrl"])
        self.assertEqual(db.writes[0]["media"]["audioRecovery"], R)

    def test_rejects_unverified_recovery(self):
        ok, db = self.upsert(None, has_audio=True, audio_recovery=dict(DERIVED, nativeOriginal=True))
        self.assertFalse(ok)
        self.assertEqual(db.writes, [])

    def test_native_superseded_selection_is_kept(self):
        native = "gs://aeonimus-suno-media/suno/handles/nessihenize/uuid.mp3"
        rec = dict(DERIVED, nativeSupersededAt="2026-10-28T00:00:00Z", nativeAudioUrl=native)
        existing = {"media": {"audioUrl": native, "audioExt": "mp3", "audioRecovery": rec}}
        ok, db = self.upsert(existing, has_audio=True, audio_ext="mp3")
        self.assertTrue(ok)
        self.assertEqual(db.writes[0]["media"]["audioUrl"], native)
        self.assertNotIn("audioRecovery", db.writes[0]["media"])  # merge keeps the stored record

    def test_superseded_flag_with_mismatched_url_still_fails_closed(self):
        rec = dict(DERIVED, nativeSupersededAt="x", nativeAudioUrl="gs://b/native.mp3")
        existing = {"media": {"audioUrl": "gs://b/other.mp3", "audioRecovery": rec}}
        ok, db = self.upsert(existing, has_audio=True)
        self.assertFalse(ok)


class NativeVersionPayload(unittest.TestCase):
    NATIVE = "gs://b/suno/handles/h/uuid.mp3"

    def test_new_version_is_next_number_and_keeps_history(self):
        existing = {"currentVersion": 1, "media": {"audioRecovery": dict(DERIVED)}}
        v1 = {"n": 1, "metadata": {"title": "T"}, "metadataSha256": "m", "source": {"cover": {"url": "u"}},
              "assets": {"audio": {"status": "missing", "derivedCandidate": {}}, "video": {"status": "ok"}}}
        versions, head = fu.native_version_payload(existing, v1, self.NATIVE, "mp3", "a" * 64, "77", "AT", "run")
        self.assertEqual([v["n"] for v in versions], [2])
        v2 = versions[0]
        self.assertEqual(v2["changedFields"], ["audio"])
        self.assertEqual(v2["assets"]["audio"]["gcs"], self.NATIVE)
        self.assertEqual(v2["assets"]["video"], {"status": "ok"})
        self.assertEqual(v2["metadata"], {"title": "T"})
        self.assertEqual(v2["supersedes"]["derivedAudioUrl"], DERIVED["derivedAudioUrl"])
        self.assertEqual(head["currentVersion"], 2)
        self.assertEqual(head["media.audioUrl"], self.NATIVE)
        self.assertEqual(head["media.audioRecovery.nativeAudioUrl"], self.NATIVE)
        self.assertFalse(any(k == "media.audioRecovery" for k in head))  # record kept, only extended
        self.assertEqual(v1["assets"]["audio"]["status"], "missing")       # previous version untouched

    def test_unversioned_song_gets_derived_v1_then_native_v2(self):
        existing = {"media": {"audioRecovery": dict(DERIVED)}}
        versions, head = fu.native_version_payload(existing, {}, self.NATIVE, "mp3", "a" * 64, "7", "AT", "r")
        self.assertEqual([v["n"] for v in versions], [1, 2])
        self.assertTrue(versions[0]["assets"]["audio"]["derived"])
        self.assertEqual(head["currentVersion"], 2)

    def test_requires_pinned_native_and_open_recovery(self):
        existing = {"currentVersion": 1, "media": {"audioRecovery": dict(DERIVED)}}
        with self.assertRaises(ValueError):
            fu.native_version_payload(existing, {}, self.NATIVE, "mp3", "nothex", "7", "AT", "r")
        with self.assertRaises(ValueError):
            fu.native_version_payload(existing, {}, self.NATIVE, "mp3", "a" * 64, "", "AT", "r")
        done = {"currentVersion": 2, "media": {"audioRecovery": dict(DERIVED, nativeSupersededAt="x")}}
        with self.assertRaises(ValueError):
            fu.native_version_payload(done, {}, self.NATIVE, "mp3", "a" * 64, "7", "AT", "r")
        with self.assertRaises(ValueError):
            fu.native_version_payload({"media": {}}, {}, self.NATIVE, "mp3", "a" * 64, "7", "AT", "r")


class ProcessClipFallback(unittest.TestCase):
    """download_media_gcs.process_clip: native refused -> derive from stored, verified MP4."""

    def setUp(self):
        import download_media_gcs as dm
        self.dm = dm
        self.store = {dm.gcs_path("nessihenize", "abc", "mp4"), dm.gcs_path("nessihenize", "abc", "jpg")}
        self.patches = [
            patch.object(dm, "gs_exists", lambda uri: uri in self.store),
            patch.object(dm, "gs_audio_valid", lambda uri, d=None: uri in self.store),
            patch.object(dm, "gs_video_valid", lambda uri, d=None: uri in self.store),
            patch.object(dm, "stream_to_gcs", lambda *a, **k: False),
            patch.object(dm, "intercept_clip_media", self.fake_intercept),
            patch.object(dm, "MAX_RETRIES", 1),
        ]
        for p in self.patches:
            p.start()
        self.derive_calls = []
        self.native = {}

    def tearDown(self):
        for p in reversed(self.patches):
            p.stop()

    async def fake_intercept(self, clip_id, handle):
        return self.native

    def derive(self, handle, clip_id, video_gs, duration, native_error=""):
        self.derive_calls.append(video_gs)
        return dict(DERIVED, derivedAudioUrl="gs://b/derived/abc/sha/listening-copy.mp3")

    def run_clip(self, **row):
        base = {"songKey": "abc", "handle": "nessihenize", "reason": "missing_gcs:mp3", "title": "t"}
        base.update(row)
        with patch.object(self.dm.derived_audio, "derive_listening_copy", self.derive):
            return asyncio.run(self.dm.process_clip(base))

    def test_native_refused_derives_from_stored_video(self):
        res = self.run_clip()
        self.assertEqual(self.derive_calls, [self.dm.gcs_path("nessihenize", "abc", "mp4")])
        self.assertTrue(res["audio"])
        self.assertEqual(res["audio_ext"], "mp3")
        self.assertTrue(res["audio_recovery"]["originalMissing"])
        self.assertEqual(res["errors"], [])

    def test_no_verified_video_means_no_derive_and_error(self):
        self.store.clear()
        res = self.run_clip()
        self.assertEqual(self.derive_calls, [])
        self.assertFalse(res["audio"])
        self.assertTrue(any("audio not captured" in e for e in res["errors"]))

    def test_derive_failure_is_reported(self):
        def boom(*a, **k):
            raise RuntimeError("ffmpeg is a GPL/nonfree build; refusing")
        with patch.object(self.dm.derived_audio, "derive_listening_copy", boom):
            res = asyncio.run(self.dm.process_clip({"songKey": "abc", "handle": "nessihenize",
                                                    "reason": "missing_gcs:mp3"}))
        self.assertFalse(res["audio"])
        self.assertTrue(res["errors"])

    def test_retained_rows_never_derive(self):
        res = self.run_clip(reason="retained:missing_gcs:mp3")
        self.assertEqual(self.derive_calls, [])

    def test_recovered_song_not_due_skips_native_attempt(self):
        nxt = (datetime.now(timezone.utc) + timedelta(days=3)).isoformat()
        res = self.run_clip(audioRecoveryKind="derived-from-video", nativeRetryNextAt=nxt)
        self.assertTrue(res.get("audio_deferred"))
        self.assertEqual(res["errors"], [])
        self.assertEqual(self.derive_calls, [])

    def test_recovered_song_due_and_still_refused_schedules_next_week(self):
        past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        res = self.run_clip(audioRecoveryKind="derived-from-video", nativeRetryNextAt=past,
                            nativeRetryAttempts="2")
        self.assertEqual(self.derive_calls, [])
        self.assertEqual(res["errors"], [])
        self.assertEqual(res["native_retry"]["attempts"], 3)
        nxt = datetime.fromisoformat(res["native_retry"]["nextAttemptAt"])
        self.assertGreater(nxt - datetime.now(timezone.utc), timedelta(days=6))

    def test_recovered_song_native_finally_served_is_flagged_for_new_version(self):
        past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        self.native = {"audio_bytes": b"native", "audio_ext": "mp3"}
        with patch.object(self.dm, "stream_bytes_to_gcs", lambda *a, **k: True):
            res = self.run_clip(audioRecoveryKind="derived-from-video", nativeRetryNextAt=past)
        self.assertTrue(res["audio"])
        self.assertTrue(res["native_after_recovery"])
        self.assertNotIn("audio_recovery", res)



class StubAudioCountsAsMissing(ProcessClipFallback):
    """Suno now serves a ~0.06 s stub instead of a 403: it must be treated as missing audio."""

    def test_stub_bytes_rejected_before_upload_and_video_fallback_runs(self):
        from audio_integrity import InvalidAudio
        uploads = []

        def stub_validate(path, expected_seconds=None):
            raise InvalidAudio("audio is a stub or too short: 0.061s")

        def fake_run(cmd, *a, **k):
            uploads.append(cmd)
            raise AssertionError("no gsutil call may happen for a rejected stub")

        self.native = {"audio_bytes": b"\xff\xfb" * 40, "audio_ext": "mp3"}
        with patch.object(self.dm, "validate_audio", stub_validate), \
             patch.object(self.dm.subprocess, "run", fake_run):
            res = self.run_clip(duration=200)
        self.assertEqual(uploads, [])
        self.assertEqual(self.derive_calls, [self.dm.gcs_path("nessihenize", "abc", "mp4")])
        self.assertTrue(res["audio"])
        self.assertEqual(res["audio_ext"], "mp3")
        self.assertEqual(res["errors"], [])

    def test_stored_stub_native_file_is_not_accepted_and_is_not_overwritten(self):
        stub_uri = self.dm.gcs_path("nessihenize", "abc", "mp3")
        # Object exists in GCS but fails byte validation (stub).
        with patch.object(self.dm, "gs_exists", lambda uri: uri in self.store or uri == stub_uri):
            res = self.run_clip()
        self.assertEqual(self.derive_calls, [self.dm.gcs_path("nessihenize", "abc", "mp4")])
        self.assertTrue(res["audio"])
        self.assertIn("audio_recovery", res)

    def test_real_validator_rejects_short_stub(self):
        import audio_integrity as ai
        from audio_integrity import InvalidAudio
        import json as _json

        class P:
            def __init__(self, rc, out):
                self.returncode, self.stdout = rc, out

        def fake_run(cmd, *a, **k):
            if "-show_entries" in cmd:
                return P(0, _json.dumps({"streams": [{"codec_type": "audio"}]}))
            return P(0, "out_time_us=61000\nprogress=end\n")

        with patch.object(ai.shutil, "which", lambda n: "/usr/bin/" + n), \
             patch.object(ai.subprocess, "run", fake_run):
            with self.assertRaises(InvalidAudio) as ctx:
                ai.validate_audio("stub.mp3", 200)
        self.assertIn("stub or too short", str(ctx.exception))

class ProcessAllWiring(unittest.TestCase):
    def test_native_after_recovery_records_version_before_upsert(self):
        import download_media_gcs as dm
        order = []
        async def fake_clip(row):
            return {"clip_id": "abc", "audio": True, "audio_ext": "mp3", "video": True, "thumb": True,
                    "errors": [], "native_after_recovery": True}
        with patch.object(dm, "process_clip", fake_clip), \
             patch.object(dm.derived_audio, "gs_sha256_and_generation", lambda uri: ("a" * 64, "9")), \
             patch.object(dm, "record_native_audio_version", lambda *a, **k: order.append("version") or True), \
             patch.object(dm, "upsert_song_after_download", lambda **k: order.append(("upsert", k["audio_recovery"]))), \
             patch.object(dm.time, "sleep", lambda s: None):
            res = asyncio.run(dm._process_all([{"songKey": "abc", "handle": "h", "reason": "missing_gcs:mp3"}]))
        self.assertEqual(order, ["version", ("upsert", None)])
        self.assertEqual(res[0]["errors"], [])

    def test_retry_schedule_and_derived_recovery_are_persisted(self):
        import download_media_gcs as dm
        calls = []
        async def fake_clip(row):
            return {"clip_id": "abc", "audio": True, "audio_ext": "mp3", "errors": [],
                    "audio_recovery": {"kind": "derived-from-video"}, "native_retry": {"attempts": 1}}
        with patch.object(dm, "process_clip", fake_clip), \
             patch.object(dm, "record_native_retry", lambda c, r: calls.append(("retry", r))), \
             patch.object(dm, "upsert_song_after_download", lambda **k: calls.append(("upsert", k["audio_recovery"]))), \
             patch.object(dm.time, "sleep", lambda s: None):
            asyncio.run(dm._process_all([{"songKey": "abc", "handle": "h", "reason": "missing_gcs:mp3"}]))
        self.assertEqual(calls, [("retry", {"attempts": 1}), ("upsert", {"kind": "derived-from-video"})])


if __name__ == "__main__":
    unittest.main()
