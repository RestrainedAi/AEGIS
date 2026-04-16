const express = require("express");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const { finished } = require("stream/promises");
const { Storage } = require("@google-cloud/storage");
const archiver = require("archiver");
const { parse: parseCsvSync } = require("csv-parse/sync");
const { applicationDefault, getApps, initializeApp: initializeFirebaseApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const branding = require("./branding.config.json");

const app = express();
const storage = new Storage();
app.use(express.json());

const BUCKET = "aeonimus-workspaces";
const OBJECT = "exports/suno/latest_catalog_wide.csv";
const OBJECT_META = "exports/suno/latest_catalog_wide.meta.json";
const LOCAL_CATALOG_FALLBACK_CANDIDATES = [
  path.join(__dirname, "dist", "catalog.csv"),
  path.join(__dirname, "public", "catalog.csv"),
];
const LOCAL_EXPORT_ROOT = path.join(os.tmpdir(), "aegis-catalog-exports");
const EXPORT_TTL_MS = Number(process.env.CATALOG_EXPORT_TTL_MS || 24 * 60 * 60 * 1000);
const EXPORT_MAX_PART_BYTES = Number(process.env.CATALOG_EXPORT_MAX_PART_BYTES || 1.5 * 1024 * 1024 * 1024);
const PROJECT = "stable-framing-482501-t9";
const DATABASE = "(default)";
const QUEUE_COLLECTION = "ytUploadQueue";
const SONG_COLLECTION = "sunoSongs";
const ACCESS_REQUEST_COLLECTION = "accessRequests";
const APP_NAME = branding.productNames.cloud;
const SUPPORT_EMAIL = "blahnikdigitaldesigns@gmail.com";
const MAIL_CONFIG_SECRET = process.env.MAIL_CONFIG_SECRET || "pipeline-monitor-config";
const AUTH_LEGACY_MODE = String(process.env.AUTH_LEGACY_MODE || "true").toLowerCase() !== "false";
const BETA_SIGNUP_ONLY = String(process.env.BETA_SIGNUP_ONLY || "true").toLowerCase() !== "false";
const BETA_ACCESS_ENDS_AT = String(process.env.BETA_ACCESS_ENDS_AT || "").trim();
const BETA_ACCESS_WINDOW_DAYS = Number(process.env.BETA_ACCESS_WINDOW_DAYS || 60);
const LEGACY_WORKSPACE_ID = process.env.LEGACY_WORKSPACE_ID || branding.legacy.workspaceId;
const LEGACY_WORKSPACE_NAME = process.env.LEGACY_WORKSPACE_NAME || branding.productNames.legacyWorkspace;
const INITIAL_APPROVED_EMAILS = String(
  process.env.INITIAL_APPROVED_EMAILS ||
    "blahnikdigitaldesigns@gmail.com,aeonimusai@gmail.com"
)
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

const SIGNUP_TIER_DEFAULTS = {
  beta: {
    requestKind: "beta",
    planId: "beta",
    role: "viewer",
    workspaceMode: "new",
  },
  free: {
    requestKind: "free",
    planId: "free",
    role: "viewer",
    workspaceMode: "new",
  },
  creator_monthly: {
    requestKind: "paid",
    planId: "creator-monthly",
    role: "editor",
    workspaceMode: "new",
  },
  studio_monthly: {
    requestKind: "paid",
    planId: "studio-monthly",
    role: "admin",
    workspaceMode: "new",
  },
};

let firebaseAuth = null;
let firebaseInitError = "";
let cachedMailConfig = null;
let mailConfigLoadedAt = 0;
let cachedMetadataAccessToken = "";
let cachedMetadataAccessTokenExpiresAt = 0;
const catalogExportJobs = new Map();

try {
  const firebaseApp =
    getApps()[0] ||
    initializeFirebaseApp({
      credential: applicationDefault(),
      projectId: PROJECT,
    });
  firebaseAuth = getAuth(firebaseApp);
} catch (error) {
  firebaseInitError = error?.message || String(error);
}

app.get("/healthz", (_req, res) => res.status(200).send("ok"));
app.get("/favicon.ico", (_req, res) => res.status(204).end());

const REQUIRED_CATALOG_COLUMNS = [
  "displayTags",
  "styles",
  "styleText",
  "lyrics",
  "lyricsStatus",
  "gcsLyricsTxt",
];

function catalogHasRequiredColumns(csvText) {
  const headerLine = String(csvText || "").split(/\r?\n/, 1)[0] || "";
  return REQUIRED_CATALOG_COLUMNS.every((column) => headerLine.includes(column));
}

function catalogHeaderColumns(csvText) {
  const headerLine = String(csvText || "").split(/\r?\n/, 1)[0] || "";
  return headerLine
    .split(",")
    .map((column) => column.trim())
    .filter(Boolean);
}

function missingRequiredCatalogColumns(csvText) {
  const available = new Set(catalogHeaderColumns(csvText));
  return REQUIRED_CATALOG_COLUMNS.filter((column) => !available.has(column));
}

function buildCatalogInspection(source, csvText, errorMessage = "") {
  const text = String(csvText || "");
  const columns = catalogHeaderColumns(text);
  const missingRequired = missingRequiredCatalogColumns(text);
  const rows = text
    .split(/\r?\n/)
    .slice(1)
    .filter((line) => String(line || "").trim() !== "").length;
  let newestCreatedAt = "";
  try {
    const parsed = parseCatalogCsv(text);
    newestCreatedAt = parsed.reduce((latest, row) => {
      const candidate = String(row.createdAt || "").trim();
      return candidate && candidate > latest ? candidate : latest;
    }, "");
  } catch (_error) {
    newestCreatedAt = "";
  }
  return {
    source,
    available: Boolean(text),
    healthy: missingRequired.length === 0 && columns.length > 0,
    columnCount: columns.length,
    missingRequired,
    rowCount: rows,
    newestCreatedAt,
    error: errorMessage,
  };
}

function parseCatalogCsv(csvText) {
  const rows = parseCsvSync(String(csvText || ""), {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
  });
  return rows.map((row) => {
    const normalized = {};
    for (const [key, value] of Object.entries(row || {})) {
      normalized[String(key || "").trim()] = value == null ? "" : String(value);
    }
    return normalized;
  });
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function serializeCsv(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return "";
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row || {})))];
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row?.[header] ?? "")).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function safeFilePart(value, fallback = "untitled") {
  const cleaned = String(value || "")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? cleaned.slice(0, 80) : fallback;
}

function extFromObjectName(objectName, fallback = "") {
  const ext = path.extname(String(objectName || "")).trim();
  return ext || fallback;
}

function byteLabel(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let scaled = value;
  let index = 0;
  while (scaled >= 1024 && index < units.length - 1) {
    scaled /= 1024;
    index += 1;
  }
  return `${scaled >= 10 || index === 0 ? scaled.toFixed(0) : scaled.toFixed(1)} ${units[index]}`;
}

function createCatalogExportJob({ workspaceId, ownerUid, requestedByUid }) {
  const exportId = crypto.randomBytes(8).toString("hex");
  const jobDir = path.join(LOCAL_EXPORT_ROOT, exportId);
  ensureDir(jobDir);
  const job = {
    exportId,
    workspaceId,
    ownerUid,
    requestedByUid,
    status: "preparing",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + EXPORT_TTL_MS).toISOString(),
    jobDir,
    error: "",
    manifestPath: "",
    summaryPath: "",
    totalRows: 0,
    totalAssets: 0,
    totalBytes: 0,
    missingAssets: 0,
    partCount: 0,
    parts: [],
  };
  catalogExportJobs.set(exportId, job);
  return job;
}

function cleanupExpiredCatalogExports() {
  const now = Date.now();
  for (const [exportId, job] of catalogExportJobs.entries()) {
    const expiresAt = Date.parse(job?.expiresAt || "");
    if (!expiresAt || expiresAt > now) continue;
    try {
      if (job?.jobDir && fs.existsSync(job.jobDir)) {
        fs.rmSync(job.jobDir, { recursive: true, force: true });
      }
    } catch (_error) {
      // best effort
    }
    catalogExportJobs.delete(exportId);
  }
}

function loadLocalCatalogFallback() {
  const existingPath = LOCAL_CATALOG_FALLBACK_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  if (!existingPath) {
    throw new Error(
      `Local fallback catalog missing. Tried: ${LOCAL_CATALOG_FALLBACK_CANDIDATES.join(", ")}`
    );
  }
  const fallback = fs.readFileSync(existingPath);
  if (!catalogHasRequiredColumns(fallback.toString("utf8"))) {
    throw new Error(`Local fallback catalog is missing required lyrics/styles columns: ${existingPath}`);
  }
  return fallback;
}

async function loadCatalogCsv() {
  try {
    const [buf] = await storage.bucket(BUCKET).file(OBJECT).download();
    if (catalogHasRequiredColumns(buf.toString("utf8"))) {
      return {
        source: "gcs",
        buffer: buf,
      };
    }
    console.warn("[catalog.csv] GCS export missing required columns; attempting local fallback snapshot");
  } catch (error) {
    console.warn("[catalog.csv] Failed to download GCS export; attempting local fallback snapshot:", error?.message || error);
  }

  try {
    return {
      source: "fallback",
      buffer: loadLocalCatalogFallback(),
    };
  } catch (error) {
    console.warn("[catalog.csv] Local fallback unavailable after GCS miss:", error?.message || error);
  }
  return {
    source: "fallback",
    buffer: loadLocalCatalogFallback(),
  };
}

async function inspectCatalogHealth() {
  let gcsInspection = buildCatalogInspection("gcs", "");
  let fallbackInspection = buildCatalogInspection("fallback", "");

  try {
    const [buf] = await storage.bucket(BUCKET).file(OBJECT).download();
    gcsInspection = buildCatalogInspection("gcs", buf.toString("utf8"));
  } catch (error) {
    gcsInspection = buildCatalogInspection("gcs", "", error?.message || String(error));
  }

  try {
    const fallback = loadLocalCatalogFallback();
    fallbackInspection = buildCatalogInspection("fallback", fallback.toString("utf8"));
  } catch (error) {
    fallbackInspection = buildCatalogInspection("fallback", "", error?.message || String(error));
  }

  const servingSource = gcsInspection.healthy ? "gcs" : fallbackInspection.healthy ? "fallback" : "unavailable";
  return {
    requiredColumns: REQUIRED_CATALOG_COLUMNS,
    servingSource,
    gcs: gcsInspection,
    fallback: fallbackInspection,
  };
}

function lyricObjectName(songKey, format) {
  const safeSongKey = String(songKey || "").trim();
  const safeFormat = String(format || "").trim().toLowerCase();
  if (!/^[a-zA-Z0-9-]+$/.test(safeSongKey)) {
    throw new Error("Invalid songKey");
  }
  if (!["txt", "json", "vtt"].includes(safeFormat)) {
    throw new Error("Invalid lyrics format");
  }
  return `exports/suno/lyrics/${safeSongKey}/lyrics.${safeFormat}`;
}

function parseGsObjectUrl(gsUrl) {
  const value = String(gsUrl || "").trim();
  const match = /^gs:\/\/([^/]+)\/(.+)$/i.exec(value);
  if (!match) {
    throw new Error("Invalid gs:// object path");
  }
  return { bucket: match[1], object: match[2] };
}

function songMediaObjectName(songDoc, kind) {
  const mediaField =
    kind === "audio"
      ? fsMapString(songDoc, "media", "audioUrl")
      : kind === "thumb"
        ? fsMapString(songDoc, "media", "thumbUrl")
        : "";
  if (!mediaField) {
    throw new Error(`Song does not have a ${kind} object path`);
  }
  return parseGsObjectUrl(mediaField);
}

function mediaContentType(kind, objectName) {
  const lower = String(objectName || "").toLowerCase();
  if (kind === "audio") {
    if (lower.endsWith(".wav")) return "audio/wav";
    if (lower.endsWith(".ogg")) return "audio/ogg";
    return "audio/mpeg";
  }
  if (kind === "thumb") {
    if (lower.endsWith(".png")) return "image/png";
    if (lower.endsWith(".webp")) return "image/webp";
    if (lower.endsWith(".gif")) return "image/gif";
    return "image/jpeg";
  }
  return "application/octet-stream";
}

async function listWorkspaceSourceDocs(workspaceId, accessToken) {
  if (!workspaceId) return [];
  const results = await fsRunQuery(
    {
      structuredQuery: {
        from: [{ collectionId: "sources" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "workspaceId" },
            op: "EQUAL",
            value: { stringValue: workspaceId },
          },
        },
        limit: 100,
      },
    },
    accessToken
  );
  return results.filter((row) => row.document).map((row) => row.document);
}

function canAccessCatalogExport(job, context) {
  if (!job || !context?.isAuthenticated) return false;
  if (context.platformAdmin || context.legacyMode) return true;
  return context.workspaces.some((workspace) => workspace.workspaceId === job.workspaceId);
}

function buildWorkspaceCatalogRows(csvText, sourceDocs) {
  const parsedRows = parseCatalogCsv(csvText);
  const sourceIds = new Set();
  const handles = new Set();

  for (const sourceDoc of sourceDocs) {
    const sourceId = sourceDoc.name?.split("/").pop() || "";
    const handle = fsString(sourceDoc, "handle");
    if (sourceId) sourceIds.add(sourceId);
    if (handle) handles.add(handle);
  }

  return parsedRows.filter((row) => {
    const sourceId = String(row.account_sourceId || "").trim();
    const handle = String(row.account_handle || "").trim();
    return sourceIds.has(sourceId) || handles.has(handle);
  });
}

async function resolveAssetDescriptor({ songKey, title, kind, gsUrl, exportPath, notes }) {
  if (!gsUrl || !isGsObjectPath(gsUrl)) {
    return {
      kind,
      exportPath,
      exists: false,
      estimatedBytes: 0,
      note: notes || "missing",
    };
  }

  try {
    const { bucket, object } = parseGsObjectUrl(gsUrl);
    const [metadata] = await storage.bucket(bucket).file(object).getMetadata();
    return {
      kind,
      exportPath,
      exists: true,
      bucket,
      object,
      estimatedBytes: Number(metadata?.size || 0),
      note: notes || "",
      songKey,
      title,
    };
  } catch (_error) {
    return {
      kind,
      exportPath,
      exists: false,
      estimatedBytes: 0,
      note: notes || "missing",
      songKey,
      title,
    };
  }
}

function isGsObjectPath(value) {
  return /^gs:\/\//i.test(String(value || "").trim());
}

