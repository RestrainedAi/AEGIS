const test = require("node:test");
const assert = require("node:assert/strict");

const { getSearchMatchSummary } = require("../search-utils");

test("getSearchMatchSummary prioritizes exact title matches over broader lyric matches", () => {
  const exactTitle = getSearchMatchSummary(
    {
      title: "Omega Kernel",
      account: ["vanessa_primary"],
      styles: ["industrial"],
      tags: [],
      lyrics: "Electric skyline in motion",
    },
    "Omega Kernel"
  );

  const lyricOnly = getSearchMatchSummary(
    {
      title: "Laugh First",
      account: ["vanessa_primary"],
      styles: ["industrial"],
      tags: [],
      lyrics: "Omega kernel in the skyline tonight",
    },
    "Omega Kernel"
  );

  assert.ok(exactTitle);
  assert.ok(lyricOnly);
  assert.equal(exactTitle.fields[0], "Title");
  assert.equal(lyricOnly.fields[0], "Lyrics");
  assert.ok(exactTitle.score > lyricOnly.score);
});

test("getSearchMatchSummary allows multi-token matches across account and lyrics", () => {
  const summary = getSearchMatchSummary(
    {
      title: "Venom Bloom",
      account: ["vanessa_primary"],
      styles: ["dark pop"],
      tags: [],
      lyrics: "Silver snakes circle through the firelight",
    },
    "vanessa snakes"
  );

  assert.ok(summary);
  assert.deepEqual(summary.fields.slice(0, 2), ["Account", "Lyrics"]);
  assert.match(summary.excerpt, /snakes/i);
});

test("getSearchMatchSummary rejects partial multi-token hits when the full query is not represented", () => {
  const summary = getSearchMatchSummary(
    {
      title: "Venom Bloom",
      account: ["vanessa_primary"],
      styles: ["dark pop"],
      tags: [],
      lyrics: "Silver sparks circle through the firelight",
    },
    "vanessa snakes"
  );

  assert.equal(summary, null);
});

test("getSearchMatchSummary matches normalized punctuation-heavy titles", () => {
  const summary = getSearchMatchSummary(
    {
      title: "BEGIN SONIC WEAPON — Ω = DETONATE",
      account: ["vanessa_primary"],
      styles: ["industrial"],
      tags: ["omega"],
      lyrics: "",
    },
    "begin sonic weapon detonate"
  );

  assert.ok(summary);
  assert.equal(summary.fields[0], "Title");
  assert.match(summary.excerpt, /BEGIN SONIC WEAPON/i);
});
