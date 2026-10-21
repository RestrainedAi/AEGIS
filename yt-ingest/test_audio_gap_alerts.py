import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import audio_gap_alerts as aga
import pipeline_monitor as pm

NOW = datetime(2026, 10, 21, 12, tzinfo=timezone.utc)


def song(key, hours_ago, audio=False, url=None, **kw):
    s = {"songKey": key, "handle": "nessihenize", "gcs": {"audio": audio, "video": True},
         "media": {"audioUrl": url}, "firstSeenAt": (NOW - timedelta(hours=hours_ago)).isoformat()}
    s.update(kw)
    return s


class AudioGapAlertTests(unittest.TestCase):
    def test_flags_only_gaps_older_than_24h(self):
        out = aga.flag_audio_gaps([song("old", 30), song("new", 5), song("ok", 100, audio=True, url="gs://x")], NOW)
        self.assertEqual([s["songKey"] for s in out], ["old"])
        self.assertEqual(out[0]["hoursMissing"], 30.0)
        self.assertTrue(out[0]["videoStored"])

    def test_uses_earliest_timestamp_and_sorts_oldest_first(self):
        a = song("a", 26, importedAt=(NOW - timedelta(hours=80)).isoformat())
        out = aga.flag_audio_gaps([song("b", 40), a], NOW)
        self.assertEqual([s["songKey"] for s in out], ["a", "b"])

    def test_unpublished_songs_are_flagged_and_marked(self):
        out = aga.flag_audio_gaps([song("u", 48, publishState="unpublished")], NOW)
        self.assertTrue(out[0]["unpublished"])

    def test_missing_url_even_if_flag_true_counts(self):
        out = aga.flag_audio_gaps([song("x", 48, audio=True, url=None)], NOW)
        self.assertEqual(len(out), 1)

    def test_no_timestamp_is_flagged(self):
        s = song("n", 0)
        del s["firstSeenAt"]
        self.assertEqual(aga.flag_audio_gaps([s], NOW)[0]["reason"], "no timestamp")


class MonitorReportsAudioGaps(unittest.TestCase):
    def summary(self, gaps):
        return pm.build_status_summary("post-harvest", 1.0, "ts", {}, {}, {}, {}, audio_gaps=gaps)

    def test_gaps_mark_status_and_email_reason(self):
        s = self.summary({"count": 3, "songs": [{"songKey": "a"}]})
        self.assertEqual(s["status"], "audio_gaps")
        self.assertEqual(s["emailReason"], "audio_missing_over_24h")
        self.assertEqual(s["audioGapAlerts"]["count"], 3)

    def test_no_gaps_stays_healthy(self):
        self.assertEqual(self.summary({"count": 0})["status"], "healthy")
        self.assertEqual(pm.build_status_summary("post-harvest", 1.0, "ts", {}, {}, {}, {})["status"], "healthy")

    def test_failures_still_take_priority(self):
        s = pm.build_status_summary("post-harvest", 1.0, "ts", {}, {}, {}, {}, partial_harvest_exit=1,
                                    audio_gaps={"count": 5})
        self.assertEqual(s["status"], "partial_harvest")

    def test_reads_alert_file(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "audio_gap_alerts.json"
            p.write_text(json.dumps({"count": 2, "songs": [{}] * 80, "thresholdHours": 24}))
            with patch.object(pm, "AUDIO_GAP_ALERTS_PATH", p):
                r = pm.read_audio_gap_alerts()
            self.assertEqual(r["count"], 2)
            self.assertEqual(len(r["songs"]), 50)
        with patch.object(pm, "AUDIO_GAP_ALERTS_PATH", Path("does-not-exist.json")):
            self.assertEqual(pm.read_audio_gap_alerts(), {})


class HarvestImageTests(unittest.TestCase):
    def test_image_uses_pinned_lgpl_ffmpeg_and_ships_new_modules(self):
        text = (Path(__file__).parent / "Dockerfile.harvest").read_text(encoding="utf-8")
        apt = text.split("apt-get install", 1)[1].split("&&", 1)[0]
        self.assertNotIn("ffmpeg", apt)
        self.assertIn("-lgpl.tar.xz", text)
        self.assertRegex(text, r"FFMPEG_LGPL_SHA256=[0-9a-f]{64}")
        self.assertIn("sha256sum -c", text)
        self.assertIn("--enable-(gpl|nonfree)", text)
        self.assertIn("libmp3lame", text)
        for module in ("derived_audio.py", "audio_gap_alerts.py"):
            self.assertIn(f"COPY {module} .", text)

    def test_entrypoint_runs_alerts_before_monitor(self):
        text = (Path(__file__).parent / "entrypoint.sh").read_text(encoding="utf-8")
        self.assertLess(text.index("audio_gap_alerts.py"), text.index("pipeline_monitor.py\" \"${MONITOR_ARGS"))


if __name__ == "__main__":
    unittest.main()