async function buildExportRowsForWorkspace(rows) {
  const exportRows = [];
  let totalAssets = 0;
  let totalBytes = 0;
  let missingAssets = 0;

  for (const row of rows) {
    const songKey = safeFilePart(row.songKey, crypto.randomBytes(4).toString("hex"));
    const titlePart = safeFilePart(row.title, songKey);
    const baseName = `${songKey} ${titlePart}`.trim();

    const audioGs = row.gcs_latest_audio || row.gcs_mp3 || row.audio_url || "";
    const imageGs = row.gcs_latest_thumb || row.gcs_thumb || row.image_url || "";
    const lyricsTxtGs = row.gcsLyricsTxt || "";
    const lyricsVttGs = row.gcsLyricsVtt || "";
    const inlineLyrics = String(row.lyrics || "").trim();

    const audioAsset = await resolveAssetDescriptor({
      songKey,
      title: row.title,
      kind: "audio",
      gsUrl: audioGs,
      exportPath: `audio/${baseName}${extFromObjectName(audioGs, ".mp3")}`,
      notes: "missing_audio",
    });
    const imageAsset = await resolveAssetDescriptor({
      songKey,
      title: row.title,
      kind: "thumb",
      gsUrl: imageGs,
      exportPath: `images/thumbs/${baseName}${extFromObjectName(imageGs, ".jpg")}`,
      notes: "missing_image",
    });
    const lyricsTxtAsset = lyricsTxtGs
      ? await resolveAssetDescriptor({
          songKey,
          title: row.title,
          kind: "lyrics_txt",
          gsUrl: lyricsTxtGs,
          exportPath: `lyrics/txt/${baseName}.txt`,
          notes: "missing_lyrics",
        })
      : inlineLyrics
        ? {
            kind: "lyrics_txt",
            exportPath: `lyrics/txt/${baseName}.txt`,
            exists: true,
            estimatedBytes: Buffer.byteLength(inlineLyrics, "utf8"),
            inlineContent: inlineLyrics,
            note: "",
            songKey,
            title: row.title,
          }
        : {
            kind: "lyrics_txt",
            exportPath: `lyrics/txt/${baseName}.txt`,
            exists: false,
            estimatedBytes: 0,
            note: "missing_lyrics",
            songKey,
            title: row.title,
          };
    const lyricsVttAsset = await resolveAssetDescriptor({
      songKey,
      title: row.title,
      kind: "lyrics_vtt",
      gsUrl: lyricsVttGs,
      exportPath: `lyrics/vtt/${baseName}.vtt`,
      notes: "missing_lyrics_vtt",
    });

    const assets = [audioAsset, imageAsset, lyricsTxtAsset, lyricsVttAsset];
    const availableAssets = assets.filter((asset) => asset.exists);
    const missingKinds = assets.filter((asset) => !asset.exists).map((asset) => asset.note).filter(Boolean);

    totalAssets += availableAssets.length;
    totalBytes += availableAssets.reduce((sum, asset) => sum + Number(asset.estimatedBytes || 0), 0);
    missingAssets += assets.length - availableAssets.length;

    exportRows.push({
      original: row,
      songKey,
      title: row.title || "",
      accountHandle: row.account_handle || "",
      assets,
      estimatedBytes: availableAssets.reduce((sum, asset) => sum + Number(asset.estimatedBytes || 0), 0),
      manifest: {
        ...row,
        audioPath: audioAsset.exists ? audioAsset.exportPath : "",
        thumbPath: imageAsset.exists ? imageAsset.exportPath : "",
        imagePath: imageAsset.exists ? imageAsset.exportPath : "",
        lyricsTxtPath: lyricsTxtAsset.exists ? lyricsTxtAsset.exportPath : "",
        lyricsVttPath: lyricsVttAsset.exists ? lyricsVttAsset.exportPath : "",
        exportPart: "",
        assetStatus:
          missingKinds.length === 0
            ? "complete"
            : missingKinds.length === assets.length
              ? "missing_multiple"
              : [...new Set(missingKinds)].join("|"),
        notes: missingKinds.join(", "),
      },
    });
  }

  return {
    exportRows,
    totalAssets,
    totalBytes,
    missingAssets,
  };
}

function shardExportRows(exportRows) {
  const parts = [];
  let currentPart = { rows: [], estimatedBytes: 0, assetCount: 0 };

  for (const row of exportRows) {
    const rowBytes = Number(row.estimatedBytes || 0);
    const rowAssetCount = row.assets.filter((asset) => asset.exists).length;
    const wouldOverflow =
      currentPart.rows.length > 0 && currentPart.estimatedBytes + rowBytes > EXPORT_MAX_PART_BYTES;

    if (wouldOverflow) {
      parts.push(currentPart);
      currentPart = { rows: [], estimatedBytes: 0, assetCount: 0 };
    }

    currentPart.rows.push(row);
    currentPart.estimatedBytes += rowBytes;
    currentPart.assetCount += rowAssetCount;
  }

  if (currentPart.rows.length > 0 || parts.length === 0) {
    parts.push(currentPart);
  }

  return parts.map((part, index) => ({
    ...part,
    partNumber: index + 1,
    partName: `catalog_part_${String(index + 1).padStart(2, "0")}.zip`,
  }));
}

async function writeZipPart(part, manifestCsv, summaryJson, targetPath) {
  ensureDir(path.dirname(targetPath));
  const output = fs.createWriteStream(targetPath);
  const archive = archiver("zip", { zlib: { level: 6 } });

  const archiveDone = finished(output);
  archive.on("error", (error) => {
    output.destroy(error);
  });
  archive.pipe(output);

  archive.append(manifestCsv, { name: "manifest/catalog.csv" });
  archive.append(summaryJson, { name: "manifest/summary.json" });

  for (const row of part.rows) {
    for (const asset of row.assets) {
      if (!asset.exists) continue;
      if (asset.inlineContent != null) {
        archive.append(asset.inlineContent, { name: asset.exportPath });
        continue;
      }
      archive.append(storage.bucket(asset.bucket).file(asset.object).createReadStream(), {
        name: asset.exportPath,
      });
    }
  }

  archive.finalize();
  await archiveDone;
  const stats = fs.statSync(targetPath);
  return stats.size;
}

async function runCatalogExportJob(job, context, accessToken) {
  job.status = "preparing";
  job.updatedAt = new Date().toISOString();

  const sourceDocs = await listWorkspaceSourceDocs(job.workspaceId, accessToken);
  const loaded = await loadCatalogCsv();
  const workspaceRows = buildWorkspaceCatalogRows(loaded.buffer.toString("utf8"), sourceDocs);
  const prepared = await buildExportRowsForWorkspace(workspaceRows);
  const parts = shardExportRows(prepared.exportRows);

  const manifestRows = prepared.exportRows.map((row, index) => {
    const matchedPart = parts.find((part) => part.rows.includes(row));
    return {
      ...row.manifest,
      exportPart: matchedPart?.partName || `catalog_part_${String(index + 1).padStart(2, "0")}.zip`,
    };
  });
  const manifestCsv = serializeCsv(manifestRows);

  const summary = {
    exportId: job.exportId,
    workspaceId: job.workspaceId,
    workspaceName: context.activeWorkspace?.name || job.workspaceId,
    generatedAt: new Date().toISOString(),
    sourceCount: sourceDocs.length,
    totalRows: prepared.exportRows.length,
    totalAssets: prepared.totalAssets,
    totalBytes: prepared.totalBytes,
    totalBytesLabel: byteLabel(prepared.totalBytes),
    missingAssets: prepared.missingAssets,
    maxPartBytes: EXPORT_MAX_PART_BYTES,
    maxPartBytesLabel: byteLabel(EXPORT_MAX_PART_BYTES),
    partCount: parts.length,
    parts: parts.map((part) => ({
      partName: part.partName,
      rowCount: part.rows.length,
      assetCount: part.assetCount,
      estimatedBytes: part.estimatedBytes,
      estimatedBytesLabel: byteLabel(part.estimatedBytes),
    })),
  };
  const summaryJson = `${JSON.stringify(summary, null, 2)}\n`;

  const manifestPath = path.join(job.jobDir, "catalog.csv");
  const summaryPath = path.join(job.jobDir, "summary.json");
  fs.writeFileSync(manifestPath, manifestCsv, "utf8");
  fs.writeFileSync(summaryPath, summaryJson, "utf8");

  const completedParts = [];
  for (const part of parts) {
    job.status = "building";
    job.updatedAt = new Date().toISOString();
    const filePath = path.join(job.jobDir, part.partName);
    const sizeBytes = await writeZipPart(part, manifestCsv, summaryJson, filePath);
    completedParts.push({
      partName: part.partName,
      fileName: part.partName,
      filePath,
      rowCount: part.rows.length,
      assetCount: part.assetCount,
      estimatedBytes: part.estimatedBytes,
      estimatedBytesLabel: byteLabel(part.estimatedBytes),
      sizeBytes,
      sizeLabel: byteLabel(sizeBytes),
      downloadUrl: `/api/catalog-export/${job.exportId}/parts/${encodeURIComponent(part.partName)}`,
    });
  }

  job.manifestPath = manifestPath;
  job.summaryPath = summaryPath;
  job.totalRows = prepared.exportRows.length;
  job.totalAssets = prepared.totalAssets;
  job.totalBytes = prepared.totalBytes;
  job.missingAssets = prepared.missingAssets;
  job.partCount = completedParts.length;
  job.parts = completedParts;
  job.summary = summary;
  job.status = "ready";
  job.updatedAt = new Date().toISOString();
}

function renderPage({ title, heading, body, pathname = "/" }) {
  const navItems = [
    { href: "/", label: "Home" },
    { href: "/vault", label: "Vault" },
    { href: "/signup", label: "Request Beta Access" },
    { href: "/control-center", label: "Control Center" },
    { href: "/privacy", label: "Privacy" },
    { href: "/terms", label: "Terms" },
  ];

  const navHtml = navItems
    .map(({ href, label }) => {
      const active = pathname === href;
      return `<a href="${href}"${active ? ' class="nav-active"' : ""}>${label}</a>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <meta name="description" content="${APP_NAME} preserves the song master recording and original recipe while supporting lyrics, metadata, and YouTube publishing workflows.">
  <style>
    :root {
      --bg: #f8f9ff;
      --paper: rgba(255, 255, 255, 0.92);
      --ink: #172033;
      --muted: #5f6885;
      --accent: #5847d8;
      --accent-soft: #ffffff;
      --line: #d8ddf0;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, "Segoe UI", system-ui, sans-serif;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(124, 111, 255, 0.08), transparent 24%),
        radial-gradient(circle at top right, rgba(74, 38, 112, 0.06), transparent 28%),
        linear-gradient(180deg, #f8f9ff 0%, #eef2ff 58%, var(--bg) 100%);
    }
    .shell {
      max-width: 1120px;
      margin: 0 auto;
      padding: 24px 20px 40px;
    }
    header, footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
    }
    .brand {
      font-size: 24px;
      font-weight: 700;
      color: #5847d8;
      text-decoration: none;
    }
    nav, .footer-links {
      display: flex;
      flex-wrap: wrap;
      gap: 14px;
    }
    nav a, .footer-links a, .inline-link {
      color: var(--accent);
      text-decoration: none;
    }
    nav a {
      color: #56607b;
      padding: 8px 12px;
      border-radius: 999px;
      border: 1px solid transparent;
      transition: border-color .18s ease, background .18s ease, color .18s ease;
    }
    nav a.nav-active {
      color: #172033;
      background: #ffffff;
      border-color: var(--line);
    }
    main {
      margin: 24px 0;
      padding: 32px clamp(20px, 3vw, 42px);
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: 24px;
      box-shadow: 0 22px 64px rgba(25, 33, 61, 0.08);
    }
    .eyebrow {
      margin: 0;
      color: #6a7190;
      text-transform: uppercase;
      letter-spacing: .14em;
      font-size: 12px;
    }
    h1 {
      margin: 10px 0 12px;
      font-size: clamp(2.2rem, 5vw, 3.8rem);
      line-height: 1;
      color: #172033;
    }
    .lead {
      margin: 0 0 20px;
      font-size: 18px;
      line-height: 1.6;
      color: #4e5874;
      max-width: 820px;
    }
    .cta-row {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      margin: 0 0 28px;
    }
    .signal-row {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin: 0 0 28px;
    }
    .signal {
      display: inline-flex;
      align-items: center;
      min-height: 32px;
      padding: 0 12px;
      border-radius: 999px;
      background: #f4f6fc;
      border: 1px solid var(--line);
      color: #36435f;
      font-size: 12px;
    }
    .button, .button-secondary {
      display: inline-block;
      padding: 12px 18px;
      border-radius: 999px;
      text-decoration: none;
      font-size: 15px;
    }
    .button {
      background: var(--accent);
      color: #f4f1ff;
    }
    .button-secondary {
      background: var(--accent-soft);
      color: #31415c;
      border: 1px solid var(--line);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 16px;
    }
    .feature-grid {
      display: grid;
      grid-template-columns: 1.3fr .9fr;
      gap: 18px;
      margin-top: 6px;
    }
    .card {
      padding: 18px;
      border-radius: 18px;
      background: #ffffff;
      border: 1px solid var(--line);
    }
    .panel {
      padding: 22px;
      border-radius: 22px;
      background: #ffffff;
      border: 1px solid var(--line);
    }
    h2 {
      margin: 0 0 8px;
      font-size: 20px;
      color: #172033;
    }
    .list {
      margin: 14px 0 0;
      padding-left: 18px;
      color: #42506e;
      display: grid;
      gap: 10px;
    }
    .meta-copy {
      margin-top: 12px;
      color: #5f6885;
      font-size: 13px;
      line-height: 1.6;
    }
    p {
      margin: 0;
      font-size: 15px;
      line-height: 1.65;
      color: #4e5874;
    }
    footer {
      color: var(--muted);
      font-size: 14px;
      line-height: 1.6;
    }
    @media (max-width: 860px) {
      .feature-grid {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header>
      <a class="brand" href="/">${APP_NAME}</a>
      <nav>${navHtml}</nav>
    </header>
    <main>${heading}${body}</main>
    <footer>
      <div>
        <strong>${APP_NAME}</strong> preserves the song master recording, the original recipe, and
        the publishing path in one working surface.
      </div>
      <div class="footer-links">
        <a href="/privacy">Privacy Policy</a>
        <a href="/terms">Terms of Service</a>
        <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>
      </div>
    </footer>
  </div>
</body>
</html>`;
}

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

app.get("/privacy", (_req, res) => {
  res.type("html").send(
    renderPage({
      title: `${APP_NAME} | Privacy Policy`,
      pathname: "/privacy",
      heading: `<p class="eyebrow">Legal</p><h1>Privacy Policy</h1>`,
      body: `
        <p class="lead">Effective date: March 23, 2026</p>
        <div class="grid">
          <section class="card">
            <h2>Information we collect</h2>
            <p>
              We may collect account identifiers, contact information you provide, application usage
              data, OAuth authorization data, and content metadata needed to operate the service.
            </p>
          </section>
          <section class="card">
            <h2>How we use information</h2>
            <p>
              We use information to authenticate users, operate the vault, process media workflows,
              improve reliability, respond to support requests, and comply with legal obligations.
            </p>
          </section>
          <section class="card">
            <h2>Data sharing</h2>
            <p>
              We do not sell personal information. Data may be shared with service providers and cloud
              infrastructure partners only as needed to operate the application and protect the service.
            </p>
          </section>
          <section class="card">
            <h2>Retention and security</h2>
            <p>
              We retain data only as long as necessary for operations, security, compliance, and
              business continuity, and we use reasonable safeguards to protect stored information.
            </p>
          </section>
          <section class="card">
            <h2>Contact</h2>
            <p>
              For privacy questions or deletion requests, contact
              <a class="inline-link" href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.
            </p>
          </section>
        </div>`,
    })
  );
});

app.get("/terms", (_req, res) => {
  res.type("html").send(
    renderPage({
      title: `${APP_NAME} | Terms of Service`,
      pathname: "/terms",
      heading: `<p class="eyebrow">Legal</p><h1>Terms of Service</h1>`,
      body: `
        <p class="lead">Effective date: March 23, 2026</p>
        <div class="grid">
          <section class="card">
            <h2>Use of the service</h2>
            <p>
              ${APP_NAME} is provided for authorized business and operational use. You agree to use
              the service lawfully and only in connection with approved workflows.
            </p>
          </section>
          <section class="card">
            <h2>Accounts and access</h2>
            <p>
              Access may be limited, suspended, or revoked at any time to protect the application,
              users, or associated content assets. You are responsible for safeguarding your credentials.
            </p>
          </section>
          <section class="card">
            <h2>Content and availability</h2>
            <p>
              The service may include media metadata, files, and third-party platform references. We
              do not guarantee uninterrupted availability or that all imported content will remain
              available from external platforms.
            </p>
          </section>
          <section class="card">
            <h2>Limitation of liability</h2>
            <p>
              The service is provided on an as-is and as-available basis to the maximum extent
              permitted by law. We are not liable for indirect, incidental, or consequential damages.
            </p>
          </section>
          <section class="card">
            <h2>Contact</h2>
            <p>
              Questions about these terms can be sent to
              <a class="inline-link" href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.
            </p>
          </section>
        </div>`,
    })
  );
});

async function getAccessToken() {
  const now = Date.now();
  if (cachedMetadataAccessToken && now < cachedMetadataAccessTokenExpiresAt - 60 * 1000) {
    return cachedMetadataAccessToken;
  }

  const resp = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "Metadata-Flavor": "Google" } }
  );
  if (!resp.ok) {
    throw new Error(`Metadata token fetch failed: HTTP ${resp.status}`);
  }
  const data = await resp.json();
  cachedMetadataAccessToken = data.access_token || "";
  cachedMetadataAccessTokenExpiresAt = now + Math.max(Number(data.expires_in || 0), 60) * 1000;
  return cachedMetadataAccessToken;
}

