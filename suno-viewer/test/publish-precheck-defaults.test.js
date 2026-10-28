const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { describePriorPublish } = require("../publish-precheck.cjs");
const d = require("../publish-defaults.cjs");
const { installYouTubeConnectRoutes } = require("../youtube-connect.cjs");

const names = { sundrop_cloud: "sundrop cloud", other: "Other" };

test("no warning for a song that was never published", () => {
  const r = describePriorPublish({ song: {}, queueRows: [], chosenChannel: "sundrop_cloud" });
  assert.equal(r.state, "none");
  assert.equal(r.canProceed, true);
});

test("already on YouTube: warning carries date, channel, link and privacy", () => {
  const song = { ytVideoId: "7fslnGXLKXE", ytPublishedAt: "2026-10-28T17:47:25Z", ytPublishChannel: "sundrop_cloud", ytPrivacy: "private" };
  const r = describePriorPublish({ song, chosenChannel: "sundrop_cloud", channelNames: names });
  assert.equal(r.state, "on_youtube");
  assert.equal(r.sameChannel, true);
  assert.deepEqual(r.details, {
    ytVideoId: "7fslnGXLKXE",
    url: "https://www.youtube.com/watch?v=7fslnGXLKXE",
    publishedAt: "2026-10-28T17:47:25Z",
    channel: "sundrop_cloud",
    channelName: "sundrop cloud",
    privacy: "private",
  });
  assert.equal(r.canProceed, true);
});

test("the chosen channel is used in the duplicate check", () => {
  const song = { ytVideoId: "V", ytPublishChannel: "sundrop_cloud" };
  const r = describePriorPublish({ song, chosenChannel: "other", channelNames: names });
  assert.equal(r.sameChannel, false);
  assert.match(r.message, /different channel/);
});

test("older publishes fall back to the queue row for channel and privacy", () => {
  const rows = [{ status: "done", ytVideoId: "V", uploadedAt: "2026-09-04T01:08:36Z", ytPublishChannel: "", ytPrivacy: "unlisted" }];
  const r = describePriorPublish({ song: { ytVideoId: "V" }, queueRows: rows });
  assert.equal(r.details.privacy, "unlisted");
  assert.equal(r.details.publishedAt, "2026-09-04T01:08:36Z");
  assert.match(r.details.channelName, /unknown channel/);
});

test("already queued: warning, and going ahead is not offered", () => {
  const rows = [{ status: "queued", queuedAt: "T", ytPublishChannel: "sundrop_cloud", ytPrivacy: "private", queueId: "q1" }];
  const r = describePriorPublish({ song: {}, queueRows: rows, channelNames: names });
  assert.equal(r.state, "queued");
  assert.equal(r.canProceed, false);
  assert.equal(r.details.channelName, "sundrop cloud");
});

test("system fallback privacy is private, not public", () => {
  assert.equal(d.SYSTEM_FALLBACK.privacy, "private");
  assert.equal(d.effectiveDefaults({}).effective.privacy, "private");
});

test("user defaults sit on top of the system set; reset returns to system", () => {
  const system = { privacy: "unlisted", category: "10" };
  const user = { category: "24", privacy: "public" };
  const r = d.effectiveDefaults({ system, user });
  assert.equal(r.effective.privacy, "public");
  assert.equal(r.effective.category, "24");
  assert.equal(r.effective.license, "youtube");
  assert.deepEqual(d.effectiveDefaults({ system, user: {} }).effective, r.system); // "Return to default"
});

test("only differences from the system set are stored; invalid values are dropped", () => {
  assert.deepEqual(d.userOverrides({ privacy: "private", category: "24", license: "bogus", title: "x" }, {}), { category: "24" });
  assert.deepEqual(d.sanitize({ privacy: "everyone", alteredContent: "yes", language: "en-US" }), { language: "en-US" });
});

test("batch mode hides per-song fields", () => {
  assert.deepEqual(d.BATCH_HIDDEN_FIELDS, ["title", "description", "tags"]);
});

test("YouTube connect is a clear 501 plug-in point for now", async () => {
  const app = express();
  installYouTubeConnectRoutes(app);
  const server = app.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/youtube/connect/start`, { method: "POST" });
    assert.equal(res.status, 501);
    assert.equal((await res.json()).code, "youtube_connect_not_built");
  } finally {
    server.close();
  }
});
