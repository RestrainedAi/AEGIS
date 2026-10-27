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
const tierCatalogConfig = require("./shared/tierCatalog.json");
const { summarizeExportFreshness, pickNewestByCreatedAt } = require("./freshness-utils");
const {
  DEFAULT_CATALOG_EXPORT_TTL_MS,
  buildCatalogExportBaseFileName,
  catalogExportScopeDetails,
  hydrateCatalogExportParts,
  migrateLegacyCatalogExportExpiry,
} = require("./catalog-export-utils");
const { artifactExists: artifactExistsWithFallback, buildCustomerManifestRow, hasArtifact } = require("./export-utils");
const { normalizeStorageObjectReference } = require("./storage-object-reference");

const app = express();
app.disable("x-powered-by");
// S4: token routes still used by the local receiver (local-mirror) and maintenance tooling.
// Bearer-hash protected, rate limited, audit logged. Harvest-test and maintenance build routes removed.
{
  const { createRateLimiter } = require("./token-hash-auth.cjs");
  app.use(["/api/local-mirror/token", "/api/maintenance/token"], createRateLimiter({ windowMs: 60000, max: 20 }));
}
require("./local-mirror-token.cjs").installLocalMirrorTokenRoute(app, { getAccessToken });
require("./maintenance-token.cjs").installMaintenanceTokenRoute(app, { getAccessToken });
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
const EXPORT_JOB_PREFIX = "exports/catalog-jobs";
const EXPORT_TTL_MS = Number(process.env.CATALOG_EXPORT_TTL_MS || DEFAULT_CATALOG_EXPORT_TTL_MS);
const EXPORT_MAX_PART_BYTES = Number(process.env.CATALOG_EXPORT_MAX_PART_BYTES || 1.5 * 1024 * 1024 * 1024);
const EXPORT_ASSET_METADATA_TIMEOUT_MS = Number(process.env.CATALOG_EXPORT_ASSET_METADATA_TIMEOUT_MS || 15000);
const EXPORT_ASSET_DOWNLOAD_TIMEOUT_MS = Number(process.env.CATALOG_EXPORT_ASSET_DOWNLOAD_TIMEOUT_MS || 180000);
const EXPORT_ROW_CONCURRENCY = Number(process.env.CATALOG_EXPORT_ROW_CONCURRENCY || 4);
const EXPORT_BUILD_ROW_TIMEOUT_MS = Number(process.env.CATALOG_EXPORT_BUILD_ROW_TIMEOUT_MS || 90000);
const EXPORT_BUILD_STEP_TIMEOUT_MS = Number(process.env.CATALOG_EXPORT_BUILD_STEP_TIMEOUT_MS || 10 * 60 * 1000);
// Keep recovery beyond the upload deadline so a slow but still valid resumable
// transfer cannot be rebuilt concurrently by a second worker.
const EXPORT_ACTIVE_JOB_STALE_MS = Number(process.env.CATALOG_EXPORT_ACTIVE_JOB_STALE_MS || 30 * 60 * 1000);
const EXPORT_RESUME_STALE_MS = Number(process.env.CATALOG_EXPORT_RESUME_STALE_MS || 30 * 60 * 1000);
const EXPORT_ARTIFACT_RECHECK_MS = Number(process.env.CATALOG_EXPORT_ARTIFACT_RECHECK_MS || 30 * 1000);
const EXPORT_HEARTBEAT_MS = Number(process.env.CATALOG_EXPORT_HEARTBEAT_MS || 30 * 1000);
const EXPORT_STORAGE_RETRY_ATTEMPTS = Number(process.env.CATALOG_EXPORT_STORAGE_RETRY_ATTEMPTS || 4);
const EXPORT_STORAGE_RETRY_BASE_DELAY_MS = Number(process.env.CATALOG_EXPORT_STORAGE_RETRY_BASE_DELAY_MS || 1500);
const EXPORT_STORAGE_UPLOAD_TIMEOUT_MS = Number(
  process.env.CATALOG_EXPORT_STORAGE_UPLOAD_TIMEOUT_MS || 20 * 60 * 1000
);
const EXPORT_STATE_PERSIST_MIN_INTERVAL_MS = Number(
  process.env.CATALOG_EXPORT_STATE_PERSIST_MIN_INTERVAL_MS || 5000
);
const EXPORT_WRITER_VERSION = "2026-05-15-direct-manifest-v3";
const PROJECT = "stable-framing-482501-t9";
const DATABASE = "(default)";
const QUEUE_COLLECTION = "ytUploadQueue";
const SONG_COLLECTION = "sunoSongs";
const SOURCES_COLLECTION = "sources";
const SUNO_ACCOUNT_LABEL_ALIASES = {
  unshakableechos2341: "vanessa_primary",
  nessihenize: "vanessa_secondary",
};
const ACCESS_REQUEST_COLLECTION = "accessRequests";
const APP_NAME = branding.productNames.cloud;
const CLOUD_ORIGIN = String(branding.domains?.cloudOrigin || "").trim();
const MUSIC_ORIGIN = String(branding.domains?.musicOrigin || "").trim();
const LEGACY_APP_ORIGIN = String(process.env.LEGACY_APP_ORIGIN || "https://music.aeonimus.info").trim();
const PUBLIC_APP_ORIGIN = String(
  process.env.PUBLIC_APP_ORIGIN || CLOUD_ORIGIN || MUSIC_ORIGIN || LEGACY_APP_ORIGIN || ""
).trim();
const CLOUD_HOSTNAME = safeHostname(CLOUD_ORIGIN);
const MUSIC_HOSTNAME = safeHostname(MUSIC_ORIGIN);
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
    "blahnikdigitaldesigns@gmail.com,aeonimusai@gmail.com,aegis@aeonimus.ai,software@blahnikdigitaldesigns.com"
)
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const PUBLIC_SIGNUP_TIER_IDS = String(
  process.env.PUBLIC_SIGNUP_TIER_IDS || "artist,creator,producer"
)
  .split(",")
  .map((value) => String(value || "").trim().toLowerCase().replace(/[_\s]+/g, "-"))
  .filter(Boolean);