async function getSecret(secretId, accessToken) {
  const resp = await fetch(
    `https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${encodeURIComponent(
      secretId
    )}/versions/latest:access`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (!resp.ok) {
    throw new Error(`Secret fetch failed for ${secretId}: HTTP ${resp.status}`);
  }
  const payload = await resp.json();
  return Buffer.from(payload?.payload?.data || "", "base64").toString("utf8");
}

async function getMailConfig(accessToken) {
  const now = Date.now();
  if (cachedMailConfig && now - mailConfigLoadedAt < 5 * 60 * 1000) {
    return cachedMailConfig;
  }
  const raw = await getSecret(MAIL_CONFIG_SECRET, accessToken);
  const parsed = JSON.parse(raw || "{}");
  if (!parsed.from || !parsed.password) {
    throw new Error(`Mail config secret ${MAIL_CONFIG_SECRET} is missing required fields.`);
  }
  cachedMailConfig = parsed;
  mailConfigLoadedAt = now;
  return cachedMailConfig;
}

function notificationShell({ title, intro, body, footer = "" }) {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#0b0b14;font-family:Inter,'Segoe UI',system-ui,sans-serif;color:#e9ebff;">
    <div style="max-width:640px;margin:0 auto;background:#111325;border:1px solid #2b2f57;border-radius:24px;overflow:hidden;">
      <div style="padding:24px 28px;background:linear-gradient(135deg,#161936 0%,#22164b 100%);border-bottom:1px solid #2b2f57;">
        <div style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#8f96c9;margin-bottom:10px;">Sundrop Cloud Beta</div>
        <div style="font-size:28px;line-height:1.1;font-weight:700;color:#f3f4ff;">${title}</div>
        <div style="margin-top:12px;font-size:16px;line-height:1.6;color:#c8cdf7;">${intro}</div>
      </div>
      <div style="padding:24px 28px;font-size:15px;line-height:1.7;color:#d8dcff;">
        ${body}
      </div>
      <div style="padding:18px 28px;border-top:1px solid #2b2f57;font-size:13px;line-height:1.6;color:#9fa6d9;">
        ${footer || `Questions? Reply to this email or contact <a href="mailto:${SUPPORT_EMAIL}" style="color:#b7bbff;">${SUPPORT_EMAIL}</a>.`}
      </div>
    </div>
  </body>
</html>`;
}

function notificationList(items) {
  const rows = items
    .filter((item) => item?.value)
    .map(
      (item) => `<tr>
        <td style="padding:8px 12px;color:#8f96c9;font-size:13px;vertical-align:top;">${item.label}</td>
        <td style="padding:8px 12px;color:#eef0ff;font-size:14px;font-weight:600;">${item.value}</td>
      </tr>`
    )
    .join("");
  return `<table style="width:100%;border-collapse:collapse;background:#171a31;border:1px solid #2b2f57;border-radius:16px;overflow:hidden;">${rows}</table>`;
}

async function sendNotificationEmail({ accessToken, to, cc = [], subject, html }) {
  if (!to) return false;
  const mailConfig = await getMailConfig(accessToken);
  const recipients = [to, ...cc].map((value) => String(value || "").trim()).filter(Boolean);
  if (!recipients.length) return false;

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: mailConfig.from,
      pass: mailConfig.password,
    },
  });

  await transporter.sendMail({
    from: mailConfig.from,
    to,
    cc: cc.length ? cc : undefined,
    subject,
    html,
  });
  return true;
}

async function safeSendNotificationEmail(payload) {
  try {
    return await sendNotificationEmail(payload);
  } catch (error) {
    console.warn("[beta-email] Notification failed:", error?.message || error);
    return false;
  }
}

function buildRequestReceivedEmail(accessRequest) {
  const list = notificationList([
    { label: "Workspace", value: accessRequest.requestedWorkspaceName || "Not provided yet" },
    { label: "SUNO handle", value: accessRequest.sunoHandle },
    { label: "SUNO profile", value: accessRequest.sunoProfileUrl },
    { label: "YouTube channel", value: accessRequest.youtubeChannelUrl },
    { label: "Preferred path after beta", value: accessRequest.preferredUpgradePlanId || "creator_monthly" },
  ]);
  return notificationShell({
    title: "Beta request received",
    intro: `We have your request for Sundrop Cloud beta access and it is now in the review queue.`,
    body: `
      <p style="margin:0 0 18px;">Thanks for signing in and giving us the details we need to treat this like a real customer intake. We will review your beta request and follow up with an approval or denial email.</p>
      ${list}
      <p style="margin:18px 0 0;">Intended use:</p>
      <div style="margin-top:10px;padding:14px 16px;background:#171a31;border:1px solid #2b2f57;border-radius:16px;color:#eef0ff;">${accessRequest.intendedUse || "No intended use was provided."}</div>
    `,
  });
}

function buildRequestApprovedEmail({ accessRequest, workspaceName, role, planId, betaExpiresAt }) {
  const list = notificationList([
    { label: "Workspace", value: workspaceName || accessRequest.requestedWorkspaceName || "Workspace assigned" },
    { label: "Role", value: role || accessRequest.approvedRole || "viewer" },
    { label: "Plan", value: planId || accessRequest.approvedPlanId || "beta" },
    { label: "Beta access ends", value: betaExpiresAt || accessRequest.betaExpiresAt || "Not set" },
    { label: "Upgrade target after beta", value: accessRequest.betaMigrationTargetPlanId || accessRequest.preferredUpgradePlanId || "creator_monthly" },
  ]);
  return notificationShell({
    title: "Beta access approved",
    intro: `Your beta access has been approved. You can now sign in and open the Vault with the workspace that was assigned to you.`,
    body: `
      <p style="margin:0 0 18px;">We approved your request and created the access posture for your account. Sign in again if you already had the app open so the new workspace and entitlements refresh cleanly.</p>
      ${list}
      <p style="margin:18px 0 0;">
        Open the app here:
        <a href="https://music.aeonimus.info/vault" style="color:#b7bbff;">https://music.aeonimus.info/vault</a>
      </p>
    `,
  });
}

function buildRequestDeniedEmail({ accessRequest, reviewNotes }) {
  return notificationShell({
    title: "Beta request update",
    intro: `We reviewed your Sundrop Cloud beta request and cannot approve it right now.`,
    body: `
      <p style="margin:0 0 18px;">Your request has been marked as denied for now. You can update and resubmit later if the fit changes.</p>
      ${reviewNotes ? `<p style="margin:0 0 10px;">Reviewer notes:</p><div style="padding:14px 16px;background:#171a31;border:1px solid #2b2f57;border-radius:16px;color:#eef0ff;">${reviewNotes}</div>` : ""}
      <p style="margin:18px 0 0;">
        Request details:
      </p>
      ${notificationList([
        { label: "SUNO handle", value: accessRequest.sunoHandle },
        { label: "Requested workspace", value: accessRequest.requestedWorkspaceName },
        { label: "Preferred path after beta", value: accessRequest.preferredUpgradePlanId || "creator_monthly" },
      ])}
    `,
  });
}

function buildOperatorRequestEmail(accessRequest) {
  return notificationShell({
    title: "New beta request",
    intro: `${accessRequest.displayName || accessRequest.email} submitted a new beta request and it is waiting in the Control Center.`,
    body: `
      ${notificationList([
        { label: "Applicant", value: accessRequest.displayName || accessRequest.email },
        { label: "Email", value: accessRequest.email },
        { label: "SUNO handle", value: accessRequest.sunoHandle },
        { label: "SUNO profile", value: accessRequest.sunoProfileUrl },
        { label: "YouTube channel", value: accessRequest.youtubeChannelUrl },
        { label: "Requested workspace", value: accessRequest.requestedWorkspaceName },
        { label: "Preferred upgrade path", value: accessRequest.preferredUpgradePlanId || "creator_monthly" },
      ])}
      <p style="margin:18px 0 0;">Intended use:</p>
      <div style="margin-top:10px;padding:14px 16px;background:#171a31;border:1px solid #2b2f57;border-radius:16px;color:#eef0ff;">${accessRequest.intendedUse || "No intended use was provided."}</div>
      <p style="margin:18px 0 0;">
        Review in Control Center:
        <a href="https://music.aeonimus.info/control-center" style="color:#b7bbff;">https://music.aeonimus.info/control-center</a>
      </p>
    `,
  });
}

function fsBase() {
  return `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${DATABASE}`;
}

function fsDocName(collection, docId) {
  return `projects/${PROJECT}/databases/${DATABASE}/documents/${collection}/${encodeURIComponent(docId)}`;
}

function fsDocNameFromPath(docPath) {
  const encoded = String(docPath || "")
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `projects/${PROJECT}/databases/${DATABASE}/documents/${encoded}`;
}

async function fsGetDoc(collection, docId, accessToken) {
  const url = `${fsBase()}/documents/${collection}/${encodeURIComponent(docId)}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (resp.status === 404) return null;
  if (!resp.ok) {
    throw new Error(`Firestore get failed: HTTP ${resp.status}`);
  }
  return await resp.json();
}

async function fsGetDocByPath(docPath, accessToken) {
  const url = `${fsBase()}/documents/${String(docPath || "")
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (resp.status === 404) return null;
  if (!resp.ok) {
    throw new Error(`Firestore get failed: HTTP ${resp.status}`);
  }
  return await resp.json();
}

async function fsRunQuery(body, accessToken) {
  const resp = await fetch(`${fsBase()}/documents:runQuery`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const details = await resp.text().catch(() => "");
    throw new Error(`Firestore query failed: HTTP ${resp.status}${details ? ` :: ${details}` : ""}`);
  }
  return await resp.json();
}

async function fsListCollection(collection, accessToken, pageSize = 200) {
  const docs = [];
  let pageToken = "";

  while (true) {
    const params = new URLSearchParams();
    params.set("pageSize", String(pageSize));
    if (pageToken) {
      params.set("pageToken", pageToken);
    }

    const resp = await fetch(`${fsBase()}/documents/${collection}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) {
      const details = await resp.text().catch(() => "");
      throw new Error(`Firestore list failed: HTTP ${resp.status}${details ? ` :: ${details}` : ""}`);
    }

    const payload = await resp.json();
    docs.push(...(payload.documents || []));

    if (!payload.nextPageToken) {
      break;
    }
    pageToken = payload.nextPageToken;
  }

  return docs;
}

async function fsCreateDoc(collection, fields, accessToken) {
  const resp = await fetch(`${fsBase()}/documents/${collection}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
  });
  if (!resp.ok) {
    throw new Error(`Firestore create failed: HTTP ${resp.status}`);
  }
  return await resp.json();
}

async function fsPatchDoc(docName, fields, accessToken) {
  const mask = Object.keys(fields)
    .map((field) => `updateMask.fieldPaths=${encodeURIComponent(field)}`)
    .join("&");
  const url = `https://firestore.googleapis.com/v1/${docName}?${mask}`;
  const resp = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
  });
  if (!resp.ok) {
    throw new Error(`Firestore patch failed: HTTP ${resp.status}`);
  }
  return await resp.json();
}

async function fsSetDoc(docName, fields, accessToken, { createOnly = false } = {}) {
  const params = [];
  if (createOnly) {
    params.push("currentDocument.exists=false");
  }
  for (const field of Object.keys(fields)) {
    params.push(`updateMask.fieldPaths=${encodeURIComponent(field)}`);
  }
  const url = `https://firestore.googleapis.com/v1/${docName}${params.length ? `?${params.join("&")}` : ""}`;
  const resp = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
  });
  if (!resp.ok) {
    throw new Error(`Firestore set failed: HTTP ${resp.status}`);
  }
  return await resp.json();
}

function fsString(doc, field) {
  return doc?.fields?.[field]?.stringValue || "";
}

function fsMapString(doc, field, child) {
  return doc?.fields?.[field]?.mapValue?.fields?.[child]?.stringValue || "";
}

function fsBool(doc, field) {
  return Boolean(doc?.fields?.[field]?.booleanValue);
}

function fsInt(doc, field) {
  const raw = doc?.fields?.[field]?.integerValue;
  if (raw === undefined || raw === null || raw === "") return 0;
  return Number(raw) || 0;
}

function fsTimestamp(doc, field) {
  return doc?.fields?.[field]?.timestampValue || doc?.fields?.[field]?.stringValue || "";
}

function fsArrayStrings(doc, field) {
  const values = doc?.fields?.[field]?.arrayValue?.values || [];
  return values
    .map((value) => value?.stringValue || "")
    .filter(Boolean);
}

function fsValueToJs(value) {
  if (!value || typeof value !== "object") return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return Boolean(value.booleanValue);
  if ("integerValue" in value) return Number(value.integerValue || 0);
  if ("doubleValue" in value) return Number(value.doubleValue || 0);
  if ("timestampValue" in value) return value.timestampValue;
  if ("nullValue" in value) return null;
  if ("mapValue" in value) {
    const entries = Object.entries(value.mapValue?.fields || {}).map(([key, nestedValue]) => [
      key,
      fsValueToJs(nestedValue),
    ]);
    return Object.fromEntries(entries);
  }
  if ("arrayValue" in value) {
    return (value.arrayValue?.values || []).map((item) => fsValueToJs(item));
  }
  return null;
}

function jsValueToFs(value) {
  if (value === undefined) return undefined;
  if (value === null) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { integerValue: value } : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value
          .map((item) => jsValueToFs(item))
          .filter((item) => item !== undefined),
      },
    };
  }
  if (typeof value === "object") {
    return { mapValue: { fields: objectToFsFields(value) } };
  }
  return { stringValue: String(value) };
}

function objectToFsFields(obj) {
  return Object.fromEntries(
    Object.entries(obj || {})
      .map(([key, value]) => [key, jsValueToFs(value)])
      .filter(([, value]) => value !== undefined)
  );
}

function hasPublishedResult(doc) {
  const ytStatus = fsString(doc, "ytStatus");
  const ytVideoId = fsString(doc, "ytVideoId");
  const ytCanonicalUrl = fsString(doc, "ytCanonicalUrl");
  return ytStatus === "done" || Boolean(ytVideoId) || Boolean(ytCanonicalUrl);
}

function buildPublishState(doc) {
  const ytStatus = fsString(doc, "ytStatus");
  const ytVideoId = fsString(doc, "ytVideoId");
  const ytCanonicalUrl =
    fsString(doc, "ytCanonicalUrl") ||
    (ytVideoId ? `https://www.youtube.com/watch?v=${ytVideoId}` : "");
  const ytPublishedAt = fsString(doc, "ytPublishedAt");
  const ytError = fsString(doc, "ytError");
  const ytErrorAt = fsString(doc, "ytErrorAt");

  if (!ytStatus && !ytVideoId && !ytCanonicalUrl && !ytError) {
    return null;
  }

  return {
    status: ytStatus || (ytVideoId || ytCanonicalUrl ? "done" : ""),
    ytVideoId,
    ytCanonicalUrl,
    ytPublishedAt,
    error: ytError,
    ytErrorAt,
  };
}

function slugifyWorkspaceName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function parseBearerToken(req) {
  const header = String(req.headers.authorization || "");
  if (!header.toLowerCase().startsWith("bearer ")) return "";
  return header.slice(7).trim();
}

