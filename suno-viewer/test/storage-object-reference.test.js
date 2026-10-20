const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeStorageObjectReference } = require("../storage-object-reference");

test("catalog HTTPS lyrics resolve to the same stored object as gs references", () => {
  const object = "aeonimus-workspaces/exports/suno/lyrics/song-id/lyrics.vtt";
  assert.equal(normalizeStorageObjectReference(`https://storage.googleapis.com/${object}`), `gs://${object}`);
  assert.equal(normalizeStorageObjectReference(`gs://${object}`), `gs://${object}`);
});

test("supports encoded object names and virtual-hosted GCS URLs", () => {
  assert.equal(normalizeStorageObjectReference("https://bucket.storage.googleapis.com/folder/a%20b.txt?generation=123"), "gs://bucket/folder/a b.txt");
  assert.equal(normalizeStorageObjectReference("https://storage.googleapis.com/bucket/lyrics%2Ffile.txt"), "gs://bucket/lyrics/file.txt");
});

test("does not treat unrelated or incomplete URLs as Storage objects", () => {
  for (const url of ["", "gs://bucket", "https://storage.googleapis.com/bucket", "https://storage.googleapis.com/bucket/", "https://storage.googleapis.com.evil.example/bucket/file", "https://example.com/bucket/file", "http://storage.googleapis.com/bucket/file", "https://user:pass@storage.googleapis.com/bucket/file", "https://storage.googleapis.com:8443/bucket/file", "https://storage.googleapis.com/bucket/%ZZ"]) {
    assert.equal(normalizeStorageObjectReference(url), "", url);
  }
});
