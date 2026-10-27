const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const express = require("express");
const { parse } = require("csv-parse/sync");
const { buildLightCatalog, createProgressiveCatalog } = require("../catalog-progressive.cjs");

const CSV =
  "songKey,title,prompt,lyrics,createdAt,mediaIssues\n" +
  'old,Old song,"a prompt","[Verse]\nla, ""la""",2025-01-01T00:00:00Z,\n' +
  "new,New song,,,2026-10-26T00:00:00Z,no_video\n" +
  "nodate,,,,,silent_placeholder\n";

test("light catalog drops lyrics/prompt, keeps flags, sorts newest first", () => {
  const light = buildLightCatalog(Buffer.from(CSV));
  const rows = parse(light.csv.toString("utf8"), { columns: true });
  assert.equal(light.rowCount, 3);
  assert.deepEqual(rows.map((r) => r.songKey), ["new", "old", "nodate"]);
  assert.ok(!("lyrics" in rows[0]) && !("prompt" in rows[0]));
  assert.equal(rows[1].hasLyricsText, "1");
  assert.equal(rows[1].hasPromptText, "1");
  assert.equal(rows[0].hasLyricsText, "");
  assert.equal(rows[0].mediaIssues, "no_video");
  assert.deepEqual(light.textBySongKey.get("old"), { lyrics: '[Verse]\nla, "la"', prompt: "a prompt" });
  assert.equal(zlib.gunzipSync(light.gzip).toString("utf8"), light.csv.toString("utf8"));
});

async function withServer(options, fn) {
  const app = express();
  const progressive = createProgressiveCatalog({ log: {}, ...options });
  app.get("/catalog.csv", (req, res) => progressive.sendCsv(req, res, Buffer.from(CSV)));
  progressive.install(app);
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { server.close(); }
}

test("routes serve gzip with ETag/304, row count, and per-song text; enforce auth", async () => {
  let loads = 0;
  let allow = true;
  await withServer({
    loadCatalogCsv: async () => { loads += 1; return { source: "test", buffer: Buffer.from(CSV) }; },
    authorize: async (_req, res) => { if (!allow) res.status(401).json({ ok: false }); return allow; },
  }, async (base) => {
    const r1 = await fetch(`${base}/catalog-light.csv`, { headers: { "accept-encoding": "gzip" } });
    assert.equal(r1.status, 200);
    assert.equal(r1.headers.get("content-encoding"), "gzip");
    assert.equal(r1.headers.get("x-catalog-row-count"), "3");
    const body = await r1.text(); // fetch decompresses
    assert.match(body, /^songKey,title,createdAt,mediaIssues,hasLyricsText,hasPromptText\n/);
    const etag = r1.headers.get("etag");
    const r2 = await fetch(`${base}/catalog-light.csv`, { headers: { "if-none-match": etag } });
    assert.equal(r2.status, 304);

    const t = await (await fetch(`${base}/api/song-text/old`)).json();
    assert.equal(t.lyrics, '[Verse]\nla, "la"');
    assert.equal((await fetch(`${base}/api/song-text/missing`)).status, 404);

    const full = await fetch(`${base}/catalog.csv`, { headers: { "accept-encoding": "gzip" } });
    assert.equal(full.headers.get("content-encoding"), "gzip");
    assert.equal(await full.text(), CSV);

    allow = false;
    assert.equal((await fetch(`${base}/catalog-light.csv`)).status, 401);
    assert.equal((await fetch(`${base}/api/song-text/old`)).status, 401);
    assert.ok(loads >= 3);
  });
});

test("light route returns 500 (client then falls back to catalog.csv) when loading fails", async () => {
  await withServer({
    loadCatalogCsv: async () => { throw new Error("gcs down"); },
    authorize: async () => true,
  }, async (base) => {
    assert.equal((await fetch(`${base}/catalog-light.csv`)).status, 500);
  });
});
