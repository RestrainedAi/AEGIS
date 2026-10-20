import unittest
from rebuild_catalog import doc_to_row, FIELDNAMES

def value(v):
    if isinstance(v, bool): return {"booleanValue": v}
    if isinstance(v, dict): return {"mapValue": {"fields": {k:value(x) for k,x in v.items()}}}
    return {"stringValue": str(v)}

class RecoveryExportTests(unittest.TestCase):
    def row(self, selected="gs://bucket/derived.mp3"):
        fields={"media":{"audioUrl":selected,"audioRecovery":{"kind":"derived-from-video","nativeOriginal":False,"derivedAudioUrl":"gs://bucket/derived.mp3","originalAudioUrl":"gs://bucket/native.mp3","provenanceUrl":"gs://bucket/provenance.json"}},"gcs_mp3":"gs://bucket/stale.mp3","gcs_latest_audio":"gs://bucket/stale.mp3"}
        return doc_to_row({"name":"songs/id","fields":{k:value(v) for k,v in fields.items()}},"run")
    def test_selected_recovery_keeps_native_and_playable_distinct(self):
        r=self.row()
        self.assertEqual(r["audio_asset_role"],"derived-from-video")
        self.assertEqual(r["gcs_mp3"],"gs://bucket/native.mp3")
        self.assertEqual(r["gcs_latest_audio"],"gs://bucket/derived.mp3")
        self.assertEqual(r["audio_provenance_url"],"gs://bucket/provenance.json")
        self.assertTrue(set(r).issubset(FIELDNAMES))
    def test_unselected_recovery_is_not_labeled_as_playing(self):
        r=self.row("gs://bucket/other.mp3")
        self.assertEqual(r["audio_asset_role"],"")
        self.assertEqual(r["audio_original_url"],"")

if __name__ == "__main__": unittest.main()