const SIGNUP_TIER_DEFAULTS = {
  artist: {
    requestKind: "beta",
    planId: "artist",
    role: "viewer",
    workspaceMode: "new",
  },
  creator: {
    requestKind: "paid",
    planId: "creator-monthly",
    role: "viewer",
    workspaceMode: "new",
  },
  producer: {
    requestKind: "paid",
    planId: "producer-monthly",
    role: "admin",
    workspaceMode: "new",
  },
  executive: {
    requestKind: "paid",
    planId: "executive-monthly",
    role: "admin",
    workspaceMode: "new",
  },
  beta: {
    requestKind: "beta",
    planId: "artist",
    role: "viewer",
    workspaceMode: "new",
  },
  free: {
    requestKind: "beta",
    planId: "artist",
    role: "viewer",
    workspaceMode: "new",
  },
  creator_monthly: {
    requestKind: "paid",
    planId: "creator-monthly",
    role: "viewer",
    workspaceMode: "new",
  },
  studio_monthly: {
    requestKind: "paid",
    planId: "producer-monthly",
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

function safeHostname(origin) {
  if (!origin) return "";
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return "";
  }
}

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

function withTimeout(promise, timeoutMs, label) {
  const effectiveTimeoutMs = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
    ? Number(timeoutMs)
    : 60_000;
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.round(effectiveTimeoutMs / 1000)}s`));
    }, effectiveTimeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableCatalogExportStorageError(error) {
  const statusCode = Number(error?.code || error?.statusCode || error?.status || 0);
  if (statusCode === 408 || statusCode === 425 || statusCode === 429) {
    return true;
  }
  if (statusCode >= 500) {
    return true;
  }

  const code = String(error?.code || "").toUpperCase();
  if ([
    "ECONNRESET",
    "ECONNABORTED",
    "ETIMEDOUT",
    "EAI_AGAIN",
    "ENOTFOUND",
    "EPIPE",
    "UND_ERR_CONNECT_TIMEOUT",
  ].includes(code)) {
    return true;
  }

  const message = String(error?.message || error || "").toLowerCase();
  return [
    "socket hang up",
    "timed out",
    "timeout",
    "connection reset",
    "temporarily unavailable",
    "service unavailable",
    "internal error",
    "tls",
    "network",
  ].some((fragment) => message.includes(fragment));
}

async function retryCatalogExportStorageOperation(label, operation) {
  let lastError = null;
  for (let attempt = 1; attempt <= EXPORT_STORAGE_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= EXPORT_STORAGE_RETRY_ATTEMPTS || !isRetryableCatalogExportStorageError(error)) {
        throw error;
      }
      const delayMs = EXPORT_STORAGE_RETRY_BASE_DELAY_MS * attempt;
      console.warn(`[catalog-export] ${label} failed on attempt ${attempt}/${EXPORT_STORAGE_RETRY_ATTEMPTS}; retrying in ${delayMs}ms: ${error?.message || error}`);
      await sleep(delayMs);
    }
  }
  throw lastError || new Error(`${label} failed`);
}

function appendArchiveStream(archive, source, entryName, timeoutMs, label) {
  const effectiveTimeoutMs = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
    ? Number(timeoutMs)
    : 60_000;
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      archive.off("error", onError);
      if (source && typeof source.off === "function") {
        source.off("error", onError);
      }
    };

    const finish = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        reject(error);
        return;
      }
      resolve();
    };

    const onError = (error) => {
      finish(error);
    };

    timer = setTimeout(() => {
      const timeoutError = new Error(`${label} timed out after ${Math.round(effectiveTimeoutMs / 1000)}s`);
      if (source && typeof source.destroy === "function") {
        source.destroy(timeoutError);
      }
      finish(timeoutError);
    }, effectiveTimeoutMs);

    archive.on("error", onError);
    if (source && typeof source.on === "function") {
      source.on("error", onError);
    }
    if (source && typeof source.on === "function") {
      finished(source).then(() => finish(), onError);
    }

    archive.append(source, { name: entryName });
  });
}

async function downloadAssetBuffer(bucketName, objectName, timeoutMs, label) {
  const file = storage.bucket(bucketName).file(objectName);
  const [buffer] = await retryCatalogExportStorageOperation(
    label,
    () => withTimeout(
      file.download(),
      timeoutMs,
      label
    )
  );
  return buffer;
}

function buildExportFileStem(row) {
  const songKey = safeFilePart(row.songKey, crypto.randomBytes(4).toString("hex"));
  return songKey || crypto.randomBytes(4).toString("hex");
}

function manifestFileNameForPart(partName, kind) {
  const stem = safeFilePart(String(partName || "").replace(/\.zip$/i, ""), "catalog_part");
  if (kind === "summary") {
    return `${stem}.summary.json`;
  }
  return `${stem}.catalog.csv`;
}

function buildCatalogExportReadyEmail({ job, context, summary }) {
  const workspaceName = context?.activeWorkspace?.name || summary?.workspaceName || job.workspaceId;
  const downloadsHref = `${PUBLIC_APP_ORIGIN || "https://music.aeonimus.info"}/vault?view=catalog&section=downloads`;
  const body = `
  <p style="margin:0 0 18px;">Your local catalog package is ready to download from the Vault downloads panel.</p>
  ${notificationList([
      { label: "Workspace", value: workspaceName },
      { label: "Rows", value: Number(job.totalRows || 0).toLocaleString() },
      { label: "Assets", value: Number(job.totalAssets || 0).toLocaleString() },
      { label: "ZIP parts", value: Number(job.partCount || 0).toLocaleString() },
      { label: "Package size", value: byteLabel(job.totalBytes || 0) },
      { label: "Missing assets", value: Number(job.missingAssets || 0).toLocaleString() },
      { label: "Expires", value: job.expiresAt || "" },
  ])}
  <p style="margin:18px 0 0;">
    Open the Vault downloads panel here:
    <a href="${downloadsHref}" style="color:#b7bbff;">${downloadsHref}</a>
  </p>
  `;
  return notificationShell({
    title: "Local catalog download ready",
    intro: `${workspaceName} has finished packaging and is ready for download.`,
    body,
  });
}

function buildCatalogExportSignature({ workspaceId, songKeys, accountHandle = "" }) {
  const normalizedKeys = Array.isArray(songKeys)
    ? [...new Set(songKeys.map((value) => String(value || "").trim()).filter(Boolean))].sort()
    : [];
  return JSON.stringify({
    workspaceId: String(workspaceId || "").trim(),
    songKeys: normalizedKeys,
    accountHandle: String(accountHandle || "").trim(),
  });
}

function exportJobPrefix(exportId) {
  return `${EXPORT_JOB_PREFIX}/${String(exportId || "").trim()}`;
}

function exportJobStateObject(exportId) {
  return `${exportJobPrefix(exportId)}/job.json`;
}

function exportJobManifestObject(exportId) {
  return `${exportJobPrefix(exportId)}/catalog.csv`;
}

function exportJobSummaryObject(exportId) {
  return `${exportJobPrefix(exportId)}/summary.json`;
}

function exportJobPartObject(exportId, partName) {
  return `${exportJobPrefix(exportId)}/parts/${path.basename(String(partName || "").trim())}`;
}

function buildCatalogExportStoredJob(job) {
  return {
    exportId: job.exportId,
    workspaceId: job.workspaceId,
    ownerUid: job.ownerUid,
    requestedByUid: job.requestedByUid,
    requestScope: job.requestScope || "catalog",
    requestAccountHandle: job.requestAccountHandle || "",
    requestSongKeys: Array.isArray(job.requestSongKeys) ? job.requestSongKeys : [],
    requestSignature: job.requestSignature || "",
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    lastProgressAt: job.lastProgressAt || job.updatedAt || job.createdAt,
    expiresAt: job.expiresAt,
    phaseLabel: job.phaseLabel || "",
    progressMessage: job.progressMessage || "",
    stepCurrent: Number(job.stepCurrent || 0),
    stepTotal: Number(job.stepTotal || 0),
    currentPart: Number(job.currentPart || 0),
    totalRows: Number(job.totalRows || 0),
    totalAssets: Number(job.totalAssets || 0),
    totalBytes: Number(job.totalBytes || 0),
    missingAssets: Number(job.missingAssets || 0),
    partCount: Number(job.partCount || 0),
    parts: Array.isArray(job.parts)
      ? job.parts.map((part) => ({
          partName: part.partName,
          fileName: part.fileName || part.partName,
          rowCount: Number(part.rowCount || 0),
          assetCount: Number(part.assetCount || 0),
          estimatedBytes: Number(part.estimatedBytes || 0),
          estimatedBytesLabel: part.estimatedBytesLabel || byteLabel(part.estimatedBytes || 0),
          sizeBytes: Number(part.sizeBytes || 0),
          sizeLabel: part.sizeLabel || byteLabel(part.sizeBytes || 0),
          objectName: part.objectName || "",
        }))
      : [],
    manifestObject: job.manifestObject || "",
    summaryObject: job.summaryObject || "",
    summary: job.summary || null,
    error: job.error || "",
  };
}

function catalogExportProgressTimestamp(job) {
  const explicitProgressAt = Date.parse(job?.lastProgressAt || "");
  if (explicitProgressAt) return explicitProgressAt;

  // Jobs written before lastProgressAt existed used the heartbeat timestamp.
  // For a legacy job parked in upload, that timestamp alone does not prove that
  // bytes are moving, so use its creation time to allow safe recovery.
  if (String(job?.phaseLabel || "").toLowerCase() === "uploading packages") {
    return Date.parse(job?.createdAt || "");
  }

  return Date.parse(job?.updatedAt || job?.createdAt || "");
}

async function persistCatalogExportJob(job) {
  if (!job?.exportId) return;
  const payload = `${JSON.stringify(buildCatalogExportStoredJob(job), null, 2)}\n`;
  await retryCatalogExportStorageOperation(
    `Persisting job ${job.exportId}`,
    () => storage.bucket(BUCKET).file(exportJobStateObject(job.exportId)).save(payload, {
      contentType: "application/json",
      resumable: false,
      metadata: {
        cacheControl: "private, max-age=0, no-store",
      },
    })
  );
}

async function checkpointCatalogExportJob(job) {
  if (!job?.exportId) return;
  if (job._persistTimer) {
    clearTimeout(job._persistTimer);
    job._persistTimer = null;
  }
  // Do not let an older throttled snapshot overwrite a completed part. Every
  // upload checkpoint waits for the prior write, then commits the newest state.
  await Promise.resolve(job._persistPromise).catch(() => {});
  const revision = Number(job._persistRevision || 0) + 1;
  job._persistRevision = revision;
  job._persistSnapshot = `${JSON.stringify(buildCatalogExportStoredJob(job), null, 2)}\n`;
  const persistPromise = persistCatalogExportJob(job);
  job._persistPromise = persistPromise;
  await persistPromise;
  job._persistCommittedRevision = revision;
}

function queueCatalogExportPersist(job) {
  if (!job?.exportId) return;
  const revision = Number(job._persistRevision || 0) + 1;
  job._persistRevision = revision;
  // Progress can change once per asset. Keep only the newest snapshot and
  // throttle mutations to the single GCS state object so large exports do not
  // hit Cloud Storage's per-object update rate limit.
  job._persistSnapshot = `${JSON.stringify(buildCatalogExportStoredJob(job), null, 2)}\n`;
  if (job._persistInFlight || job._persistTimer) return;

  const flush = async () => {
    job._persistTimer = null;
    if (job._persistInFlight) return;
    const snapshot = job._persistSnapshot;
    const snapshotRevision = Number(job._persistRevision || 0);
    if (!snapshot || snapshotRevision <= Number(job._persistCommittedRevision || 0)) return;

    job._persistInFlight = true;
    const persistLabel = `Persisting job ${job.exportId} rev ${snapshotRevision}`;
    try {
      const persistPromise = retryCatalogExportStorageOperation(
        persistLabel,
        () => storage.bucket(BUCKET).file(exportJobStateObject(job.exportId)).save(snapshot, {
          contentType: "application/json",
          resumable: false,
          metadata: {
            cacheControl: "private, max-age=0, no-store",
          },
        })
      );
      job._persistPromise = persistPromise;
      await persistPromise;
      job._persistCommittedRevision = snapshotRevision;
    } catch (error) {
      console.error(`[catalog-export] ${persistLabel} failed: ${error?.message || error}`);
    } finally {
      job._persistInFlight = false;
      if (Number(job._persistRevision || 0) > Number(job._persistCommittedRevision || 0)) {
        job._persistTimer = setTimeout(flush, EXPORT_STATE_PERSIST_MIN_INTERVAL_MS);
        if (typeof job._persistTimer.unref === "function") job._persistTimer.unref();
      }
    }
  };

  void flush();
}

function hydrateStoredCatalogExportJob(job) {
  if (!job || typeof job !== "object" || !job.exportId) return null;
  return {
    ...job,
    jobDir: String(job.jobDir || path.join(LOCAL_EXPORT_ROOT, String(job.exportId || "").trim())),
  };
}

async function loadPersistedCatalogExportJob(exportId) {
  if (!exportId) return null;
  try {
    const [buf] = await retryCatalogExportStorageOperation(
      `Loading job ${exportId}`,
      () => storage.bucket(BUCKET).file(exportJobStateObject(exportId)).download()
    );
    const parsed = JSON.parse(buf.toString("utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    return hydrateStoredCatalogExportJob(parsed);
  } catch (error) {
    console.warn(`[catalog-export] Loading persisted job ${exportId} failed: ${error?.message || error}`);
    return null;
  }
}

async function listPersistedCatalogExportJobs() {
  try {
    const [files] = await retryCatalogExportStorageOperation(
      "Listing persisted catalog export jobs",
      () => storage.bucket(BUCKET).getFiles({ prefix: `${EXPORT_JOB_PREFIX}/` })
    );
    const jobFiles = files.filter((file) => String(file.name || "").endsWith("/job.json"));
    if (jobFiles.length === 0) return [];
    const jobs = await Promise.all(
      jobFiles.map(async (file) => {
        try {
          const [buf] = await file.download();
          return hydrateStoredCatalogExportJob(JSON.parse(buf.toString("utf8")));
        } catch (error) {
          console.warn(`[catalog-export] Reading persisted job ${file.name || "unknown"} failed: ${error?.message || error}`);
          return null;
        }
      })
    );
    return jobs.filter(Boolean);
  } catch (error) {
    // An unavailable durable job store must never look like an empty customer
    // download history. Surface it to the request handler and keep the
    // existing records untouched until storage is reachable again.
    console.error(`[catalog-export] Listing persisted catalog export jobs failed: ${error?.message || error}`);
    throw new Error(`The download history is temporarily unavailable: ${error?.message || error}`);
  }
}

async function deletePersistedCatalogExportArtifacts(job) {
  if (!job?.exportId) return;
  const objectNames = [
    exportJobStateObject(job.exportId),
    job.manifestObject,
    job.summaryObject,
    ...(Array.isArray(job.parts) ? job.parts.map((part) => part.objectName).filter(Boolean) : []),
  ].filter(Boolean);
  await Promise.all(
    objectNames.map(async (objectName) => {
      try {
        await storage.bucket(BUCKET).file(objectName).delete({ ignoreNotFound: true });
      } catch (_error) {
        // best effort
      }
    })
  );
}

async function reconcileCatalogExportJob(job) {
  if (!job?.exportId) return null;
  const now = Date.now();
  const expiryMigration = migrateLegacyCatalogExportExpiry(job, now);
  if (expiryMigration.migrated) {
    Object.assign(job, expiryMigration.job);
    await persistCatalogExportJob(job);
  }
  const expiresAt = Date.parse(job.expiresAt || "");
  if (expiresAt && expiresAt <= now) {
    return null;
  }
  const isActive = ["preparing", "building"].includes(String(job.status || "").toLowerCase());
  const lastProgressAt = catalogExportProgressTimestamp(job);
  if (isActive && lastProgressAt && now - lastProgressAt > EXPORT_ACTIVE_JOB_STALE_MS) {
    const staleMessage = "This package stopped making progress and was cleared. Please start a fresh download package.";
    const reconciled = {
      ...job,
      status: "error",
      phaseLabel: "Timed out",
      progressMessage: staleMessage,
      error: staleMessage,
      stepCurrent: 0,
      currentPart: 0,
      updatedAt: new Date().toISOString(),
    };
    if (catalogExportJobs.has(job.exportId)) {
      Object.assign(catalogExportJobs.get(job.exportId), reconciled);
    }
    await persistCatalogExportJob(reconciled);
    return reconciled;
  }
  await refreshCatalogExportAvailability(job);
  return job;
}

async function artifactExists({ objectName = "", filePath = "" } = {}) {
  return artifactExistsWithFallback(
    { objectName, filePath },
    {
      localExists: (candidate) => fs.existsSync(candidate),
      remoteExists: async (candidate) => {
        const [exists] = await storage.bucket(BUCKET).file(candidate).exists();
        return exists;
      },
    }
  );
}

async function refreshCatalogExportAvailability(job) {
  if (!job?.exportId) return job;
  const status = String(job.status || "").toLowerCase();
  if (status !== "ready" && status !== "partial") {
    job.downloadReady = false;
    job.downloadUnavailableReason = "";
    return job;
  }

  const checkedAt = Number(job._artifactCheckedAt || 0);
  if (checkedAt && Date.now() - checkedAt < EXPORT_ARTIFACT_RECHECK_MS) {
    return job;
  }

  const [manifestAvailable, summaryAvailable, verifiedParts] = await Promise.all([
    artifactExists({ objectName: job.manifestObject, filePath: job.manifestPath }),
    artifactExists({ objectName: job.summaryObject, filePath: job.summaryPath }),
    Promise.all(
      Array.isArray(job.parts)
        ? job.parts.map(async (part) => {
            const available = await artifactExists({ objectName: part.objectName, filePath: part.filePath });
            return {
              ...part,
              available,
              downloadUrl: available && part.partName
                ? `/api/catalog-export/${job.exportId}/parts/${encodeURIComponent(part.partName)}`
                : "",
            };
          })
        : []
    ),
  ]);

  job.parts = verifiedParts;
  job.manifestAvailable = manifestAvailable;
  job.summaryAvailable = summaryAvailable;
  job.downloadReady = manifestAvailable || summaryAvailable || verifiedParts.some((part) => part.available);
  job.downloadUnavailableReason = job.downloadReady
    ? ""
    : "This package is no longer downloadable. Prepare a fresh export package to download it again.";
  job._artifactCheckedAt = Date.now();

  if (!job.downloadReady) {
    job.phaseLabel = "Needs refresh";
    job.progressMessage = job.downloadUnavailableReason;
  }

  return job;
}

function createCatalogExportJob({ workspaceId, ownerUid, requestedByUid, songKeys = [], accountHandle = "" }) {
  const exportId = crypto.randomBytes(8).toString("hex");
  const jobDir = path.join(LOCAL_EXPORT_ROOT, exportId);
  ensureDir(jobDir);
  const normalizedSongKeys = [...new Set(songKeys.map((value) => String(value || "").trim()).filter(Boolean))];
  const requestScope = normalizedSongKeys.length === 0
    ? "catalog"
    : normalizedSongKeys.length === 1
      ? "song"
      : "selection";
  const job = {
    exportId,
    workspaceId,
    ownerUid,
    requestedByUid,
    requestScope,
    requestSongKeys: normalizedSongKeys,
    requestAccountHandle: String(accountHandle || "").trim(),
    requestSignature: buildCatalogExportSignature({
      workspaceId,
      songKeys: normalizedSongKeys,
      accountHandle,
    }),
    status: "preparing",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastProgressAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + EXPORT_TTL_MS).toISOString(),
    jobDir,
    error: "",
    phaseLabel: "Queued",
    progressMessage: "Waiting to prepare this catalog package.",
    stepCurrent: 0,
    stepTotal: 4,
    currentPart: 0,
    manifestPath: "",
    summaryPath: "",
    manifestObject: "",
    summaryObject: "",
    totalRows: 0,
    totalAssets: 0,
    totalBytes: 0,
    missingAssets: 0,
    partCount: 0,
    parts: [],
    _persistRevision: 0,
    _persistCommittedRevision: 0,
    _persistPromise: Promise.resolve(),
  };
  catalogExportJobs.set(exportId, job);
  queueCatalogExportPersist(job);
  return job;
}

function setCatalogExportProgress(job, updates = {}) {
  if (!job) return;
  Object.assign(job, updates);
  const now = new Date().toISOString();
  job.updatedAt = now;
  job.lastProgressAt = now;
  queueCatalogExportPersist(job);
}

function startCatalogExportHeartbeat(job) {
  if (!job?.exportId || EXPORT_HEARTBEAT_MS <= 0) return null;
  const timer = setInterval(() => {
    if (!catalogExportJobs.has(job.exportId)) {
      catalogExportJobs.set(job.exportId, job);
    }
    job.updatedAt = new Date().toISOString();
    queueCatalogExportPersist(job);
  }, EXPORT_HEARTBEAT_MS);
  if (typeof timer.unref === "function") {
    timer.unref();
  }
  return timer;
}

async function catalogExportObjectMatchesFile(filePath, destination, label) {
  const expectedBytes = Number(fs.statSync(filePath).size || 0);
  if (expectedBytes <= 0) {
    throw new Error(`${label} cannot upload an empty artifact.`);
  }
  const file = storage.bucket(BUCKET).file(destination);
  try {
    const [metadata] = await withTimeout(
      file.getMetadata(),
      EXPORT_ASSET_METADATA_TIMEOUT_MS,
      `Checking ${label}`
    );
    const actualBytes = Number(metadata?.size || 0);
    if (actualBytes === expectedBytes) {
      return { matches: true, expectedBytes, actualBytes };
    }
    console.warn(
      `[catalog-export] ${label} has incomplete object ${destination}: expected=${expectedBytes} actual=${actualBytes}; replacing it.`
    );
    await file.delete({ ignoreNotFound: true });
  } catch (error) {
    const code = Number(error?.code || error?.statusCode || 0);
    if (code !== 404 && !/No such object|not found/i.test(String(error?.message || error || ""))) {
      throw error;
    }
  }
  return { matches: false, expectedBytes, actualBytes: 0 };
}

async function uploadCatalogExportFile(filePath, destination, contentType, label) {
  const beforeUpload = await catalogExportObjectMatchesFile(filePath, destination, label);
  if (beforeUpload.matches) {
    console.log(`[catalog-export] ${label} already verified in durable storage; reusing it.`);
    return beforeUpload.expectedBytes;
  }
  await retryCatalogExportStorageOperation(
    label,
    () => withTimeout(
      storage.bucket(BUCKET).upload(filePath, {
        destination,
        contentType,
        // Multi-hundred-megabyte package parts must use the resumable upload
        // protocol. A single-request upload can stall at the final transfer.
        resumable: true,
        timeout: EXPORT_STORAGE_UPLOAD_TIMEOUT_MS,
      }),
      EXPORT_STORAGE_UPLOAD_TIMEOUT_MS,
      label
    )
  );
  const verified = await catalogExportObjectMatchesFile(filePath, destination, label);
  if (!verified.matches) {
    throw new Error(`${label} completed without a size-verified Cloud Storage artifact.`);
  }
  return verified.expectedBytes;
}

function serializeCatalogExportJob(job) {
  const scope = catalogExportScopeDetails(job);
  return {
    ok: true,
    exportId: job.exportId,
    workspaceId: job.workspaceId,
    requestScope: scope.requestScope,
    requestAccountHandle: job.requestAccountHandle || "",
    selectionCount: scope.selectionCount,
    scopeLabel: scope.scopeLabel,
    requestLabel: scope.requestLabel,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    expiresAt: job.expiresAt,
    phaseLabel: job.phaseLabel || "",
    progressMessage: job.progressMessage || "",
    stepCurrent: Number(job.stepCurrent || 0),
    stepTotal: Number(job.stepTotal || 0),
    currentPart: Number(job.currentPart || 0),
    totalRows: job.totalRows || 0,
    totalAssets: job.totalAssets || 0,
    totalBytes: job.totalBytes || 0,
    totalBytesLabel: byteLabel(job.totalBytes || 0),
    missingAssets: job.missingAssets || 0,
    partCount: job.partCount || 0,
    parts: hydrateCatalogExportParts(job),
    manifestUrl:
      (job.manifestAvailable ?? hasArtifact(job, "manifest")) ? `/api/catalog-export/${job.exportId}/manifest` : "",
    summaryUrl:
      (job.summaryAvailable ?? hasArtifact(job, "summary")) ? `/api/catalog-export/${job.exportId}/summary` : "",
    downloadReady: Boolean(job.downloadReady),
    downloadUnavailableReason: job.downloadUnavailableReason || "",
    summary: job.summary || null,
    error: job.error || "",
  };
}

function cleanupExpiredCatalogExports() {
  // Package history is customer data. Expiry may control the UI's freshness
  // copy, but it must never silently delete the persisted job record or a
  // completed archive. Deletion requires a future explicit/audited action.
}

function isCatalogExportActiveAndStale(job, thresholdMs = EXPORT_RESUME_STALE_MS) {
  const status = String(job?.status || "").toLowerCase();
  if (!["preparing", "building"].includes(status)) return false;
  const lastProgressAt = catalogExportProgressTimestamp(job);
  return Boolean(lastProgressAt && Date.now() - lastProgressAt > thresholdMs);
}

async function maybeResumeCatalogExportJob(job, context, accessToken) {
  if (!job || !context?.isAuthenticated || !accessToken) return job;
  if (!isCatalogExportActiveAndStale(job)) return job;

  const lastResumeAt = Number(job._resumeRequestedAt || 0);
  if (lastResumeAt && Date.now() - lastResumeAt < 2 * 60 * 1000) {
    return job;
  }

  job._resumeRequestedAt = Date.now();
  catalogExportJobs.set(job.exportId, job);
  setCatalogExportProgress(job, {
    status: "preparing",
    phaseLabel: "Resuming package build",
    progressMessage: "This package stalled earlier, so we are resuming it now.",
    error: "",
  });
  void runCatalogExportJob(job, context, accessToken).catch((error) => {
    setCatalogExportProgress(job, {
      status: job.parts?.length || job.manifestObject || job.summaryObject ? "partial" : "error",
      phaseLabel: job.parts?.length || job.manifestObject || job.summaryObject ? "Partially ready" : "Failed",
      progressMessage: job.parts?.length || job.manifestObject || job.summaryObject
        ? "Some verified package files are ready below. The remaining package build failed, so start a fresh package for a complete set."
        : "This package did not finish successfully.",
      error: error?.message || String(error),
    });
  });
  return job;
}

async function getCatalogExportJob(exportId, context = null, accessToken = "") {
  if (!exportId) return null;
  const localJob = catalogExportJobs.get(exportId);
  if (localJob) {
    return reconcileCatalogExportJob(await maybeResumeCatalogExportJob(localJob, context, accessToken));
  }
  const persisted = await loadPersistedCatalogExportJob(exportId);
  return reconcileCatalogExportJob(await maybeResumeCatalogExportJob(persisted, context, accessToken));
}

async function getAccessibleCatalogExportJobs(context, accessToken = "") {
  const persistedJobs = await listPersistedCatalogExportJobs();
  const merged = new Map();

  for (const job of persistedJobs) {
    if (!job?.exportId) continue;
    const reconciled = await reconcileCatalogExportJob(
      await maybeResumeCatalogExportJob(job, context, accessToken)
    );
    if (!reconciled) continue;
    merged.set(job.exportId, reconciled);
  }

  for (const [exportId, job] of catalogExportJobs.entries()) {
    const reconciled = await reconcileCatalogExportJob(
      await maybeResumeCatalogExportJob(job, context, accessToken)
    );
    if (!reconciled) continue;
    merged.set(exportId, reconciled);
  }

  return [...merged.values()]
    .filter((job) => canAccessCatalogExport(job, context))
    .sort((a, b) => Date.parse(b.updatedAt || b.createdAt || "") - Date.parse(a.updatedAt || a.createdAt || ""));
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
  const accountLabels = new Set();

  for (const sourceDoc of sourceDocs) {
    const sourceId = sourceDoc.name?.split("/").pop() || "";
    const handle = fsString(sourceDoc, "handle");
    const accountLabel =
      fsString(sourceDoc, "accountLabel") || canonicalAccountLabel(handle) || handle;
    if (sourceId) sourceIds.add(sourceId);
    if (handle) handles.add(handle);
    if (accountLabel) accountLabels.add(accountLabel);
    const aliasedHandle = SUNO_ACCOUNT_LABEL_ALIASES[handle];
    if (aliasedHandle) accountLabels.add(aliasedHandle);
  }

  return parsedRows.filter((row) => {
    const sourceId = String(row.account_sourceId || "").trim();
    const handle = String(row.account_handle || "").trim();
    const label = String(row.account_label || "").trim();
    return (
      sourceIds.has(sourceId) ||
      handles.has(handle) ||
      accountLabels.has(label) ||
      accountLabels.has(canonicalAccountLabel(handle, label))
    );
  });
}

async function resolveAssetDescriptor({ songKey, title, kind, gsUrl, exportPath, notes }) {
  gsUrl = normalizeStorageObjectReference(gsUrl);
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
    const [metadata] = await Promise.race([
      storage.bucket(bucket).file(object).getMetadata(),
      new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Timed out loading metadata for ${kind} asset: ${gsUrl}`));
        }, EXPORT_ASSET_METADATA_TIMEOUT_MS);
      }),
    ]);
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

