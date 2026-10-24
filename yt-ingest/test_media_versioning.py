import unittest
from firestore_upsert import media_change_version

STUB = "gs://b/suno/handles/gravitystruth/x.mp3"
DER = "gs://b/suno/handles/gravitystruth/derived/x/h/listening-copy.mp3"
V1 = {"n": 1, "metadata": {"title": "The Flame"}, "source": {"s": 1},
      "assets": {"audio": {"gcs": STUB, "status": "ok"}, "video": {"gcs": "gs://b/x.mp4", "status": "ok"}}}


class MediaVersioning(unittest.TestCase):
    def head(self, **media):
        return {"currentVersion": 1, "media": dict({"audioUrl": STUB, "videoUrl": "gs://b/x.mp4"}, **media)}

    def test_audio_swap_creates_next_version(self):
        payload = {"media": {"audioUrl": DER, "videoUrl": "gs://b/x.mp4",
                             "audioRecovery": {"derivedSha256": "a" * 64}}}
        v = media_change_version(self.head(), V1, payload, "t", "r")
        self.assertEqual(v["n"], 2)
        self.assertEqual(v["changedFields"], ["audio"])
        self.assertEqual(v["assets"]["audio"]["gcs"], DER)
        self.assertTrue(v["assets"]["audio"]["derived"])
        self.assertEqual(v["assets"]["video"], V1["assets"]["video"])
        self.assertEqual(v["supersedes"], {"version": 1, "previous": {"audioUrl": STUB}})
        self.assertEqual(V1["assets"]["audio"]["gcs"], STUB)  # previous version untouched

    def test_same_media_no_version(self):
        self.assertIsNone(media_change_version(self.head(), V1, {"media": {"audioUrl": STUB, "videoUrl": "gs://b/x.mp4"}}, "t", "r"))

    def test_none_does_not_count_as_change(self):
        self.assertIsNone(media_change_version(self.head(), V1, {"media": {"audioUrl": None, "videoUrl": None}}, "t", "r"))

    def test_unversioned_song_left_to_migration(self):
        self.assertIsNone(media_change_version({"media": {"audioUrl": STUB}}, {}, {"media": {"audioUrl": DER}}, "t", "r"))

    def test_v2_song_goes_to_v3(self):
        h = self.head(); h["currentVersion"] = 2
        v = media_change_version(h, dict(V1, n=2), {"media": {"videoUrl": "gs://b/new.mp4", "audioUrl": STUB}}, "t", "r")
        self.assertEqual((v["n"], v["changedFields"]), (3, ["video"]))


if __name__ == "__main__":
    unittest.main()
