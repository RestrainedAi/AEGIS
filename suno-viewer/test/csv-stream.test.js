const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { parse } = require("csv-parse/sync");

// Load the browser parser (TypeScript) straight from src so there is one copy.
function loadTs(rel) {
  const file = path.join(__dirname, "..", rel);
  const out = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", "require", out)(mod, mod.exports, require);
  return mod.exports;
}
const { createCsvStreamParser, parseCsvText } = loadTs("src/lib/csv-stream.ts");

const SAMPLE =
  'songKey,title,lyrics\r\n' +
  'a,"Hello, world","line 1\nline ""2"""\r\n' +
  'b,Plain,\r\n' +
  '\r\n' +
  'c,"Ends""",x';

function chunked(text, size) {
  const parser = createCsvStreamParser();
  const out = [];
  for (let i = 0; i < text.length; i += size) out.push(...parser.push(text.slice(i, i + size)));
  out.push(...parser.end());
  return out;
}

test("parses quotes, escaped quotes, embedded newlines and CRLF", () => {
  const rows = parseCsvText(SAMPLE);
  assert.deepEqual(rows, [
    { songKey: "a", title: "Hello, world", lyrics: 'line 1\nline "2"' },
    { songKey: "b", title: "Plain", lyrics: "" },
    { songKey: "c", title: 'Ends"', lyrics: "x" },
  ]);
});

test("gives identical results no matter where chunks split", () => {
  const whole = parseCsvText(SAMPLE);
  for (let size = 1; size <= SAMPLE.length; size++) {
    assert.deepEqual(chunked(SAMPLE, size), whole, `chunk size ${size}`);
  }
});

test("returns rows as soon as they are complete", () => {
  const parser = createCsvStreamParser();
  assert.deepEqual(parser.push("songKey,title\na,One\nb,T"), [{ songKey: "a", title: "One" }]);
  assert.deepEqual(parser.push("wo\n"), [{ songKey: "b", title: "Two" }]);
  assert.deepEqual(parser.end(), []);
});

test("matches csv-parse on a generated catalog with nasty lyrics", () => {
  const rows = [];
  for (let i = 0; i < 300; i++) {
    rows.push({ songKey: `k${i}`, title: `T,${i}"q"`, lyrics: `[Verse]\r\nla "la"\n${"x".repeat(i)},end` });
  }
  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const text = "songKey,title,lyrics\n" + rows.map((r) => [r.songKey, r.title, r.lyrics].map(esc).join(",")).join("\n") + "\n";
  const expected = parse(text, { columns: true, skip_empty_lines: true });
  assert.deepEqual(chunked(text, 777), expected);
  assert.deepEqual(chunked(text, 3), expected);
});