async function buildExportRow(row) {
    const songKey = safeFilePart(row.songKey, crypto.randomBytes(4).toString("hex"));
    const fileStem = buildExportFileStem(row);

    const audioGs = row.gcs_latest_audio || row.gcs_mp3 || row.audio_url || "";
    const imageGs = row.gcs_latest_thumb || row.gcs_thumb || row.image_url || "";
    const lyricsTxtGs = row.gcsLyricsTxt || "";
    const lyricsVttGs = row.gcsLyricsVtt || "";
    const inlineLyrics = String(row.lyrics || "").trim();

    const [audioAsset, imageAsset, resolvedLyricsTxtAsset, lyricsVttAsset] = await Promise.all([
      resolveAssetDescriptor({
        songKey,
        title: row.title,
        kind: "audio",
        gsUrl: audioGs,
        exportPath: `audio/${fileStem}${extFromObjectName(audioGs, ".mp3")}`,
        notes: "missing_audio",
      }),
      resolveAssetDescriptor({
        songKey,
        title: row.title,
        kind: "thumb",
        gsUrl: imageGs,
        exportPath: `images/thumbs/${fileStem}${extFromObjectName(imageGs, ".jpg")}`,
        notes: "missing_image",
      }),
      lyricsTxtGs
        ? resolveAssetDescriptor({
            songKey,
            title: row.title,
            kind: "lyrics_txt",
            gsUrl: lyricsTxtGs,
            exportPath: `lyrics/txt/${fileStem}.txt`,
            notes: "missing_lyrics",
          })
        : Promise.resolve(
            inlineLyrics
              ? {
                  kind: "lyrics_txt",
                  exportPath: `lyrics/txt/${fileStem}.txt`,
                  exists: true,
                  estimatedBytes: Buffer.byteLength(inlineLyrics, "utf8"),
                  inlineContent: inlineLyrics,
                  note: "",
                  songKey,
                  title: row.title,
                }
              : {
                  kind: "lyrics_txt",
                  exportPath: `lyrics/txt/${fileStem}.txt`,
                  exists: false,
                  estimatedBytes: 0,
                  note: "missing_lyrics",
                  songKey,
                  title: row.title,
                }
          ),
      resolveAssetDescriptor({
        songKey,
        title: row.title,
        kind: "lyrics_vtt",
        gsUrl: lyricsVttGs,
        exportPath: `lyrics/vtt/${fileStem}.vtt`,
        notes: "missing_lyrics_vtt",
      }),
    ]);
    const lyricsTxtAsset = resolvedLyricsTxtAsset;

    const assets = [audioAsset, imageAsset, lyricsTxtAsset, lyricsVttAsset];
    const availableAssets = assets.filter((asset) => asset.exists);
    const missingKinds = assets.filter((asset) => !asset.exists).map((asset) => asset.note).filter(Boolean);
    const estimatedBytes = availableAssets.reduce((sum, asset) => sum + Number(asset.estimatedBytes || 0), 0);

    return {
      original: row,
      songKey,
      title: row.title || "",
      accountHandle: row.account_handle || "",
      assets,
      estimatedBytes,
      manifest: buildCustomerManifestRow(
        row,
        fileStem,
        audioAsset,
        imageAsset,
        lyricsTxtAsset,
        lyricsVttAsset,
        missingKinds
      ),
    };
}

