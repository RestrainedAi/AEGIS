const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ISSUE_TAGS, issueIdsForSong, songHasIssues } = require("../issue-tags");

const healthy = {
  songKey: "a", status: "active", gcs_mp3: "gs://b/a.mp3", gcs_mp4: "gs://b/a.mp4", gcs_thumb: "gs://b/a.jpg",
};

test("a healthy song has no issue tags", () => {
  assert.deepEqual(issueIdsForSong(healthy), []);
  assert.equal(songHasIssues(healthy), false);
});

test("mediaIssues from the catalog wins and is shown in a fixed order", () => {
  const song = { ...healthy, mediaIssues: "no_thumb;removed_from_suno;bogus;no_video" };
  assert.deepEqual(issueIdsForSong(song), ["removed_from_suno", "no_video", "no_thumb"]);
});

test("the two songs Suno deleted keep their tag", () => {
  for (const key of ["cb39738d-5e3a-412e-bbd2-63f2d65b5ee0", "e6378018-0da1-4efa-9695-b0e18b42f57e"]) {
    assert.ok(issueIdsForSong({ ...healthy, songKey: key, mediaIssues: "removed_from_suno;silent_placeholder" })
      .includes("removed_from_suno"));
  }
});

test("older catalogs fall back to the paths", () => {
  assert.deepEqual(issueIdsForSong({ ...healthy, audio_asset_role: "derived-from-video" }), ["audio_from_video"]);
  assert.deepEqual(issueIdsForSong({ ...healthy, gcs_mp3: "", gcs_latest_audio: "" }), ["no_audio"]);
  assert.deepEqual(issueIdsForSong({ ...healthy, audio_url: "https://cdn-o.suno.com/sil-100.mp3" }), ["silent_placeholder"]);
  assert.deepEqual(issueIdsForSong({ ...healthy, gcs_mp4: "", gcs_thumb: "", image_url: "" }), ["no_video", "no_thumb"]);
  assert.deepEqual(issueIdsForSong({ ...healthy, status: "removed_from_suno" }), ["removed_from_suno"]);
});

test("every tag has a plain-words explanation", () => {
  for (const tag of ISSUE_TAGS) {
    assert.ok(tag.label && tag.info.length > 30, tag.id);
    assert.doesNotMatch(tag.info, /\b(gcs|gs:\/\/|stub|404|derived)\b/i, `${tag.id} should avoid jargon`);
  }
});

test("the TypeScript copy matches the tested JS copy", () => {
  const ts = fs.readFileSync(path.join(__dirname, "..", "src", "lib", "issue-tags.ts"), "utf8");
  for (const tag of ISSUE_TAGS) {
    assert.ok(ts.includes(`id: "${tag.id}"`), tag.id);
    assert.ok(ts.includes(JSON.stringify(tag.label)), tag.label);
    assert.ok(ts.includes(tag.info.replace(/\u201c/g, "\\u201c").replace(/\u201d/g, "\\u201d")), `${tag.id} info`);
  }
});

test("the song card renders the tags in one spot and the Has issues quick view exists", () => {
  const grid = fs.readFileSync(path.join(__dirname, "..", "src", "components", "VaultGrid.tsx"), "utf8");
  const cardStart = grid.indexOf("function SongCard(");
  const cardEnd = grid.indexOf("\nfunction ", cardStart + 10);
  const card = grid.slice(cardStart, cardEnd);
  assert.equal((card.match(/<IssueTagRow /g) || []).length, 1, "exactly one tag row per card");
  assert.ok(card.indexOf("<IssueTagRow ") < card.indexOf("{isExpanded && audio"), "tags sit above the expandable player");
  assert.match(grid, /\{ key: 'has_issues', label: 'Has issues' \}/);
  assert.match(grid, /aria-describedby/);
});

test("untitled songs with issue tags (incl. removed from Suno) stay listed in the grid", () => {
  const grid = fs.readFileSync(path.join(__dirname, "..", "src", "components", "VaultGrid.tsx"), "utf8");
  const start = grid.indexOf("const hasRenderableVaultIdentity");
  // The grid delegates to the shared helper, which is behavior-tested below.
  assert.match(grid.slice(start, start + 400), /songHasVaultIdentity\(/);
  assert.match(grid, /hideRemoved\) out = out\.filter\(s => !songIsRemoved\(s\)\)/);
});

const { isRemovedFromSuno, hasRenderableVaultIdentity } = require("../issue-tags");

test("isRemovedFromSuno honors the mediaIssues tag as well as status", () => {
  assert.equal(isRemovedFromSuno({ ...healthy, status: "removed_from_suno" }), true);
  assert.equal(isRemovedFromSuno({ ...healthy, status: "active", mediaIssues: "removed_from_suno;no_video" }), true);
  assert.equal(isRemovedFromSuno({ ...healthy, mediaIssues: "no_video" }), false);
  assert.equal(isRemovedFromSuno(healthy), false);
});

test("hasRenderableVaultIdentity keeps titled songs and any ID with an issue tag", () => {
  assert.equal(hasRenderableVaultIdentity({ ...healthy, title: "T", createdAt: "2026-01-01" }), true);
  assert.equal(hasRenderableVaultIdentity({ ...healthy, title: "", createdAt: "" }), false);
  assert.equal(hasRenderableVaultIdentity({ songKey: "x", mediaIssues: "silent_placeholder" }), true);
  assert.equal(hasRenderableVaultIdentity({ songKey: "x", status: "removed_from_suno" }), true);
  assert.equal(hasRenderableVaultIdentity({ songKey: "", mediaIssues: "no_audio" }), false);
});

test("browser issue-tags.ts exports the same helpers", () => {
  const tsSrc = fs.readFileSync(path.join(__dirname, "..", "src", "lib", "issue-tags.ts"), "utf8");
  assert.match(tsSrc, /export function isRemovedFromSuno/);
  assert.match(tsSrc, /export function hasRenderableVaultIdentity/);
});
