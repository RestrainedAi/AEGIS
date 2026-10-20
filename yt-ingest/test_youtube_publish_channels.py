#!/usr/bin/env python3
import unittest

from account_labels import HANDLE_ALIAS_MAP, canonical_account_label, canonical_account_handle
from youtube_publish_channels import resolve_publish_channel, oauth_secret_for_channel


class PublishChannelTests(unittest.TestCase):
    def test_nessihenize_maps_to_secondary(self):
        self.assertEqual(canonical_account_label("nessihenize"), "vanessa_secondary")
        self.assertEqual(
            resolve_publish_channel(account_handle="nessihenize"),
            "vanessa_secondary",
        )

    def test_primary_handle_maps_to_primary_secret(self):
        self.assertEqual(
            oauth_secret_for_channel("vanessa_primary"),
            "youtube-oauth-refresh-token",
        )

    def test_secondary_secret_name(self):
        self.assertEqual(
            oauth_secret_for_channel("vanessa_secondary"),
            "youtube-oauth-refresh-token-vanessa-secondary",
        )

    def test_source_id_routing(self):
        self.assertEqual(
            resolve_publish_channel(source_id="suno_nessihenize"),
            "vanessa_secondary",
        )
        self.assertEqual(
            resolve_publish_channel(source_id="suno_unshakableechos2341"),
            "vanessa_primary",
        )


if __name__ == "__main__":
    unittest.main()