function buildTimedOutExportRow(row, error) {
  const songKey = safeFilePart(row.songKey, crypto.randomBytes(4).toString("hex"));
  const fileStem = buildExportFileStem(row);
  const audioGs = row.gcs_latest_audio || row.gcs_mp3 || row.audio_url || "";
  const imageGs = row.gcs_latest_thumb || row.gcs_thumb || row.image_url || "";
  const inlineLyrics = String(row.lyrics || "").trim();
  const assets = [
    {
      kind: "audio",
      exportPath: `audio/${fileStem}${extFromObjectName(audioGs, ".mp3")}`,
      exists: false,
      estimatedBytes: 0,
      note: "asset_resolution_timeout",
      songKey,
      title: row.title,
    },
    {
      kind: "thumb",
      exportPath: `images/thumbs/${fileStem}${extFromObjectName(imageGs, ".jpg")}`,
      exists: false,
      estimatedBytes: 0,
      note: "asset_resolution_timeout",
      songKey,
      title: row.title,
    },
    inlineLyrics
      ? {
          kind: "lyrics_txt",
          exportPath: `lyrics/txt/${fileStem}.txt`,
          exists: true,
          estimatedBytes: Buffer.byteLength(inlineLyrics, "utf8"),
          inlineContent: inlineLyrics,
          note: "",
          songKey,
          title: row.title,
        }
      : {
          kind: "lyrics_txt",
          exportPath: `lyrics/txt/${fileStem}.txt`,
          exists: false,
          estimatedBytes: 0,
          note: "asset_resolution_timeout",
          songKey,
          title: row.title,
        },
    {
      kind: "lyrics_vtt",
      exportPath: `lyrics/vtt/${fileStem}.vtt`,
      exists: false,
      estimatedBytes: 0,
      note: "asset_resolution_timeout",
      songKey,
      title: row.title,
    },
  ];
  console.error(
    `[catalog-export] asset resolution skipped song=${row.songKey || "unknown"} title=${row.title || "unknown"}: ${error?.message || error}`
  );
  return {
    original: row,
    songKey,
    title: row.title || "",
    accountHandle: row.account_handle || "",
    assets,
    estimatedBytes: assets.filter((asset) => asset.exists).reduce((sum, asset) => sum + Number(asset.estimatedBytes || 0), 0),
    manifest: buildCustomerManifestRow(
      row,
      fileStem,
      assets[0],
      assets[1],
      assets[2],
      assets[3],
      assets.filter((asset) => !asset.exists).map((asset) => asset.note).filter(Boolean)
    ),
  };
}

async function buildExportRowSafely(row) {
  try {
    return await withTimeout(
      buildExportRow(row),
      EXPORT_BUILD_ROW_TIMEOUT_MS,
      `Resolving assets for ${row.title || row.songKey || "catalog row"}`
    );
  } catch (error) {
    return buildTimedOutExportRow(row, error);
  }
}

