import os, sys, unittest
from unittest.mock import patch
from types import SimpleNamespace
import catalog_sync_firestore_multi as sync
from media_validation_receipts import CONTRACT, receipt_matches
class DeltaTests(unittest.TestCase):
    def run_delta(self, ids, docs, verified=False, budget="25"):
        modules={"build_manifest_from_studio_api":SimpleNamespace(fetch_profile_clip_ids=lambda h:ids),"media_validation_receipts":SimpleNamespace(ReceiptStore=lambda:SimpleNamespace(verified=lambda *a:verified))}
        files={f"{i}.{ext}" for i in docs for ext in ("mp3","mp4","jpg")}
        with patch.dict(sys.modules,modules), patch.dict(os.environ,{"MEDIA_REPAIR_BUDGET_PER_HANDLE":budget}), patch.object(sync,"get_firestore_docs_rest",return_value=docs), patch.object(sync,"list_gcs_files",return_value=files):
            return sync.compute_handle_delta("unused","authorized","suno_authorized")
    def test_unknown_nonempty_is_pending(self):
        rows,stats=self.run_delta(["a"],{"a":{"lyrics":"words","duration":60}})
        self.assertEqual(rows[0]["reason"],"missing_gcs:audio,mp4")
        self.assertEqual(stats["validation_pending"],1)
    def test_verified_skips_repair(self):
        rows,stats=self.run_delta(["a"],{"a":{"lyrics":"words"}},True)
        self.assertEqual(rows,[])
        self.assertEqual(stats["validation_pending"],0)
    def test_retained_captured_reference(self):
        rows,stats=self.run_delta([],{"a":{"audioUrl":"https://known/a.mp3","lyrics":"words"}})
        self.assertEqual(rows[0]["reason"],"retained:missing_gcs:audio")
        self.assertEqual(rows[0]["audio_url"],"https://known/a.mp3")
        self.assertEqual(stats["retained_without_reference"][0]["assets"],["mp4"])
    def test_budget_backlog(self):
        rows,stats=self.run_delta(["a","b"],{i:{"lyrics":"words"} for i in ["a","b"]},budget="1")
        self.assertEqual(len(rows),1)
        self.assertEqual(len(stats["validation_backlog"]),1)
        self.assertEqual(stats["validation_pending"],2)
    def test_storage_denied_not_absent(self):
        with patch.object(sync.subprocess,"run",return_value=SimpleNamespace(returncode=1,stderr="403")):
            with self.assertRaises(RuntimeError):sync.list_gcs_files("authorized")
    def test_receipt_invalidation(self):
        blob=SimpleNamespace(generation=12,size=12345,md5_hash="md5")
        receipt=dict(contract=CONTRACT,status="verified",generation="12",bytes=12345,md5="md5",sha256="sha",expected_seconds=60,kind="audio")
        self.assertTrue(receipt_matches(receipt,blob,60,"audio"))
        for key,value in [("generation","11"),("bytes",1),("md5","other"),("contract","old"),("sha256","")]:
            self.assertFalse(receipt_matches(dict(receipt,**{key:value}),blob,60,"audio"))
        self.assertFalse(receipt_matches(receipt,blob,61,"audio"))
        self.assertFalse(receipt_matches(receipt,blob,60,"video"))
if __name__ == "__main__":unittest.main()
