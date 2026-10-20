import base64
import hashlib
import unittest
import backfill_lyrics_artifacts as module


class ArtifactIntegrityTests(unittest.TestCase):
    def fixture(self):
        fields = {key: {'stringValue': f'{module.PUBLIC_BASE}/exports/suno/test/{ext}'}
                  for key, ext in [('gcsLyricsTxt', 'lyrics.txt'), ('gcsLyricsJson', 'lyrics.json'), ('gcsLyricsVtt', 'lyrics.vtt')]}
        objects = {value['stringValue']: {'size': '12'} for value in fields.values()}
        objects[fields['gcsLyricsTxt']['stringValue']]['md5Hash'] = base64.b64encode(hashlib.md5(b'lyrics').digest()).decode()
        return fields, objects

    def test_url_strings_do_not_prove_files_exist(self):
        fields, _ = self.fixture()
        self.assertFalse(module.artifacts_current(fields, 'lyrics', {}))

    def test_empty_artifact_needs_recovery(self):
        fields, objects = self.fixture()
        objects[fields['gcsLyricsJson']['stringValue']]['size'] = '0'
        self.assertFalse(module.artifacts_current(fields, 'lyrics', objects))

    def test_changed_lyrics_need_new_artifact_versions(self):
        fields, objects = self.fixture()
        self.assertFalse(module.artifacts_current(fields, 'updated lyrics', objects))

    def test_matching_stored_files_are_preserved(self):
        fields, objects = self.fixture()
        self.assertTrue(module.artifacts_current(fields, 'lyrics', objects))


if __name__ == '__main__':
    unittest.main()
