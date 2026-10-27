const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const express = require("express");
const { parse } = require("csv-parse/sync");
const t = require("../title-overrides.cjs");
const { createProgressiveCatalog } = require("../catalog-progressive.cjs");

const CSV =
  "songKey,title,lyrics,createdAt,mediaIssues\n" +
  "suno1,Real Suno Title,,2026-01-01T00:00:00Z,\n" +
  'lyr1,,"[Guitar: soft]\\n\\n[Verse 1]\\nWords get tangled, like roots,",,no_video\n' +
  "old1,,,,silent_placeholder\n" +
  "none1,,,,no_audio\n";
const quiet = { log() {}, warn() {}, error() {} };

function memoryAdapter(initial = null) {
  const state = { generation: initial ? 1 : 0, data: initial, writes: 0, failNext: 0 };
  return {
    state,
    async read() {
      return state.generation ? { generation: String(state.generation), data: JSON.parse(JSON.stringify(state.data)) } : null;
    },
    async write(data, ifGenerationMatch) {
      if (state.failNext > 0) {
        state.failNext -= 1;
        state.generation += 1; // someone else wrote in between
        const err = new Error("Precondition Failed");
        err.code = 412;
        throw err;
      }
      if (String(ifGenerationMatch) !== String(state.generation)) {
        const err = new Error("Precondition Failed");
        err.code = 412;
        throw err;
      }
      state.generation += 1;
      state.writes += 1;
      state.data = JSON.parse(JSON.stringify(data));
      return String(state.generation);
    },
  };
}
const seed = () => ({ version: 1, overrides: { old1: { title: "Fever Dream", source: "old_file" }, suno1: { title: "Ignored guess", source: "old_file" } } });

test("lyric picker matches the shared Python cases", () => {
  for (const c of require("../../yt-ingest/fixtures/lyric_title_cases.json")) {
    assert.equal(t.pickLyricTitle(c.lyrics), c.title, c.lyrics);
  }
});

test("precedence: user > suno > old file > lyrics > blank", () => {
  assert.deepEqual(t.resolveTitle("Suno", "", { title: "Mine", source: "user" }), { title: "Mine", titleSource: "user" });
  assert.deepEqual(t.resolveTitle("Suno", "", { title: "Old", source: "old_file" }), { title: "Suno", titleSource: "suno" });
  assert.deepEqual(t.resolveTitle("", "", { title: "Old", source: "old_file" }), { title: "Old", titleSource: "old_file" });
  assert.deepEqual(t.resolveTitle("", "[Verse]\nHi there", null), { title: "Hi there", titleSource: "lyrics" });
  assert.deepEqual(t.resolveTitle("", "", null), { title: "", titleSource: "" });
});

test("validateTitle trims, limits to 200 characters and rejects control characters", () => {
  assert.equal(t.validateTitle("  Fine  "), "");
  assert.match(t.validateTitle("   "), /empty/);
  assert.match(t.validateTitle("a".repeat(201)), /200/);
  assert.equal(t.validateTitle("🔥".repeat(200)), "");
  assert.match(t.validateTitle("bad\nline"), /line breaks/);
  assert.match(t.validateTitle("x\u202Ey"), /control/);
  assert.match(t.validateTitle(42), /text/);
});

test("applyToCatalog adds titleSource and fills titles; cached per version", async () => {
  const titles = t.createTitleOverrides({ adapter: memoryAdapter(seed()), log: quiet });
  const out = await titles.applyToCatalog({ source: "gcs", buffer: Buffer.from(CSV) });
  const rows = parse(out.buffer.toString("utf8"), { columns: true });
  assert.deepEqual(rows.map((r) => [r.songKey, r.title, r.titleSource]), [
    ["suno1", "Real Suno Title", "suno"],
    ["lyr1", "Words get tangled, like roots", "lyrics"],
    ["old1", "Fever Dream", "old_file"],
    ["none1", "", ""],
  ]);
  assert.equal(rows[1].lyrics, "[Guitar: soft]\\n\\n[Verse 1]\\nWords get tangled, like roots,");
  const again = await titles.applyToCatalog({ source: "gcs", buffer: Buffer.from(CSV) });
  assert.equal(again.buffer, out.buffer);
});

