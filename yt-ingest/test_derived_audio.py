import asyncio
import json
import shutil
import subprocess
import sys
import tempfile
import types
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import derived_audio as da

VIDEO = "gs://b/suno/handles/nessihenize/abc.mp4"
LGPL_VERSION = "ffmpeg version N-1 Copyright\nconfiguration: --enable-libmp3lame --enable-version3\n"
GPL_VERSION = "ffmpeg version 4.4 Copyright\nconfiguration: --enable-gpl --enable-libx264\n"
SHA = "c" * 64


class FakeGS:
    """Fake gsutil/ffmpeg runner backed by an in-memory bucket."""

    def __init__(self, objects=None, version=LGPL_VERSION, encoders=" A....D libmp3lame", encode_ok=True):
        self.objects = dict(objects or {})
        self.version, self.encoders, self.encode_ok = version, encoders, encode_ok
        self.calls = []

    def __call__(self, cmd, capture_output=True, text=True, **kw):
        self.calls.append(list(map(str, cmd)))
        ok = lambda out="": subprocess.CompletedProcess(cmd, 0, out, "")
        bad = subprocess.CompletedProcess(cmd, 1, "", "err")
        tool, args = Path(str(cmd[0])).name, [str(c) for c in cmd[1:]]
        if tool.startswith("ffmpeg"):
            if "-version" in args:
                return ok(self.version)
            if "-encoders" in args:
                return ok(self.encoders)
            if not self.encode_ok:
                return bad
            Path(args[-1]).write_bytes(b"ID3derived-mp3-bytes")
            return ok()
        if args[0] == "stat":
            return ok("    Generation:  1792\n") if args[1] in self.objects else bad
        if args[0] == "ls":
            prefix = args[1].split("*")[0]
            hits = [k for k in self.objects if k.startswith(prefix) and k.endswith("/provenance.json")]
            return ok("\n".join(hits)) if hits else bad
        if args[0] == "cat":
            return ok(self.objects[args[1]].decode()) if args[1] in self.objects else bad
        if args[:2] == ["-q", "cp"]:
            no_clobber = "-n" in args
            src, dst = args[-2], args[-1]
            if src.startswith("gs://"):
                key = src.split("#")[0]
                if key not in self.objects:
                    return bad
                Path(dst).write_bytes(self.objects[key])
                return ok()
            assert no_clobber, "uploads must be no-clobber"
            if dst in self.objects:
                return ok()  # -n: existing object kept
            self.objects[dst] = Path(src).read_bytes()
            return ok()
        raise AssertionError(f"unexpected command {cmd}")


