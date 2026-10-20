function buildCustomerManifestRow(row, fileStem, audioAsset, imageAsset, lyricsTxtAsset, lyricsVttAsset, missingKinds) {
  return {
    songKey: row.songKey || "",
    account_sourceId: row.account_sourceId || "",
    account_handle: row.account_handle || "",
    account_label: row.account_label || "",
    title: row.title || "",
    tags: row.tags || "",
    displayTags: row.displayTags || "",
    styles: row.styles || "",
    styleText: row.styleText || "",
    prompt: row.prompt || "",
    lyrics: row.lyrics || "",
    lyricsStat: row.lyricsStat || "",
    createdAt: row.createdAt || "",
    updatedAt: row.updatedAt || "",
    duration: row.duration || "",
    audioPath: audioAsset.exists ? audioAsset.exportPath : "",
    thumbPath: imageAsset.exists ? imageAsset.exportPath : "",
    imagePath: imageAsset.exists ? imageAsset.exportPath : "",
    lyricsTxtPath: lyricsTxtAsset.exists ? lyricsTxtAsset.exportPath : "",
    lyricsVttPath: lyricsVttAsset.exists ? lyricsVttAsset.exportPath : "",
    exportFileStem: fileStem,
    exportPart: "",
    assetStatus:
      missingKinds.length === 0
        ? "complete"
        : missingKinds.length === 4
          ? "missing_multiple"
          : [...new Set(missingKinds)].join("|"),
    notes: missingKinds.join(", "),
  };
}

function hasArtifact(job, key) {
  if (!job) return false;
  return Boolean(job[`${key}Path`] || job[`${key}Object`]);
}

async function artifactExists(
  { objectName = "", filePath = "" } = {},
  { localExists = () => false, remoteExists = async () => false } = {}
) {
  // Local Cloud Run files disappear between revisions. A durable object remains
  // the source of truth when an older persisted path is no longer present.
  if (filePath && localExists(filePath)) {
    return true;
  }
  if (!objectName) {
    return false;
  }
  try {
    return Boolean(await remoteExists(objectName));
  } catch (_error) {
    return false;
  }
}

module.exports = {
  artifactExists,
  buildCustomerManifestRow,
  hasArtifact,
};
