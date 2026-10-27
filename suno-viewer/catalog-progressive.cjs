// Progressive Vault loading.
//
// The full catalog.csv is ~20 MB because every row carries the song's lyrics and Suno
// prompt. The Vault grid needs neither to draw a card, so this module serves:
//   GET /catalog-light.csv        every row without lyrics/prompt, newest first, gzip, ETag
//   GET /api/song-text/:songKey   lyrics + prompt for one song (fetched when a card opens)
// and gzips /catalog.csv itself when the browser accepts it.
// The light file is derived in memory from the same catalog the server already loads,
// so it can never drift from catalog.csv. If a pre-built catalog-light.csv exists it is
// not required; the client falls back to /catalog.csv if this route fails.
const crypto = require("crypto");
const zlib = require("zlib");
const { parse: parseCsvSync } = require("csv-parse/sync");

const HEAVY_TEXT_COLUMNS = ["lyrics", "prompt"];
const LIGHT_FLAG_COLUMNS = { lyrics: "hasLyricsText", prompt: "hasPromptText" };
const LIGHT_VERSION = "1";

function csvCell(value) {
  const text = String(value == null ? "" : value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function createdAtMs(row) {
  const ms = Date.parse(row.createdAt || "");
  return Number.isFinite(ms) ? ms : -Infinity;
}

function buildLightCatalog(buffer) {
  const text = Buffer.isBuffer(buffer) ? buffer.toString("utf8") : String(buffer || "");
  const rows = parseCsvSync(text, {
    columns: true, bom: true, skip_empty_lines: true, relax_column_count: true,
  });
  const headerLine = text.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] || "";
  const headers = parseCsvSync(headerLine)[0] || [];
  const lightHeaders = headers.filter((h) => !HEAVY_TEXT_COLUMNS.includes(h));
  for (const heavy of HEAVY_TEXT_COLUMNS) {
    if (headers.includes(heavy)) lightHeaders.push(LIGHT_FLAG_COLUMNS[heavy]);
  }
  const textBySongKey = new Map();
  for (const row of rows) {
    const key = String(row.songKey || "").trim();
    if (!key) continue;
    const prev = textBySongKey.get(key);
    // Several rows can share a song key; prefer the one that actually has lyrics.
    if (!prev || (!String(prev.lyrics || "").trim() && String(row.lyrics || "").trim())) {
      textBySongKey.set(key, { lyrics: row.lyrics || "", prompt: row.prompt || "" });
    }
  }
  // Newest first, so the first chunk the browser receives is the first page it shows.
  const ordered = rows
    .map((row, idx) => ({ row, idx }))
    .sort((a, b) => createdAtMs(b.row) - createdAtMs(a.row) || a.idx - b.idx)
    .map(({ row }) => row);
  const lines = [lightHeaders.map(csvCell).join(",")];
  for (const row of ordered) {
    lines.push(lightHeaders.map((h) => {
      if (h === LIGHT_FLAG_COLUMNS.lyrics) return String(row.lyrics || "").trim() ? "1" : "";
      if (h === LIGHT_FLAG_COLUMNS.prompt) return String(row.prompt || "").trim() ? "1" : "";
      return csvCell(row[h]);
    }).join(","));
  }
  const csv = Buffer.from(lines.join("\n") + "\n", "utf8");
  return {
    csv,
    gzip: zlib.gzipSync(csv, { level: 6 }),
    rowCount: rows.length,
    textBySongKey,
  };
}

function acceptsGzip(req) {
  return /\bgzip\b/i.test(String(req.headers["accept-encoding"] || ""));
}

function sendCsv(req, res, raw, gz) {
  res.set("Vary", "Accept-Encoding");
  res.type("text/csv");
  if (acceptsGzip(req)) {
    res.set("Content-Encoding", "gzip");
    return res.send(gz || zlib.gzipSync(raw, { level: 6 }));
  }
  return res.send(raw);
}

function createProgressiveCatalog({ loadCatalogCsv, authorize, log = console }) {
  let cached = null; // { hash, source, light, fullGzip }

  async function current() {
    const loaded = await loadCatalogCsv();
    const hash = crypto.createHash("sha1").update(loaded.buffer).digest("hex");
    if (!cached || cached.hash !== hash) {
      const started = Date.now();
      cached = { hash, source: loaded.source, light: buildLightCatalog(loaded.buffer), fullGzip: null, buffer: loaded.buffer };
      log.log?.(`[catalog-light] rebuilt rows=${cached.light.rowCount} full=${loaded.buffer.length}B light=${cached.light.csv.length}B gzip=${cached.light.gzip.length}B in ${Date.now() - started}ms`);
    }
    return cached;
  }

  function fullGzip(entry) {
    if (!entry.fullGzip) entry.fullGzip = zlib.gzipSync(entry.buffer, { level: 6 });
    return entry.fullGzip;
  }

  function install(app) {
    app.get("/catalog-light.csv", async (req, res) => {
      try {
        if (!(await authorize(req, res))) return;
        const entry = await current();
        const etag = `"light-${LIGHT_VERSION}-${entry.hash}"`;
        res.set("Cache-Control", "private, no-cache");
        res.set("ETag", etag);
        res.set("X-Catalog-Source", entry.source);
        res.set("X-Catalog-Row-Count", String(entry.light.rowCount));
        res.set("X-Catalog-Light-Version", LIGHT_VERSION);
        if (String(req.headers["if-none-match"] || "") === etag) return res.status(304).end();
        return sendCsv(req, res, entry.light.csv, entry.light.gzip);
      } catch (e) {
        res.status(500).type("text/plain").send("Failed to load catalog-light.csv: " + (e?.message || e));
      }
    });

    app.get("/api/song-text/:songKey", async (req, res) => {
      try {
        if (!(await authorize(req, res))) return;
        const entry = await current();
        const text = entry.light.textBySongKey.get(String(req.params.songKey || "").trim());
        res.set("Cache-Control", "private, max-age=300");
        if (!text) return res.status(404).json({ ok: false, error: "Song not found in catalog." });
        return res.json({ ok: true, songKey: req.params.songKey, lyrics: text.lyrics, prompt: text.prompt });
      } catch (e) {
        res.status(500).json({ ok: false, error: `song-text failed: ${e?.message || e}` });
      }
    });
  }

  return { install, current, fullGzip, sendCsv };
}

module.exports = { buildLightCatalog, createProgressiveCatalog, sendCsv, acceptsGzip, HEAVY_TEXT_COLUMNS };
