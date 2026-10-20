// Resolve catalog references through the authenticated Storage SDK, including
// the HTTPS object URLs emitted by the lyric artifact pipeline.
function normalizeStorageObjectReference(value) {
  const input = String(value || "").trim();
  if (/^gs:\/\/[^/]+\/.+/i.test(input)) return input;
  try {
    const url = new URL(input);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return "";
    let bucket;
    let object;
    if (url.hostname === "storage.googleapis.com") {
      const path = url.pathname.slice(1);
      const separator = path.indexOf("/");
      if (separator < 1) return "";
      bucket = path.slice(0, separator);
      object = path.slice(separator + 1);
    } else if (url.hostname.endsWith(".storage.googleapis.com")) {
      bucket = url.hostname.slice(0, -".storage.googleapis.com".length);
      object = url.pathname.slice(1);
    } else {
      return "";
    }
    if (!bucket || !object) return "";
    return `gs://${bucket}/${decodeURIComponent(object)}`;
  } catch {
    return "";
  }
}

module.exports = { normalizeStorageObjectReference };
