import importlib.util
import pathlib
import unittest


MODULE_PATH = pathlib.Path(__file__).with_name("download_media_gcs.py")
SPEC = importlib.util.spec_from_file_location("download_media_gcs", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class MediaRepairPolicyTests(unittest.TestCase):
    def test_video_only_legacy_repair_is_deferred_by_default(self):
        self.assertTrue(
            MODULE.should_defer_optional_video_repair(
                "missing_gcs:mp4", need_audio=False, need_thumb=False
            )
        )

    def test_required_assets_keep_the_row_on_the_main_harvest_path(self):
        self.assertFalse(
            MODULE.should_defer_optional_video_repair(
                "missing_gcs:mp4", need_audio=True, need_thumb=False
            )
        )
        self.assertFalse(
            MODULE.should_defer_optional_video_repair(
                "missing_gcs:mp4,thumb", need_audio=False, need_thumb=True
            )
        )

    def test_new_song_is_never_treated_as_a_legacy_video_repair(self):
        self.assertFalse(
            MODULE.should_defer_optional_video_repair(
                "new", need_audio=False, need_thumb=False
            )
        )


if __name__ == "__main__":
    unittest.main()
