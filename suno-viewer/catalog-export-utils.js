const ACCOUNT_DISPLAY_NAMES = {
  vanessa_primary: "unshakableechos2341",
  vanessa_secondary: "nessihenize",
};

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CATALOG_EXPORT_TTL_MS = 10 * DAY_MS;
const LEGACY_CATALOG_EXPORT_TTL_MS = DAY_MS;
const LEGACY_EXPIRY_TOLERANCE_MS = 5 * 60 * 1000;

const accountDisplayName = (accountHandle) => ACCOUNT_DISPLAY_NAMES[accountHandle] || accountHandle;

function catalogExportScopeDetails(job) {
  const requestScope = String(job?.requestScope || "catalog");
  const accountHandle = String(job?.requestAccountHandle || "").trim();
  const accountLabel = accountDisplayName(accountHandle);
  const selectionCount = Array.isArray(job?.requestSongKeys) ? job.requestSongKeys.length : 0;
  if (requestScope === "song") {
    return {
      requestScope: "song",
      scopeLabel: "Single song",
      requestLabel: "Single-song package",
      selectionCount: Math.max(selectionCount, 1),
    };
  }
  if (requestScope === "selection") {
    return {
      requestScope: "selection",
      scopeLabel: `${selectionCount.toLocaleString()} selected song${selectionCount === 1 ? "" : "s"}`,
      requestLabel: "Selected songs package",
      selectionCount,
    };
  }
  return {
    requestScope: "catalog",
    scopeLabel: accountHandle ? `Full catalog · ${accountLabel}` : "Full catalog",
    requestLabel: accountHandle ? `Full catalog package · ${accountLabel}` : "Full catalog package",
    selectionCount: 0,
  };
}

function safeFilePart(value, fallback = "untitled") {
  const cleaned = String(value || "")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? cleaned.slice(0, 80) : fallback;
}

function buildCatalogExportBaseFileName(job, context = {}) {
  const workspaceName = safeFilePart(
    context.workspaceName || context.workspaceId || job?.workspaceId || "workspace",
    "workspace"
  );
  const scope = catalogExportScopeDetails(job);
  if (scope.requestScope === "song") {
    return `${workspaceName}-single-song-package`;
  }
  if (scope.requestScope === "selection") {
    return `${workspaceName}-${scope.selectionCount || 0}-song-package`;
  }
  return `${workspaceName}-full-catalog-package`;
}

function hydrateCatalogExportParts(job) {
  return Array.isArray(job?.parts)
    ? job.parts.map((part) => ({
        ...part,
        fileName: part.fileName || part.partName,
        downloadUrl: Object.prototype.hasOwnProperty.call(part, "downloadUrl")
          ? part.downloadUrl
          : (part.partName
              ? `/api/catalog-export/${job.exportId}/parts/${encodeURIComponent(part.partName)}`
              : ""),
      }))
    : [];
}

function migrateLegacyCatalogExportExpiry(job, now = Date.now()) {
  const createdAt = Date.parse(job?.createdAt || "");
  const expiresAt = Date.parse(job?.expiresAt || "");
  if (!createdAt || !expiresAt) {
    return { job, migrated: false };
  }

  const lifetime = expiresAt - createdAt;
  const isLegacyOneDayWindow = Math.abs(lifetime - LEGACY_CATALOG_EXPORT_TTL_MS) <= LEGACY_EXPIRY_TOLERANCE_MS;
  if (!isLegacyOneDayWindow || createdAt + DEFAULT_CATALOG_EXPORT_TTL_MS <= now) {
    return { job, migrated: false };
  }

  return {
    job: {
      ...job,
      expiresAt: new Date(createdAt + DEFAULT_CATALOG_EXPORT_TTL_MS).toISOString(),
    },
    migrated: true,
  };
}

module.exports = {
  DEFAULT_CATALOG_EXPORT_TTL_MS,
  buildCatalogExportBaseFileName,
  catalogExportScopeDetails,
  hydrateCatalogExportParts,
  migrateLegacyCatalogExportExpiry,
};
