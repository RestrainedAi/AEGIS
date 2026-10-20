"""Network-free acceptance tests for provider duration reaching harvest CSV."""
import csv
import io
import json
import pathlib
import tempfile
import types
import unittest
from contextlib import ExitStack, redirect_stdout
from unittest.mock import patch

import catalog_sync_firestore_multi as sync
from audio_integrity import expected_duration


class ManifestAudioDurationTests(unittest.TestCase):
    def run_manifest(self, provider_clip=None, firestore_documents=None):
        requests = []
        def firestore_response(request, **kwargs):
            query = json.loads(request.data)['structuredQuery']
            requests.append(query)
            # Simulate Firestore field projection, so a missing selected field
            # cannot accidentally pass just because the fixture contains it.
            selected = {item['fieldPath'] for item in query['select']['fields']}
            documents = []
            for document in firestore_documents or []:
                doc = dict(document)
                doc['fields'] = {key: value for key, value in document['fields'].items() if key in selected}
                documents.append({'document': doc})
            return io.BytesIO(json.dumps(documents).encode())

        with tempfile.TemporaryDirectory() as temp, ExitStack() as stack:
            output = pathlib.Path(temp)
            stack.enter_context(patch.object(sync, 'OUT_CSV', output / 'manifest.csv'))
            stack.enter_context(patch.object(sync, 'OUT_REPORT', output / 'report.json'))
            stack.enter_context(patch.object(sync, 'WORK_DIR', output))
            stack.enter_context(patch.object(sync, 'get_token', return_value='fake-token'))
            stack.enter_context(patch.object(sync, 'list_active_suno_sources', return_value=[('handle', 'suno_handle', False, 'public_profile')]))
            stack.enter_context(patch.object(sync, 'update_source_health'))
            stack.enter_context(patch.object(sync, 'list_gcs_files', return_value={'song.mp4', 'song.jpg'}))
            stack.enter_context(patch.object(sync, 'fetch_clip_details', return_value=provider_clip or {}))
            stack.enter_context(patch.object(sync.urllib.request, 'urlopen', side_effect=firestore_response))
            stack.enter_context(patch.object(sync.time, 'sleep'))
            stack.enter_context(patch.object(sync.sys, 'argv', ['catalog_sync_firestore_multi.py']))
            stack.enter_context(patch.dict('sys.modules', {'build_manifest_from_studio_api': types.SimpleNamespace(fetch_profile_clip_ids=lambda handle: ['song'])}))
            stack.enter_context(redirect_stdout(io.StringIO()))
            with self.assertRaises(SystemExit) as exited:
                sync.main()
            self.assertEqual(exited.exception.code, 0)
            with (output / 'manifest.csv').open(newline='', encoding='utf-8') as file:
                rows = list(csv.DictReader(file))
            return rows, requests

    def test_new_provider_metadata_duration_survives_csv(self):
        rows, _ = self.run_manifest(provider_clip={'title': 'Test', 'metadata': {'duration': 154.32}})
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['reason'], 'new')
        self.assertEqual(expected_duration(rows[0]), 154.32)

    def test_top_level_provider_duration_survives_csv(self):
        rows, _ = self.run_manifest(provider_clip={'title': 'Test', 'duration': 321.5})
        self.assertEqual(expected_duration(rows[0]), 321.5)

    def test_missing_audio_duration_survives_firestore_projection_and_csv(self):
        rows, queries = self.run_manifest(firestore_documents=[{
            'name': 'projects/test/databases/(default)/documents/sunoSongs/suno:song',
            'fields': {'title': {'stringValue': 'Existing'}, 'lyrics': {'stringValue': 'Words'},
                       'duration': {'doubleValue': 230.75}}
        }])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['reason'], 'missing_gcs:audio')
        self.assertEqual(expected_duration(rows[0]), 230.75)
        self.assertIn({'fieldPath': 'duration'}, queries[0]['select']['fields'])

    def test_missing_audio_duration_seconds_alias_survives_firestore(self):
        rows, _ = self.run_manifest(firestore_documents=[{
            'name': 'projects/test/databases/(default)/documents/sunoSongs/suno:song',
            'fields': {'lyrics': {'stringValue': 'Words'}, 'durationSeconds': {'integerValue': '321'}}
        }])
        self.assertEqual(expected_duration(rows[0]), 321)


if __name__ == '__main__':
    unittest.main()
