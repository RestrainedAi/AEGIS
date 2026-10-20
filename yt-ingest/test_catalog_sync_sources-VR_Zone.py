import importlib.util
import pathlib
import unittest


MODULE_PATH = pathlib.Path(__file__).with_name("catalog_sync_firestore_multi.py")
SPEC = importlib.util.spec_from_file_location("catalog_sync_firestore_multi", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class SourceSelectionTests(unittest.TestCase):
    def test_source_snapshot_result_marks_individual_source_errors_partial(self):
        self.assertEqual(MODULE.source_snapshot_result([]), "healthy")
        self.assertEqual(
            MODULE.source_snapshot_result([{"handle": "nessihenize", "error": "unreadable"}]),
            "partial_source",
        )

    def test_source_snapshot_result_marks_public_only_sources_partial(self):
        self.assertEqual(MODULE.source_snapshot_result([], partial_sources=1), "partial_source")

    def test_removal_authority_requires_a_verified_private_or_official_source(self):
        fields = {
            "ingestionMode": {"stringValue": "public_profile"},
            "authorityStatus": {"stringValue": "verified"},
        }
        self.assertEqual(MODULE.source_authority_from_fields(fields), ("public_profile", False))
        fields["ingestionMode"] = {"stringValue": "owned_library"}
        self.assertEqual(MODULE.source_authority_from_fields(fields), ("owned_library", True))
        fields["authorityStatus"] = {"stringValue": "partial_source"}
        self.assertEqual(MODULE.source_authority_from_fields(fields), ("owned_library", False))

    def test_filtering_never_reintroduces_an_archived_account(self):
        registry = [
            ("unshakableechos2341", "suno_unshakableechos2341", False, "public_profile", ""),
            ("nessihenize", "suno_nessihenize", False, "public_profile", ""),
        ]
        filtered = MODULE.filter_tracked_handles(registry, ["genxdreams"])
        self.assertEqual(filtered, [])

    def test_filter_tracked_handles_limits_harvest_scope(self):
        registry = [
            ("unshakableechos2341", "suno_unshakableechos2341", False, "public_profile", ""),
            ("nessihenize", "suno_nessihenize", False, "public_profile", ""),
        ]
        filtered = MODULE.filter_tracked_handles(registry, ["nessihenize"])
        self.assertEqual(filtered, [("nessihenize", "suno_nessihenize", False, "public_profile", "")])

    def test_parse_handle_filter_normalizes_at_prefix(self):
        self.assertEqual(MODULE.parse_handle_filter("@nessihenize, genxdreams"), ["nessihenize", "genxdreams"])


if __name__ == "__main__":
    unittest.main()
