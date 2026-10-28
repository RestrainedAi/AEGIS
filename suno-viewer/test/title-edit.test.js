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
const ui = loadTs("src/lib/title-edit.ts");
const server = require("../title-overrides.cjs");

test("browser and server validation agree", () => {
  for (const value of ["ok", "  spaced  ", "", "   ", "a".repeat(200), "a".repeat(201), "🔥".repeat(200), "x\ny", "tab\there", "a\u202Eb"]) {
    assert.equal(ui.validateTitleInput(value) === "", server.validateTitle(value) === "", JSON.stringify(value));
  }
  assert.equal(ui.normalizeTitleInput("  Fever   Dream "), "Fever Dream");
});

test("best-guess tags for lyrics and old-file titles only", () => {
  assert.equal(ui.titleSourceTag({ songKey: "a", titleSource: "lyrics" }).label, "Title from lyrics");
  assert.equal(ui.titleSourceTag({ songKey: "a", titleSource: "old_file" }).label, "Best guess");
  for (const src of ["suno", "user", "", undefined]) assert.equal(ui.titleSourceTag({ songKey: "a", titleSource: src }), null);
  for (const tag of Object.values(ui.TITLE_SOURCE_TAGS)) assert.ok(tag.info.length > 40);
});

test("applyTitleEdits overlays edits and keeps untouched rows identical", () => {
  const rows = [{ songKey: "a", title: "", titleSource: "" }, { songKey: "b", title: "B", titleSource: "suno" }];
  const out = ui.applyTitleEdits(rows, { a: { title: "New", titleSource: "user" } });
  assert.deepEqual(out[0], { songKey: "a", title: "New", titleSource: "user" });
  assert.equal(out[1], rows[1]);
  assert.equal(ui.applyTitleEdits(rows, {}), rows);
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test("save is optimistic, then settles on the server's answer", async () => {
  const seen = [];
  const pending = deferred();
  const sent = [];
  const editor = ui.createTitleEditor({ send: (key, body) => { sent.push([key, body]); return pending.promise; }, onChange: (e) => seen.push(e) });
  const song = { songKey: "s1", title: "Verse guess", titleSource: "lyrics" };
  const done = editor.save(song, "  My  Title ");
  assert.deepEqual(seen.at(-1), { s1: { title: "My Title", titleSource: "user" } });
  assert.deepEqual(sent, [["s1", { title: "My Title" }]]);
  pending.resolve({ title: "My Title", titleSource: "user", previousTitle: "Verse guess" });
  const result = await done;
  assert.equal(result.previousTitle, "Verse guess");
  assert.deepEqual(editor.edits, { s1: { title: "My Title", titleSource: "user" } });
});

test("a failed save rolls back to what was on screen", async () => {
  const editor = ui.createTitleEditor({ send: async () => { throw new Error("Only the Vault owner can edit titles."); }, onChange: () => {} });
  await assert.rejects(editor.save({ songKey: "s1", title: "Old", titleSource: "suno" }, "New"), /owner/);
  assert.deepEqual(editor.edits, { s1: { title: "Old", titleSource: "suno" } });
  const rows = ui.applyTitleEdits(ui.applyTitleEdits([{ songKey: "s1", title: "Old", titleSource: "suno" }], { s1: { title: "New", titleSource: "user" } }), editor.edits);
  assert.deepEqual(rows[0], { songKey: "s1", title: "Old", titleSource: "suno" });
  // after an earlier successful edit, a failed second edit returns to that first edit
  let fail = false;
  const ok = ui.createTitleEditor({ send: async (_k, b) => { if (fail) throw new Error("offline"); return { title: b.title, titleSource: "user" }; }, onChange: () => {} });
  await ok.save({ songKey: "s1", title: "Old" }, "First");
  fail = true;
  await assert.rejects(ok.save({ songKey: "s1", title: "First", titleSource: "user" }, "Second"), /offline/);
  assert.deepEqual(ok.edits.s1, { title: "First", titleSource: "user" });
});

test("invalid input never reaches the server", async () => {
  let calls = 0;
  const editor = ui.createTitleEditor({ send: async () => { calls += 1; return { title: "", titleSource: "" }; }, onChange: () => {} });
  await assert.rejects(editor.save({ songKey: "s1", title: "x" }, "   "), /Type a title/);
  await assert.rejects(editor.save({ songKey: "s1", title: "x" }, "a\nb"), /line breaks/);
  assert.equal(calls, 0);
});

test("undo shows the previous title right away and sends a revert", async () => {
  const sent = [];
  const seen = [];
  const editor = ui.createTitleEditor({
    send: async (key, body) => { sent.push(body); return body.revert ? { title: "Fever Dream", titleSource: "old_file" } : { title: body.title, titleSource: "user" }; },
    onChange: (e) => seen.push(e),
  });
  const song = { songKey: "s1", title: "Fever Dream", titleSource: "old_file" };
  await editor.save(song, "Fever Dream (Live)");
  const undo = editor.undo({ ...song, title: "Fever Dream (Live)", titleSource: "user" }, { title: "Fever Dream", titleSource: "old_file" });
  assert.deepEqual(seen.at(-1).s1, { title: "Fever Dream", titleSource: "old_file" });
  await undo;
  assert.deepEqual(sent.at(-1), { revert: true });
  assert.deepEqual(editor.edits.s1, { title: "Fever Dream", titleSource: "old_file" });
});

test("readTitleResponse turns server errors into plain messages", async () => {
  const resp = (status, body) => ({ ok: status < 400, status, json: async () => body });
  assert.deepEqual(await ui.readTitleResponse(resp(200, { ok: true, title: "T", titleSource: "user", previousTitle: "P" })),
    { title: "T", titleSource: "user", previousTitle: "P", canRevert: undefined });
  await assert.rejects(ui.readTitleResponse(resp(400, { ok: false, error: "Title cannot be empty." })), /empty/);
  await assert.rejects(ui.readTitleResponse({ ok: false, status: 429, json: async () => { throw new Error("x"); } }), /Too many/);
});

test("every card view uses the same editable title", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "components", "VaultGrid.tsx"), "utf8");
  const songCard = src.slice(src.indexOf("function SongCard("), src.indexOf("function QueueStatusPill("));
  const catalogRow = src.slice(src.indexOf("function CatalogRow("), src.indexOf("export default function VaultGrid("));
  assert.match(songCard, /<EditableTitle/);
  assert.match(catalogRow, /<EditableTitle/);
  assert.doesNotMatch(songCard + catalogRow, /\{song\.title \|\| 'Untitled'\}/);
  assert.match(src, /<TitleEditContext\.Provider value=\{titleEditApi\}>/);
});

