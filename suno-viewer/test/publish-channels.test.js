const test = require("node:test");
const assert = require("node:assert/strict");
const pc = require("../publish-channels.cjs");

// Example registry as it would be stored in Firestore (seeded at deploy, not in code).
const REG = {
  sundrop_cloud: { name: "sundrop cloud", youtubeChannelId: "UCcFXR8PM5Hfwcy7WyaL7v8Q", tokenSecret: "youtube-oauth-refresh-token", enabled: true },
  vanessa_secondary: { name: "Vanessa secondary", youtubeChannelId: "", tokenSecret: "youtube-oauth-refresh-token-vanessa-secondary", enabled: true },
};
const MAP = { genxdreams: "sundrop_cloud", vanessa_primary: "sundrop_cloud", vanessa_secondary: "vanessa_secondary" };
const gravity = pc.accountCandidates({ label: "gravitystruth", handle: "gravitystruth", sourceId: "suno_gravitystruth" });

test("gravitystruth is blocked until its own channel exists (no fallback to sundrop cloud)", () => {
  const r = pc.resolveChannel({ candidates: gravity, channelMap: MAP, registry: REG });
  assert.equal(r.ok, false);
  assert.equal(r.code, "channel_unmapped");
  assert.match(r.error, /gravitystruth/);
});

test("nothing is hardcoded: with an empty registry every account is blocked", () => {
  for (const acct of ["vanessa_primary", "vanessa_secondary", "genxdreams"]) {
    assert.equal(pc.resolveChannel({ candidates: [acct] }).ok, false);
  }
});

test("each account uses its default channel", () => {
  const r = pc.resolveChannel({ candidates: ["genxdreams"], channelMap: MAP, registry: REG });
  assert.deepEqual([r.ok, r.channel, r.channelName], [true, "sundrop_cloud", "sundrop cloud"]);
  assert.equal(pc.resolveChannel({ candidates: ["vanessa_secondary"], channelMap: MAP, registry: REG }).channel, "vanessa_secondary");
});

test("the Publish form's channel pick overrides the default, for any account", () => {
  const r = pc.resolveChannel({ candidates: ["genxdreams"], channelMap: MAP, registry: REG, requested: "vanessa_secondary" });
  assert.equal(r.channel, "vanessa_secondary");
  assert.equal(r.defaultChannel, "sundrop_cloud");
  const g = pc.resolveChannel({ candidates: gravity, channelMap: MAP, registry: REG, requested: "sundrop_cloud" });
  assert.equal(g.ok, true); // an explicit, deliberate pick is allowed; only silent fallback is blocked
});

test("a new channel is linked through settings only", () => {
  const reg = { ...REG, gravitys_truth: { name: "Gravitys Truth", youtubeChannelId: "UCx", tokenSecret: "yt-token-gravitys-truth", enabled: true } };
  const r = pc.resolveChannel({ candidates: gravity, channelMap: { ...MAP, gravitystruth: "gravitys_truth" }, registry: reg });
  assert.deepEqual([r.ok, r.channel], [true, "gravitys_truth"]);
});

test("unknown, disabled, or token-less channels are blocked", () => {
  assert.equal(pc.resolveChannel({ candidates: ["genxdreams"], registry: REG, requested: "nope" }).code, "channel_unknown");
  // another user's channel is simply absent from this user's registry -> blocked
  assert.equal(pc.resolveChannel({ candidates: ["genxdreams"], channelMap: MAP, registry: {} }).code, "channel_unknown");
  const off = { ...REG, sundrop_cloud: { ...REG.sundrop_cloud, enabled: false } };
  assert.equal(pc.resolveChannel({ candidates: ["genxdreams"], channelMap: MAP, registry: off }).code, "channel_disabled");
  const noTok = { x: { name: "X", enabled: true } };
  assert.equal(pc.resolveChannel({ candidates: ["a"], channelMap: { a: "x" }, registry: noTok }).code, "channel_no_token");
});

test("listChannels never exposes token references", () => {
  const list = pc.listChannels(REG);
  assert.deepEqual(list.map((c) => c.key), ["sundrop_cloud", "vanessa_secondary"]);
  assert.ok(list.every((c) => !("tokenSecret" in c)));
});

test("changing an account's default channel resets published state and keeps history (DEV-57)", () => {
  const songs = [
    { songKey: "a", ytVideoId: "OLD1", ytStatus: "done", ytPreviousVideoIds: ["OLDER"] },
    { songKey: "b" },
    { songKey: "c", ytStatus: "error" },
  ];
  const plan = pc.planChannelChange({ account: "genxdreams", oldChannel: "sundrop_cloud", newChannel: "other", songs, now: "T" });
  assert.deepEqual(plan.resets.map((r) => r.songKey), ["a", "c"]);
  const a = plan.resets[0].fields;
  assert.equal(a.ytVideoId.stringValue, "");
  assert.equal(a.ytPublishedAt.stringValue, "");
  assert.deepEqual(a.ytPreviousVideoIds.arrayValue.values.map((v) => v.stringValue), ["OLDER", "OLD1"]);
  assert.equal(a.ytPreviousChannel.stringValue, "sundrop_cloud");
});

test("same channel means no reset; keys are validated", () => {
  assert.deepEqual(pc.planChannelChange({ account: "x", oldChannel: "k", newChannel: "k", songs: [{ songKey: "a", ytVideoId: "V" }] }), { changed: false, resets: [] });
  assert.equal(pc.validateChannelKey("gravitys_truth"), true);
  assert.equal(pc.validateChannelKey("../etc"), false);
});
