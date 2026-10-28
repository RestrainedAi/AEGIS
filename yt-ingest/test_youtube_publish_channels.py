#!/usr/bin/env python3
import unittest
from unittest import mock

from account_labels import canonical_account_label
import youtube_uploader as up
from youtube_publish_channels import (
    UnmappedPublishChannel,
    oauth_secret_for_channel,
    resolve_publish_channel,
)

# Example data as stored in Firestore (seeded at deploy time, not in code).
REG = {
    "sundrop_cloud": {"tokenSecret": "youtube-oauth-refresh-token", "enabled": True},
    "vanessa_secondary": {"tokenSecret": "youtube-oauth-refresh-token-vanessa-secondary", "enabled": True},
}
MAP = {"vanessa_primary": "sundrop_cloud", "vanessa_secondary": "vanessa_secondary", "genxdreams": "sundrop_cloud"}


def song(**f):
    return {"fields": {k: {"stringValue": v} for k, v in f.items()}}


class PublishChannelTests(unittest.TestCase):
    def test_nessihenize_alias_uses_account_default(self):
        self.assertEqual(canonical_account_label("nessihenize"), "vanessa_secondary")
        self.assertEqual(resolve_publish_channel(account_handle="nessihenize", channel_map=MAP), "vanessa_secondary")
        self.assertEqual(resolve_publish_channel(source_id="suno_unshakableechos2341", channel_map=MAP), "sundrop_cloud")

    def test_nothing_hardcoded(self):
        self.assertEqual(resolve_publish_channel(account_handle="nessihenize"), "")
        with self.assertRaises(UnmappedPublishChannel):
            oauth_secret_for_channel("vanessa_primary")

    def test_unmapped_account_has_no_channel(self):
        self.assertEqual(resolve_publish_channel(account_handle="gravitystruth", source_id="suno_gravitystruth", channel_map=MAP), "")

    def test_token_secret_from_registry(self):
        self.assertEqual(oauth_secret_for_channel("sundrop_cloud", REG), "youtube-oauth-refresh-token")
        reg = {"gravitys_truth": {"tokenSecret": "yt-token-gravitys-truth"}}
        self.assertEqual(oauth_secret_for_channel("gravitys_truth", reg), "yt-token-gravitys-truth")

    def test_disabled_or_tokenless_channel_blocks(self):
        with self.assertRaises(UnmappedPublishChannel):
            oauth_secret_for_channel("sundrop_cloud", {"sundrop_cloud": {"tokenSecret": "x", "enabled": False}})
        with self.assertRaises(UnmappedPublishChannel):
            oauth_secret_for_channel("x", {"x": {"enabled": True}})

    def _patches(self, owners):
        """owners: {uid: (registry, map)} as stored under users/{uid}/..."""
        reg = lambda tok, uid, ch: {ch: owners.get(uid, ({}, {}))[0][ch]} if ch in owners.get(uid, ({}, {}))[0] else {}
        amap = lambda tok, uid, acct: {acct: owners.get(uid, ({}, {}))[1][acct]} if acct in owners.get(uid, ({}, {}))[1] else {}
        return (mock.patch.object(up, "fs_get_channel_registry_entry", side_effect=reg),
                mock.patch.object(up, "fs_get_channel_map_entry", side_effect=amap))

    def _q(self, **f):
        return {"fields": {k: {"stringValue": v} for k, v in f.items()}}

    def test_gravitystruth_never_falls_back_to_sundrop_cloud(self):
        doc = song(handle="gravitystruth", account_label="gravitystruth", sourceId="suno_gravitystruth")
        r, m = self._patches({"thomas": (REG, MAP)})
        with r, m, self.assertRaises(UnmappedPublishChannel) as ctx:
            up.resolve_publish_target(doc, self._q(ownerUid="thomas"), "tok")
        self.assertIn("gravitystruth", str(ctx.exception))

    def test_account_default_and_channel_pick(self):
        doc = song(handle="genxdreams")
        r, m = self._patches({"thomas": (REG, MAP)})
        with r, m:
            self.assertEqual(up.resolve_publish_target(doc, self._q(ownerUid="thomas"), "tok"), ("thomas", "sundrop_cloud"))
            pick = self._q(ownerUid="thomas", ytPublishChannel="vanessa_secondary")
            self.assertEqual(up.resolve_publish_target(doc, pick, "tok"), ("thomas", "vanessa_secondary"))

    def test_job_rejects_channel_owned_by_another_user(self):
        doc = song(handle="genxdreams")
        r, m = self._patches({"thomas": (REG, MAP), "mallory": ({}, {})})
        with r, m, self.assertRaises(UnmappedPublishChannel):
            up.resolve_publish_target(doc, self._q(ownerUid="mallory", ytPublishChannel="sundrop_cloud"), "tok")

    def test_row_without_owner_is_blocked(self):
        r, m = self._patches({"thomas": (REG, MAP)})
        with r, m, self.assertRaises(UnmappedPublishChannel):
            up.resolve_publish_target(song(handle="genxdreams"), self._q(ytPublishChannel="sundrop_cloud"), "tok")


class RepublishTests(unittest.TestCase):
    def test_history_kept_on_confirmed_republish(self):
        doc = {"fields": {"ytPreviousVideoIds": {"arrayValue": {"values": [{"stringValue": "A"}]}}}}
        out = up.republish_history_fields(doc, "B", "T", True)
        self.assertEqual([v["stringValue"] for v in out["ytPreviousVideoIds"]["arrayValue"]["values"]], ["A", "B"])
        self.assertEqual(up.republish_history_fields(doc, "B", "T", False), {})

    def test_republish_bypasses_guard_only_with_matching_id(self):
        doc = song(ytVideoId="OLD", handle="genxdreams")
        stale = {"fields": {"republishOf": {"stringValue": "SOMETHING_ELSE"}}}
        with mock.patch.object(up, "fs_get", return_value=doc):
            self.assertEqual(up.upload_clip("t", "s", dry_run=True, queue_doc=stale), "OLD")  # guard holds
            ok = {"fields": {"republishOf": {"stringValue": "OLD"}, "ytPublishChannel": {"stringValue": "sundrop_cloud"},
                             "ownerUid": {"stringValue": "thomas"}}}
            with mock.patch.object(up, "fs_get_channel_registry_entry", return_value={"sundrop_cloud": REG["sundrop_cloud"]}), \
                 mock.patch.object(up, "resolve_video_gcs_location", return_value=("b", "o", "media.videoUrl")):
                self.assertIsNone(up.upload_clip("t", "s", dry_run=True, queue_doc=ok))  # would upload


class MigrationPlanTests(unittest.TestCase):
    def test_migration_targets_one_user_and_skips_gravitystruth(self):
        import migrate_channels_to_user as mig
        paths = [p for p, _ in mig.plan("thomas")]
        self.assertTrue(all(p.startswith("users/thomas/") for p in paths))
        self.assertIn("users/thomas/youtubeChannels/sundrop_cloud", paths)
        self.assertFalse(any("gravitystruth" in p for p in paths))


if __name__ == "__main__":
    unittest.main()