function providerListFromToken(decodedToken) {
  const providerSet = new Set();
  const firebaseInfo = decodedToken?.firebase || {};
  if (firebaseInfo.sign_in_provider) {
    providerSet.add(firebaseInfo.sign_in_provider);
  }
  const identities = firebaseInfo.identities || {};
  for (const providerName of Object.keys(identities)) {
    providerSet.add(providerName);
  }
  return [...providerSet].filter(Boolean);
}

function sanitizeWorkspaceRole(value) {
  const role = String(value || "").trim().toLowerCase();
  if (["owner", "admin", "editor", "viewer"].includes(role)) return role;
  return "viewer";
}

function approvedEmailSet() {
  return new Set(INITIAL_APPROVED_EMAILS);
}

function isBootstrapApprovedEmail(email) {
  return approvedEmailSet().has(String(email || "").trim().toLowerCase());
}

function signupTierDefaults(requestedTier, requestKind) {
  const requested = String(requestedTier || "").trim();
  if (requested && SIGNUP_TIER_DEFAULTS[requested]) {
    return SIGNUP_TIER_DEFAULTS[requested];
  }
  if (String(requestKind || "").trim() === "paid") {
    return SIGNUP_TIER_DEFAULTS.creator_monthly;
  }
  if (String(requestKind || "").trim() === "free") {
    return SIGNUP_TIER_DEFAULTS.free;
  }
  return SIGNUP_TIER_DEFAULTS.beta;
}

function activePublicSignupTierIds() {
  return BETA_SIGNUP_ONLY ? ["beta"] : Object.keys(SIGNUP_TIER_DEFAULTS);
}

function isAllowedPublicSignupTier(tierId) {
  return activePublicSignupTierIds().includes(String(tierId || "").trim());
}

function sanitizeBetaApplicationUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function buildBetaAccessState(userDoc) {
  if (!userDoc) return null;
  const audience = fsString(userDoc, "audience") || "";
  const approvedAt = fsTimestamp(userDoc, "betaApprovedAt");
  const expiresAt = fsTimestamp(userDoc, "betaExpiresAt");
  const migrationTargetPlanId = fsString(userDoc, "betaMigrationTargetPlanId");
  let status = fsString(userDoc, "betaStatus") || "";

  if (!status && audience === "beta") {
    status = approvedAt ? "active" : "pending";
  }
  if (status === "active" && expiresAt) {
    const expiry = Date.parse(expiresAt);
    if (Number.isFinite(expiry) && expiry <= Date.now()) {
      status = "expired";
    }
  }

  if (!audience && !status && !approvedAt && !expiresAt && !migrationTargetPlanId) {
    return null;
  }

  return {
    audience: audience || "beta",
    status: status || "pending",
    approvedAt,
    expiresAt,
    migrationTargetPlanId,
  };
}

function deriveBetaExpiryIso(overrideValue = "") {
  const override = String(overrideValue || "").trim();
  if (override) {
    const overrideDate = new Date(override);
    if (!Number.isNaN(overrideDate.getTime())) {
      return overrideDate.toISOString();
    }
  }

  if (BETA_ACCESS_ENDS_AT) {
    const configured = new Date(BETA_ACCESS_ENDS_AT);
    if (!Number.isNaN(configured.getTime())) {
      return configured.toISOString();
    }
  }

  const days = Number.isFinite(BETA_ACCESS_WINDOW_DAYS) && BETA_ACCESS_WINDOW_DAYS > 0
    ? BETA_ACCESS_WINDOW_DAYS
    : 60;
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + days);
  return expiry.toISOString();
}

function buildLegacyWorkspaceSummary() {
  const limits = {
    sourcesMax: 0,
    storageGbIncluded: 0,
    membersMax: 0,
    youtubePublishMonthlyLimit: 0,
  };
  const entitlements = buildLegacyEntitlements();
  return {
    workspaceId: LEGACY_WORKSPACE_ID,
    name: LEGACY_WORKSPACE_NAME,
    slug: "legacy",
    role: "owner",
    membershipStatus: "active",
    status: "active",
    planId: "internal",
    sourceLimit: 0,
    storageLimitGb: 0,
    seatLimit: 0,
    features: entitlements,
    entitlements,
    limits,
    isLegacy: true,
  };
}

async function ensureUserProfile(decodedToken, accessToken) {
  if (!decodedToken?.uid) return null;
  const userPath = `users/${decodedToken.uid}`;
  const existing = await fsGetDocByPath(userPath, accessToken);
  const providers = providerListFromToken(decodedToken);
  const baseFields = {
    email: decodedToken.email || "",
    displayName: decodedToken.name || decodedToken.email || "",
    photoURL: decodedToken.picture || "",
    authProviders: providers,
    status: existing ? fsString(existing, "status") || "active" : "active",
    lastLoginAt: new Date().toISOString(),
  };

  if (!existing) {
    await fsSetDoc(
      fsDocNameFromPath(userPath),
      objectToFsFields({
        ...baseFields,
        createdAt: new Date().toISOString(),
        defaultWorkspaceId: "",
      }),
      accessToken,
      { createOnly: true }
    );
    return await fsGetDocByPath(userPath, accessToken);
  }

  await fsPatchDoc(fsDocNameFromPath(userPath), objectToFsFields(baseFields), accessToken);
  return await fsGetDocByPath(userPath, accessToken);
}

async function listMembershipDocs(uid, accessToken) {
  const workspaceDocs = await fsListCollection("workspaces", accessToken);
  const membershipDocs = [];

  for (const workspaceDoc of workspaceDocs) {
    const workspaceId =
      workspaceDoc.name?.split("/").pop() ||
      fsString(workspaceDoc, "workspaceId") ||
      "";
    if (!workspaceId) continue;
    const membershipDoc = await fsGetDocByPath(`workspaces/${workspaceId}/memberships/${uid}`, accessToken);
    if (membershipDoc) {
      membershipDocs.push(membershipDoc);
    }
  }

  return membershipDocs;
}

async function listWorkspaceSummaries(uid, accessToken) {
  const memberships = await listMembershipDocs(uid, accessToken);
  const workspaceMap = new Map();

  for (const membership of memberships) {
    const status = fsString(membership, "status") || "active";
    if (status !== "active" && status !== "invited") continue;

    const workspaceId =
      fsString(membership, "workspaceId") || membership.name?.split("/")[6] || "";
    if (!workspaceId) continue;

    const workspaceDoc = await fsGetDocByPath(`workspaces/${workspaceId}`, accessToken);
    if (!workspaceDoc) continue;

    workspaceMap.set(workspaceId, resolveWorkspaceContract(workspaceDoc, membership));
  }

  return [...workspaceMap.values()];
}

async function findAccessRequestForUser(uid, accessToken) {
  const results = await fsRunQuery(
    {
      structuredQuery: {
        from: [{ collectionId: ACCESS_REQUEST_COLLECTION }],
        where: {
          fieldFilter: {
            field: { fieldPath: "uid" },
            op: "EQUAL",
            value: { stringValue: uid },
          },
        },
      },
    },
    accessToken
  );
  return (
    results
      .filter((row) => row.document)
      .map((row) => row.document)
      .sort((left, right) => {
        const leftTs =
          fsTimestamp(left, "updatedAt") ||
          fsTimestamp(left, "createdAt") ||
          "";
        const rightTs =
          fsTimestamp(right, "updatedAt") ||
          fsTimestamp(right, "createdAt") ||
          "";
        return String(rightTs).localeCompare(String(leftTs));
      })[0] || null
  );
}

function buildAccessRequest(doc) {
  if (!doc) return null;
  return {
    requestId: doc.name?.split("/").pop() || "",
    uid: fsString(doc, "uid"),
    email: fsString(doc, "email"),
    displayName: fsString(doc, "displayName"),
    requestedWorkspaceId: fsString(doc, "requestedWorkspaceId"),
    requestedWorkspaceName: fsString(doc, "requestedWorkspaceName"),
    requestKind: fsString(doc, "requestKind") || "beta",
    requestedTier: fsString(doc, "requestedTier") || "beta",
    status: fsString(doc, "status") || "pending",
    note: fsString(doc, "note"),
    sunoHandle: fsString(doc, "sunoHandle"),
    sunoProfileUrl: fsString(doc, "sunoProfileUrl"),
    youtubeChannelUrl: fsString(doc, "youtubeChannelUrl"),
    intendedUse: fsString(doc, "intendedUse"),
    preferredUpgradePlanId: fsString(doc, "preferredUpgradePlanId"),
    createdAt: fsTimestamp(doc, "createdAt"),
    updatedAt: fsTimestamp(doc, "updatedAt"),
    reviewedAt: fsTimestamp(doc, "reviewedAt"),
    reviewedBy: fsString(doc, "reviewedBy"),
    reviewNotes: fsString(doc, "reviewNotes"),
    approvedWorkspaceId: fsString(doc, "approvedWorkspaceId"),
    approvedRole: fsString(doc, "approvedRole"),
    approvedTier: fsString(doc, "approvedTier"),
    approvedPlanId: fsString(doc, "approvedPlanId"),
    betaApprovedAt: fsTimestamp(doc, "betaApprovedAt"),
    betaExpiresAt: fsTimestamp(doc, "betaExpiresAt"),
    betaMigrationTargetPlanId: fsString(doc, "betaMigrationTargetPlanId"),
  };
}

function pickActiveWorkspace(workspaces, preferredWorkspaceId, userDoc) {
  if (!Array.isArray(workspaces) || workspaces.length === 0) return null;
  if (preferredWorkspaceId) {
    const explicit = workspaces.find((workspace) => workspace.workspaceId === preferredWorkspaceId);
    if (explicit) return explicit;
  }
  const defaultWorkspaceId = fsString(userDoc, "defaultWorkspaceId");
  if (defaultWorkspaceId) {
    const fallback = workspaces.find((workspace) => workspace.workspaceId === defaultWorkspaceId);
    if (fallback) return fallback;
  }
  return workspaces[0];
}

async function resolveRequestContext(req, accessToken) {
  const token = parseBearerToken(req);
  const preferredWorkspaceId =
    String(req.query.workspaceId || req.headers["x-workspace-id"] || "").trim();

  if (!token || !firebaseAuth) {
    return {
      authEnabled: Boolean(firebaseAuth),
      legacyMode: false,
      isAuthenticated: false,
      user: null,
      workspaces: [],
      activeWorkspace: null,
      platformAdmin: false,
      adminMode: false,
      entitlements: {},
      accessRequest: null,
      needsApproval: false,
      authInitError: firebaseInitError,
    };
  }

  let decodedToken = null;
  try {
    decodedToken = await firebaseAuth.verifyIdToken(token);
  } catch (_error) {
    return {
      authEnabled: true,
      legacyMode: false,
      isAuthenticated: false,
      user: null,
      workspaces: [],
      activeWorkspace: null,
      platformAdmin: false,
      adminMode: false,
      entitlements: {},
      accessRequest: null,
      needsApproval: false,
      betaAccess: null,
      authInitError: firebaseInitError,
    };
  }
  const userDoc = await ensureUserProfile(decodedToken, accessToken);
  await ensureBootstrapWorkspaceForUser(decodedToken, accessToken);

  let refreshedUserDoc = null;
  try {
    refreshedUserDoc = await fsGetDocByPath(`users/${decodedToken.uid}`, accessToken);
  } catch (error) {
    console.warn("[auth-session] failed to refresh user doc:", error?.message || error);
  }

  const bootstrapApproved =
    isBootstrapApprovedEmail(decodedToken.email) ||
    isBootstrapApprovedEmail(fsString(refreshedUserDoc || userDoc, "email"));

  let adminDoc = null;
  try {
    adminDoc = await fsGetDocByPath(`admins/${decodedToken.uid}`, accessToken);
  } catch (error) {
    console.warn("[auth-session] failed to load admin doc:", error?.message || error);
  }

  let workspaces = [];
  try {
    workspaces = await listWorkspaceSummaries(decodedToken.uid, accessToken);
  } catch (error) {
    console.warn("[auth-session] failed to load workspace summaries:", error?.message || error);
  }

  let accessRequestDoc = null;
  try {
    accessRequestDoc = await findAccessRequestForUser(decodedToken.uid, accessToken);
  } catch (error) {
    console.warn("[auth-session] failed to load access request:", error?.message || error);
  }

  const accessRequest = buildAccessRequest(accessRequestDoc);
  const platformAdmin =
    fsBool(adminDoc, "isActive") ||
    fsBool(adminDoc, "is_active") ||
    bootstrapApproved;
  const betaAccess = buildBetaAccessState(refreshedUserDoc || userDoc);
  const betaExpired = !platformAdmin && betaAccess?.status === "expired";
  const effectiveWorkspaces = betaExpired ? [] : workspaces;
  const activeWorkspace = betaExpired
    ? null
    : pickActiveWorkspace(effectiveWorkspaces, preferredWorkspaceId, refreshedUserDoc || userDoc);
  const entitlements = activeWorkspace?.entitlements || {};

  return {
    authEnabled: true,
    legacyMode: false,
    isAuthenticated: true,
    user: {
      uid: decodedToken.uid,
      email: decodedToken.email || fsString(userDoc, "email"),
      displayName: decodedToken.name || fsString(userDoc, "displayName"),
      photoURL: decodedToken.picture || fsString(userDoc, "photoURL"),
      authProviders: fsArrayStrings(refreshedUserDoc || userDoc, "authProviders"),
      status: fsString(refreshedUserDoc || userDoc, "status") || "active",
      createdAt: fsTimestamp(refreshedUserDoc || userDoc, "createdAt"),
      lastLoginAt: fsTimestamp(refreshedUserDoc || userDoc, "lastLoginAt"),
      defaultWorkspaceId: fsString(refreshedUserDoc || userDoc, "defaultWorkspaceId"),
      audience: fsString(refreshedUserDoc || userDoc, "audience") || "",
    },
    workspaces: effectiveWorkspaces,
    activeWorkspace,
    platformAdmin,
    adminMode: platformAdmin,
    entitlements,
    accessRequest,
    needsApproval: !platformAdmin && effectiveWorkspaces.length === 0 && betaAccess?.status !== "expired",
    betaAccess,
    authInitError: firebaseInitError,
  };
}

function requireOperatorAccess(context, res) {
  if (context.isAuthenticated || context.legacyMode) return true;
  res.status(401).json({ ok: false, error: "Authentication is required" });
  return false;
}

function requirePlatformAdmin(context, res) {
  if (context.platformAdmin || context.legacyMode) return true;
  res.status(403).json({ ok: false, error: "Platform admin access is required" });
  return false;
}

function hasEntitlement(context, key) {
  if (context?.platformAdmin || context?.legacyMode) return true;
  return Boolean(context?.entitlements?.[key]);
}

function requireEntitlement(context, key, res, message) {
  if (hasEntitlement(context, key)) return true;
  res.status(403).json({
    ok: false,
    error: message || "This action is not available on the current plan.",
    entitlement: key,
  });
  return false;
}

function requireVaultAccess(context, res) {
  if (!context?.isAuthenticated) {
    res.status(401).json({ ok: false, error: "Sign in and get approved before opening the Vault." });
    return false;
  }
  if (context?.betaAccess?.status === "expired") {
    res.status(403).json({ ok: false, error: "Beta access has expired for this account." });
    return false;
  }
  if (context?.platformAdmin) return true;
  if (context?.activeWorkspace && hasEntitlement(context, "vault.browse")) return true;
  res.status(403).json({ ok: false, error: "Vault access has not been granted for this account yet." });
  return false;
}

async function findExistingQueueDoc(songKey, accessToken) {
  const results = await fsRunQuery(
    {
      structuredQuery: {
        from: [{ collectionId: QUEUE_COLLECTION }],
        where: {
          fieldFilter: {
            field: { fieldPath: "songKey" },
            op: "EQUAL",
            value: { stringValue: songKey },
          },
        },
        limit: 1,
      },
    },
    accessToken
  );
  const hit = results.find((row) => row.document)?.document;
  return hit || null;
}

