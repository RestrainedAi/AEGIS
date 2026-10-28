// Vault title overrides: best-guess titles plus owner edits that survive nightly harvests.
//
// Store: one JSON object in GCS (default gs://aeonimus-workspaces/exports/suno/state/title_overrides.json)
//   { "version": 1, "overrides": { "<songKey>": { title, source, setBy, setAt, previousTitle, replaced? } } }
// source "user"     = typed in the Vault; always wins over Suno's title.
// source "old_file" = recovered from older harvest files; only fills a blank Suno title.
// Rules match yt-ingest/title_overrides.py (shared cases: yt-ingest/fixtures/lyric_title_cases.json):
//   user edit > Suno title > old-file title > first real lyric line ("lyrics") > blank.
// The server applies overrides to catalog.csv at serve time, so an edit shows on the next
// load without waiting for the harvest. Writes use GCS generation preconditions, so two
// edits at once can never overwrite each other.
const crypto = require("crypto");
const { parse: parseCsvSync } = require("csv-parse/sync");

const TITLE_MAX = 200;
const LYRIC_TITLE_MAX = 80;
const REPLACED_DEPTH = 3;

const SECTION_WORDS =
  "verse|chorus|pre[- ]?chorus|post[- ]?chorus|hook|bridge|intro|outro|interlude|refrain|" +
  "break|breakdown|drop|build|build[- ]?up|instrumental|solo|guitar solo|spoken|spoken word|" +
  "end|ending|fade|fade out|coda|tag|vamp|ad[- ]?libs?|outro chorus|final chorus|instrumental break";
const SECTION_RE = new RegExp(`^\\s*(?:${SECTION_WORDS})(?:\\s*[\\divx]+)?\\s*(?:[:\\-–—|].*)?$`, "i");
const BRACKETED_RE = /\[[^\]]*\]|\([^)]*\)|\{[^}]*\}|<[^>]*>|\*[^*]*\*/g;
const NOTE_RE = /^[A-Za-z][A-Za-z /&+'-]{0,30}:\s/;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/;

function count(text, ch) { return text.split(ch).length - 1; }

function cleanTitle(value, limit = TITLE_MAX) {
  // eslint-disable-next-line no-control-regex
  const text = String(value == null ? "" : value).replace(/[\u0000-\u001f\u007f]/g, " ");
  return Array.from(text.replace(/\s+/g, " ").trim()).slice(0, limit).join("").trim();
}

function stripEdges(text) { return text.replace(/^[\s\-–—|:;,]+|[\s\-–—|:;,]+$/g, ""); }

function pickLyricTitle(lyrics, limit = LYRIC_TITLE_MAX) {
  const text = String(lyrics || "").replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\r\n?/g, "\n");
  for (const raw of text.split("\n")) {
    let line = raw.trim();
    if (!line) continue;
    if (count(line, "[") !== count(line, "]") || count(line, "(") !== count(line, ")")) continue;
    line = stripEdges(cleanTitle(line.replace(BRACKETED_RE, " ")));
    if (line.endsWith(".") && !/\b\w\.\w\.$/.test(line)) line = line.replace(/\.+$/, "").trim();
    if (!line || !/[A-Za-z0-9]/.test(line)) continue;
    if (SECTION_RE.test(line) || NOTE_RE.test(line)) continue;
    const chars = Array.from(line); // code points, to match Python's len()
    if (chars.length > limit) {
      const cut = chars.slice(0, limit).join("");
      const word = cut.includes(" ") ? cut.slice(0, cut.lastIndexOf(" ")).replace(/[ ,;:-]+$/, "") : "";
      line = (word || cut) + "…";
    }
    return line;
  }
  return "";
}

function resolveTitle(sunoTitle, lyrics, override) {
  const suno = cleanTitle(sunoTitle);
  if (override && (override.source || "user") === "user" && cleanTitle(override.title)) {
    return { title: cleanTitle(override.title), titleSource: "user" };
  }
  if (suno) return { title: suno, titleSource: "suno" };
  if (override && cleanTitle(override.title)) {
    return { title: cleanTitle(override.title), titleSource: String(override.source || "old_file") };
  }
  const guess = pickLyricTitle(lyrics);
  if (guess) return { title: guess, titleSource: "lyrics" };
  return { title: "", titleSource: "" };
}