async function buildExportRowsForWorkspace(rows, onProgress) {
  const exportRows = [];
  let totalAssets = 0;
  let totalBytes = 0;
  let missingAssets = 0;
  const totalRows = rows.length;

  for (let offset = 0; offset < rows.length; offset += EXPORT_ROW_CONCURRENCY) {
    const batch = rows.slice(offset, offset + EXPORT_ROW_CONCURRENCY);
    const builtBatch = await Promise.all(batch.map((row) => buildExportRowSafely(row)));
    for (const [batchIndex, builtRow] of builtBatch.entries()) {
      exportRows.push(builtRow);
      const availableAssets = builtRow.assets.filter((asset) => asset.exists);
      totalAssets += availableAssets.length;
      totalBytes += builtRow.estimatedBytes;
      missingAssets += builtRow.assets.length - availableAssets.length;

      if (typeof onProgress === "function") {
        onProgress({
          resolvedRows: offset + batchIndex + 1,
          totalRows,
          title: builtRow.title || "",
        });
      }
    }
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

async function writeZipPart(part, manifestCsv, summaryJson, targetPath, onProgress) {
  ensureDir(path.dirname(targetPath));
  const output = fs.createWriteStream(targetPath);
  const archive = archiver("zip", { zlib: { level: 6 } });
  let archiveDone;
  console.log(
    `[catalog-export] writer=${EXPORT_WRITER_VERSION} part=${part.partName} phase=manifest target=${targetPath}`
  );

  archiveDone = finished(output);
  archive.on("error", (error) => {
    output.destroy(error);
  });
  archive.pipe(output);
  try {
    archive.append(manifestCsv, { name: `manifest/${manifestFileNameForPart(part.partName, "catalog")}` });
    archive.append(summaryJson, { name: `manifest/${manifestFileNameForPart(part.partName, "summary")}` });
    archive.append(
      [
        "Unzip each catalog part into the same parent folder.",
        "Audio, image, and lyrics filenames are already unique and safe to merge.",
        "Manifest files are named per-part so they do not overwrite each other.",
        "",
      ].join("\n"),
      { name: "manifest/README.txt" }
    );
    console.log(
      `[catalog-export] writer=${EXPORT_WRITER_VERSION} part=${part.partName} phase=assets totalAssets=${part.rows.reduce((sum, row) => sum + row.assets.filter((asset) => asset.exists).length, 0)}`
    );

    const totalAssets = part.rows.reduce((sum, row) => sum + row.assets.filter((asset) => asset.exists).length, 0);
    let appendedAssets = 0;
    for (const row of part.rows) {
      for (const asset of row.assets) {
        if (!asset.exists) continue;
        if (asset.inlineContent != null) {
          archive.append(asset.inlineContent, { name: asset.exportPath });
        } else if (asset.kind !== "audio") {
          const buffer = await downloadAssetBuffer(
            asset.bucket,
            asset.object,
            EXPORT_ASSET_DOWNLOAD_TIMEOUT_MS,
            `Downloading ${asset.kind} for ${asset.title || asset.songKey || asset.exportPath}`
          );
          archive.append(buffer, { name: asset.exportPath });
        } else {
          const stream = storage.bucket(asset.bucket).file(asset.object).createReadStream({
            validation: false,
          });
          await appendArchiveStream(
            archive,
            stream,
            asset.exportPath,
            EXPORT_ASSET_DOWNLOAD_TIMEOUT_MS,
            `Streaming ${asset.kind} for ${asset.title || asset.songKey || asset.exportPath}`
          );
        }
        appendedAssets += 1;
        if (typeof onProgress === "function") {
          onProgress({
            appendedAssets,
            totalAssets,
            title: row.title || asset.title || "",
            partName: part.partName,
          });
        }
      }
    }

    archive.finalize();
    await withTimeout(archiveDone, EXPORT_BUILD_STEP_TIMEOUT_MS, `Finalizing ${part.partName}`);
    const stats = fs.statSync(targetPath);
    return stats.size;
  } catch (error) {
    console.error(`[catalog-export] part=${part.partName} failed; cleaning partial ZIP: ${error?.message || error}`);
    try {
      if (typeof archive.abort === "function") archive.abort();
    } catch (_abortError) {
      // Best effort: the original error is more useful to the caller.
    }
    if (!output.destroyed) output.destroy(error);
    await archiveDone.catch(() => {});
    try {
      fs.unlinkSync(targetPath);
    } catch (_unlinkError) {
      // Best effort cleanup; do not hide the export failure.
    }
    throw error;
  }
}

async function runCatalogExportJob(job, context, accessToken) {
  job.jobDir = String(job.jobDir || path.join(LOCAL_EXPORT_ROOT, String(job.exportId || "").trim()));
  ensureDir(job.jobDir);
  const heartbeat = startCatalogExportHeartbeat(job);
  try {
    setCatalogExportProgress(job, {
      status: "preparing",
      phaseLabel: "Loading catalog",
      progressMessage: "Reading the latest catalog snapshot for this workspace.",
      stepCurrent: 1,
      stepTotal: 4,
      currentPart: 0,
      error: "",
    });

  const sourceDocs = await listWorkspaceSourceDocs(job.workspaceId, accessToken);
  const loaded = await loadCatalogWithTitles(); // exports use the same titles the Vault shows
  const requestedSongKeySet = new Set(Array.isArray(job.requestSongKeys) ? job.requestSongKeys : []);
  const requestedAccountHandle = String(job.requestAccountHandle || "").trim();
  const allCatalogRows = parseCatalogCsv(loaded.buffer.toString("utf8"));
  const workspaceRows = buildWorkspaceCatalogRows(loaded.buffer.toString("utf8"), sourceDocs);
  const accountSourceRows = requestedAccountHandle && (context.platformAdmin || context.legacyMode)
    ? allCatalogRows
    : workspaceRows;
  const exportableRows = requestedAccountHandle
    ? accountSourceRows.filter((row) => {
        const handle = String(row.account_handle || "").trim();
        const label = String(row.account_label || "").trim();
        return handle === requestedAccountHandle ||
          label === requestedAccountHandle ||
          canonicalAccountLabel(handle, label) === requestedAccountHandle;
      })
    : workspaceRows;
  const selectionRows =
    requestedSongKeySet.size > 0
      ? (context.platformAdmin
          ? allCatalogRows.filter((row) => requestedSongKeySet.has(String(row.songKey || "").trim()))
          : exportableRows.filter((row) => requestedSongKeySet.has(String(row.songKey || "").trim())))
      : [];
  const scopedRows = requestedSongKeySet.size > 0
    ? selectionRows
    : exportableRows;
  const rowLabel =
    job.requestScope === "song"
      ? "song"
      : job.requestScope === "selection"
        ? "selected song"
        : "catalog row";
  setCatalogExportProgress(job, {
    phaseLabel: "Resolving assets",
    progressMessage: `Found ${scopedRows.length.toLocaleString()} ${rowLabel}${scopedRows.length === 1 ? "" : "s"} for packaging.`,
    stepCurrent: 2,
  });
  if (requestedSongKeySet.size === 0 && exportableRows.length === 0) {
    throw new Error(
      requestedAccountHandle
        ? "No exportable catalog rows were found for the selected account in this workspace yet. Pick another account or wait for harvest to finish."
        : "No exportable catalog rows were found for this workspace yet. Pick a workspace with cataloged songs or wait for harvest to finish."
    );
  }
  if (requestedSongKeySet.size > 0 && scopedRows.length === 0) {
    throw new Error(
      job.requestScope === "song"
        ? "That song is not exportable from this workspace yet. Wait for harvest to finish or try another song."
        : "None of the selected songs are exportable from this workspace yet. Wait for harvest to finish or refine the selection."
    );
  }
  const prepared = await buildExportRowsForWorkspace(scopedRows, ({ resolvedRows, totalRows, title }) => {
    setCatalogExportProgress(job, {
      status: "preparing",
      phaseLabel: "Resolving assets",
      progressMessage: `Resolving assets for song ${resolvedRows.toLocaleString()} of ${totalRows.toLocaleString()}${title ? `: ${title}` : ""}`,
      stepCurrent: 2,
    });
  });
  if (prepared.exportRows.length === 0) {
    throw new Error(
      job.requestScope === "song"
        ? "We found the song, but its download assets are not ready to package yet. Try again after the catalog finishes syncing."
        : job.requestScope === "selection"
          ? "We found the selected songs, but their download assets are not ready to package yet. Try again after the catalog finishes syncing."
          : "We found the workspace, but there were no exportable song assets ready to package yet. Try again after the catalog finishes syncing."
    );
  }
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
    requestScope: job.requestScope,
    selectionCount: requestedSongKeySet.size,
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
  job.manifestObject = exportJobManifestObject(job.exportId);
  job.summaryObject = exportJobSummaryObject(job.exportId);
  await uploadCatalogExportFile(
    manifestPath,
    job.manifestObject,
    "text/csv",
    `Uploading manifest for ${job.exportId}`
  );
  await uploadCatalogExportFile(
    summaryPath,
    job.summaryObject,
    "application/json",
    `Uploading summary for ${job.exportId}`
  );
  setCatalogExportProgress(job, {
    manifestPath,
    summaryPath,
    manifestObject: job.manifestObject,
    summaryObject: job.summaryObject,
  });
  await checkpointCatalogExportJob(job);
  setCatalogExportProgress(job, {
    phaseLabel: "Building packages",
    progressMessage: `Preparing ${parts.length.toLocaleString()} ZIP package part${parts.length === 1 ? "" : "s"}.`,
    stepCurrent: 3,
  });

  const completedParts = [];
  for (const [index, part] of parts.entries()) {
    setCatalogExportProgress(job, {
      status: "building",
      phaseLabel: "Building packages",
      progressMessage: `Building ZIP ${index + 1} of ${parts.length}: ${part.partName}`,
      stepCurrent: 3,
      currentPart: index + 1,
    });
    const filePath = path.join(job.jobDir, part.partName);
    await writeZipPart(part, manifestCsv, summaryJson, filePath, ({ appendedAssets, totalAssets, title, partName }) => {
      setCatalogExportProgress(job, {
        status: "building",
        phaseLabel: "Building packages",
        progressMessage: `Building ${partName}: asset ${appendedAssets.toLocaleString()} of ${totalAssets.toLocaleString()}${title ? ` · ${title}` : ""}`,
        stepCurrent: 3,
        currentPart: index + 1,
      });
    });
    const objectName = exportJobPartObject(job.exportId, part.partName);
    setCatalogExportProgress(job, {
      status: "building",
      phaseLabel: "Uploading packages",
      progressMessage: `Uploading ZIP ${index + 1} of ${parts.length}: ${part.partName}`,
      stepCurrent: 3,
      currentPart: index + 1,
    });
    const uploadedSizeBytes = await uploadCatalogExportFile(
      filePath,
      objectName,
      "application/zip",
      `Uploading ${part.partName} for ${job.exportId}`
    );
    const completedPart = {
      partName: part.partName,
      fileName: part.partName,
      filePath: "",
      objectName,
      rowCount: part.rows.length,
      assetCount: part.assetCount,
      estimatedBytes: part.estimatedBytes,
      estimatedBytesLabel: byteLabel(part.estimatedBytes),
      sizeBytes: uploadedSizeBytes,
      sizeLabel: byteLabel(uploadedSizeBytes),
      downloadUrl: `/api/catalog-export/${job.exportId}/parts/${encodeURIComponent(part.partName)}`,
    };
    job.parts = [
      ...(Array.isArray(job.parts) ? job.parts.filter((entry) => entry.partName !== part.partName) : []),
      completedPart,
    ].sort((left, right) => String(left.partName).localeCompare(String(right.partName)));
    job.totalRows = prepared.exportRows.length;
    job.totalAssets = prepared.totalAssets;
    job.totalBytes = prepared.totalBytes;
    job.missingAssets = prepared.missingAssets;
    job.partCount = job.parts.length;
    job.summary = summary;
    setCatalogExportProgress(job, {
      status: "building",
      phaseLabel: "Uploading packages",
      progressMessage: `Verified ZIP ${index + 1} of ${parts.length}: ${part.partName}`,
      stepCurrent: 3,
      currentPart: index + 1,
    });
    await checkpointCatalogExportJob(job);
    try {
      fs.unlinkSync(filePath);
    } catch (_error) {
      // Best effort: GCS is the source of truth once upload completes.
    }
    completedParts.push(completedPart);
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
  setCatalogExportProgress(job, {
    status: "ready",
    phaseLabel: "Ready",
    progressMessage: `Package ready. ${completedParts.length.toLocaleString()} ZIP part${completedParts.length === 1 ? "" : "s"} and the manifests are available below.`,
    stepCurrent: 4,
    currentPart: completedParts.length,
  });
    // Commit the completed state before optional notification delivery. The
    // download record and its artifacts are the primary customer outcome.
    await checkpointCatalogExportJob(job);
    if (context?.user?.email) {
      await safeSendNotificationEmail({
        accessToken,
        to: context.user.email,
        subject: `Catalog download ready: ${summary.workspaceName || job.workspaceId}`,
        html: buildCatalogExportReadyEmail({ job, context, summary }),
      });
    }
  } finally {
    if (heartbeat) {
      clearInterval(heartbeat);
    }
  }
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
    { label: "Preferred path after beta", value: accessRequest.preferredUpgradePlanId || "creator-monthly" },
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
  const vaultHref = `${PUBLIC_APP_ORIGIN || "https://music.aeonimus.info"}/vault`;
  const list = notificationList([
    { label: "Workspace", value: workspaceName || accessRequest.requestedWorkspaceName || "Workspace assigned" },
    { label: "Role", value: role || accessRequest.approvedRole || "viewer" },
    { label: "Plan", value: planId || accessRequest.approvedPlanId || "artist" },
    { label: "Beta access ends", value: betaExpiresAt || accessRequest.betaExpiresAt || "Not set" },
    { label: "Upgrade target after beta", value: accessRequest.betaMigrationTargetPlanId || accessRequest.preferredUpgradePlanId || "creator-monthly" },
  ]);
  return notificationShell({
    title: "Beta access approved",
    intro: `Your beta access has been approved. You can now sign in and open the Vault with the workspace that was assigned to you.`,
    body: `
      <p style="margin:0 0 18px;">We approved your request and created the access posture for your account. Sign in again if you already had the app open so the new workspace and entitlements refresh cleanly.</p>
      ${list}
      <p style="margin:18px 0 0;">
        Open the app here:
        <a href="${vaultHref}" style="color:#b7bbff;">${vaultHref}</a>
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
        { label: "Preferred path after beta", value: accessRequest.preferredUpgradePlanId || "creator-monthly" },
      ])}
    `,
  });
}

function buildOperatorRequestEmail(accessRequest) {
  const controlCenterHref = `${PUBLIC_APP_ORIGIN || "https://music.aeonimus.info"}/control-center`;
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
        { label: "Preferred upgrade path", value: accessRequest.preferredUpgradePlanId || "creator-monthly" },
      ])}
      <p style="margin:18px 0 0;">Intended use:</p>
      <div style="margin-top:10px;padding:14px 16px;background:#171a31;border:1px solid #2b2f57;border-radius:16px;color:#eef0ff;">${accessRequest.intendedUse || "No intended use was provided."}</div>
      <p style="margin:18px 0 0;">
        Review in Control Center:
        <a href="${controlCenterHref}" style="color:#b7bbff;">${controlCenterHref}</a>
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
    return SIGNUP_TIER_DEFAULTS.creator;
  }
  return SIGNUP_TIER_DEFAULTS.artist;
}