async function getQueueCounts(accessToken) {
  const counts = { new: 0, queued: 0, uploading: 0, done: 0, error: 0, total: 0 };
  const results = await fsRunQuery(
    {
      structuredQuery: {
        from: [{ collectionId: QUEUE_COLLECTION }],
        select: { fields: [{ fieldPath: "status" }] },
        limit: 500,
      },
    },
    accessToken
  );

  for (const row of results) {
    if (!row.document) continue;
    const status = row.document.fields?.status?.stringValue || "unknown";
    counts.total += 1;
    if (status in counts) counts[status] += 1;
  }

  return counts;
}

async function loadExportMeta() {
  try {
    const [buf] = await storage.bucket(BUCKET).file(OBJECT_META).download();
    return JSON.parse(buf.toString("utf8"));
  } catch (_error) {
    return null;
  }
}

async function listRecentAccessRequests(accessToken, limit = 10) {
  const results = await fsRunQuery(
    {
      structuredQuery: {
        from: [{ collectionId: ACCESS_REQUEST_COLLECTION }],
        orderBy: [{ field: { fieldPath: "updatedAt" }, direction: "DESCENDING" }],
        limit,
      },
    },
    accessToken
  );
  return results.filter((row) => row.document).map((row) => buildAccessRequest(row.document));
}

async function countPendingAccessRequests(accessToken) {
  const results = await fsRunQuery(
    {
      structuredQuery: {
        from: [{ collectionId: ACCESS_REQUEST_COLLECTION }],
        where: {
          fieldFilter: {
            field: { fieldPath: "status" },
            op: "EQUAL",
            value: { stringValue: "pending" },
          },
        },
        limit: 250,
      },
    },
    accessToken
  );
  return results.filter((row) => row.document).length;
}

async function summarizeAccessRequests(accessToken) {
  const results = await fsRunQuery(
    {
      structuredQuery: {
        from: [{ collectionId: ACCESS_REQUEST_COLLECTION }],
        limit: 250,
      },
    },
    accessToken
  );

  const summary = {
    total: 0,
    pending: 0,
    approved: 0,
    denied: 0,
    withdrawn: 0,
    beta: 0,
    free: 0,
    paid: 0,
  };

  for (const row of results) {
    if (!row.document) continue;
    summary.total += 1;
    const status = fsString(row.document, "status") || "pending";
    const lane = fsString(row.document, "requestKind") || "beta";
    if (status in summary) {
      summary[status] += 1;
    }
    if (lane in summary) {
      summary[lane] += 1;
    }
  }

  return summary;
}

function buildSignupCatalog() {
  return [
    {
      id: "beta",
      lane: "beta",
      label: "Beta Tester",
      priceLabel: "$0 during beta",
      cadence: "approval",
      summary: "Early access to the Vault and workflow surfaces while we shape the product.",
      highlights: [
        "Vault browsing and metadata access",
        "Feedback-driven early access",
        "Manual approval from the control center",
      ],
      defaultRole: "viewer",
      defaultPlanId: "beta",
      trialDays: 0,
      billingCadences: ["approval"],
      entitlements: {
        "vault.browse": true,
        "vault.search.advanced": true,
        "catalog.export.local": true,
        "lyrics.artifacts": true,
        "styles.normalized": true,
        "youtube.publish.enabled": true,
        "admin.reports": false,
      },
      limits: {
        sourcesMax: 3,
        storageGbIncluded: 10,
        membersMax: 1,
        youtubePublishMonthlyLimit: 25,
      },
    },
    {
      id: "free",
      lane: "free",
      label: "Explorer Free",
      priceLabel: "$0",
      cadence: "ongoing",
      summary: "A light personal workspace for browsing, preserving, and learning the system.",
      highlights: [
        "Personal workspace",
        "Starter source and storage limits",
        "Upgrade path into paid creator tiers",
      ],
      defaultRole: "viewer",
      defaultPlanId: "free",
      trialDays: 0,
      billingCadences: ["ongoing"],
      entitlements: {
        "vault.browse": true,
        "vault.search.advanced": false,
        "catalog.export.local": true,
        "lyrics.artifacts": true,
        "styles.normalized": true,
        "youtube.publish.enabled": false,
        "admin.reports": false,
      },
      limits: {
        sourcesMax: 1,
        storageGbIncluded: 5,
        membersMax: 1,
        youtubePublishMonthlyLimit: 0,
      },
    },
    {
      id: "creator_monthly",
      lane: "paid",
      label: "Creator Monthly",
      priceLabel: "$29 / month",
      cadence: "monthly",
      summary: "A working creator tier for active cataloging, publishing, and preservation workflows.",
      highlights: [
        "Dedicated workspace",
        "Higher source and storage limits",
        "Publishing and workflow features",
      ],
      defaultRole: "editor",
      defaultPlanId: "creator-monthly",
      trialDays: 14,
      billingCadences: ["monthly", "quarterly", "annual"],
      entitlements: {
        "vault.browse": true,
        "vault.search.advanced": true,
        "catalog.export.local": true,
        "lyrics.artifacts": true,
        "styles.normalized": true,
        "youtube.publish.enabled": true,
        "admin.reports": false,
      },
      limits: {
        sourcesMax: 10,
        storageGbIncluded: 50,
        membersMax: 2,
        youtubePublishMonthlyLimit: 150,
      },
    },
    {
      id: "studio_monthly",
      lane: "paid",
      label: "Studio Monthly",
      priceLabel: "$99 / month",
      cadence: "monthly",
      summary: "A team-ready tier for broader operational control and heavier workflow usage.",
      highlights: [
        "Shared workspace support",
        "Admin-grade controls",
        "Higher operational limits",
      ],
      defaultRole: "admin",
      defaultPlanId: "studio-monthly",
      trialDays: 14,
      billingCadences: ["monthly", "quarterly", "annual"],
      entitlements: {
        "vault.browse": true,
        "vault.search.advanced": true,
        "catalog.export.local": true,
        "lyrics.artifacts": true,
        "styles.normalized": true,
        "youtube.publish.enabled": true,
        "admin.reports": true,
      },
      limits: {
        sourcesMax: 30,
        storageGbIncluded: 200,
        membersMax: 8,
        youtubePublishMonthlyLimit: 600,
      },
    },
  ];
}

function buildPublicSignupCatalog() {
  const allowedIds = new Set(activePublicSignupTierIds());
  return buildSignupCatalog().filter((tier) => allowedIds.has(tier.id));
}

function normalizePlanKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
}

function numericOverride(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const next = Number(value);
  return Number.isFinite(next) ? next : undefined;
}

function findSignupTierByPlanId(planId) {
  const normalizedPlanId = normalizePlanKey(planId);
  return buildSignupCatalog().find((tier) => {
    return (
      normalizePlanKey(tier.id) === normalizedPlanId ||
      normalizePlanKey(tier.defaultPlanId) === normalizedPlanId
    );
  }) || null;
}

