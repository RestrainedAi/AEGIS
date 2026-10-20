const test = require("node:test");
const assert = require("node:assert/strict");

const { artifactExists, buildCustomerManifestRow, hasArtifact } = require("../export-utils");

test("hasArtifact returns true for persisted bucket objects", () => {
  assert.equal(hasArtifact({ manifestObject: "exports/catalog-jobs/job/manifest.csv" }, "manifest"), true);
  assert.equal(hasArtifact({ summaryObject: "exports/catalog-jobs/job/summary.json" }, "summary"), true);
});

test("hasArtifact returns true for local file paths and false when absent", () => {
  assert.equal(hasArtifact({ manifestPath: "C:/tmp/manifest.csv" }, "manifest"), true);
  assert.equal(hasArtifact({ summaryPath: "C:/tmp/summary.json" }, "summary"), true);
  assert.equal(hasArtifact({}, "manifest"), false);
  assert.equal(hasArtifact(null, "summary"), false);
});

test("artifactExists falls back to the durable object when a prior local path is gone", async () => {
  const checkedObjects = [];
  const available = await artifactExists(
    {
      filePath: "/tmp/previous-revision/catalog_part_01.zip",
      objectName: "exports/catalog-jobs/job/parts/catalog_part_01.zip",
    },
    {
      localExists: () => false,
      remoteExists: async (objectName) => {
        checkedObjects.push(objectName);
        return true;
      },
    }
  );

  assert.equal(available, true);
  assert.deepEqual(checkedObjects, ["exports/catalog-jobs/job/parts/catalog_part_01.zip"]);
});

test("artifactExists keeps a usable local artifact without a remote check", async () => {
  let remoteChecked = false;
  const available = await artifactExists(
    {
      filePath: "/tmp/current-revision/catalog_part_01.zip",
      objectName: "exports/catalog-jobs/job/parts/catalog_part_01.zip",
    },
    {
      localExists: () => true,
      remoteExists: async () => {
        remoteChecked = true;
        return true;
      },
    }
  );

  assert.equal(available, true);
  assert.equal(remoteChecked, false);
});

test("buildCustomerManifestRow produces customer-facing export rows only", () => {
  const row = {
    songKey: "abc123",
    account_sourceId: "suno_workspace",
    account_handle: "vanessa_primary",
    account_label: "vanessa_primary",
    title: "What I Do",
    tags: "dreamy,electronic pop",
    displayTags: "dreamy, electronic pop",
    styles: "dreamy,electronic pop",
    styleText: "dreamy electronic pop",
    prompt: "A production note",
    lyrics: "Verse 1",
    lyricsStat: "OK",
    createdAt: "2026-05-04T00:00:00Z",
    updatedAt: "2026-05-04T00:00:00Z",
    duration: "00:04:12",
    ytStatus: "published",
    ytVideo: "abc",
    ytCanonical: "https://youtube.com/watch?v=abc",
    ytPublished: "2026-05-04T00:00:00Z",
    gcs_mp3: "gs://private/audio.mp3",
  };

  const manifestRow = buildCustomerManifestRow(
    row,
    "export-stem",
    { exists: true, exportPath: "audio/export-stem.mp3" },
    { exists: true, exportPath: "images/export-stem.jpg" },
    { exists: true, exportPath: "lyrics/txt/export-stem.txt" },
    { exists: false, exportPath: "lyrics/vtt/export-stem.vtt" },
    ["missing_lyrics_vtt"]
  );

  assert.deepEqual(manifestRow, {
    songKey: "abc123",
    account_sourceId: "suno_workspace",
    account_handle: "vanessa_primary",
    account_label: "vanessa_primary",
    title: "What I Do",
    tags: "dreamy,electronic pop",
    displayTags: "dreamy, electronic pop",
    styles: "dreamy,electronic pop",
    styleText: "dreamy electronic pop",
    prompt: "A production note",
    lyrics: "Verse 1",
    lyricsStat: "OK",
    createdAt: "2026-05-04T00:00:00Z",
    updatedAt: "2026-05-04T00:00:00Z",
    duration: "00:04:12",
    audioPath: "audio/export-stem.mp3",
    thumbPath: "images/export-stem.jpg",
    imagePath: "images/export-stem.jpg",
    lyricsTxtPath: "lyrics/txt/export-stem.txt",
    lyricsVttPath: "",
    exportFileStem: "export-stem",
    exportPart: "",
    assetStatus: "missing_lyrics_vtt",
    notes: "missing_lyrics_vtt",
  });

  assert.equal("ytStatus" in manifestRow, false);
  assert.equal("ytVideo" in manifestRow, false);
  assert.equal("ytCanonical" in manifestRow, false);
  assert.equal("ytPublished" in manifestRow, false);
  assert.equal("gcs_mp3" in manifestRow, false);
});

test("buildCustomerManifestRow reports complete and missing_multiple states", () => {
  const baseRow = {
    songKey: "xyz",
  };

  const completeRow = buildCustomerManifestRow(
    baseRow,
    "stem-a",
    { exists: true, exportPath: "audio/stem-a.mp3" },
    { exists: true, exportPath: "images/stem-a.jpg" },
    { exists: true, exportPath: "lyrics/txt/stem-a.txt" },
    { exists: true, exportPath: "lyrics/vtt/stem-a.vtt" },
    []
  );
  assert.equal(completeRow.assetStatus, "complete");
  assert.equal(completeRow.notes, "");

  const missingMultipleRow = buildCustomerManifestRow(
    baseRow,
    "stem-b",
    { exists: false, exportPath: "audio/stem-b.mp3" },
    { exists: false, exportPath: "images/stem-b.jpg" },
    { exists: false, exportPath: "lyrics/txt/stem-b.txt" },
    { exists: false, exportPath: "lyrics/vtt/stem-b.vtt" },
    ["missing_audio", "missing_image", "missing_lyrics_txt", "missing_lyrics_vtt"]
  );
  assert.equal(missingMultipleRow.assetStatus, "missing_multiple");
  assert.equal(
    missingMultipleRow.notes,
    "missing_audio, missing_image, missing_lyrics_txt, missing_lyrics_vtt"
  );
});
