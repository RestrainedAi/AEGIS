import json
import os
import unittest

import title_overrides as t

HERE = os.path.dirname(os.path.abspath(__file__))


class LyricTitleTest(unittest.TestCase):
    def test_skips_section_labels_and_notes(self):
        lyrics = ("[Metallic percussion: soft clanks]\\n[Reversed guitar swells]\\n\\n[Verse 1]\\n"
                  "Chaos needs a name so we call it divine\\nA polished excuse")
        self.assertEqual(t.pick_lyric_title(lyrics), "Chaos needs a name so we call it divine")

    def test_skips_unbalanced_fragment_and_plain_labels(self):
        lyrics = ("Guitar: low-gain, palm-muted.]\\n[Bass: tight root notes.]\\n\\n"
                  "[Verse 1 – slow build | soft piano]\\nWords get tangled like roots in rain,\\nmore")
        self.assertEqual(t.pick_lyric_title(lyrics), "Words get tangled like roots in rain")
        self.assertEqual(t.pick_lyric_title("Verse 1\nChorus:\nPre-Chorus 2\nIntro - soft\n(oooh)\nReal line here"),
                         "Real line here")

    def test_production_note_without_brackets(self):
        self.assertEqual(t.pick_lyric_title("Vocal: near-whisper\nI wrote a comment at 3 A.M.,"),
                         "I wrote a comment at 3 A.M.")

    def test_blank_and_instrumental(self):
        self.assertEqual(t.pick_lyric_title(""), "")
        self.assertEqual(t.pick_lyric_title("[Instrumental]\n[Outro]\n..."), "")

    def test_long_line_cut_on_word(self):
        title = t.pick_lyric_title("word " * 40)
        self.assertLessEqual(len(title), t.LYRIC_TITLE_MAX + 1)
        self.assertTrue(title.endswith("…"))

    def test_shared_cases_match_js(self):
        with open(os.path.join(HERE, "fixtures", "lyric_title_cases.json"), encoding="utf-8") as fh:
            for case in json.load(fh):
                self.assertEqual(t.pick_lyric_title(case["lyrics"]), case["title"], case["lyrics"][:40])


class PrecedenceTest(unittest.TestCase):
    def test_user_override_beats_suno(self):
        self.assertEqual(t.resolve_title({"title": "Suno"}, {"title": "Mine", "source": "user"}), ("Mine", "user"))

    def test_old_file_only_fills_blank(self):
        self.assertEqual(t.resolve_title({"title": "Suno"}, {"title": "Old", "source": "old_file"}), ("Suno", "suno"))
        self.assertEqual(t.resolve_title({"title": ""}, {"title": "Old", "source": "old_file"}), ("Old", "old_file"))

    def test_lyrics_then_blank(self):
        self.assertEqual(t.resolve_title({"title": " ", "lyrics": "[Verse]\\nHello world"}), ("Hello world", "lyrics"))
        self.assertEqual(t.resolve_title({"title": "", "lyrics": ""}), ("", ""))

    def test_gcs_beats_seed_and_apply_counts(self):
        merged = t.merged_overrides({"a": {"title": "User A", "source": "user"}},
                                    {"a": {"title": "Seed A", "source": "old_file"}, "b": {"title": "Seed B", "source": "old_file"}})
        rows = [{"songKey": "a", "title": "S"}, {"songKey": "b", "title": ""}, {"songKey": "c", "title": "", "lyrics": "la la"}, {"songKey": "d"}]
        counts = t.apply_titles(rows, merged)
        self.assertEqual([r["title"] for r in rows], ["User A", "Seed B", "la la", ""])
        self.assertEqual(counts, {"user": 1, "old_file": 1, "lyrics": 1, "blank": 1})

    def test_seed_fixture(self):
        seed = t.load_seed()
        self.assertEqual(len(seed), 26)
        for entry in seed.values():
            self.assertEqual(entry["source"], "old_file")
            self.assertEqual(t.clean_title(entry["title"]), entry["title"])


if __name__ == "__main__":
    unittest.main()