test("search sees the displayed title, the Untitled fallback and best-guess tag labels", () => {
  const search = require("../search-utils");
  const doc = song => { const t = ui.titleSearchTerms(song); return { title: t.title, account: [], styles: [], tags: t.tags, lyrics: "" }; };
  const untitled = { songKey: "u", title: "", titleSource: "" };
  const lyric = { songKey: "l", title: "Verse 1", titleSource: "lyrics" };
  const guess = { songKey: "g", title: "Old Name", titleSource: "old_file" };
  const normal = { songKey: "n", title: "Fever Dream", titleSource: "suno" };
  assert.deepEqual(ui.titleSearchTerms(untitled), { title: "Untitled", tags: [] });
  assert.ok(search.getSearchMatchSummary(doc(untitled), "Untitled"));
  assert.ok(search.getSearchMatchSummary(doc(lyric), "Title from lyrics"));
  assert.ok(search.getSearchMatchSummary(doc(guess), "Best guess"));
  assert.ok(search.getSearchMatchSummary(doc(guess), "Old Name"));
  assert.equal(search.getSearchMatchSummary(doc(normal), "Untitled"), null);
  assert.equal(search.getSearchMatchSummary(doc(normal), "Title from lyrics"), null);
});

test("Vault grid search uses titleSearchTerms", () => {
  const grid = fs.readFileSync(path.join(__dirname, "..", "src/components/VaultGrid.tsx"), "utf8");
  assert.match(grid, /title: titleTerms\.title,/);
  assert.match(grid, /\.\.\.titleTerms\.tags\]/);
});
test("cautious lyric guess: junk lines are skipped, real line keeps the tag, all-junk stays Untitled", () => {
  const ui = loadTs("src/lib/title-edit.ts");
  const search = require("../search-utils");
  const t = require("../title-overrides.cjs");
  const picked = t.resolveTitle("", "## Opening Invocation\nHere is your 5,000-character song:\nLyrics\nCold rain on the window", null);
  assert.deepEqual(picked, { title: "Cold rain on the window", titleSource: "lyrics" });
  const doc = song => { const s = ui.titleSearchTerms(song); return { title: s.title, account: [], styles: [], tags: s.tags, lyrics: "" }; };
  const song = { songKey: "c", ...picked };
  assert.equal(ui.titleSourceTag(song).label, "Title from lyrics");
  assert.ok(search.getSearchMatchSummary(doc(song), "Title from"));
  assert.ok(search.getSearchMatchSummary(doc(song), "Cold rain"));
  const junk = t.resolveTitle("", "Lyrics\n# Song\nUnderstood \u2014 ignition confirmed.\n[Outro]", null);
  assert.deepEqual(junk, { title: "", titleSource: "" });
  const empty = { songKey: "j", ...junk };
  assert.equal(ui.titleSourceTag(empty), null);
  assert.ok(search.getSearchMatchSummary(doc(empty), "Untitled"));
  assert.deepEqual(t.resolveTitle("Suno Name", "Lyrics", null), { title: "Suno Name", titleSource: "suno" });
  assert.deepEqual(t.resolveTitle("", "Lyrics", { title: "Mine", source: "user" }), { title: "Mine", titleSource: "user" });
});