function normalizeSunoHandle(handle) {
  return String(handle || "")
    .trim()
    .replace(/^@+/, "")
    .replace(/^https?:\/\/(www\.)?suno\.com\/@/i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function tierIdForPlan(planId) {
  return findSignupTierByPlanId(planId)?.id || normalizePlanKey(planId).replace(/-/g, "_");
}

async function syncApprovedSunoSource({
  accessToken,
  handle,
  profileUrl,
  uid,
  email,
  workspaceId,
  planId,
  requestKind,
  preferredUpgradePlanId,
  betaExpiresAt,
  now,
}) {
  const normalizedHandle = normalizeSunoHandle(handle);
  if (!normalizedHandle) return null;

  const docPath = `sources/suno_${normalizedHandle}`;
  const existing = await fsGetDocByPath(docPath, accessToken);
  const tierId = tierIdForPlan(planId);
  const audience = requestKind === "beta" ? "beta" : "customer";

  const patch = {
    platform: "suno",
    handle: normalizedHandle,
    accountLabel: fsString(existing, "accountLabel") || `${normalizedHandle}_${tierId}`,
    profileUrl:
      sanitizeBetaApplicationUrl(profileUrl) ||
      fsString(existing, "profileUrl") ||
      `https://suno.com/@${normalizedHandle}`,
    workspaceId,
    ownerUid: uid,
    ownerEmail: email,
    planId,
    tierId,
    audience,
    betaStatus: requestKind === "beta" ? "active" : "upgraded",
    betaExpiresAt: requestKind === "beta" ? betaExpiresAt : "",
    betaMigrationTargetPlanId: preferredUpgradePlanId,
    status: "active",
    isActive: true,
    harvestEnabled: true,
    provisioningState: "assigned",
    assignedAt: now,
    updatedAt: now,
  };

  if (!existing) {
    patch.createdAt = now;
  }

  await fsPatchDoc(fsDocNameFromPath(docPath), objectToFsFields(patch), accessToken);
  return fsGetDocByPath(docPath, accessToken);
}

function mergeWorkspaceEntitlements(planEntitlements, featureOverrides) {
  const next = { ...(planEntitlements || {}) };
  if (!featureOverrides || typeof featureOverrides !== "object") {
    return next;
  }

  for (const [key, value] of Object.entries(featureOverrides)) {
    if (typeof value === "boolean" || typeof value === "number") {
      next[key] = value;
    }
  }

  return next;
}

function resolveWorkspaceContract(workspaceDoc, membershipDoc) {
  const features = fsValueToJs(workspaceDoc.fields?.features) || {};
  const planId = fsString(workspaceDoc, "planId");
  const tier = findSignupTierByPlanId(planId);
  const limits = tier?.limits
    ? { ...tier.limits }
    : {
        sourcesMax: fsInt(workspaceDoc, "sourceLimit"),
        storageGbIncluded: fsInt(workspaceDoc, "storageLimitGb"),
        membersMax: fsInt(workspaceDoc, "seatLimit"),
        youtubePublishMonthlyLimit: 0,
      };

  return {
    workspaceId: workspaceDoc.name?.split("/").pop() || "",
    name: fsString(workspaceDoc, "name") || workspaceDoc.name?.split("/").pop() || "",
    slug: fsString(workspaceDoc, "slug") || workspaceDoc.name?.split("/").pop() || "",
    ownerUid: fsString(workspaceDoc, "ownerUid"),
    role: membershipDoc ? fsString(membershipDoc, "role") || "viewer" : "viewer",
    membershipStatus: membershipDoc ? fsString(membershipDoc, "status") || "active" : "active",
    status: fsString(workspaceDoc, "status") || "active",
    planId,
    sourceLimit: fsInt(workspaceDoc, "sourceLimit") || limits.sourcesMax || 0,
    storageLimitGb: fsInt(workspaceDoc, "storageLimitGb") || limits.storageGbIncluded || 0,
    seatLimit: fsInt(workspaceDoc, "seatLimit") || limits.membersMax || 0,
    features,
    entitlements: mergeWorkspaceEntitlements(tier?.entitlements || {}, features),
    limits,
    isLegacy: false,
  };
}

function buildLegacyEntitlements() {
  return {
    "vault.browse": true,
    "vault.search.advanced": true,
    "lyrics.artifacts": true,
    "styles.normalized": true,
    "youtube.publish.enabled": true,
    "admin.reports": true,
  };
}

async function setUserDefaultWorkspace(uid, workspaceId, accessToken) {
  if (!uid || !workspaceId) return;
  await fsPatchDoc(
    fsDocNameFromPath(`users/${uid}`),
    objectToFsFields({
      defaultWorkspaceId: workspaceId,
      status: "active",
      updatedAt: new Date().toISOString(),
    }),
    accessToken
  );
}

async function ensureBootstrapWorkspaceForUser(decodedToken, accessToken) {
  if (!decodedToken?.uid) return;
  const email = String(decodedToken.email || "").trim().toLowerCase();
  if (!isBootstrapApprovedEmail(email)) return;

  const memberships = await listMembershipDocs(decodedToken.uid, accessToken);
  const activeMembership = memberships.find((membership) => {
    const status = fsString(membership, "status") || "active";
    return status === "active" || status === "invited";
  });
  if (activeMembership) {
    const workspaceId = fsString(activeMembership, "workspaceId") || activeMembership.name?.split("/")[6] || "";
    if (workspaceId) {
      await setUserDefaultWorkspace(decodedToken.uid, workspaceId, accessToken);
    }
    return;
  }

  const now = new Date().toISOString();
  const localPart = email.split("@")[0] || decodedToken.uid;
  const workspaceId = `bootstrap-${slugifyWorkspaceName(localPart) || decodedToken.uid}`.slice(0, 64);
  const workspaceName = decodedToken.name || decodedToken.email || "Bootstrap Workspace";
  const targetWorkspacePath = `workspaces/${workspaceId}`;
  const workspaceDoc = await fsGetDocByPath(targetWorkspacePath, accessToken);

  if (!workspaceDoc) {
    const tier = findSignupTierByPlanId("beta") || buildSignupCatalog()[0];
    await fsSetDoc(
      fsDocNameFromPath(targetWorkspacePath),
      objectToFsFields({
        name: workspaceName,
        slug: slugifyWorkspaceName(workspaceName || localPart) || workspaceId,
        ownerUid: decodedToken.uid,
        planId: tier?.defaultPlanId || "beta",
        status: "active",
        createdAt: now,
        updatedAt: now,
        sourceLimit: tier?.limits?.sourcesMax || 0,
        storageLimitGb: tier?.limits?.storageGbIncluded || 0,
        seatLimit: tier?.limits?.membersMax || 1,
        features: tier?.entitlements || {},
      }),
      accessToken,
      { createOnly: true }
    );
  }

  await fsSetDoc(
    fsDocNameFromPath(`${targetWorkspacePath}/memberships/${decodedToken.uid}`),
    objectToFsFields({
      uid: decodedToken.uid,
      workspaceId,
      role: "owner",
      status: "active",
      createdAt: now,
      updatedAt: now,
      invitedBy: decodedToken.uid,
    }),
    accessToken
  );

  await setUserDefaultWorkspace(decodedToken.uid, workspaceId, accessToken);
}

app.get("/api/auth/session", async (req, res) => {
  const startedAt = process.hrtime.bigint();
  const includeDebugTiming =
    String(req.query.debug || "").trim() === "1" ||
    String(req.headers["x-aegis-debug-session"] || "").trim() === "1";
  try {
    const accessToken = await getAccessToken();
    const context = await resolveRequestContext(req, accessToken);
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    res.setHeader("Server-Timing", `authsession;dur=${durationMs.toFixed(1)}`);
    res.setHeader("X-Aegis-Auth-Session-Ms", durationMs.toFixed(1));
    return res.json({
      ok: true,
      ...context,
      ...(includeDebugTiming
        ? {
            debugTiming: {
              authSessionMs: Number(durationMs.toFixed(1)),
            },
          }
        : {}),
    });
  } catch (error) {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    res.setHeader("Server-Timing", `authsession;dur=${durationMs.toFixed(1)}`);
    res.setHeader("X-Aegis-Auth-Session-Ms", durationMs.toFixed(1));
    return res.status(500).json({
      ok: false,
      error: `auth-session failed: ${error?.message || error}`,
      authEnabled: Boolean(firebaseAuth),
      legacyMode: AUTH_LEGACY_MODE,
      authInitError: firebaseInitError,
      ...(includeDebugTiming
        ? {
            debugTiming: {
              authSessionMs: Number(durationMs.toFixed(1)),
            },
          }
        : {}),
    });
  }
});

app.get("/api/signup/catalog", (_req, res) => {
  return res.json({
    ok: true,
    betaOnly: BETA_SIGNUP_ONLY,
    approvedEmails: INITIAL_APPROVED_EMAILS,
    tiers: buildPublicSignupCatalog(),
  });
});

app.post("/api/access-requests", async (req, res) => {
  try {
    const accessToken = await getAccessToken();
    const context = await resolveRequestContext(req, accessToken);
    if (!context.isAuthenticated || !context.user) {
      return res.status(401).json({ ok: false, error: "You need to sign in before requesting access." });
    }

    if (context.workspaces.length > 0 || context.platformAdmin) {
      return res.status(400).json({ ok: false, error: "This account already has access." });
    }

    const existing = context.accessRequest;
    const now = new Date().toISOString();
    const rawRequestKind = String(req.body?.requestKind || "beta").trim() || "beta";
    const rawRequestedTier = String(req.body?.requestedTier || "").trim() || signupTierDefaults("", rawRequestKind).planId;
    const requestKind = BETA_SIGNUP_ONLY ? "beta" : rawRequestKind;
    const requestedTier = BETA_SIGNUP_ONLY ? "beta" : rawRequestedTier;
    if (!isAllowedPublicSignupTier(requestedTier)) {
      return res.status(400).json({ ok: false, error: "Only beta applications are open right now." });
    }

    const requestedWorkspaceName = String(req.body?.requestedWorkspaceName || "").trim();
    const sunoHandle = String(req.body?.sunoHandle || "").trim();
    const sunoProfileUrl = sanitizeBetaApplicationUrl(req.body?.sunoProfileUrl);
    const youtubeChannelUrl = sanitizeBetaApplicationUrl(req.body?.youtubeChannelUrl);
    const intendedUse = String(req.body?.intendedUse || "").trim();
    const preferredUpgradePlanId = String(req.body?.preferredUpgradePlanId || "creator_monthly").trim() || "creator_monthly";

    if (!sunoHandle) {
      return res.status(400).json({ ok: false, error: "sunoHandle is required" });
    }
    if (!sunoProfileUrl) {
      return res.status(400).json({ ok: false, error: "A valid sunoProfileUrl is required" });
    }
    if (!intendedUse) {
      return res.status(400).json({ ok: false, error: "intendedUse is required" });
    }

    const payload = {
      uid: context.user.uid,
      email: context.user.email,
      displayName: context.user.displayName || context.user.email,
      requestedWorkspaceId: String(req.body?.requestedWorkspaceId || "").trim(),
      requestedWorkspaceName,
      requestKind,
      requestedTier,
      status: "pending",
      note: String(req.body?.note || "").trim(),
      sunoHandle,
      sunoProfileUrl,
      youtubeChannelUrl,
      intendedUse,
      preferredUpgradePlanId,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      reviewedAt: "",
      reviewedBy: "",
      reviewNotes: "",
      approvedWorkspaceId: "",
      approvedRole: "",
      approvedTier: "",
      approvedPlanId: "",
      betaApprovedAt: "",
      betaExpiresAt: "",
      betaMigrationTargetPlanId: "",
    };

    let requestId = existing?.requestId || "";
    if (requestId) {
      await fsPatchDoc(
        fsDocName(ACCESS_REQUEST_COLLECTION, requestId),
        objectToFsFields(payload),
        accessToken
      );
    } else {
      const created = await fsCreateDoc(ACCESS_REQUEST_COLLECTION, objectToFsFields(payload), accessToken);
      requestId = created.name?.split("/").pop() || "";
    }

    const refreshed = await fsGetDoc(ACCESS_REQUEST_COLLECTION, requestId, accessToken);
    const builtRequest = buildAccessRequest(refreshed);

    await Promise.allSettled([
      safeSendNotificationEmail({
        accessToken,
        to: context.user.email,
        subject: "Sundrop Cloud beta request received",
        html: buildRequestReceivedEmail(builtRequest),
      }),
      safeSendNotificationEmail({
        accessToken,
        to: SUPPORT_EMAIL,
        subject: `New beta request: ${builtRequest.displayName || builtRequest.email}`,
        html: buildOperatorRequestEmail(builtRequest),
      }),
    ]);

    return res.status(existing ? 200 : 201).json({
      ok: true,
      accessRequest: builtRequest,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: `access-request failed: ${error?.message || error}`,
    });
  }
});

app.post("/api/access-requests/withdraw", async (req, res) => {
  try {
    const accessToken = await getAccessToken();
    const context = await resolveRequestContext(req, accessToken);
    if (!context.isAuthenticated || !context.user) {
      return res.status(401).json({ ok: false, error: "You need to sign in before changing access requests." });
    }

    const existing = context.accessRequest;
    if (!existing?.requestId) {
      return res.status(404).json({ ok: false, error: "No access request found for this account." });
    }

    if (existing.status !== "pending") {
      return res.status(400).json({ ok: false, error: "Only pending access requests can be withdrawn." });
    }

    const now = new Date().toISOString();
    await fsPatchDoc(
      fsDocName(ACCESS_REQUEST_COLLECTION, existing.requestId),
      objectToFsFields({
        status: "withdrawn",
        updatedAt: now,
        reviewNotes: String(req.body?.reviewNotes || "").trim(),
      }),
      accessToken
    );

    const refreshed = await fsGetDoc(ACCESS_REQUEST_COLLECTION, existing.requestId, accessToken);
    return res.json({
      ok: true,
      accessRequest: buildAccessRequest(refreshed),
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: `withdraw-access-request failed: ${error?.message || error}`,
    });
  }
});

app.get("/api/workspaces", async (req, res) => {
  try {
    const accessToken = await getAccessToken();
    const context = await resolveRequestContext(req, accessToken);
    if (!requireOperatorAccess(context, res)) return;

    return res.json({
      ok: true,
      workspaces: context.workspaces,
      activeWorkspace: context.activeWorkspace,
      platformAdmin: context.platformAdmin,
      legacyMode: context.legacyMode,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: `workspaces failed: ${error?.message || error}`,
    });
  }
});

app.post("/api/workspaces/select", async (req, res) => {
  try {
    const accessToken = await getAccessToken();
    const context = await resolveRequestContext(req, accessToken);
    if (!requireOperatorAccess(context, res)) return;
    if (!context.user?.uid) {
      return res.status(401).json({ ok: false, error: "Authentication is required" });
    }

    const workspaceId = String(req.body?.workspaceId || "").trim();
    if (!workspaceId) {
      return res.status(400).json({ ok: false, error: "workspaceId is required" });
    }

    const allowedWorkspace = context.workspaces.find((workspace) => workspace.workspaceId === workspaceId);
    if (!allowedWorkspace && !context.platformAdmin) {
      return res.status(403).json({ ok: false, error: "You do not belong to that workspace" });
    }

    await setUserDefaultWorkspace(context.user.uid, workspaceId, accessToken);
    const refreshed = await resolveRequestContext(
      {
        ...req,
        query: { ...(req.query || {}), workspaceId },
        headers: { ...(req.headers || {}), "x-workspace-id": workspaceId },
      },
      accessToken
    );

    return res.json({
      ok: true,
      activeWorkspace: refreshed.activeWorkspace,
      workspaces: refreshed.workspaces,
      entitlements: refreshed.entitlements,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: `select-workspace failed: ${error?.message || error}`,
    });
  }
});

app.post("/api/workspaces", async (req, res) => {
  try {
    const accessToken = await getAccessToken();
    const context = await resolveRequestContext(req, accessToken);
    if (!requirePlatformAdmin(context, res)) return;

    const name = String(req.body?.name || "").trim();
    if (!name) {
      return res.status(400).json({ ok: false, error: "name is required" });
    }

    const slug = slugifyWorkspaceName(req.body?.slug || name);
    if (!slug) {
      return res.status(400).json({ ok: false, error: "slug could not be derived" });
    }

    const ownerUid = String(req.body?.ownerUid || context.user?.uid || "").trim();
    if (!ownerUid && !context.legacyMode) {
      return res.status(400).json({ ok: false, error: "ownerUid is required" });
    }

    const workspaceId = String(req.body?.workspaceId || slug).trim();
    const tier = findSignupTierByPlanId(req.body?.planId || "free");
    const now = new Date().toISOString();
    const workspaceDocName = fsDocNameFromPath(`workspaces/${workspaceId}`);
    await fsSetDoc(
      workspaceDocName,
      objectToFsFields({
        name,
        slug,
        ownerUid,
        planId: String(req.body?.planId || "free"),
        status: String(req.body?.status || "active"),
        createdAt: now,
        updatedAt: now,
        sourceLimit: numericOverride(req.body?.sourceLimit) ?? tier?.limits?.sourcesMax ?? 0,
        storageLimitGb: numericOverride(req.body?.storageLimitGb) ?? tier?.limits?.storageGbIncluded ?? 0,
        seatLimit: numericOverride(req.body?.seatLimit) ?? tier?.limits?.membersMax ?? 1,
        features: req.body?.features || tier?.entitlements || {},
      }),
      accessToken,
      { createOnly: true }
    );

    if (ownerUid) {
      await fsSetDoc(
        fsDocNameFromPath(`workspaces/${workspaceId}/memberships/${ownerUid}`),
        objectToFsFields({
          uid: ownerUid,
          workspaceId,
          role: "owner",
          status: "active",
          createdAt: now,
          updatedAt: now,
          invitedBy: context.user?.uid || ownerUid,
        }),
        accessToken,
        { createOnly: true }
      );
    }

    const workspaceDoc = await fsGetDocByPath(`workspaces/${workspaceId}`, accessToken);
    return res.status(201).json({
      ok: true,
      workspace: {
        workspaceId,
        name: fsString(workspaceDoc, "name"),
        slug: fsString(workspaceDoc, "slug"),
        ownerUid: fsString(workspaceDoc, "ownerUid"),
        status: fsString(workspaceDoc, "status") || "active",
        planId: fsString(workspaceDoc, "planId"),
        sourceLimit: fsInt(workspaceDoc, "sourceLimit"),
        storageLimitGb: fsInt(workspaceDoc, "storageLimitGb"),
        seatLimit: fsInt(workspaceDoc, "seatLimit"),
        features: fsValueToJs(workspaceDoc.fields?.features) || {},
      },
    });
  } catch (error) {
    const message = error?.message || String(error);
    const statusCode = message.includes("HTTP 409") ? 409 : 500;
    return res.status(statusCode).json({ ok: false, error: `create-workspace failed: ${message}` });
  }
});

app.get("/api/admin/overview", async (req, res) => {
  try {
    const accessToken = await getAccessToken();
    const context = await resolveRequestContext(req, accessToken);
    if (!requirePlatformAdmin(context, res)) return;

    const [queueCounts, exportMeta, pendingCount, recentAccessRequests, catalogHealth, accessRequestSummary] = await Promise.all([
      getQueueCounts(accessToken),
      loadExportMeta(),
      countPendingAccessRequests(accessToken),
      listRecentAccessRequests(accessToken, 8),
      inspectCatalogHealth(),
      summarizeAccessRequests(accessToken),
    ]);

    return res.json({
      ok: true,
      session: context,
      queue: queueCounts,
      exportArtifact: {
        bucket: BUCKET,
        object: OBJECT,
        metaObject: OBJECT_META,
        generatedAt: exportMeta?.generatedAt || "",
        rowCount: Number(exportMeta?.rowCount || 0),
        generator: exportMeta?.generator || "",
        artifact: exportMeta?.artifact || "",
      },
      catalogHealth,
      accessRequests: {
        pendingCount,
        summary: accessRequestSummary,
        recent: recentAccessRequests,
      },
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: `admin-overview failed: ${error?.message || error}`,
    });
  }
});

app.get("/api/admin/access-requests", async (req, res) => {
  try {
    const accessToken = await getAccessToken();
    const context = await resolveRequestContext(req, accessToken);
    if (!requirePlatformAdmin(context, res)) return;

    const requests = await listRecentAccessRequests(accessToken, 50);
    return res.json({ ok: true, requests });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: `admin-access-requests failed: ${error?.message || error}`,
    });
  }
});

