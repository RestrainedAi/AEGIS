import csv
import importlib.util
import io
import json
import pathlib
import unittest


MODULE_PATH = pathlib.Path(__file__).with_name("validate_published_catalog_export.py")
SPEC = importlib.util.spec_from_file_location("validate_published_catalog_export", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


def make_csv(row_count=1, remove_column=None):
    fields = [field for field in MODULE.FIELDNAMES if field != remove_column]
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=fields)
    writer.writeheader()
    for index in range(row_count):
        writer.writerow({field: f"value-{index}" for field in fields})
    return stream.getvalue().encode("utf-8")


def make_meta(row_count=1, generated_at="2026-08-16T00:00:00Z"):
    return json.dumps(
        {"artifact": MODULE.GCS_DEST, "generatedAt": generated_at, "rowCount": row_count}
    ).encode("utf-8")


class PublishedCatalogContractTests(unittest.TestCase):
    def test_accepts_matching_local_and_published_artifacts(self):
        MODULE.validate(make_csv(), make_meta(), make_csv(), make_meta())

    def test_rejects_missing_required_column(self):
        with self.assertRaisesRegex(ValueError, "missing required columns"):
            MODULE.validate(make_csv(remove_column="lyrics"), make_meta(), None, None)

    def test_rejects_published_timestamp_drift(self):
        with self.assertRaisesRegex(ValueError, "generatedAt mismatch"):
            MODULE.validate(
                make_csv(),
                make_meta(),
                make_csv(),
                make_meta(generated_at="2026-08-16T00:05:00Z"),
            )

    def test_rejects_published_row_count_drift(self):
        with self.assertRaisesRegex(ValueError, "published row count mismatch"):
            MODULE.validate(make_csv(), make_meta(), make_csv(2), make_meta(2))


if __name__ == "__main__":
    unittest.main()
