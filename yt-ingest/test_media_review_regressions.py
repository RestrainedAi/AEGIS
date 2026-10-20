import asyncio, json, unittest
from types import SimpleNamespace
from unittest.mock import Mock, AsyncMock, patch
import download_media_gcs as media
from firestore_upsert import update_song_metadata_only
from test_receipt_storage import StoreTests

class ReviewTests(unittest.TestCase):
    def test_metadata_has_no_media_permit(self):
        with patch.object(media,"update_song_metadata_only",return_value=True) as update, patch.object(media,"gs_exists") as exists, patch.object(media,"gs_audio_valid") as audio, patch.object(media,"gs_video_valid") as video, patch.object(media,"intercept_clip_media",new=AsyncMock()) as browser, patch.object(media,"stream_to_gcs") as transfer:
            for sid in ["a","b","c"]:
                result=asyncio.run(media.process_clip({"songKey":sid,"handle":"authorized","reason":"metadata_repair:lyrics"}))
                self.assertTrue(result["metadata_only"])
                self.assertEqual(result["errors"],[])
            self.assertEqual(update.call_count,3)
            for operation in [exists,audio,video,browser,transfer]:operation.assert_not_called()
    def test_one_media_budget_with_three_metadata_gaps(self):
        from test_delta_media_validation import DeltaTests
        import catalog_sync_firestore_multi as sync
        with patch.object(sync,"fetch_clip_details",return_value={"title":"known","prompt":"lyrics"}), patch.object(sync.time,"sleep"):
            rows,stats=DeltaTests().run_delta(["a","b","c"],{i:{"lyrics":"","duration":60} for i in ["a","b","c"]},budget="1")
        self.assertEqual(len(rows),4)
        with patch.object(media,"update_song_metadata_only",return_value=True) as update, patch.object(media,"gs_exists",return_value=True), patch.object(media,"gs_audio_valid",return_value=True) as audio, patch.object(media,"gs_video_valid",return_value=True) as video, patch.object(media,"intercept_clip_media",new=AsyncMock()) as browser:
            for row in rows:asyncio.run(media.process_clip(row))
            self.assertEqual(audio.call_count,1)
            self.assertEqual(video.call_count,1)
            self.assertEqual(update.call_count,3)
            browser.assert_not_called()

    def test_retained_exact_url_failure_never_discovers(self):
        with patch.object(media,"gs_exists",return_value=False), patch.object(media,"stream_to_gcs",return_value=False) as transfer, patch.object(media,"intercept_clip_media",new=AsyncMock()) as browser:
            result=asyncio.run(media.process_clip({"songKey":"old","handle":"authorized","reason":"retained:missing_gcs:audio","audio_url":"https://captured/audio.mp3"}))
            browser.assert_not_called()
            self.assertEqual(transfer.call_count,1)
            self.assertEqual(transfer.call_args.args[0],"https://captured/audio.mp3")
            self.assertTrue(result["errors"])
    def test_retained_thumb_does_not_add_audio_discovery(self):
        with patch.object(media,"gs_exists",return_value=False), patch.object(media,"stream_to_gcs",return_value=False) as transfer, patch.object(media,"intercept_clip_media",new=AsyncMock()) as browser:
            result=asyncio.run(media.process_clip({"songKey":"old","handle":"authorized","reason":"retained:missing_gcs:thumb","image_url":"https://captured/thumb.jpg"}))
            browser.assert_not_called()
            self.assertEqual(transfer.call_count,1)
            self.assertFalse(any("audio" in error for error in result["errors"]))
    def test_metadata_update_preserves_media_status_and_provenance(self):
        ref=Mock()
        ref.get.return_value=SimpleNamespace(exists=True,to_dict=lambda:{"sourceId":"suno_authorized","status":"removed","media":{"audioUrl":"native"}})
        db=Mock();db.collection.return_value.document.return_value=ref
        self.assertTrue(update_song_metadata_only({"songKey":"a","handle":"authorized","lyrics":"new lyrics","audio_url":"other","title":""},db))
        fields=ref.update.call_args.args[0]
        self.assertEqual(set(fields),{"lyrics","lyricsStatus","metadataUpdatedAt"})
    def test_wrong_account_metadata_is_refused(self):
        ref=Mock();ref.get.return_value=SimpleNamespace(exists=True,to_dict=lambda:{"sourceId":"suno_other"})
        db=Mock();db.collection.return_value.document.return_value=ref
        self.assertFalse(update_song_metadata_only({"songKey":"a","handle":"authorized","lyrics":"text"},db))
        ref.update.assert_not_called()

class MalformedReceiptTests(StoreTests):
    def test_nonmapping_receipts_are_unverified_then_revalidated(self):
        for shape in [[],None,42,"string"]:
            with self.subTest(shape=shape):
                self.side.download_as_text.return_value=json.dumps(shape)
                self.assertFalse(self.store.verified("gs://bucket/song.mp3",60,"audio"))
                validator=Mock(return_value=60)
                self.assertTrue(self.store.validate("gs://bucket/song.mp3",60,"audio",validator))
                validator.assert_called_once()
if __name__ == "__main__":unittest.main()