app.post("/api/admin/access-requests/:requestId/approve", async (req, res) => {
  try {
    const accessToken = await getAccessToken();
    const context = await resolveRequestContext(req, accessToken);
    if (!requirePlatformAdmin(context, res)) return;

    const requestId = String(req.params.requestId || "").trim();
    if (!requestId) {
      return res.status(400).json({ ok: false, error: "requestId is required" });
    }

    const requestDoc = await fsGetDoc(ACCESS_REQUEST_COLLECTION, requestId, accessToken);
    if (!requestDoc) {
      return res.status(404).json({ ok: false, error: "Access request not found" });
    }

    const uid = fsString(requestDoc, "uid");
    const email = fsString(requestDoc, "email");
    const displayName = fsString(requestDoc, "displayName") || email;
    const requestedTier = fsString(requestDoc, "requestedTier");
    const requestKind = fsString(requestDoc, "requestKind");
    const requestedSunoHandle = normalizeSunoHandle(fsString(requestDoc, "sunoHandle"));
    const requestedSunoProfileUrl = fsString(requestDoc, "sunoProfileUrl");
    const preferredUpgradePlanId =
      String(req.body?.betaMigrationTargetPlanId || fsString(requestDoc, "preferredUpgradePlanId") || "creator_monthly").trim() ||
      "creator_monthly";
    const tierDefaults = signupTierDefaults(requestedTier, requestKind);
    const tier = findSignupTierByPlanId(req.body?.planId || tierDefaults.planId || requestedTier || "beta");
    const workspaceMode = String(req.body?.workspaceMode || tierDefaults.workspaceMode || "legacy").trim();
    const role = sanitizeWorkspaceRole(req.body?.role || tierDefaults.role || "viewer");
    const planId = String(req.body?.planId || tierDefaults.planId || requestedTier || "beta").trim();
    const requestedWorkspaceId = fsString(requestDoc, "requestedWorkspaceId");
    const requestedWorkspaceName = fsString(requestDoc, "requestedWorkspaceName");
    const explicitWorkspaceId = String(req.body?.workspaceId || requestedWorkspaceId || "").trim();
    const desiredWorkspaceName =
      String(
        req.body?.workspaceName ||
          requestedWorkspaceName ||
          requestedWorkspaceId ||
          `${displayName} Workspace`
      ).trim();
    const betaExpiresAt = deriveBetaExpiryIso(req.body?.betaExpiresAt);
    let workspaceId = explicitWorkspaceId;
    const now = new Date().toISOString();

    if (workspaceMode === "legacy" && !workspaceId) {
      workspaceId = LEGACY_WORKSPACE_ID;
    }

    if (!workspaceId || workspaceMode === "new") {
      const derivedSlug = slugifyWorkspaceName(
        String(req.body?.workspaceSlug || desiredWorkspaceName || email.split("@")[0] || uid)
      );
      workspaceId = String(req.body?.workspaceId || derivedSlug || uid).trim();
    }

    const targetWorkspacePath = `workspaces/${workspaceId}`;
    let workspaceDoc = await fsGetDocByPath(targetWorkspacePath, accessToken);
    if (!workspaceDoc) {
      const workspaceName = desiredWorkspaceName || displayName || "Workspace";
      await fsSetDoc(
        fsDocNameFromPath(targetWorkspacePath),
        objectToFsFields({
          name: workspaceName,
          slug: slugifyWorkspaceName(req.body?.workspaceSlug || workspaceName || workspaceId) || workspaceId,
          ownerUid: uid,
          planId,
          status: String(req.body?.workspaceStatus || "active"),
          createdAt: now,
          updatedAt: now,
          sourceLimit: numericOverride(req.body?.sourceLimit) ?? tier?.limits?.sourcesMax ?? 0,
          storageLimitGb: numericOverride(req.body?.storageLimitGb) ?? tier?.limits?.storageGbIncluded ?? 0,
          seatLimit: numericOverride(req.body?.seatLimit) ?? tier?.limits?.membersMax ?? 1,
          features: req.body?.features || tier?.entitlements || {},
        }),
        accessToken,
        { createOnly: true }
      );
      workspaceDoc = await fsGetDocByPath(targetWorkspacePath, accessToken);
    }

    await fsPatchDoc(
      fsDocNameFromPath(targetWorkspacePath),
      objectToFsFields({
        name: desiredWorkspaceName || fsString(workspaceDoc, "name") || displayName || "Workspace",
        slug:
          slugifyWorkspaceName(req.body?.workspaceSlug || desiredWorkspaceName || workspaceId) ||
          fsString(workspaceDoc, "slug") ||
          workspaceId,
        ownerUid: uid,
        planId,
        status: String(req.body?.workspaceStatus || fsString(workspaceDoc, "status") || "active"),
        audience: requestKind === "beta" ? "beta" : "customer",
        sourceLimit:
          numericOverride(req.body?.sourceLimit) ??
          tier?.limits?.sourcesMax ??
          fsInt(workspaceDoc, "sourceLimit") ??
          0,
        storageLimitGb:
          numericOverride(req.body?.storageLimitGb) ??
          tier?.limits?.storageGbIncluded ??
          fsInt(workspaceDoc, "storageLimitGb") ??
          0,
        seatLimit:
          numericOverride(req.body?.seatLimit) ??
          tier?.limits?.membersMax ??
          fsInt(workspaceDoc, "seatLimit") ??
          1,
        features: req.body?.features || tier?.entitlements || fsValueToJs(workspaceDoc.fields?.features) || {},
        updatedAt: now,
      }),
      accessToken
    );
    workspaceDoc = await fsGetDocByPath(targetWorkspacePath, accessToken);

    await fsSetDoc(
      fsDocNameFromPath(`${targetWorkspacePath}/memberships/${uid}`),
      objectToFsFields({
        uid,
        workspaceId,
        role,
        status: "active",
        createdAt: now,
        updatedAt: now,
        invitedBy: context.user?.uid || "",
      }),
      accessToken
    );

    await setUserDefaultWorkspace(uid, workspaceId, accessToken);
    await fsPatchDoc(
      fsDocNameFromPath(`users/${uid}`),
      objectToFsFields({
        status: "active",
        audience: requestKind === "beta" ? "beta" : "customer",
        betaStatus: requestKind === "beta" ? "active" : "upgraded",
        betaApprovedAt: now,
        betaExpiresAt: requestKind === "beta" ? betaExpiresAt : "",
        betaMigrationTargetPlanId: preferredUpgradePlanId,
        updatedAt: now,
      }),
      accessToken
    );

    await fsPatchDoc(
      fsDocName(ACCESS_REQUEST_COLLECTION, requestId),
      objectToFsFields({
        status: "approved",
        reviewedAt: now,
        reviewedBy: context.user?.uid || "",
        updatedAt: now,
        reviewNotes: String(req.body?.reviewNotes || "").trim(),
        approvedWorkspaceId: workspaceId,
        approvedRole: role,
        approvedTier: requestedTier || planId,
        approvedPlanId: planId,
        betaApprovedAt: now,
        betaExpiresAt: requestKind === "beta" ? betaExpiresAt : "",
        betaMigrationTargetPlanId: preferredUpgradePlanId,
      }),
      accessToken
    );

    const linkedSourceDoc = await syncApprovedSunoSource({
      accessToken,
      handle: requestedSunoHandle,
      profileUrl: requestedSunoProfileUrl,
      uid,
      email,
      workspaceId,
      planId,
      requestKind,
      preferredUpgradePlanId,
      betaExpiresAt: requestKind === "beta" ? betaExpiresAt : "",
      now,
    });

    const approvedRequestDoc = await fsGetDoc(ACCESS_REQUEST_COLLECTION, requestId, accessToken);
    const approvedRequest = buildAccessRequest(approvedRequestDoc);
    await safeSendNotificationEmail({
      accessToken,
      to: email,
      subject: "Sundrop Cloud beta access approved",
      html: buildRequestApprovedEmail({
        accessRequest: approvedRequest,
        workspaceName: fsString(workspaceDoc, "name") || desiredWorkspaceName,
        role,
        planId,
        betaExpiresAt: requestKind === "beta" ? betaExpiresAt : "",
      }),
    });

    return res.json({
      ok: true,
      requestId,
      workspaceId,
      role,
      planId,
      betaExpiresAt: requestKind === "beta" ? betaExpiresAt : "",
      betaMigrationTargetPlanId: preferredUpgradePlanId,
      workspace: workspaceDoc
        ? {
            workspaceId,
            name: fsString(workspaceDoc, "name"),
            slug: fsString(workspaceDoc, "slug"),
            planId: fsString(workspaceDoc, "planId"),
          }
        : null,
      source: linkedSourceDoc
        ? {
            sourceId: linkedSourceDoc.name?.split("/").pop() || "",
            handle: fsString(linkedSourceDoc, "handle"),
            workspaceId: fsString(linkedSourceDoc, "workspaceId"),
            planId: fsString(linkedSourceDoc, "planId"),
            provisioningState: fsString(linkedSourceDoc, "provisioningState"),
          }
        : null,
      status: "approved",
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: `approve-access-request failed: ${error?.message || error}`,
    });
  }
});

app.post("/api/admin/access-requests/:requestId/deny", async (req, res) => {
  try {
    const accessToken = await getAccessToken();
    const context = await resolveRequestContext(req, accessToken);
    if (!requirePlatformAdmin(context, res)) return;

    const requestId = String(req.params.requestId || "").trim();
    if (!requestId) {
      return res.status(400).json({ ok: false, error: "requestId is required" });
    }

    const requestDoc = await fsGetDoc(ACCESS_REQUEST_COLLECTION, requestId, accessToken);
    if (!requestDoc) {
      return res.status(404).json({ ok: false, error: "Access request not found" });
    }

    const now = new Date().toISOString();
    await fsPatchDoc(
      fsDocName(ACCESS_REQUEST_COLLECTION, requestId),
      objectToFsFields({
        status: "denied",
        reviewedAt: now,
        reviewedBy: context.user?.uid || "",
        updatedAt: now,
        reviewNotes: String(req.body?.reviewNotes || "").trim(),
      }),
      accessToken
    );

    const deniedRequestDoc = await fsGetDoc(ACCESS_REQUEST_COLLECTION, requestId, accessToken);
    const deniedRequest = buildAccessRequest(deniedRequestDoc);
    await safeSendNotificationEmail({
      accessToken,
      to: fsString(requestDoc, "email"),
      subject: "Sundrop Cloud beta request update",
      html: buildRequestDeniedEmail({
        accessRequest: deniedRequest,
        reviewNotes: String(req.body?.reviewNotes || "").trim(),
      }),
    });

    return res.json({ ok: true, requestId, status: "denied" });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: `deny-access-request failed: ${error?.message || error}`,
    });
  }
});

app.post("/api/admin/access-requests/:requestId/reopen", async (req, res) => {
  try {
    const accessToken = await getAccessToken();
    const context = await resolveRequestContext(req, accessToken);
    if (!requirePlatformAdmin(context, res)) return;

    const requestId = String(req.params.requestId || "").trim();
    if (!requestId) {
      return res.status(400).json({ ok: false, error: "requestId is required" });
    }

    const requestDoc = await fsGetDoc(ACCESS_REQUEST_COLLECTION, requestId, accessToken);
    if (!requestDoc) {
      return res.status(404).json({ ok: false, error: "Access request not found" });
    }

    const status = fsString(requestDoc, "status") || "pending";
    if (status === "pending") {
      return res.json({ ok: true, requestId, status: "pending" });
    }
    if (status === "approved") {
      return res.status(400).json({
        ok: false,
        error: "Approved access requests cannot be reopened from this screen yet.",
      });
    }

    const now = new Date().toISOString();
    await fsPatchDoc(
      fsDocName(ACCESS_REQUEST_COLLECTION, requestId),
      objectToFsFields({
        status: "pending",
        updatedAt: now,
        reviewedAt: "",
        reviewedBy: "",
        reviewNotes: String(req.body?.reviewNotes || "").trim(),
        approvedWorkspaceId: "",
        approvedRole: "",
        approvedTier: "",
        approvedPlanId: "",
      }),
      accessToken
    );

    const refreshed = await fsGetDoc(ACCESS_REQUEST_COLLECTION, requestId, accessToken);
    return res.json({
      ok: true,
      requestId,
      status: "pending",
      accessRequest: buildAccessRequest(refreshed),
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: `reopen-access-request failed: ${error?.message || error}`,
    });
  }
});

app.post("/api/catalog-export", async (req, res) => {
  try {
    cleanupExpiredCatalogExports();
    const accessToken = await getAccessToken();
    const context = await resolveRequestContext(req, accessToken);
    if (!requireVaultAccess(context, res)) return;
    if (
      !requireEntitlement(
        context,
        "catalog.export.local",
        res,
        "Local catalog export is not enabled for this workspace."
      )
    ) return;

    const requestedWorkspaceId = String(req.body?.workspaceId || "").trim();
    let targetWorkspace = context.activeWorkspace;
    if (requestedWorkspaceId) {
      if (context.platformAdmin) {
        targetWorkspace =
          context.workspaces.find((workspace) => workspace.workspaceId === requestedWorkspaceId) ||
          { workspaceId: requestedWorkspaceId, name: requestedWorkspaceId };
      } else {
        targetWorkspace = context.workspaces.find((workspace) => workspace.workspaceId === requestedWorkspaceId) || null;
      }
    }

    if (!targetWorkspace?.workspaceId) {
      return res.status(400).json({ ok: false, error: "An active workspace is required for export." });
    }

    const existingJob = [...catalogExportJobs.values()].find(
      (job) =>
        job.workspaceId === targetWorkspace.workspaceId &&
        job.ownerUid === context.user.uid &&
        ["preparing", "building", "ready"].includes(job.status) &&
        Date.parse(job.expiresAt || "") > Date.now()
    );

    if (existingJob) {
      return res.json({
        ok: true,
        exportId: existingJob.exportId,
        status: existingJob.status,
        workspaceId: existingJob.workspaceId,
        partCount: existingJob.partCount || 0,
        totalRows: existingJob.totalRows || 0,
        totalBytes: existingJob.totalBytes || 0,
        missingAssets: existingJob.missingAssets || 0,
        expiresAt: existingJob.expiresAt,
        parts: existingJob.parts || [],
      });
    }

    const job = createCatalogExportJob({
      workspaceId: targetWorkspace.workspaceId,
      ownerUid: context.user.uid,
      requestedByUid: context.user.uid,
    });

    void runCatalogExportJob(job, { ...context, activeWorkspace: targetWorkspace }, accessToken).catch((error) => {
      job.status = "error";
      job.updatedAt = new Date().toISOString();
      job.error = error?.message || String(error);
    });

    return res.status(202).json({
      ok: true,
      exportId: job.exportId,
      status: job.status,
      workspaceId: job.workspaceId,
      expiresAt: job.expiresAt,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: `catalog-export failed: ${error?.message || error}`,
    });
  }
});

app.get("/api/catalog-export/:exportId", async (req, res) => {
  try {
    cleanupExpiredCatalogExports();
    const accessToken = await getAccessToken();
    const context = await resolveRequestContext(req, accessToken);
    if (!requireVaultAccess(context, res)) return;

    const exportId = String(req.params.exportId || "").trim();
    const job = catalogExportJobs.get(exportId);
    if (!job) {
      return res.status(404).json({ ok: false, error: "Export job not found or expired." });
    }
    if (!canAccessCatalogExport(job, context)) {
      return res.status(403).json({ ok: false, error: "You do not have access to that export." });
    }

    return res.json({
      ok: true,
      exportId: job.exportId,
      workspaceId: job.workspaceId,
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      expiresAt: job.expiresAt,
      totalRows: job.totalRows || 0,
      totalAssets: job.totalAssets || 0,
      totalBytes: job.totalBytes || 0,
      totalBytesLabel: byteLabel(job.totalBytes || 0),
      missingAssets: job.missingAssets || 0,
      partCount: job.partCount || 0,
      parts: job.parts || [],
      manifestUrl: `/api/catalog-export/${job.exportId}/manifest`,
      summaryUrl: `/api/catalog-export/${job.exportId}/summary`,
      summary: job.summary || null,
      error: job.error || "",
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: `catalog-export-status failed: ${error?.message || error}`,
    });
  }
});

app.get("/api/catalog-export/:exportId/manifest", async (req, res) => {
  try {
    cleanupExpiredCatalogExports();
    const accessToken = await getAccessToken();
    const context = await resolveRequestContext(req, accessToken);
    if (!requireVaultAccess(context, res)) return;

    const exportId = String(req.params.exportId || "").trim();
    const job = catalogExportJobs.get(exportId);
    if (!job || !job.manifestPath || !fs.existsSync(job.manifestPath)) {
      return res.status(404).json({ ok: false, error: "Manifest not found or expired." });
    }
    if (!canAccessCatalogExport(job, context)) {
      return res.status(403).json({ ok: false, error: "You do not have access to that export." });
    }

    res.set("Cache-Control", "private, no-store");
    res.set("Content-Disposition", `attachment; filename="${job.workspaceId}-catalog.csv"`);
    res.type("text/csv").send(fs.readFileSync(job.manifestPath));
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: `catalog-export-manifest failed: ${error?.message || error}`,
    });
  }
});

app.get("/api/catalog-export/:exportId/summary", async (req, res) => {
  try {
    cleanupExpiredCatalogExports();
    const accessToken = await getAccessToken();
    const context = await resolveRequestContext(req, accessToken);
    if (!requireVaultAccess(context, res)) return;

    const exportId = String(req.params.exportId || "").trim();
    const job = catalogExportJobs.get(exportId);
    if (!job || !job.summaryPath || !fs.existsSync(job.summaryPath)) {
      return res.status(404).json({ ok: false, error: "Summary not found or expired." });
    }
    if (!canAccessCatalogExport(job, context)) {
      return res.status(403).json({ ok: false, error: "You do not have access to that export." });
    }

    res.set("Cache-Control", "private, no-store");
    res.set("Content-Disposition", `attachment; filename="${job.workspaceId}-catalog-summary.json"`);
    res.type("application/json").send(fs.readFileSync(job.summaryPath));
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: `catalog-export-summary failed: ${error?.message || error}`,
    });
  }
});

app.get("/api/catalog-export/:exportId/parts/:partName", async (req, res) => {
  try {
    cleanupExpiredCatalogExports();
    const accessToken = await getAccessToken();
    const context = await resolveRequestContext(req, accessToken);
    if (!requireVaultAccess(context, res)) return;

    const exportId = String(req.params.exportId || "").trim();
    const partName = path.basename(String(req.params.partName || "").trim());
    const job = catalogExportJobs.get(exportId);
    if (!job) {
      return res.status(404).json({ ok: false, error: "Export job not found or expired." });
    }
    if (!canAccessCatalogExport(job, context)) {
      return res.status(403).json({ ok: false, error: "You do not have access to that export." });
    }

    const part = (job.parts || []).find((entry) => entry.partName === partName);
    if (!part || !part.filePath || !fs.existsSync(part.filePath)) {
      return res.status(404).json({ ok: false, error: "Export part not found." });
    }

    res.set("Cache-Control", "private, no-store");
    res.set("Content-Disposition", `attachment; filename="${part.fileName}"`);
    res.type("application/zip").send(fs.readFileSync(part.filePath));
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: `catalog-export-part failed: ${error?.message || error}`,
    });
  }
});

app.get("/catalog.csv", async (req, res) => {
  try {
    const accessToken = await getAccessToken();
    const context = await resolveRequestContext(req, accessToken);
    if (!requireVaultAccess(context, res)) return;
    const loaded = await loadCatalogCsv();
    const text = loaded.buffer.toString("utf8");
    const inspection = buildCatalogInspection(loaded.source, text);
    console.log(
      `[catalog.csv] served source=${loaded.source} rows=${inspection.rowCount} newest=${inspection.newestCreatedAt || "unknown"}`
    );
    res.set("Cache-Control", "private, no-store");
    res.set("X-Catalog-Source", loaded.source);
    res.set("X-Catalog-Row-Count", String(inspection.rowCount || 0));
    res.set("X-Catalog-Newest", inspection.newestCreatedAt || "");
    res.type("text/csv").send(loaded.buffer);
  } catch (e) {
    res.status(500).type("text/plain").send("Failed to load catalog.csv: " + (e?.message || e));
  }
});

