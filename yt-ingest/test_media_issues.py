import unittest

import rebuild_catalog as rc

B = "gs://aeonimus-suno-media/suno/handles/h/"


def row(**kw):
    base = {"songKey": "a", "status": "active", "gcs_mp3": B + "a.mp3", "gcs_latest_audio": B + "a.mp3",
            "gcs_mp4": B + "a.mp4", "gcs_thumb": B + "a.jpg", "audio_asset_role": ""}
    base.update(kw)
    return base


SIZES = {B + "a.mp3": 5_000_000, B + "a.mp4": 9_000_000, B + "a.jpg": 40_000}


class MediaIssuesTests(unittest.TestCase):
    def test_healthy(self):
        self.assertEqual(rc.media_issues_for_row(row(), SIZES), "")

    def test_silent_placeholder(self):
        self.assertEqual(rc.media_issues_for_row(row(), dict(SIZES, **{B + "a.mp3": 4844})), "silent_placeholder")

    def test_audio_from_video_wins_over_missing_native(self):
        r = row(gcs_mp3="", audio_asset_role="derived-from-video", gcs_latest_audio=B + "a.derived.mp3")
        self.assertEqual(rc.media_issues_for_row(r, SIZES), "audio_from_video")

    def test_no_audio_video_thumb(self):
        r = row(gcs_mp3="", gcs_latest_audio="", gcs_mp4="", gcs_thumb="", image_url="")
        self.assertEqual(rc.media_issues_for_row(r, SIZES), "no_audio;no_video;no_thumb")

    def test_known_removed_songs_are_tagged_and_kept(self):
        removed = rc.load_known_removed()
        self.assertIn("cb39738d-5e3a-412e-bbd2-63f2d65b5ee0", removed)
        self.assertIn("e6378018-0da1-4efa-9695-b0e18b42f57e", removed)
        r = row(songKey="cb39738d-5e3a-412e-bbd2-63f2d65b5ee0")
        self.assertTrue(rc.media_issues_for_row(r, SIZES, removed).startswith("removed_from_suno"))
        rows = [r]
        rc.drop_missing_media_paths(rows, SIZES)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["status"], "active")

    def test_media_issues_is_an_export_column(self):
        self.assertIn("mediaIssues", rc.FIELDNAMES)


if __name__ == "__main__":
    unittest.main()