function activePublicSignupTierIds() {
  const availableIds = new Set(buildSignupCatalog().map((tier) => normalizePlanKey(tier.id)));
  const requestedIds = PUBLIC_SIGNUP_TIER_IDS.filter((tierId) => availableIds.has(tierId));
  return requestedIds.length > 0 ? requestedIds : ["artist", "creator", "producer"];
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
    domains: ["sundrop.music", "sundrop.cloud"],
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

async function findAdminDocForIdentity({ uid = "", email = "" }, accessToken) {
  const normalizedUid = String(uid || "").trim();
  if (normalizedUid) {
    try {
      const directDoc = await fsGetDocByPath(`admins/${normalizedUid}`, accessToken);
      if (directDoc) return directDoc;
    } catch (error) {
      console.warn("[auth-session] failed to load direct admin doc:", error?.message || error);
    }
  }

  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return null;

  const results = await fsRunQuery(
    {
      structuredQuery: {
        from: [{ collectionId: "admins" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "email" },
            op: "EQUAL",
            value: { stringValue: normalizedEmail },
          },
        },
        limit: 1,
      },
    },
    accessToken
  );

  return results.find((row) => row.document)?.document || null;
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
    requestedTier: fsString(doc, "requestedTier") || "artist",
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

const authTrust = require("./auth-trust");
const ALLOWED_SIGN_IN_PROVIDERS = authTrust.allowedProviders(process.env.ALLOWED_SIGN_IN_PROVIDERS);

async function resolveRequestContextInner(req, accessToken, viewAsSubject = null) {
  const token = viewAsSubject ? "view-as" : parseBearerToken(req);
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
    decodedToken = viewAsSubject || (await firebaseAuth.verifyIdToken(token));
    // S3: only verified Google (or explicitly allowed) sign-ins count as authenticated.
    if (!viewAsSubject && !authTrust.isTrustedIdentity(decodedToken, ALLOWED_SIGN_IN_PROVIDERS)) {
      throw new Error("untrusted sign-in provider or unverified email");
    }
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
  // View-as sessions are read-only: never create/update the subject's profile or workspace.
  const userDoc = viewAsSubject
    ? await fsGetDocByPath(`users/${decodedToken.uid}`, accessToken).catch(() => null)
    : await ensureUserProfile(decodedToken, accessToken);
  if (!viewAsSubject) await ensureBootstrapWorkspaceForUser(decodedToken, accessToken);

  let refreshedUserDoc = null;
  try {
    refreshedUserDoc = await fsGetDocByPath(`users/${decodedToken.uid}`, accessToken);
  } catch (error) {
    console.warn("[auth-session] failed to refresh user doc:", error?.message || error);
  }

  // S3: bootstrap emails come only from the verified token, never from the user-editable profile.
  const verifiedEmail = viewAsSubject ? "" : authTrust.trustedEmail(decodedToken, ALLOWED_SIGN_IN_PROVIDERS);
  const bootstrapApproved = !viewAsSubject && isBootstrapApprovedEmail(verifiedEmail);

  let adminDoc = null;
  if (!viewAsSubject) try {
    adminDoc = await findAdminDocForIdentity(
      {
        uid: decodedToken.uid,
        email: verifiedEmail,
      },
      accessToken
    );
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
  const platformAdmin = !viewAsSubject && authTrust.isPlatformAdminIdentity({
    decoded: decodedToken,
    providers: ALLOWED_SIGN_IN_PROVIDERS,
    adminDoc,
    bootstrapEmails: approvedEmailSet(),
    fsBool,
  });
  const betaAccess = buildBetaAccessState(refreshedUserDoc || userDoc);
  const betaExpired = !platformAdmin && betaAccess?.status === "expired";
  const effectiveWorkspaces = betaExpired ? [] : workspaces;
  const activeWorkspace = betaExpired
    ? null
    : pickActiveWorkspace(effectiveWorkspaces, preferredWorkspaceId, refreshedUserDoc || userDoc);
  const entitlements = activeWorkspace?.entitlements || {};
  const domainAccess = contextAllowsCurrentDomain(
    {
      platformAdmin,
      legacyMode: false,
      activeWorkspace,
    },
    req
  );

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
    currentDomain: domainAccess.current,
    domainAccess,
    accessRequest,
    needsApproval: !platformAdmin && effectiveWorkspaces.length === 0 && betaAccess?.status !== "expired",
    betaAccess,
    authInitError: firebaseInitError,
  };
}

// ---- Master Admin "view as user" (PLAN_4_5 step 5). Off unless MASTER_ADMIN_ENABLED=true. ----
const adminAccess = require("./admin-access");
const MASTER_ADMIN_ENABLED = String(process.env.MASTER_ADMIN_ENABLED || "").trim().toLowerCase() === "true";
const VIEW_AS_SECRET = String(process.env.VIEW_AS_SECRET || "");
const ADMIN_AUDIT_COLLECTION = "adminAuditLog";

async function writeAdminAudit(entry, accessToken) {
  console.log(JSON.stringify({ severity: "NOTICE", logName: "admin-audit", ...entry }));
  try {
    await fsCreateDoc(ADMIN_AUDIT_COLLECTION, objectToFsFields(entry), accessToken || (await getAccessToken()));
  } catch (error) {
    console.warn("[admin-audit] firestore write failed:", error?.message || error);
  }
}

async function verifyMasterAdminRequest(req) {
  const token = parseBearerToken(req);
  if (!token || !firebaseAuth) return null;
  try {
    const decoded = await firebaseAuth.verifyIdToken(token);
    if (!authTrust.isTrustedIdentity(decoded, ALLOWED_SIGN_IN_PROVIDERS)) return null;
    return adminAccess.hasRole(decoded, "master_admin") ? decoded : null;
  } catch (_e) {
    return null;
  }
}

// Returns {session} when a valid view-as header is present, {error,status} when present but invalid, null when absent.
async function readViewAsSession(req) {
  if (!MASTER_ADMIN_ENABLED) return null;
  const raw = req.headers["x-view-as-session"];
  if (!raw) return null;
  if (VIEW_AS_SECRET.length < 32) return { status: 503, error: "view-as not configured" };
  const session = adminAccess.verify(String(raw), VIEW_AS_SECRET);
  if (!session) return { status: 401, error: "view-as session invalid or expired" };
  const actor = await verifyMasterAdminRequest(req);
  if (!actor || actor.uid !== session.actor) return { status: 403, error: "view-as session belongs to another admin" };
  return { session, actor };
}

async function resolveRequestContext(req, accessToken) {
  const viewAs = await readViewAsSession(req);
  if (!viewAs) return resolveRequestContextInner(req, accessToken);
  if (!viewAs.session) {
    const err = new Error(viewAs.error);
    err.status = viewAs.status;
    throw err;
  }
  const { session } = viewAs;
  let subject = { uid: session.subject };
  try {
    const rec = await firebaseAuth.getUser(session.subject);
    subject = { uid: rec.uid, email: rec.email || "", name: rec.displayName || "", picture: rec.photoURL || "" };
  } catch (_e) {}
  const context = await resolveRequestContextInner(req, accessToken, subject);
  return {
    ...context,
    viewAs: {
      sessionId: session.sessionId,
      actorUid: session.actor,
      subjectUid: session.subject,
      subjectName: subject.name || subject.email || session.subject,
      mode: session.mode,
      startedAt: session.startedAt,
      exp: session.exp,
    },
  };
}

if (MASTER_ADMIN_ENABLED) {
  // Every request during a view-as session is audited; writes are blocked in read-only mode.
  app.use(async (req, res, next) => {
    if (!req.headers["x-view-as-session"]) return next();
    if (req.path === "/api/admin/view-as/end") return next();
    const viewAs = await readViewAsSession(req);
    if (!viewAs || !viewAs.session) return res.status(viewAs?.status || 401).json({ ok: false, error: viewAs?.error || "invalid view-as session" });
    const blocked = viewAs.session.mode === "read_only" && ["POST", "PUT", "PATCH", "DELETE"].includes(req.method.toUpperCase());
    writeAdminAudit(adminAccess.auditEntry(viewAs.session, blocked ? "write_blocked" : "request", req)).catch(() => {});
    if (blocked) return res.status(403).json({ ok: false, error: "read-only view-as session: changes are blocked" });
    res.setHeader("x-view-as-active", "1");
    return next();
  });

  app.get("/api/admin/whoami", async (req, res) => {
    const actor = await verifyMasterAdminRequest(req);
    res.json({ ok: true, enabled: true, masterAdmin: Boolean(actor) });
  });

  app.get("/api/admin/view-as/users", async (req, res) => {
    const actor = await verifyMasterAdminRequest(req);
    if (!actor) return res.status(403).json({ ok: false, error: "master_admin required" });
    try {
      const q = String(req.query.q || "").trim().toLowerCase();
      const page = await firebaseAuth.listUsers(1000);
      const users = page.users
        .filter((u) => u.uid !== actor.uid)
        .filter((u) => !q || (u.email || "").toLowerCase().includes(q) || (u.displayName || "").toLowerCase().includes(q))
        .slice(0, 50)
        .map((u) => ({ uid: u.uid, email: u.email || "", displayName: u.displayName || "" }));
      res.json({ ok: true, users });
    } catch (error) {
      res.status(500).json({ ok: false, error: "could not list users" });
    }
  });

  app.post("/api/admin/view-as/start", async (req, res) => {
    const actor = await verifyMasterAdminRequest(req);
    if (!actor) return res.status(403).json({ ok: false, error: "master_admin required" });
    if (VIEW_AS_SECRET.length < 32) return res.status(503).json({ ok: false, error: "view-as not configured" });
    try {
      const { token, session } = adminAccess.startImpersonation({
        actorUid: actor.uid,
        actorClaims: actor,
        subjectUid: String(req.body?.subjectUid || ""),
        reason: req.body?.reason,
        secret: VIEW_AS_SECRET,
        mode: "read_only",
      });
      await firebaseAuth.getUser(session.subject);
      await writeAdminAudit({ ...adminAccess.auditEntry(session, "session_start", req), reason: session.reason });
      res.json({ ok: true, token, session });
    } catch (error) {
      res.status(error?.status || 400).json({ ok: false, error: error?.message || "could not start view-as" });
    }
  });

  app.post("/api/admin/view-as/end", async (req, res) => {
    const session = adminAccess.verify(String(req.headers["x-view-as-session"] || ""), VIEW_AS_SECRET);
    if (session) await writeAdminAudit(adminAccess.auditEntry(session, "session_end", req));
    res.json({ ok: true });
  });
} else {
  app.get("/api/admin/whoami", (_req, res) => res.json({ ok: true, enabled: false, masterAdmin: false }));
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

function canonicalAccountLabel(rawHandle = "", rawLabel = "") {
  const handle = String(rawHandle || "").trim();
  const label = String(rawLabel || "").trim();
  const picked = label || handle;
  if (!picked) return "";
  return SUNO_ACCOUNT_LABEL_ALIASES[picked] || SUNO_ACCOUNT_LABEL_ALIASES[handle] || picked;
}

function resolvePublishChannelFromSongDoc(songDoc) {
  const handle = fsString(songDoc, "handle") || fsString(songDoc, "account_handle");
  const label = canonicalAccountLabel(handle, fsString(songDoc, "account_label"));
  if (label === "vanessa_secondary") return "vanessa_secondary";
  if (label === "vanessa_primary") return "vanessa_primary";
  const sourceId = fsString(songDoc, "account_sourceId") || fsString(songDoc, "sourceId");
  if (sourceId.includes("nessihenize")) return "vanessa_secondary";
  if (sourceId.includes("unshakableechos2341")) return "vanessa_primary";
  return "vanessa_primary";
}

async function loadLatestSourceSong(accessToken) {
  const snapshot = await loadLatestSourceSnapshot(accessToken);
  return snapshot.latestSourceSong;
}

async function listActiveHarvestSources(accessToken) {
  const results = await fsRunQuery(
    {
      structuredQuery: {
        from: [{ collectionId: SOURCES_COLLECTION }],
        where: {
          fieldFilter: {
            field: { fieldPath: "harvestEnabled" },
            op: "EQUAL",
            value: { booleanValue: true },
          },
        },
        limit: 50,
      },
    },
    accessToken
  );
  return results.filter((row) => row.document).map((row) => row.document);
}

async function loadLatestSongForSource(sourceId, accessToken) {
  if (!sourceId) return null;
  let results;
  try {
    results = await queryLatestSongsForSource(sourceId, "createdAt", 1, accessToken);
  } catch (error) {
    // sunoSongs has a (sourceId, importedAt) composite index but not
    // (sourceId, createdAt). Without it Firestore returns FAILED_PRECONDITION,
    // which used to 500 /api/vault/freshness and /api/admin/overview.
    // Fall back to the indexed field and pick the newest createdAt in memory.
    console.warn(`[freshness] createdAt query failed for ${sourceId}; falling back to importedAt: ${error?.message || error}`);
    results = await queryLatestSongsForSource(sourceId, "importedAt", 50, accessToken);
  }
  const doc = pickNewestByCreatedAt(
    results.filter((row) => row.document).map((row) => row.document),
    (candidate) => fsTimestamp(candidate, "createdAt")
  );
  if (!doc) return null;
  return {
    songKey: fsString(doc, "songKey"),
    title: fsString(doc, "title"),
    createdAt: fsTimestamp(doc, "createdAt"),
    status: fsString(doc, "status") || "active",
    accountHandle:
      fsString(doc, "account_handle") ||
      fsString(doc, "account_label") ||
      fsString(doc, "handle"),
    sourceId,
  };
}

async function queryLatestSongsForSource(sourceId, orderField, limit, accessToken) {
  return fsRunQuery(
    {
      structuredQuery: {
        from: [{ collectionId: SONG_COLLECTION }],
        where: {
          fieldFilter: {
            field: { fieldPath: "sourceId" },
            op: "EQUAL",
            value: { stringValue: sourceId },
          },
        },
        orderBy: [{ field: { fieldPath: orderField }, direction: "DESCENDING" }],
        limit,
      },
    },
    accessToken
  );
}

async function loadLatestSourceSnapshot(accessToken) {
  const sourceDocs = await listActiveHarvestSources(accessToken);
  const accounts = [];
  for (const sourceDoc of sourceDocs) {
    const sourceId = sourceDoc.name?.split("/").pop() || "";
    const handle = fsString(sourceDoc, "handle");
    const accountLabel =
      fsString(sourceDoc, "accountLabel") ||
      canonicalAccountLabel(handle) ||
      handle;
    let latest = null;
    let latestError = "";
    try {
      latest = await loadLatestSongForSource(sourceId, accessToken);
    } catch (error) {
      // One bad source must not take the whole freshness/overview endpoint down.
      latestError = String(error?.message || error);
      console.error(`[freshness] latest-song lookup failed for ${sourceId}: ${latestError}`);
    }
    const ingestionMode = fsString(sourceDoc, "ingestionMode") || "public_profile";
    const authorityStatus = fsString(sourceDoc, "authorityStatus") || "partial_source";
    const isAuthoritative =
      ["owned_library", "official_export"].includes(ingestionMode) &&
      authorityStatus === "verified";
    accounts.push({
      ...(latest || {}),
      handle,
      accountLabel,
      sourceId,
      ingestionMode,
      authorityStatus,
      isAuthoritative,
      lastSourceError: fsString(sourceDoc, "lastSourceError"),
      ...(latestError ? { latestLookupError: latestError } : {}),
    });
  }

  accounts.sort(
    (left, right) => Date.parse(right.createdAt || "") - Date.parse(left.createdAt || "")
  );
  const timestamps = accounts
    .map((account) => Date.parse(account.createdAt || ""))
    .filter((value) => Number.isFinite(value));
  const newestCreatedAt =
    timestamps.length > 0 ? new Date(Math.max(...timestamps)).toISOString() : "";

  return {
    accounts,
    newestCreatedAt,
    createdAt: newestCreatedAt,
    latestSourceSong: accounts[0] || null,
  };
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
  return Array.isArray(tierCatalogConfig?.tiers) ? tierCatalogConfig.tiers : [];
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

function canonicalPlanKey(planId) {
  const normalizedPlanId = normalizePlanKey(planId);
  const legacyAliases = {
    "studio-monthly": "producer-monthly",
  };
  return legacyAliases[normalizedPlanId] || normalizedPlanId;
}

function findSignupTierByPlanId(planId) {
  const normalizedPlanId = canonicalPlanKey(planId);
  return buildSignupCatalog().find((tier) => {
    return (
      normalizePlanKey(tier.id) === normalizedPlanId ||
      canonicalPlanKey(tier.defaultPlanId) === normalizedPlanId
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
    if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
      next[key] = value;
    }
  }

  return next;
}

function normalizeTierDomains(domains) {
  if (!Array.isArray(domains)) return [];
  return domains
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);
}

function classifyRequestDomain(req) {
  const hostHeader = String(req?.headers?.["x-forwarded-host"] || req?.headers?.host || "")
    .split(",")[0]
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "");

  const hostname = hostHeader || "";
  if (!hostname) return null;

  if (hostname === CLOUD_HOSTNAME || hostname === "sundrop.cloud" || hostname.startsWith("cloud.")) {
    return "sundrop.cloud";
  }

  if (hostname === MUSIC_HOSTNAME || hostname === "sundrop.music" || hostname.startsWith("music.")) {
    return "sundrop.music";
  }

  return null;
}

function contextAllowsCurrentDomain(context, req) {
  const currentDomain = classifyRequestDomain(req);
  if (!currentDomain) {
    return {
      current: null,
      activeWorkspaceAllowed: true,
      activeWorkspaceDomains: normalizeTierDomains(context?.activeWorkspace?.domains),
    };
  }

  if (context?.platformAdmin || context?.legacyMode) {
    return {
      current: currentDomain,
      activeWorkspaceAllowed: true,
      activeWorkspaceDomains: normalizeTierDomains(context?.activeWorkspace?.domains),
    };
  }

  const allowedDomains = normalizeTierDomains(context?.activeWorkspace?.domains);
  return {
    current: currentDomain,
    activeWorkspaceAllowed:
      allowedDomains.length === 0 ? true : allowedDomains.includes(currentDomain),
    activeWorkspaceDomains: allowedDomains,
  };
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
    domains: normalizeTierDomains(tier?.domains || fsValueToJs(workspaceDoc.fields?.domains)),
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
    const tier = findSignupTierByPlanId("artist") || buildSignupCatalog()[0];
    await fsSetDoc(
      fsDocNameFromPath(targetWorkspacePath),
      objectToFsFields({
        name: workspaceName,
        slug: slugifyWorkspaceName(workspaceName || localPart) || workspaceId,
        ownerUid: decodedToken.uid,
        planId: tier?.defaultPlanId || "artist",
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
    const requestedTier = BETA_SIGNUP_ONLY ? rawRequestedTier : rawRequestedTier;
    if (!isAllowedPublicSignupTier(requestedTier)) {
      return res.status(400).json({ ok: false, error: "Only beta applications are open right now." });
    }

    const requestedWorkspaceName = String(req.body?.requestedWorkspaceName || "").trim();
    const sunoHandle = String(req.body?.sunoHandle || "").trim();
    const sunoProfileUrl = sanitizeBetaApplicationUrl(req.body?.sunoProfileUrl);
    const youtubeChannelUrl = sanitizeBetaApplicationUrl(req.body?.youtubeChannelUrl);
    const intendedUse = String(req.body?.intendedUse || "").trim();
    const preferredUpgradePlanId = String(req.body?.preferredUpgradePlanId || "creator-monthly").trim() || "creator-monthly";

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
    const tier = findSignupTierByPlanId(req.body?.planId || "artist");
    const now = new Date().toISOString();
    const workspaceDocName = fsDocNameFromPath(`workspaces/${workspaceId}`);
    await fsSetDoc(
      workspaceDocName,
      objectToFsFields({
        name,
        slug,
        ownerUid,
        planId: String(req.body?.planId || "artist"),
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

    const [queueCounts, exportMeta, pendingCount, recentAccessRequests, catalogHealth, accessRequestSummary, latestSourceSnapshot] = await Promise.all([
      getQueueCounts(accessToken),
      loadExportMeta(),
      countPendingAccessRequests(accessToken),
      listRecentAccessRequests(accessToken, 8),
      inspectCatalogHealth(),
      summarizeAccessRequests(accessToken),
      loadLatestSourceSnapshot(accessToken),
    ]);
    const exportFreshness = summarizeExportFreshness({
      exportMeta,
      catalogHealth,
      latestSource: latestSourceSnapshot,
    });

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
      exportFreshness,
      latestSourceSong: latestSourceSnapshot.latestSourceSong,
      sourceAccounts: latestSourceSnapshot.accounts || [],
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

app.get("/api/vault/freshness", async (req, res) => {
  try {
    const accessToken = await getAccessToken();
    const context = await resolveRequestContext(req, accessToken);
    if (!requireOperatorAccess(context, res)) return;

    const [exportMeta, catalogHealth, latestSourceSnapshot] = await Promise.all([
      loadExportMeta(),
      inspectCatalogHealth(),
      loadLatestSourceSnapshot(accessToken),
    ]);
    const exportFreshness = summarizeExportFreshness({
      exportMeta,
      catalogHealth,
      latestSource: latestSourceSnapshot,
    });

    return res.json({
      ok: true,
      exportArtifact: {
        generatedAt: exportMeta?.generatedAt || "",
        rowCount: Number(exportMeta?.rowCount || 0),
        generator: exportMeta?.generator || "",
        artifact: exportMeta?.artifact || "",
      },
      exportFreshness,
      latestSourceSong: latestSourceSnapshot.latestSourceSong,
      sourceAccounts: latestSourceSnapshot.accounts || [],
      catalogHealth,
    });
  } catch (error) {
    console.error(`[freshness] /api/vault/freshness failed: ${error?.stack || error}`);
    return res.status(500).json({
      ok: false,
      error: `vault-freshness failed: ${error?.message || error}`,
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
      String(req.body?.betaMigrationTargetPlanId || fsString(requestDoc, "preferredUpgradePlanId") || "creator-monthly").trim() ||
      "creator-monthly";
    const tierDefaults = signupTierDefaults(requestedTier, requestKind);
    const tier = findSignupTierByPlanId(req.body?.planId || tierDefaults.planId || requestedTier || "artist");
    const workspaceMode = String(req.body?.workspaceMode || tierDefaults.workspaceMode || "legacy").trim();
    const role = sanitizeWorkspaceRole(req.body?.role || tierDefaults.role || "viewer");
    const planId = String(req.body?.planId || tierDefaults.planId || requestedTier || "artist").trim();
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
    const requestedSongKeys = Array.isArray(req.body?.songKeys)
      ? [...new Set(req.body.songKeys.map((value) => String(value || "").trim()).filter(Boolean))]
      : [];
    const requestedAccountHandle = String(req.body?.accountHandle || "").trim();
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

    const existingJobs = await getAccessibleCatalogExportJobs(context, accessToken);
    const existingJob = existingJobs.find(
      (job) =>
        job.workspaceId === targetWorkspace.workspaceId &&
        job.ownerUid === context.user.uid &&
        job.requestSignature === buildCatalogExportSignature({
          workspaceId: targetWorkspace.workspaceId,
          songKeys: requestedSongKeys,
          accountHandle: requestedAccountHandle,
        }) &&
        ["preparing", "building", "ready"].includes(job.status) &&
        Date.parse(job.expiresAt || "") > Date.now()
    );

    if (existingJob) {
      return res.json(serializeCatalogExportJob(existingJob));
    }

    const job = createCatalogExportJob({
      workspaceId: targetWorkspace.workspaceId,
      ownerUid: context.user.uid,
      requestedByUid: context.user.uid,
      songKeys: requestedSongKeys,
      accountHandle: requestedAccountHandle,
    });

    try {
      // Do not begin a long-running package build until its durable recovery
      // record exists. A revision restart can then resume/report it instead of
      // making the customer package disappear from Downloads.
      await persistCatalogExportJob(job);
      job._persistCommittedRevision = Number(job._persistRevision || 0);
    } catch (error) {
      catalogExportJobs.delete(job.exportId);
      return res.status(503).json({
        ok: false,
        error: `Unable to record this download request safely: ${error?.message || error}`,
      });
    }

    void runCatalogExportJob(job, { ...context, activeWorkspace: targetWorkspace }, accessToken).catch((error) => {
      setCatalogExportProgress(job, {
        status: job.parts?.length || job.manifestObject || job.summaryObject ? "partial" : "error",
        phaseLabel: job.parts?.length || job.manifestObject || job.summaryObject ? "Partially ready" : "Failed",
        progressMessage: job.parts?.length || job.manifestObject || job.summaryObject
          ? "Some verified package files are ready below. The remaining package build failed, so start a fresh package for a complete set."
          : "This package did not finish successfully.",
        error: error?.message || String(error),
      });
      void persistCatalogExportJob(job).catch((persistError) => {
        console.error(`[catalog-export] Persisting failed job ${job.exportId} failed: ${persistError?.message || persistError}`);
      });
    });

    return res.status(202).json(serializeCatalogExportJob(job));
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: `catalog-export failed: ${error?.message || error}`,
    });
  }
});

app.get("/api/catalog-exports", async (req, res) => {
  try {
    cleanupExpiredCatalogExports();
    const accessToken = await getAccessToken();
    const context = await resolveRequestContext(req, accessToken);
    if (!requireVaultAccess(context, res)) return;

    const jobs = await getAccessibleCatalogExportJobs(context, accessToken);

    return res.json({
      ok: true,
      jobs: jobs.map((job) => serializeCatalogExportJob(job)),
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: `catalog-exports failed: ${error?.message || error}`,
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
    const job = await getCatalogExportJob(exportId, context, accessToken);
    if (!job) {
      return res.status(404).json({ ok: false, error: "Export job not found or expired." });
    }
    if (!canAccessCatalogExport(job, context)) {
      return res.status(403).json({ ok: false, error: "You do not have access to that export." });
    }

    return res.json(serializeCatalogExportJob(job));
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
    const job = await getCatalogExportJob(exportId, context, accessToken);
    if (!job || (!job.manifestObject && (!job.manifestPath || !fs.existsSync(job.manifestPath)))) {
      return res.status(404).json({ ok: false, error: "Manifest not found or expired." });
    }
    if (!canAccessCatalogExport(job, context)) {
      return res.status(403).json({ ok: false, error: "You do not have access to that export." });
    }

    res.set("Cache-Control", "private, no-store");
    const baseFileName = buildCatalogExportBaseFileName(job, {
      workspaceId: context?.activeWorkspace?.workspaceId || job.workspaceId,
      workspaceName: context?.activeWorkspace?.name || job.summary?.workspaceName || job.workspaceId,
    });
    res.set("Content-Disposition", `attachment; filename="${baseFileName}.csv"`);
    res.type("text/csv");
    const stream = job.manifestObject
      ? storage.bucket(BUCKET).file(job.manifestObject).createReadStream()
      : fs.createReadStream(job.manifestPath);
    stream.on("error", (error) => {
      if (!res.headersSent) {
        res.status(500).json({ ok: false, error: `catalog-export-manifest failed: ${error?.message || error}` });
      } else {
        res.destroy(error);
      }
    });
    stream.pipe(res);
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
    const job = await getCatalogExportJob(exportId, context, accessToken);
    if (!job || (!job.summaryObject && (!job.summaryPath || !fs.existsSync(job.summaryPath)))) {
      return res.status(404).json({ ok: false, error: "Summary not found or expired." });
    }
    if (!canAccessCatalogExport(job, context)) {
      return res.status(403).json({ ok: false, error: "You do not have access to that export." });
    }

    res.set("Cache-Control", "private, no-store");
    const baseFileName = buildCatalogExportBaseFileName(job, {
      workspaceId: context?.activeWorkspace?.workspaceId || job.workspaceId,
      workspaceName: context?.activeWorkspace?.name || job.summary?.workspaceName || job.workspaceId,
    });
    res.set("Content-Disposition", `attachment; filename="${baseFileName}-summary.json"`);
    res.type("application/json");
    const stream = job.summaryObject
      ? storage.bucket(BUCKET).file(job.summaryObject).createReadStream()
      : fs.createReadStream(job.summaryPath);
    stream.on("error", (error) => {
      if (!res.headersSent) {
        res.status(500).json({ ok: false, error: `catalog-export-summary failed: ${error?.message || error}` });
      } else {
        res.destroy(error);
      }
    });
    stream.pipe(res);
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
    const job = await getCatalogExportJob(exportId, context, accessToken);
    if (!job) {
      return res.status(404).json({ ok: false, error: "Export job not found or expired." });
    }
    if (!canAccessCatalogExport(job, context)) {
      return res.status(403).json({ ok: false, error: "You do not have access to that export." });
    }

    const part = (job.parts || []).find((entry) => entry.partName === partName);
    const hasLocalPart = part?.filePath && fs.existsSync(part.filePath);
    if (!part || (!part.objectName && !hasLocalPart)) {
      return res.status(404).json({ ok: false, error: "Export part not found." });
    }

    res.set("Cache-Control", "private, no-store");
    res.set("Content-Disposition", `attachment; filename="${part.fileName}"`);
    res.type("application/zip");
    const stream = part.objectName
      ? storage.bucket(BUCKET).file(part.objectName).createReadStream()
      : fs.createReadStream(part.filePath);
    stream.on("error", (error) => {
      if (!res.headersSent) {
        res.status(500).json({ ok: false, error: `catalog-export-part failed: ${error?.message || error}` });
      } else {
        res.destroy(error);
      }
    });
    stream.pipe(res);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: `catalog-export-part failed: ${error?.message || error}`,
    });
  }
});

// Title overrides (best-guess titles + owner edits), applied at serve time.
const titleOverridesModule = require("./title-overrides.cjs");
const TITLE_OVERRIDES_OBJECT = process.env.TITLE_OVERRIDES_OBJECT || "exports/suno/state/title_overrides.json";
const titleOverrides = titleOverridesModule.createTitleOverrides({
  adapter: titleOverridesModule.gcsAdapter(storage, BUCKET, TITLE_OVERRIDES_OBJECT),
  ttlMs: Number(process.env.TITLE_OVERRIDES_TTL_MS || 15000),
});
async function loadCatalogWithTitles() {
  return titleOverrides.applyToCatalog(await loadCatalogCsv());
}
titleOverridesModule.installTitleRoutes(app, {
  titles: titleOverrides,
  loadCatalogCsv,
  rateLimit: createRateLimiter({ windowMs: 60000, max: 30 }),
  // Strictest existing role: platform admins (the owner) only, never inside a "view as" session.
  authorize: async (req, res) => {
    const accessToken = await getAccessToken();
    const context = await resolveRequestContext(req, accessToken);
    if (!requireVaultAccess(context, res)) return null;
    if (context.viewAs) {
      res.status(403).json({ ok: false, error: "Titles cannot be edited while viewing as another user." });
      return null;
    }
    if (!context.platformAdmin) {
      res.status(403).json({ ok: false, error: "Only the Vault owner can edit titles." });
      return null;
    }
    return { uid: context.user?.uid || "", email: context.user?.email || "" };
  },
  audit: (entry) => writeAdminAudit({ logName: "song-title-audit", ...entry }),
});

app.get("/catalog.csv", async (req, res) => {
  try {
    const accessToken = await getAccessToken();
    const context = await resolveRequestContext(req, accessToken);
    if (!requireVaultAccess(context, res)) return;
    const loaded = await loadCatalogWithTitles();
    const text = loaded.buffer.toString("utf8");
    const inspection = buildCatalogInspection(loaded.source, text);
    console.log(
      `[catalog.csv] served source=${loaded.source} rows=${inspection.rowCount} newest=${inspection.newestCreatedAt || "unknown"}`
    );
    res.set("Cache-Control", "private, no-store");
    res.set("X-Catalog-Source", loaded.source);
    res.set("X-Catalog-Row-Count", String(inspection.rowCount || 0));
    res.set("X-Catalog-Newest", inspection.newestCreatedAt || "");
    // Compressed when the browser accepts it (lyrics compress ~4x).
    progressiveCatalog.sendCsv(req, res, loaded.buffer);
  } catch (e) {
    res.status(500).type("text/plain").send("Failed to load catalog.csv: " + (e?.message || e));
  }
});

// Progressive loading: /catalog-light.csv (no lyrics/prompt) + /api/song-text/:songKey.
const progressiveCatalog = require("./catalog-progressive.cjs").createProgressiveCatalog({
  loadCatalogCsv: loadCatalogWithTitles,
  authorize: async (req, res) => {
    const accessToken = await getAccessToken();
    const context = await resolveRequestContext(req, accessToken);
    return requireVaultAccess(context, res);
  },
});
progressiveCatalog.install(app);

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
    const publishChannel = resolvePublishChannelFromSongDoc(songDoc);

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
        ytPublishChannel: { stringValue: publishChannel },
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
app.get("/login", (_req, res) => {
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