class DeriveTests(unittest.TestCase):
    def setUp(self):
        self.p = patch.multiple(da, BUCKET="gs://b", GSUTIL="gsutil", FFMPEG="ffmpeg")
        self.p.start()

    def tearDown(self):
        self.p.stop()

    def test_derives_with_lgpl_and_writes_provenance(self):
        gs = FakeGS({VIDEO: b"mp4-bytes"})
        validated = []
        rec = da.derive_listening_copy("nessihenize", "abc", VIDEO, 200.0, run=gs,
                                       validate=lambda p, e: validated.append((p, e)))
        self.assertEqual(validated[0][1], 200.0)
        self.assertTrue(rec["originalMissing"])
        self.assertIs(rec["nativeOriginal"], False)
        self.assertEqual(rec["kind"], "derived-from-video")
        self.assertEqual(rec["originalSha256"], "")
        self.assertEqual(rec["sourceVideoGeneration"], "1792")
        self.assertRegex(rec["derivedAudioUrl"],
                         r"^gs://b/suno/handles/nessihenize/derived/abc/[0-9a-f]{64}/listening-copy\.mp3$")
        self.assertIn(rec["derivedAudioUrl"], gs.objects)
        prov = json.loads(gs.objects[rec["provenanceUrl"]])
        self.assertEqual(prov["audioRecovery"]["derivedSha256"], rec["derivedSha256"])
        self.assertIn("LGPL", prov["encoder"])
        self.assertIn("nextAttemptAt", rec["nativeRetry"])
        enc = [c for c in gs.calls if c[0] == "ffmpeg" and "-i" in c][0]
        self.assertIn("libmp3lame", enc)

    def test_reuses_existing_derived_copy_without_encoding(self):
        sha_video = da.hashlib.sha256(b"mp4-bytes").hexdigest()
        prov_uri = f"gs://b/suno/handles/nessihenize/derived/abc/{SHA}/provenance.json"
        existing = {"audioRecovery": {"kind": "derived-from-video", "nativeOriginal": False,
                                      "sourceVideoSha256": sha_video, "derivedSha256": SHA,
                                      "derivedAudioUrl": prov_uri.replace("provenance.json", "listening-copy.mp3")}}
        gs = FakeGS({VIDEO: b"mp4-bytes", prov_uri: json.dumps(existing).encode()})
        before = dict(gs.objects)
        rec = da.derive_listening_copy("nessihenize", "abc", VIDEO, None, run=gs, validate=lambda *a: None)
        self.assertTrue(rec["reused"])
        self.assertTrue(rec["originalMissing"])  # older provenance gets the explicit flag
        self.assertEqual(rec["derivedSha256"], SHA)
        self.assertEqual(gs.objects, before)       # nothing written
        self.assertFalse([c for c in gs.calls if c[0] == "ffmpeg" and "-i" in c])

    def test_different_source_video_is_not_reused(self):
        prov_uri = f"gs://b/suno/handles/nessihenize/derived/abc/{SHA}/provenance.json"
        existing = {"audioRecovery": {"kind": "derived-from-video", "sourceVideoSha256": "d" * 64,
                                      "derivedAudioUrl": "gs://b/x.mp3"}}
        gs = FakeGS({VIDEO: b"mp4-bytes", prov_uri: json.dumps(existing).encode()})
        rec = da.derive_listening_copy("nessihenize", "abc", VIDEO, None, run=gs, validate=lambda *a: None)
        self.assertNotIn("reused", rec)
        self.assertIn(prov_uri, gs.objects)  # old provenance untouched
        self.assertEqual(json.loads(gs.objects[prov_uri]), existing)

    def test_existing_object_is_never_overwritten(self):
        gs = FakeGS({VIDEO: b"mp4-bytes"})
        rec = da.derive_listening_copy("nessihenize", "abc", VIDEO, None, run=gs, validate=lambda *a: None)
        uploads = [c for c in gs.calls if c[:2] == ["gsutil", "-q"] and not c[-2].startswith("gs://")]
        self.assertTrue(uploads and all("-n" in c for c in uploads))
        self.assertTrue(rec["derivedAudioUrl"])

    def test_refuses_gpl_build(self):
        gs = FakeGS({VIDEO: b"mp4-bytes"}, version=GPL_VERSION)
        with self.assertRaisesRegex(da.DeriveError, "GPL"):
            da.derive_listening_copy("h", "abc", VIDEO, None, run=gs, validate=lambda *a: None)
        self.assertEqual(set(gs.objects), {VIDEO})

    def test_refuses_build_without_lame(self):
        gs = FakeGS({VIDEO: b"m"}, encoders=" A....D aac")
        with self.assertRaisesRegex(da.DeriveError, "libmp3lame"):
            da.derive_listening_copy("h", "abc", VIDEO, None, run=gs, validate=lambda *a: None)

    def test_validation_failure_uploads_nothing(self):
        gs = FakeGS({VIDEO: b"mp4-bytes"})
        def bad(*a):
            raise ValueError("silent audio")
        with self.assertRaises(ValueError):
            da.derive_listening_copy("h", "abc", VIDEO, 100, run=gs, validate=bad)
        self.assertEqual(set(gs.objects), {VIDEO})

    def test_missing_video_raises(self):
        with self.assertRaises(da.DeriveError):
            da.derive_listening_copy("h", "abc", VIDEO, None, run=FakeGS({}), validate=lambda *a: None)

    def test_encode_failure_raises(self):
        gs = FakeGS({VIDEO: b"m"}, encode_ok=False)
        with self.assertRaisesRegex(da.DeriveError, "extract audio"):
            da.derive_listening_copy("h", "abc", VIDEO, None, run=gs, validate=lambda *a: None)


class RetryScheduleTests(unittest.TestCase):
    def test_weekly_schedule(self):
        r = da.next_native_retry({"attempts": 2}, "2026-10-21T07:00:00+00:00", "403")
        self.assertEqual(r["attempts"], 3)
        self.assertEqual(r["nextAttemptAt"], "2026-10-28T07:00:00+00:00")

    def test_due(self):
        now = datetime(2026, 10, 28, 8, tzinfo=timezone.utc)
        rec = {"kind": "derived-from-video", "nativeRetry": {"nextAttemptAt": "2026-10-28T07:00:00+00:00"}}
        self.assertTrue(da.native_retry_due(rec, now))
        self.assertFalse(da.native_retry_due(rec, now - timedelta(days=2)))
        self.assertTrue(da.native_retry_due({"kind": "derived-from-video"}, now))  # no schedule yet
        self.assertTrue(da.native_retry_due({"kind": "derived-from-video",
                                             "nativeRetry": {"nextAttemptAt": "garbage"}}, now))


@unittest.skipUnless(shutil.which("ffmpeg") and da.ffmpeg_license_ok()[0], "LGPL ffmpeg with libmp3lame not on PATH")
class RealLgplFfmpegTest(unittest.TestCase):
    def test_real_encode_from_mp4(self):
        ff = shutil.which("ffmpeg")
        with tempfile.TemporaryDirectory() as d:
            mp4 = Path(d) / "v.mp4"
            subprocess.run([ff, "-v", "error", "-f", "lavfi", "-i", "sine=d=3", "-f", "lavfi", "-i",
                            "color=s=32x32:d=3", "-c:a", "aac", "-shortest", str(mp4)], check=True)
            gs = FakeGS({VIDEO: mp4.read_bytes()})
            real = subprocess.run
            def run(cmd, **kw):
                return real(cmd, **kw) if Path(str(cmd[0])).name.startswith("ffmpeg") else gs(cmd, **kw)
            with patch.multiple(da, BUCKET="gs://b", GSUTIL="gsutil", FFMPEG=ff):
                rec = da.derive_listening_copy("h", "abc", VIDEO, None, run=run, validate=lambda *a: None)
            self.assertGreater(len(gs.objects[rec["derivedAudioUrl"]]), 1000)


if __name__ == "__main__":
    unittest.main()
