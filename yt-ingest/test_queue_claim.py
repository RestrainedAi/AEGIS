#!/usr/bin/env python3
"""Queue claim tests: only one job run may move a row from queued to uploading."""
import io
import json
import threading
import unittest
import urllib.error
import urllib.parse
from unittest import mock

import queue_manager as qm
import youtube_uploader as up

BASE = "projects/p/databases/(default)/documents/ytUploadQueue"


class FakeFirestore:
    """Minimal in-memory Firestore REST double that enforces updateTime preconditions."""

    def __init__(self, rows):
        self.lock = threading.Lock()
        self.rev = 0
        self.docs = {}
        for rid, fields in rows.items():
            self._put(f"{BASE}/{rid}", fields)

    def _put(self, name, fields):
        self.rev += 1
        self.docs[name] = {"name": name, "fields": fields, "updateTime": f"2026-10-28T00:00:{self.rev:02d}.000000Z"}
        return json.loads(json.dumps(self.docs[name]))

    def req(self, token, url, data=None, method=None):
        with self.lock:
            if url.endswith("documents:runQuery"):
                q = json.loads(data)["structuredQuery"]
                want = q["where"]["fieldFilter"]["value"]["stringValue"]
                hits = [d for d in self.docs.values() if d["fields"].get("status", {}).get("stringValue") == want]
                return [{"document": json.loads(json.dumps(d))} for d in hits[: q.get("limit", 100)]]
            if method == "PATCH":
                path, _, query = url.partition("?")
                name = path.split("/v1/", 1)[1]
                params = urllib.parse.parse_qs(query)
                cur = self.docs[name]
                pre = params.get("currentDocument.updateTime")
                if pre and pre[0] != cur["updateTime"]:
                    raise urllib.error.HTTPError(url, 400, "FAILED_PRECONDITION", {}, io.BytesIO(b"{}"))
                fields = dict(cur["fields"])
                fields.update(json.loads(data)["fields"])
                return self._put(name, fields)
            raise AssertionError(f"unexpected request {method} {url}")

    def status(self, rid):
        return self.docs[f"{BASE}/{rid}"]["fields"]["status"]["stringValue"]


def queued(song):
    return {"songKey": {"stringValue": song}, "status": {"stringValue": "queued"}, "retryCount": {"integerValue": "0"}}


class ClaimTests(unittest.TestCase):
    def setUp(self):
        self.fake = FakeFirestore({"r1": queued("song-1")})
        p = mock.patch.object(qm, "_req", side_effect=self.fake.req)
        p.start()
        self.addCleanup(p.stop)

    def test_second_claim_with_stale_read_loses(self):
        doc = qm.fs_query_status("t", "queued", 10)[0]
        self.assertIsNotNone(qm.claim_item("t", doc))
        self.assertIsNone(qm.claim_item("t", doc))  # same stale snapshot
        self.assertEqual(self.fake.status("r1"), "uploading")

    def test_two_runs_claim_same_row_at_once(self):
        snapshot = qm.fs_query_status("t", "queued", 10)[0]
        barrier = threading.Barrier(8)
        wins = []

        def run():
            doc = json.loads(json.dumps(snapshot))
            barrier.wait()
            if qm.claim_item("t", doc) is not None:
                wins.append(1)

        threads = [threading.Thread(target=run) for _ in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(len(wins), 1)

    def test_parallel_process_queue_uploads_once(self):
        calls = []
        barrier = threading.Barrier(2)
        real_query = qm.fs_query_status

        def query(token, status, limit):
            docs = real_query(token, status, limit)
            if docs:
                try:
                    barrier.wait(timeout=2)  # both runs read the row before either claims it
                except threading.BrokenBarrierError:
                    pass
            return docs

        def fake_upload(token, song_key, dry_run=False, queue_doc=None):
            calls.append(song_key)
            return "VID123"

        with mock.patch.object(qm, "fs_query_status", side_effect=query), \
             mock.patch.object(qm.uploader, "upload_clip", side_effect=fake_upload):
            threads = [threading.Thread(target=qm.process_queue, args=("t", 10, False)) for _ in range(2)]
            for t in threads:
                t.start()
            for t in threads:
                t.join()
        self.assertEqual(calls, ["song-1"])
        self.assertEqual(self.fake.status("r1"), "done")

    def test_rows_queued_mid_run_are_drained(self):
        uploaded = []

        def fake_upload(token, song_key, dry_run=False, queue_doc=None):
            uploaded.append(song_key)
            if song_key == "song-1":  # a second publish click lands while we work
                self.fake._put(f"{BASE}/r2", queued("song-2"))
            return "V-" + song_key

        with mock.patch.object(qm.uploader, "upload_clip", side_effect=fake_upload):
            n = qm.process_queue("t", 10, False)
        self.assertEqual(uploaded, ["song-1", "song-2"])
        self.assertEqual(n, 2)

    def test_failed_row_is_not_retried_in_same_run(self):
        attempts = []

        def boom(token, song_key, dry_run=False, queue_doc=None):
            attempts.append(song_key)
            raise RuntimeError("upload failed")

        with mock.patch.object(qm.uploader, "upload_clip", side_effect=boom):
            qm.process_queue("t", 10, False)
        self.assertEqual(attempts, ["song-1"])
        self.assertEqual(self.fake.status("r1"), "queued")

    def test_dry_run_does_not_claim_or_write(self):
        before = json.dumps(self.fake.docs, sort_keys=True)
        with mock.patch.object(qm.uploader, "upload_clip", return_value=None) as m:
            qm.process_queue("t", 10, True)
        self.assertEqual(json.dumps(self.fake.docs, sort_keys=True), before)
        self.assertTrue(m.call_args.kwargs["dry_run"])


class DryRunGuardTests(unittest.TestCase):
    def test_dry_run_still_hits_duplicate_guard(self):
        doc = {"fields": {"ytVideoId": {"stringValue": "7fslnGXLKXE"}, "handle": {"stringValue": "nobody"}}}
        with mock.patch.object(up, "fs_get", return_value=doc), \
             mock.patch.object(up, "fs_patch") as patch, \
             mock.patch.object(up, "get_youtube_token") as tok, \
             mock.patch.object(up, "resolve_video_gcs_location") as loc:
            out = up.upload_clip("t", "song", dry_run=True)
        self.assertEqual(out, "7fslnGXLKXE")
        patch.assert_not_called()
        tok.assert_not_called()
        loc.assert_not_called()


if __name__ == "__main__":
    unittest.main()
