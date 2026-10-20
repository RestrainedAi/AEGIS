import unittest
import song_versions as sv
import migrate_versions_v1 as mig

OBS = {"metadata": {"title": "A", "lyrics": "la", "duration": 120.04, "playCount": 5},
       "source": {"audio": {"url": "https://cdn1.suno.ai/x.mp3", "etag": "e1", "length": 10},
                  "cover": {"url": "https://cdn2.suno.ai/x.jpg", "etag": "i1"}}}


class VersionTests(unittest.TestCase):
    def first(self):
        return sv.apply_observation(None, None, OBS, "r1", "t1")

    def test_first_observation_is_v1(self):
        head, v = self.first()
        self.assertEqual(head["currentVersion"], 1)
        self.assertEqual(v["n"], 1)
        self.assertEqual(v["changedFields"], ["initial"])
        self.assertNotIn("playCount", v["metadata"])

    def test_same_data_and_counter_change_make_no_version(self):
        head, v = self.first()
        obs = {**OBS, "metadata": {**OBS["metadata"], "playCount": 999, "duration": 120.01}}
        head2, v2 = sv.apply_observation(head, v, obs, "r2", "t2")
        self.assertIsNone(v2)
        self.assertEqual(head2["currentVersion"], 1)

    def test_title_change_makes_v2_and_keeps_v1(self):
        head, v1 = self.first()
        snapshot = dict(v1)
        obs = {**OBS, "metadata": {**OBS["metadata"], "title": "B"}}
        head2, v2 = sv.apply_observation(head, v1, obs, "r2", "t2")
        self.assertEqual((head2["currentVersion"], v2["n"]), (2, 2))
        self.assertEqual(v2["changedFields"], ["title"])
        self.assertEqual(v1, snapshot)  # untouched
        self.assertEqual(v2["metadata"]["lyrics"], "la")

    def test_art_etag_change_marks_asset_for_capture(self):
        head, v1 = self.first()
        v1["assets"]["cover"] = {"gcs": "gs://b/v1/cover.jpg", "status": "ok"}
        obs = {**OBS, "source": {**OBS["source"], "cover": {"url": OBS["source"]["cover"]["url"], "etag": "i2"}}}
        _, v2 = sv.apply_observation(head, v1, obs, "r2", "t2")
        self.assertEqual(v2["changedFields"], ["cover"])
        self.assertEqual(v2["assets"]["cover"], {"status": "retry"})

    def test_missing_observation_is_not_a_change(self):
        head, v1 = self.first()
        _, v2 = sv.apply_observation(head, v1, {"metadata": {"title": "A"}, "source": {}}, "r2", "t2")
        self.assertIsNone(v2)

    def test_unpublish_needs_two_absences_and_republish_is_recorded(self):
        head, _ = self.first()
        h = sv.publish_transition(head, False, "t2", "r2")
        self.assertEqual(h["publishState"], "published")
        h = sv.publish_transition(h, False, "t3", "r3")
        self.assertEqual(h["publishState"], "unpublished")
        h = sv.publish_transition(h, True, "t4", "r4")
        self.assertEqual(h["publishState"], "published")
        self.assertEqual([e["state"] for e in h["publishHistory"]], ["unpublished", "published"])

    def test_versioned_path(self):
        self.assertEqual(sv.versioned_object("nessihenize", "id1", 3, "cover"),
                         "suno/nessihenize/id1/v3/cover.jpg")

    def test_migration_maps_flat_doc_to_v1(self):
        doc = {"name": "x/sunoSongs/id1", "fields": {
            "title": {"stringValue": "T"}, "status": {"stringValue": "removed_from_suno"},
            "image_url": {"stringValue": "gs://aeonimus-suno-media/a.jpg"},
            "gcs": {"mapValue": {"fields": {"audio": {"booleanValue": True}, "video": {"booleanValue": False}}}},
            "media": {"mapValue": {"fields": {"audioUrl": {"stringValue": "gs://m/a.mp3"}, "videoUrl": {"nullValue": None}}}}}}
        head, v1 = mig.doc_to_v1(doc, "run", "t")
        self.assertEqual(head["publishState"], "unpublished")
        self.assertEqual(v1["assets"]["audio"]["status"], "ok")
        self.assertEqual(v1["assets"]["video"]["status"], "missing")
        self.assertNotIn("cover", v1["source"])  # gs:// is a copy, not a Suno URL


if __name__ == "__main__":
    unittest.main()
