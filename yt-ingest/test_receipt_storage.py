import base64, hashlib, json, sys, unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch
from media_validation_receipts import ReceiptStore, CONTRACT

class StoreTests(unittest.TestCase):
    def setUp(self):
        self.data=b"native media bytes"
        self.blob=SimpleNamespace(name="song.mp3",generation=12,size=len(self.data),md5_hash=base64.b64encode(hashlib.md5(self.data).digest()).decode())
        self.blob.download_to_filename=Mock(side_effect=lambda p,**kw:Path(p).write_bytes(self.data))
        self.side=SimpleNamespace(download_as_text=Mock(return_value="{}"),upload_from_string=Mock())
        self.store=ReceiptStore(client=object())
        self.store.objects=Mock(return_value=(self.blob,self.side))
        self.errors=patch.dict(sys.modules,{"google.api_core.exceptions":SimpleNamespace(NotFound=FileNotFoundError)})
        self.errors.start()
        self.addCleanup(self.errors.stop)
    def test_generation_pinned_bytes_hash_and_decode_before_receipt(self):
        validator=Mock(return_value=60)
        self.assertTrue(self.store.validate("gs://bucket/song.mp3",60,"audio",validator))
        self.assertEqual(self.blob.download_to_filename.call_args.kwargs["if_generation_match"],12)
        receipt=json.loads(self.side.upload_from_string.call_args.args[0])
        self.assertEqual(receipt["sha256"],hashlib.sha256(self.data).hexdigest())
        self.side.download_as_text.return_value=json.dumps(receipt)
        self.assertTrue(self.store.validate("gs://bucket/song.mp3",60,"audio",validator))
        self.assertEqual(validator.call_count,1)
        self.assertEqual(self.blob.download_to_filename.call_count,1)
    def test_hash_mismatch_cannot_publish_receipt(self):
        self.blob.md5_hash="wrong"
        with self.assertRaises(ValueError):self.store.validate("gs://bucket/song.mp3",60,"audio",Mock())
        self.side.upload_from_string.assert_not_called()
    def test_invalid_decode_cannot_publish_receipt(self):
        with self.assertRaises(ValueError):self.store.validate("gs://bucket/song.mp3",60,"audio",Mock(side_effect=ValueError("stub")))
        self.side.upload_from_string.assert_not_called()
    def test_concurrent_replacement_cannot_be_accepted(self):
        self.store.objects.side_effect=[(self.blob,self.side),(SimpleNamespace(generation=13),self.side)]
        self.assertFalse(self.store.validate("gs://bucket/song.mp3",60,"audio",Mock(return_value=60)))
        self.side.upload_from_string.assert_not_called()
    def test_denial_is_not_absence(self):
        self.side.download_as_text.side_effect=PermissionError("denied")
        with self.assertRaises(PermissionError):self.store.verified("gs://bucket/song.mp3",60,"audio")
if __name__ == "__main__":unittest.main()