test("a catalog that already has guessed titles is re-resolved, not treated as Suno's", async () => {
  const csv = "songKey,title,lyrics,titleSource\nlyr1,Old guess,la la,lyrics\n";
  const titles = t.createTitleOverrides({ adapter: memoryAdapter({ version: 1, overrides: { lyr1: { title: "Mine", source: "user" } } }), log: quiet });
  const rows = parse((await titles.applyToCatalog({ buffer: Buffer.from(csv) })).buffer.toString(), { columns: true });
  assert.deepEqual([rows[0].title, rows[0].titleSource], ["Mine", "user"]);
});

test("setTitle saves with a generation precondition, keeps the old entry, and revert restores it", async () => {
  const adapter = memoryAdapter(seed());
  const titles = t.createTitleOverrides({ adapter, log: quiet });
  const buf = Buffer.from(CSV);
  const saved = await titles.setTitle({ songKey: "old1", change: { title: "  Fever  Dream (Live) " }, actor: "me@x", catalogBuffer: buf });
  assert.equal(saved.title, "Fever Dream (Live)");
  assert.equal(saved.previousTitle, "Fever Dream");
  assert.equal(saved.canRevert, true);
  assert.equal(adapter.state.data.overrides.old1.replaced.source, "old_file");
  const rows = parse((await titles.applyToCatalog({ buffer: buf })).buffer.toString(), { columns: true });
  assert.equal(rows.find((r) => r.songKey === "old1").title, "Fever Dream (Live)");
  const reverted = await titles.setTitle({ songKey: "old1", change: { revert: true }, actor: "me@x", catalogBuffer: buf });
  assert.deepEqual([reverted.title, reverted.titleSource], ["Fever Dream", "old_file"]);
  assert.equal(adapter.state.data.overrides.old1.source, "old_file");
  const sunoEdit = await titles.setTitle({ songKey: "suno1", change: { title: "Renamed" }, catalogBuffer: buf });
  assert.equal(sunoEdit.previousTitle, "Real Suno Title");
  const back = await titles.setTitle({ songKey: "suno1", change: { revert: true }, catalogBuffer: buf });
  assert.deepEqual([back.title, back.titleSource], ["Real Suno Title", "suno"]);
});

test("setTitle creates the object when missing and retries a raced write without losing data", async () => {
  const adapter = memoryAdapter(null);
  const titles = t.createTitleOverrides({ adapter, log: quiet });
  await titles.setTitle({ songKey: "none1", change: { title: "First" }, catalogBuffer: Buffer.from(CSV) });
  assert.equal(adapter.state.generation, 1);
  adapter.state.failNext = 1;
  await titles.setTitle({ songKey: "lyr1", change: { title: "Second" }, catalogBuffer: Buffer.from(CSV) });
  assert.deepEqual(Object.keys(adapter.state.data.overrides).sort(), ["lyr1", "none1"]);
  adapter.state.failNext = 9;
  await assert.rejects(
    titles.setTitle({ songKey: "lyr1", change: { title: "Third" }, catalogBuffer: Buffer.from(CSV) }),
    (e) => e.status === 409,
  );
  await assert.rejects(titles.setTitle({ songKey: "nope", change: { title: "x" }, catalogBuffer: Buffer.from(CSV) }), (e) => e.status === 404);
});

test("concurrent edits to different songs both survive", async () => {
  const adapter = memoryAdapter(seed());
  const a = t.createTitleOverrides({ adapter, log: quiet });
  const b = t.createTitleOverrides({ adapter, log: quiet });
  const buf = Buffer.from(CSV);
  await Promise.all([
    a.setTitle({ songKey: "lyr1", change: { title: "From A" }, catalogBuffer: buf }),
    b.setTitle({ songKey: "none1", change: { title: "From B" }, catalogBuffer: buf }),
  ]);
  assert.equal(adapter.state.data.overrides.lyr1.title, "From A");
  assert.equal(adapter.state.data.overrides.none1.title, "From B");
  assert.equal(adapter.state.data.overrides.old1.title, "Fever Dream");
});

test("read failures serve the catalog without overrides instead of failing", async () => {
  const titles = t.createTitleOverrides({ adapter: { read: async () => { throw new Error("down"); }, write: async () => "1" }, log: quiet });
  const rows = parse((await titles.applyToCatalog({ buffer: Buffer.from(CSV) })).buffer.toString(), { columns: true });
  assert.equal(rows.find((r) => r.songKey === "suno1").title, "Real Suno Title");
});

