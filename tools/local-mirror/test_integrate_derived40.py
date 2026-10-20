import unittest
from integrate_derived40 import bounded_rows, StagedRepairTransport
from local_mirror import csv_bytes
from pathlib import Path
import tempfile
import hashlib


class BoundedRunnerTests(unittest.TestCase):
    def fixture(self):
        item={'uuid':'one','account_sourceId':'suno_nessihenize','upload':{'target':'gs://bucket/derived/one.mp3'},
              'original_audio':{'source':'gs://bucket/original.mp3'},'source_video':{'source':'gs://bucket/video.mp4'},
              'provenance_sidecar':{'target':'gs://bucket/derived/provenance.json'}}
        row={'songKey':'one','account_sourceId':'suno_nessihenize','title':'Preserve existing title',
             'gcs_mp3':item['original_audio']['source'],'gcs_mp4':item['source_video']['source'],
             'gcsLyricsTxt':'gs://bucket/existing-lyrics.txt','local_folder':'existing-folder'}
        cloud=dict(row,title='Do not replace unrelated fields',audio_url=item['upload']['target'],
                   gcs_latest_audio=item['upload']['target'],audio_original_url=item['original_audio']['source'],
                   audio_provenance_url=item['provenance_sidecar']['target'],audio_asset_role='derived-from-video')
        return item,row,cloud

    def test_only_playback_provenance_fields_changed(self):
        item,row,cloud=self.fixture();result=bounded_rows([item],csv_bytes([cloud],[]),[row])[0]
        for key,value in row.items():self.assertEqual(result[key],value)
        self.assertEqual(result['audio_url'],cloud['audio_url'])

    def test_wrong_source_and_duplicate_catalog_rejected(self):
        item,row,cloud=self.fixture()
        with self.assertRaises(ValueError):bounded_rows([item],csv_bytes([cloud,cloud],[]),[row])
        cloud['gcs_mp3']='gs://bucket/other.mp3'
        with self.assertRaises(ValueError):bounded_rows([item],csv_bytes([cloud],[]),[row])

    def test_local_transport_checks_frozen_hash_and_generation(self):
        with tempfile.TemporaryDirectory() as folder:
            p=Path(folder)/'source';p.write_bytes(b'preserved')
            url='https://storage.googleapis.com/bucket/source'
            transport=StagedRepairTransport({url:{'path':str(p),'generation':'17','sha256':hashlib.sha256(b'preserved').hexdigest()}})
            self.assertEqual(transport.fetch(url,'17')[0],b'preserved')
            with self.assertRaises(ValueError):transport.fetch(url,'18')
            p.write_bytes(b'changed')
            with self.assertRaises(ValueError):transport.inspect(url)


if __name__=='__main__':unittest.main()
