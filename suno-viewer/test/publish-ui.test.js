const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function loadTs(rel) {
  const file = path.join(__dirname, "..", rel);
  const out = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", "require", out)(mod, mod.exports, require);
  return mod.exports;
}

const ui = loadTs("src/lib/publish-ui.ts");

test("batch requests never carry per-song title, description or tags", () => {
  const meta = { title: "Song A", description: "A's lyrics", tags: "a", privacy: "private", category: "24", channel: "x" };
  assert.deepEqual(ui.queueMetaForRequest(meta, true), { privacy: "private", category: "24" });
  assert.deepEqual(ui.queueMetaForRequest(meta, false), { title: "Song A", description: "A's lyrics", tags: "a", privacy: "private", category: "24" });
});

test("channel picker defaults to the account's channel, never a fallback", () => {
  const channels = [{ key: "sundrop_cloud", name: "sundrop cloud" }, { key: "off", name: "Off", enabled: false }];
  const defaults = { genxdreams: "sundrop_cloud", vanessa_secondary: "off" };
  assert.equal(ui.defaultChannelForAccount(["genxdreams"], defaults, channels), "sundrop_cloud");
  assert.equal(ui.defaultChannelForAccount(["gravitystruth"], defaults, channels), "");
  assert.equal(ui.defaultChannelForAccount(["vanessa_secondary"], defaults, channels), "");
});

test("warning lines show date, channel, privacy and link", () => {
  const lines = ui.priorPublishLines({
    state: "on_youtube",
    details: { publishedAt: "2026-10-28T17:47:25Z", channelName: "sundrop cloud", privacy: "private", url: "https://www.youtube.com/watch?v=7fslnGXLKXE" },
  });
  assert.equal(lines.length, 5);
  assert.match(lines[2], /sundrop cloud/);
  assert.match(lines[3], /private/);
  assert.match(lines[4], /7fslnGXLKXE/);
  assert.match(ui.priorPublishLines({ state: "queued", details: { privacy: "private" } })[0], /queue/);
  assert.deepEqual(ui.priorPublishLines({ state: "none" }), []);
});

test("'On YouTube' only with a real video ID; Suno state has its own words", () => {
  assert.equal(ui.isOnYouTube({ status: "done" }), false);
  assert.equal(ui.youtubeStateLabel({ status: "done" }), "YouTube: no video ID");
  assert.equal(ui.youtubeStateLabel({ status: "done", ytVideoId: "V" }), "On YouTube");
  assert.equal(ui.youtubeUrl({ ytVideoId: "V" }), "https://www.youtube.com/watch?v=V");
  assert.equal(ui.youtubeStateLabel({ status: "queued" }), "Queued for YouTube");
  assert.equal(ui.sunoStateLabel(false), "Live on Suno");
  assert.equal(ui.sunoStateLabel(true), "Removed from Suno");
  for (const s of [ui.sunoStateLabel(false), ui.sunoStateLabel(true), ui.youtubeStateLabel({ status: "done" })]) {
    assert.doesNotMatch(s, /^Published$/);
  }
});