// Returns an error message, or "" when the title is acceptable.
function validateTitle(value) {
  if (typeof value !== "string") return "Title must be text.";
  if (CONTROL_RE.test(value)) return "Title cannot contain line breaks or hidden control characters.";
  const title = value.trim().replace(/ {2,}/g, " ");
  const length = Array.from(title).length;
  if (length < 1) return "Title cannot be empty.";
  if (length > TITLE_MAX) return `Title must be ${TITLE_MAX} characters or fewer.`;
  return "";
}

function normalizeOverrides(data) {
  const entries = data && typeof data === "object" ? (data.overrides || {}) : {};
  const out = {};
  for (const [key, entry] of Object.entries(entries)) {
    if (key && entry && typeof entry === "object" && cleanTitle(entry.title)) out[key] = entry;
  }
  return out;
}

function csvCell(value) {
  const text = String(value == null ? "" : value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// Parse once per catalog version; keeps Suno's own title and lyrics per row.
function parseCatalog(buffer) {
  const text = (Buffer.isBuffer(buffer) ? buffer.toString("utf8") : String(buffer || "")).replace(/^\uFEFF/, "");
  const records = parseCsvSync(text, { bom: true, skip_empty_lines: true, relax_column_count: true });
  const headers = records.shift() || [];
  const keyIdx = headers.indexOf("songKey");
  const titleIdx = headers.indexOf("title");
  const lyricsIdx = headers.indexOf("lyrics");
  const sourceIdx = headers.indexOf("titleSource");
  const songKeys = new Set();
  for (const rec of records) if (keyIdx >= 0 && rec[keyIdx]) songKeys.add(String(rec[keyIdx]).trim());
  return { headers, records, keyIdx, titleIdx, lyricsIdx, sourceIdx, songKeys };
}

function applyOverrides(parsed, overrides) {
  const { headers, records, keyIdx, titleIdx, lyricsIdx, sourceIdx } = parsed;
  if (titleIdx < 0 || keyIdx < 0) return null;
  const outHeaders = sourceIdx >= 0 ? headers : [...headers, "titleSource"];
  const srcIdx = sourceIdx >= 0 ? sourceIdx : headers.length;
  const lines = [outHeaders.map(csvCell).join(",")];
  const counts = {};
  for (const rec of records) {
    const row = rec.slice();
    while (row.length < outHeaders.length) row.push("");
    const key = String(row[keyIdx] || "").trim();
    // A catalog built by the new rebuild already carries guessed titles; only Suno's own title is "real".
    const priorSource = sourceIdx >= 0 ? String(rec[sourceIdx] || "") : "";
    const sunoTitle = priorSource && priorSource !== "suno" ? "" : row[titleIdx];
    const resolved = resolveTitle(sunoTitle, lyricsIdx >= 0 ? row[lyricsIdx] : "", overrides[key]);
    row[titleIdx] = resolved.title;
    row[srcIdx] = resolved.titleSource;
    counts[resolved.titleSource || "blank"] = (counts[resolved.titleSource || "blank"] || 0) + 1;
    lines.push(row.map(csvCell).join(","));
  }
  return { buffer: Buffer.from(lines.join("\n") + "\n", "utf8"), counts };
}

// Find the automatic (non-user) title for one song, to show "previous title" in edits.
function automaticTitleFor(parsed, songKey, overrides) {
  const { records, keyIdx, titleIdx, lyricsIdx, sourceIdx } = parsed;
  for (const rec of records) {
    if (String(rec[keyIdx] || "").trim() !== songKey) continue;
    const priorSource = sourceIdx >= 0 ? String(rec[sourceIdx] || "") : "";
    const sunoTitle = priorSource && priorSource !== "suno" ? "" : rec[titleIdx];
    const entry = overrides[songKey];
    return resolveTitle(sunoTitle, lyricsIdx >= 0 ? rec[lyricsIdx] : "", entry && entry.source !== "user" ? entry : null);
  }
  return null;
}

function trimReplaced(entry, depth = REPLACED_DEPTH) {
  if (!entry) return undefined;
  const copy = { ...entry };
  if (depth <= 1) delete copy.replaced;
  else if (copy.replaced) copy.replaced = trimReplaced(copy.replaced, depth - 1);
  return copy;
}

function gcsAdapter(storage, bucket, object) {
  const isMissing = (e) => e && (e.code === 404 || /No such object/i.test(String(e.message || "")));
  return {
    async read() {
      let meta;
      try {
        [meta] = await storage.bucket(bucket).file(object).getMetadata();
      } catch (e) {
        if (isMissing(e)) return null;
        throw e;
      }
      const [buf] = await storage.bucket(bucket).file(object, { generation: meta.generation }).download();
      return { generation: String(meta.generation), data: JSON.parse(buf.toString("utf8") || "{}") };
    },
    async write(data, ifGenerationMatch) {
      const file = storage.bucket(bucket).file(object);
      await file.save(JSON.stringify(data, null, 2) + "\n", {
        resumable: false,
        contentType: "application/json",
        metadata: { cacheControl: "no-store" },
        preconditionOpts: { ifGenerationMatch: Number(ifGenerationMatch || 0) },
      });
      return String(file.metadata?.generation || "");
    },
  };
}

function isPreconditionFailure(e) {
  return e && (e.code === 412 || /precondition/i.test(String(e.message || "")));
}

function createTitleOverrides({ adapter, ttlMs = 15000, now = () => Date.now(), log = console, maxRetries = 4 }) {
  let cache = null; // { at, generation, overrides, raw }
  let applied = null; // { key, result }
  let parsedCache = null; // { hash, parsed }

  async function getOverrides({ fresh = false } = {}) {
    if (!fresh && cache && now() - cache.at < ttlMs) return cache;
    try {
      const obj = await adapter.read();
      cache = {
        at: now(),
        generation: obj ? obj.generation : "0",
        raw: obj ? obj.data : { version: 1, overrides: {} },
        overrides: normalizeOverrides(obj ? obj.data : null),
      };
    } catch (e) {
      // Serve the catalog without overrides rather than failing the Vault.
      log.warn?.("[title-overrides] read failed:", e?.message || e);
      if (fresh) throw e;
      if (!cache) cache = { at: now(), generation: "unavailable", raw: { version: 1, overrides: {} }, overrides: {} };
      else cache = { ...cache, at: now() };
    }
    return cache;
  }

  function parsedFor(buffer) {
    const hash = crypto.createHash("sha1").update(buffer).digest("hex");
    if (!parsedCache || parsedCache.hash !== hash) parsedCache = { hash, parsed: parseCatalog(buffer) };
    return parsedCache;
  }

  async function applyToCatalog(loaded) {
    const ov = await getOverrides();
    const { hash, parsed } = parsedFor(loaded.buffer);
    const key = `${hash}:${ov.generation}:${Object.keys(ov.overrides).length}`;
    if (!applied || applied.key !== key) {
      const started = now();
      const result = applyOverrides(parsed, ov.overrides);
      if (!result) return loaded;
      applied = { key, result };
      log.log?.(`[title-overrides] applied gen=${ov.generation} counts=${JSON.stringify(result.counts)} in ${now() - started}ms`);
    }
    return { ...loaded, buffer: applied.result.buffer };
  }

  // change: { title } to set, or { revert: true } to go back to the title before the last edit.
  async function setTitle({ songKey, change, actor, catalogBuffer }) {
    const parsed = catalogBuffer ? parsedFor(catalogBuffer).parsed : null;
    if (parsed && !parsed.songKeys.has(songKey)) {
      const err = new Error("Song not found in catalog.");
      err.status = 404;
      throw err;
    }
    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      const ov = await getOverrides({ fresh: true });
      const raw = { version: 1, ...(ov.raw || {}), overrides: { ...((ov.raw && ov.raw.overrides) || {}) } };
      const existing = raw.overrides[songKey];
      const auto = parsed ? automaticTitleFor(parsed, songKey, ov.overrides) : null;
      const currentTitle = existing && existing.source === "user" ? cleanTitle(existing.title) : (auto ? auto.title : "");
      if (change.revert) {
        if (!existing || existing.source !== "user") {
          return { changed: false, songKey, ...(auto || resolveTitle("", "", existing)) };
        }
        if (existing.replaced) raw.overrides[songKey] = existing.replaced;
        else delete raw.overrides[songKey];
      } else {
        const title = cleanTitle(change.title);
        if (existing && existing.source === "user" && cleanTitle(existing.title) === title) {
          return { changed: false, songKey, title, titleSource: "user", previousTitle: existing.previousTitle || "" };
        }
        // Saving a real Suno title unchanged is a no-op: no override, so later Suno renames still show.
        if ((!existing || existing.source !== "user") && auto && auto.titleSource === "suno" && auto.title === title) {
          return { changed: false, songKey, title, titleSource: "suno", previousTitle: "", canRevert: false };
        }
        raw.overrides[songKey] = {
          title,
          source: "user",
          setBy: actor || "unknown",
          setAt: new Date(now()).toISOString(),
          previousTitle: currentTitle,
          ...(existing ? { replaced: trimReplaced(existing) } : {}),
        };
      }
      raw.updatedAt = new Date(now()).toISOString();
      try {
        const generation = await adapter.write(raw, ov.generation === "unavailable" ? 0 : ov.generation);
        cache = { at: now(), generation: generation || `local-${now()}`, raw, overrides: normalizeOverrides(raw) };
        const nextOverrides = cache.overrides;
        const resolved = parsed
          ? (() => {
              const entry = nextOverrides[songKey];
              if (entry && entry.source === "user") return { title: cleanTitle(entry.title), titleSource: "user" };
              return automaticTitleFor(parsed, songKey, nextOverrides) || { title: "", titleSource: "" };
            })()
          : { title: cleanTitle(change.title), titleSource: "user" };
        const entry = nextOverrides[songKey];
        return {
          changed: true,
          songKey,
          ...resolved,
          previousTitle: currentTitle,
          canRevert: Boolean(entry && entry.source === "user"),
          generation: cache.generation,
        };
      } catch (e) {
        if (isPreconditionFailure(e) && attempt < maxRetries) {
          log.warn?.(`[title-overrides] write raced (attempt ${attempt}); retrying`);
          continue;
        }
        if (isPreconditionFailure(e)) {
          const err = new Error("Someone else saved a title at the same moment. Please try again.");
          err.status = 409;
          throw err;
        }
        throw e;
      }
    }
    throw new Error("unreachable");
  }

  return { getOverrides, applyToCatalog, setTitle, _caches: () => ({ cache, applied, parsedCache }) };
}

// PUT /api/song-title/:songKey   body: { "title": "New name" } or { "revert": true }
function installTitleRoutes(app, { titles, authorize, loadCatalogCsv, audit = async () => {}, rateLimit, log = console }) {
  const handlers = [];
  if (rateLimit) handlers.push(rateLimit);
  app.put("/api/song-title/:songKey", ...handlers, async (req, res) => {
    try {
      // Bearer-token auth (no cookies) keeps this CSRF-safe; also insist on a JSON body.
      if (!/^application\/json\b/i.test(String(req.headers["content-type"] || ""))) {
        return res.status(415).json({ ok: false, error: "Send the title as JSON." });
      }
      const actor = await authorize(req, res);
      if (!actor) return;
      const songKey = String(req.params.songKey || "").trim();
      if (!/^[A-Za-z0-9._:-]{1,128}$/.test(songKey)) {
        return res.status(400).json({ ok: false, error: "Invalid song id." });
      }
      const body = req.body && typeof req.body === "object" ? req.body : {};
      let change;
      if (body.revert === true) change = { revert: true };
      else {
        const problem = validateTitle(body.title);
        if (problem) return res.status(400).json({ ok: false, error: problem });
        change = { title: body.title };
      }
      const loaded = await loadCatalogCsv();
      const result = await titles.setTitle({ songKey, change, actor: actor.email || actor.uid, catalogBuffer: loaded.buffer });
      if (result.changed) {
        await audit({
          action: change.revert ? "song_title_revert" : "song_title_set",
          songKey,
          title: result.title,
          previousTitle: result.previousTitle || "",
          actorUid: actor.uid || "",
          actorEmail: actor.email || "",
          at: new Date().toISOString(),
        }).catch((e) => log.warn?.("[song-title] audit failed:", e?.message || e));
      }
      res.set("Cache-Control", "no-store");
      return res.json({ ok: true, ...result });
    } catch (e) {
      const status = e?.status || 500;
      if (status >= 500) log.error?.("[song-title] failed:", e?.message || e);
      return res.status(status).json({ ok: false, error: status >= 500 ? "Could not save the title. Please try again." : e.message });
    }
  });
}

module.exports = {
  TITLE_MAX,
  LYRIC_TITLE_MAX,
  cleanTitle,
  pickLyricTitle,
  resolveTitle,
  validateTitle,
  normalizeOverrides,
  parseCatalog,
  applyOverrides,
  gcsAdapter,
  createTitleOverrides,
  installTitleRoutes,
};