app.get("/api/song-media/:songKey/:kind", async (req, res) => {
  try {
    const accessToken = await getAccessToken();
    const context = await resolveRequestContext(req, accessToken);
    if (!requireVaultAccess(context, res)) return;

    const songKey = String(req.params.songKey || "").trim();
    const kind = String(req.params.kind || "").trim().toLowerCase();
    if (!songKey) {
      return res.status(400).json({ ok: false, error: "songKey is required" });
    }
    if (!["audio", "thumb"].includes(kind)) {
      return res.status(400).json({ ok: false, error: "Invalid media kind" });
    }

    const songDoc = await fsGetDoc(SONG_COLLECTION, songKey, accessToken);
    if (!songDoc) {
      return res.status(404).json({ ok: false, error: "Song not found" });
    }

    const { bucket, object } = songMediaObjectName(songDoc, kind);
    const [buf] = await storage.bucket(bucket).file(object).download();

    res.set("Cache-Control", "private, max-age=300");
    res.set("Content-Disposition", "inline");
    res.type(mediaContentType(kind, object)).send(buf);
  } catch (e) {
    const message = e?.message || String(e);
    if (/Invalid gs:\/\/ object path|Invalid media kind|songKey is required/i.test(message)) {
      return res.status(400).json({ ok: false, error: message });
    }
    if (/Song does not have a (audio|thumb) object path/i.test(message)) {
      return res.status(404).json({ ok: false, error: message });
    }
    if (/No such object/i.test(message) || /404/.test(message)) {
      return res.status(404).json({ ok: false, error: "Media object not found" });
    }
    return res.status(500).json({ ok: false, error: `Song media fetch failed: ${message}` });
  }
});

app.get("/api/lyrics-artifact/:songKey/:format", async (req, res) => {
  try {
    const accessToken = await getAccessToken();
    const context = await resolveRequestContext(req, accessToken);
    if (!requireVaultAccess(context, res)) return;
    if (
      !requireEntitlement(
        context,
        "lyrics.artifacts",
        res,
        "Lyrics artifacts are not available for this account."
      )
    ) return;
    const format = String(req.params.format || "").toLowerCase();
    const objectName = lyricObjectName(req.params.songKey, format);
    const [buf] = await storage.bucket(BUCKET).file(objectName).download();
    const contentType =
      format === "txt"
        ? "text/plain; charset=utf-8"
        : format === "json"
          ? "application/json; charset=utf-8"
          : format === "vtt"
            ? "text/vtt; charset=utf-8"
            : "application/octet-stream";

    res.set("Cache-Control", "private, max-age=300");
    res.set("Content-Disposition", `inline; filename="lyrics.${format}"`);
    res.type(contentType).send(buf);
  } catch (e) {
    const message = e?.message || String(e);
    if (/Invalid songKey|Invalid lyrics format/i.test(message)) {
      return res.status(400).json({ ok: false, error: message });
    }
    if (/No such object/i.test(message) || /404/.test(message)) {
      return res.status(404).json({ ok: false, error: "Lyrics artifact not found" });
    }
    return res.status(500).json({ ok: false, error: `Lyrics artifact fetch failed: ${message}` });
  }
});

// ── Queue status endpoint ────────────────────────────────────────────────────
// Returns counts per status so the UI can show progress without full polling.
app.get("/api/queue-status", async (_req, res) => {
  try {
    const accessToken = await getAccessToken();
    const context = await resolveRequestContext(_req, accessToken);
    if (!requireVaultAccess(context, res)) return;
    if (
      !requireEntitlement(
        context,
        "youtube.publish.enabled",
        res,
        "Queue status is available on publishing-enabled plans."
      )
    ) return;
    const counts = await getQueueCounts(accessToken);

    return res.json({ ok: true, counts });
  } catch (e) {
    return res.status(500).json({ ok: false, error: `queue-status failed: ${e?.message || e}` });
  }
});

app.post("/api/publish-states", async (req, res) => {
  try {
    const accessToken = await getAccessToken();
    const context = await resolveRequestContext(req, accessToken);
    if (!requireVaultAccess(context, res)) return;
    const songKeys = Array.isArray(req.body?.songKeys)
      ? req.body.songKeys.map((value) => String(value || "").trim()).filter(Boolean)
      : [];

    if (songKeys.length === 0) {
      return res.status(400).json({ ok: false, error: "songKeys is required" });
    }

    const uniqueKeys = [...new Set(songKeys)].slice(0, 100);
    const docs = await Promise.all(
      uniqueKeys.map(async (songKey) => {
        const doc = await fsGetDoc(SONG_COLLECTION, songKey, accessToken);
        return [songKey, buildPublishState(doc)] ;
      })
    );

    const states = Object.fromEntries(docs.filter(([, state]) => Boolean(state)));
    return res.json({ ok: true, states });
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: `publish-states failed: ${e?.message || e}` });
  }
});

app.get("/api/queue-items", async (req, res) => {
  try {
    const accessToken = await getAccessToken();
    const context = await resolveRequestContext(req, accessToken);
    if (!requireVaultAccess(context, res)) return;
    if (
      !requireEntitlement(
        context,
        "youtube.publish.enabled",
        res,
        "Queue inspection is available on publishing-enabled plans."
      )
    ) return;
    const requestedLimit = Number.parseInt(String(req.query.limit || "100"), 10);
    const limit = Math.max(1, Math.min(requestedLimit || 100, 250));

    const results = await fsRunQuery(
      {
        structuredQuery: {
          from: [{ collectionId: QUEUE_COLLECTION }],
          orderBy: [{ field: { fieldPath: "createdAt" }, direction: "DESCENDING" }],
          limit,
        },
      },
      accessToken
    );

    const items = results
      .filter((row) => row.document)
      .map((row) => {
        const doc = row.document;
        return {
          queueId: doc.name?.split("/").pop() || "",
          songKey: fsString(doc, "songKey"),
          status: fsString(doc, "status"),
          createdAt: fsString(doc, "createdAt"),
          queuedAt: fsString(doc, "queuedAt"),
          startedAt: fsString(doc, "startedAt"),
          uploadedAt: fsString(doc, "uploadedAt"),
          retryCount: fsInt(doc, "retryCount"),
          requestedFrom: fsString(doc, "requestedFrom"),
          ytVideoId: fsString(doc, "ytVideoId"),
          errorMsg: fsString(doc, "errorMsg"),
        };
      });

    return res.json({ ok: true, items, limit });
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: `queue-items failed: ${e?.message || e}` });
  }
});

app.post("/api/queue-normalize", async (req, res) => {
  try {
    const accessToken = await getAccessToken();
    const context = await resolveRequestContext(req, accessToken);
    if (!requireVaultAccess(context, res)) return;
    if (
      !requireEntitlement(
        context,
        "youtube.publish.enabled",
        res,
        "Queue normalization is available on publishing-enabled plans."
      )
    ) return;

    const queueId = String(req.body?.queueId || "").trim();
    const action = String(req.body?.action || "").trim();
    if (!queueId) {
      return res.status(400).json({ ok: false, error: "queueId is required" });
    }
    if (action !== "mark-done") {
      return res.status(400).json({ ok: false, error: "Unsupported action" });
    }

    const doc = await fsGetDoc(QUEUE_COLLECTION, queueId, accessToken);
    if (!doc) {
      return res.status(404).json({ ok: false, error: "Queue item not found" });
    }

    const ytVideoId = fsString(doc, "ytVideoId");
    if (!ytVideoId) {
      return res.status(400).json({ ok: false, error: "Queue item does not have a YouTube ID" });
    }

    const fields = {
      status: { stringValue: "done" },
      errorMsg: { stringValue: "" },
    };

    await fsPatchDoc(fsDocName(QUEUE_COLLECTION, queueId), fields, accessToken);
    return res.json({ ok: true, queueId, status: "done", ytVideoId });
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: `queue-normalize failed: ${e?.message || e}` });
  }
});


// ── Trigger Cloud Run yt-upload-job ──────────────────────────────────────────
// Kicks off a new execution of the yt-upload-job Cloud Run Job via REST API.
// The job is idempotent — running it again is safe; it only picks up queued items.
app.post("/api/trigger-upload-job", async (_req, res) => {
  try {
    const accessToken = await getAccessToken();
    const context = await resolveRequestContext(_req, accessToken);
    if (!requireVaultAccess(context, res)) return;
    if (
      !requireEntitlement(
        context,
        "youtube.publish.enabled",
        res,
        "YouTube upload triggering is available on publishing-enabled plans."
      )
    ) return;

    // Cloud Run Jobs: run an execution
    // POST https://run.googleapis.com/v2/projects/{project}/locations/{region}/jobs/{job}:run
    const region = "us-central1";
    const jobName = "yt-upload-job";
    const url = (
      `https://run.googleapis.com/v2/projects/${PROJECT}/locations/${region}` +
      `/jobs/${jobName}:run`
    );

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return res.status(502).json({
        ok: false,
        error: `Cloud Run trigger failed: HTTP ${resp.status}`,
        detail: text.slice(0, 400),
      });
    }

    const data = await resp.json();
    // data.name is the execution resource name e.g. ".../executions/yt-upload-job-xxxxx"
    const executionName = data.name?.split("/").pop() || "";

    return res.json({ ok: true, execution: executionName });
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: `trigger-upload-job failed: ${e?.message || e}` });
  }
});


app.post("/api/queue-for-youtube", async (req, res) => {
  try {
    const accessToken = await getAccessToken();
    const context = await resolveRequestContext(req, accessToken);
    if (!requireVaultAccess(context, res)) return;
    if (
      !requireEntitlement(
        context,
        "youtube.publish.enabled",
        res,
        "YouTube publishing is not enabled for this workspace yet."
      )
    ) return;

    const songKey = String(req.body?.songKey || "").trim();
    const retryExistingError = Boolean(req.body?.retryExistingError);
    if (!songKey) {
      return res.status(400).json({ ok: false, error: "songKey is required" });
    }

    const songDoc = await fsGetDoc(SONG_COLLECTION, songKey, accessToken);
    if (!songDoc) {
      return res.status(404).json({ ok: false, error: "Song not found" });
    }

    const gcsVideoUrl = fsMapString(songDoc, "media", "videoUrl");
    if (!gcsVideoUrl) {
      return res.status(400).json({ ok: false, error: "Song does not have a GCS video path" });
    }

    if (hasPublishedResult(songDoc)) {
      return res.json({
        ok: true,
        created: false,
        shouldTriggerUpload: false,
        status: "done",
        queueId: "",
        ytVideoId: fsString(songDoc, "ytVideoId"),
        ytCanonicalUrl: fsString(songDoc, "ytCanonicalUrl"),
        errorMsg: "",
      });
    }

    const existing = await findExistingQueueDoc(songKey, accessToken);
    if (existing) {
      const existingStatus = fsString(existing, "status") || "queued";
      if (existingStatus === "error" && retryExistingError) {
        const now = new Date().toISOString();
        await fsPatchDoc(
          existing.name,
          {
            status: { stringValue: "queued" },
            queuedAt: { stringValue: now },
            retryCount: { integerValue: 0 },
            errorMsg: { stringValue: "" },
            startedAt: { stringValue: "" },
            uploadedAt: { stringValue: "" },
            ytVideoId: { stringValue: "" },
          },
          accessToken
        );
        return res.json({
          ok: true,
          created: false,
          shouldTriggerUpload: true,
          status: "queued",
          queueId: existing.name?.split("/").pop() || "",
          ytVideoId: "",
          ytCanonicalUrl: fsString(songDoc, "ytCanonicalUrl"),
          errorMsg: "",
        });
      }
      return res.json({
        ok: true,
        created: false,
        shouldTriggerUpload: false,
        status: existingStatus,
        queueId: existing.name?.split("/").pop() || "",
        ytVideoId: fsString(existing, "ytVideoId") || fsString(songDoc, "ytVideoId"),
        ytCanonicalUrl: fsString(songDoc, "ytCanonicalUrl"),
        errorMsg: fsString(existing, "errorMsg"),
      });
    }

    const now = new Date().toISOString();

    // Optional YouTube metadata overrides sent from the Vault UI
    const ytMeta = req.body?.ytMeta || {};
    const ytFields = {};
    if (ytMeta.title         !== undefined) ytFields.ytTitle          = { stringValue: String(ytMeta.title) };
    if (ytMeta.description   !== undefined) ytFields.ytDescription    = { stringValue: String(ytMeta.description) };
    if (ytMeta.tags          !== undefined) ytFields.ytTags           = { stringValue: String(ytMeta.tags) };
    if (ytMeta.privacy       !== undefined) ytFields.ytPrivacy        = { stringValue: String(ytMeta.privacy) };
    if (ytMeta.language      !== undefined) ytFields.ytLanguage       = { stringValue: String(ytMeta.language) };
    if (ytMeta.license       !== undefined) ytFields.ytLicense        = { stringValue: String(ytMeta.license) };
    if (ytMeta.category      !== undefined) ytFields.ytCategory       = { stringValue: String(ytMeta.category) };
    if (ytMeta.promptPolicy  !== undefined) ytFields.ytPromptPolicy   = { stringValue: String(ytMeta.promptPolicy) };
    if (ytMeta.lyricsPolicy  !== undefined) ytFields.ytLyricsPolicy   = { stringValue: String(ytMeta.lyricsPolicy) };
    if (ytMeta.alteredContent !== undefined) ytFields.ytAlteredContent = { booleanValue: Boolean(ytMeta.alteredContent) };
    if (ytMeta.shortsRemixing !== undefined) ytFields.ytShortsRemixing = { booleanValue: Boolean(ytMeta.shortsRemixing) };

    const created = await fsCreateDoc(
      QUEUE_COLLECTION,
      {
        songKey:       { stringValue: songKey },
        status:        { stringValue: "queued" },
        createdAt:     { stringValue: now },
        queuedAt:      { stringValue: now },
        retryCount:    { integerValue: 0 },
        requestedFrom: { stringValue: "viewer" },
        gcsVideoUrl:   { stringValue: gcsVideoUrl },
        ...ytFields,
      },
      accessToken
    );

    return res.json({
      ok: true,
      created: true,
      shouldTriggerUpload: true,
      status: "queued",
      queueId: created.name?.split("/").pop() || "",
      ytVideoId: "",
      ytCanonicalUrl: "",
      errorMsg: "",
    });
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: `queue-for-youtube failed: ${e?.message || e}` });
  }
});


// Legacy compatibility route.
app.get("/vanessa", (req, res) => {
  const suffix = `${req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""}`;
  res.redirect(308, `/vault${suffix}`);
});
app.use(express.static("dist"));
// Serve SPA routes explicitly for vault views.
app.get("/vault", (_req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});
app.get("/signup", (_req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});
function loadControlCenterHtml() {
  const html = fs.readFileSync(path.join(__dirname, "dist", "index.html"), "utf8");
  const lightThemeStyle = `
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { background: #f8f9ff; color: #172033; font-family: system-ui, sans-serif; }
      ::-webkit-scrollbar { width: 6px; }
      ::-webkit-scrollbar-track { background: #f8f9ff; }
      ::-webkit-scrollbar-thumb { background: #c6d0f5; border-radius: 3px; }
    </style>`;

  return html.replace(/<style>[\s\S]*?<\/style>/, lightThemeStyle);
}

app.get("/control-center", (_req, res) => {
  res.set("Cache-Control", "no-store, max-age=0");
  res.type("html").send(loadControlCenterHtml());
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log("Listening on", port));