async function withApp({ actor = { uid: "u1", email: "owner@x" }, status = 200, adapter = memoryAdapter(seed()), rateLimit } = {}, fn) {
  const app = express();
  app.use(express.json());
  const titles = t.createTitleOverrides({ adapter, log: quiet });
  const audits = [];
  const loadCatalogCsv = async () => ({ source: "gcs", buffer: Buffer.from(CSV) });
  t.installTitleRoutes(app, {
    titles,
    loadCatalogCsv,
    rateLimit,
    log: quiet,
    audit: async (e) => { audits.push(e); },
    authorize: async (_req, res) => {
      if (status !== 200) { res.status(status).json({ ok: false, error: "denied" }); return null; }
      return actor;
    },
  });
  const progressive = createProgressiveCatalog({ loadCatalogCsv: async () => titles.applyToCatalog(await loadCatalogCsv()), authorize: async () => true, log: {} });
  progressive.install(app);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const put = (key, body, headers = { "content-type": "application/json" }) =>
    fetch(`${base}/api/song-title/${key}`, { method: "PUT", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
  try {
    await fn({ put, base, audits, adapter });
  } finally {
    server.close();
  }
}

test("PUT /api/song-title saves, audits, and the light catalog shows it immediately", async () => {
  await withApp({}, async ({ put, base, audits }) => {
    const res = await put("lyr1", { title: "Tangled Roots" });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual([body.ok, body.title, body.titleSource, body.previousTitle], [true, "Tangled Roots", "user", "Words get tangled, like roots"]);
    assert.equal(audits[0].action, "song_title_set");
    assert.equal(audits[0].actorEmail, "owner@x");
    const light = parse(await (await fetch(`${base}/catalog-light.csv`)).text(), { columns: true });
    assert.equal(light.find((r) => r.songKey === "lyr1").title, "Tangled Roots");
    assert.equal(light.find((r) => r.songKey === "lyr1").titleSource, "user");
    const undo = await (await put("lyr1", { revert: true })).json();
    assert.deepEqual([undo.title, undo.titleSource], ["Words get tangled, like roots", "lyrics"]);
    assert.equal(audits[1].action, "song_title_revert");
  });
});

test("PUT /api/song-title enforces auth, JSON, validation and song ids", async () => {
  await withApp({ status: 403 }, async ({ put, adapter }) => {
    assert.equal((await put("lyr1", { title: "x" })).status, 403);
    assert.equal(adapter.state.writes, 0);
  });
  await withApp({ status: 401 }, async ({ put }) => {
    assert.equal((await put("lyr1", { title: "x" })).status, 401);
  });
  await withApp({}, async ({ put, adapter }) => {
    assert.equal((await put("lyr1", "title=x", { "content-type": "application/x-www-form-urlencoded" })).status, 415);
    assert.equal((await put("lyr1", { title: "" })).status, 400);
    assert.equal((await put("lyr1", { title: "a".repeat(201) })).status, 400);
    assert.equal((await put("lyr1", { title: "two\nlines" })).status, 400);
    assert.equal((await put("bad%20key!", { title: "x" })).status, 400);
    assert.equal((await put("missing", { title: "x" })).status, 404);
    assert.equal(adapter.state.writes, 0);
  });
});

test("PUT /api/song-title is rate limited", async () => {
  const { createRateLimiter } = require("../token-hash-auth.cjs");
  await withApp({ rateLimit: createRateLimiter({ windowMs: 60000, max: 2 }) }, async ({ put }) => {
    assert.equal((await put("lyr1", { title: "a" })).status, 200);
    assert.equal((await put("lyr1", { title: "b" })).status, 200);
    assert.equal((await put("lyr1", { title: "c" })).status, 429);
  });
});

test("committed seed has the 26 old-file titles", () => {
  const seedFile = require(path.join("..", "..", "yt-ingest", "fixtures", "title_overrides.seed.json"));
  const entries = Object.values(seedFile.overrides);
  assert.equal(entries.length, 26);
  assert.ok(entries.every((e) => e.source === "old_file" && t.validateTitle(e.title) === ""));
});
