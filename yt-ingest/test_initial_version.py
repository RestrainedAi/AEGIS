import unittest
from unittest.mock import patch
import sys, types
import firestore_upsert as fu
from firestore_upsert import initial_version
from test_audio_recovery_upsert import DB


def _stub():
    stub = types.ModuleType("google.cloud.firestore")
    stub.transactional = lambda fn: fn
    return patch.dict(sys.modules, {"google.cloud.firestore": stub})


class InitialVersionTests(unittest.TestCase):
    def test_new_song_gets_v1_with_stored_media(self):
        v = initial_version({"media": {"audioUrl": "gs://b/a.mp3", "videoUrl": "gs://b/v.mp4"}}, "T", "r")
        self.assertEqual(v["n"], 1)
        self.assertEqual(v["assets"]["audio"], {"gcs": "gs://b/a.mp3", "status": "ok"})
        self.assertIn("video", v["assets"])
        self.assertEqual(v["changedFields"], ["initial"])

    def test_derived_audio_is_marked(self):
        rec = {"kind": "derived-from-video", "derivedSha256": "ab"}
        v = initial_version({"media": {"audioUrl": "gs://b/a.mp3", "audioRecovery": rec}}, "T", "r")
        self.assertTrue(v["assets"]["audio"]["derived"])

    def test_no_media_no_version(self):
        self.assertIsNone(initial_version({"media": {}}, "T", "r"))


class FirstStoreUpsertTests(unittest.TestCase):
    def upsert(self, existing, versions=None, **kw):
        db = DB([existing], versions)
        with _stub():
            ok = fu.upsert_song_after_download("uuid", "nessihenize", db=db, **kw)
        return ok, db

    def test_new_song_creates_v1_and_sets_current_version(self):
        ok, db = self.upsert(None, has_audio=True, has_video=True, audio_ext="mp3")
        self.assertTrue(ok)
        self.assertEqual([k for k, _ in db.created], ["1"])
        self.assertEqual(db.writes[0]["currentVersion"], 1)

    def test_existing_v1_is_never_overwritten(self):
        old = {"n": 1, "createdBy": "migration"}
        ok, db = self.upsert({"media": {}}, versions={"1": old}, has_audio=True, audio_ext="mp3")
        self.assertTrue(ok)
        self.assertEqual(db.created, [])
        self.assertEqual(db.versions["1"], old)


if __name__ == "__main__":
    unittest.main()
