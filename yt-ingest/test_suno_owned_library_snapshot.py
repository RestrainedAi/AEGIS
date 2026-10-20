import unittest

from download_media_gcs import audio_extension_for_url
from suno_owned_library_snapshot import SunoOwnedLibrarySnapshotError, normalize_snapshot


CLIP_ID = "123e4567-e89b-12d3-a456-426614174000"


def valid_snapshot():
    return {
        "schemaVersion": 1,
        "sourceHandle": "nessihenize",
        "generatedAt": "2026-09-03T12:00:00Z",
        "clips": [
            {
                "id": CLIP_ID,
                "title": "Library-only track",
                "createdAt": "2026-09-02T12:00:00Z",
                "audioUrl": "https://cdn.example.invalid/track.mp3",
                "imageUrl": "https://cdn.example.invalid/cover.jpg",
                "lyrics": "Test lyrics",
            }
        ],
    }


class OwnedLibrarySnapshotTests(unittest.TestCase):
    def test_normalizes_valid_customer_snapshot(self):
        normalized = normalize_snapshot(valid_snapshot(), "@nessihenize")
        self.assertEqual(normalized["sourceHandle"], "nessihenize")
        self.assertEqual(normalized["clipsById"][CLIP_ID]["audio_url"], "https://cdn.example.invalid/track.mp3")

    def test_rejects_snapshot_for_another_account(self):
        with self.assertRaises(SunoOwnedLibrarySnapshotError):
            normalize_snapshot(valid_snapshot(), "unshakableechos2341")

    def test_rejects_clip_without_downloadable_audio(self):
        snapshot = valid_snapshot()
        del snapshot["clips"][0]["audioUrl"]
        with self.assertRaisesRegex(SunoOwnedLibrarySnapshotError, "missing audioUrl"):
            normalize_snapshot(snapshot, "nessihenize")

    def test_preserves_m4a_extension_when_url_is_signed(self):
        self.assertEqual(audio_extension_for_url("https://cdn.example.invalid/track.m4a?token=abc"), "m4a")


if __name__ == "__main__":
    unittest.main()
