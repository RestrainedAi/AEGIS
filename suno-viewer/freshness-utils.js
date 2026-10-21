function parseIsoTimestamp(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function summarizeExportFreshness({
  exportMeta = null,
  catalogHealth = null,
  latestSource = null,
  now = new Date(),
  staleHours = 26,
} = {}) {
  const generatedAt = String(exportMeta?.generatedAt || "").trim();
  const generatedAtMs = parseIsoTimestamp(generatedAt);
  const nowMs = now instanceof Date ? now.getTime() : parseIsoTimestamp(now);
  const servingSource = catalogHealth?.servingSource || "unavailable";
  const servedInspection =
    servingSource === "gcs"
      ? catalogHealth?.gcs
      : servingSource === "fallback"
        ? catalogHealth?.fallback
        : null;
  const servedRowCount = Number(servedInspection?.rowCount || 0);
  const exportRowCount = Number(exportMeta?.rowCount || 0);
  const newestServedCreatedAt = String(servedInspection?.newestCreatedAt || "").trim();
  const latestSourceCreatedAt = String(
    latestSource?.newestCreatedAt ||
      latestSource?.createdAt ||
      ""
  ).trim();
  const latestSourceCreatedAtMs = parseIsoTimestamp(latestSourceCreatedAt);
  const newestServedCreatedAtMs = parseIsoTimestamp(newestServedCreatedAt);
  const sourceContentAgeHours =
    latestSourceCreatedAtMs != null && nowMs != null
      ? Number(((nowMs - latestSourceCreatedAtMs) / 36e5).toFixed(2))
      : null;
  const hoursSinceGeneratedAt =
    generatedAtMs != null && nowMs != null
      ? Number(((nowMs - generatedAtMs) / 36e5).toFixed(2))
      : null;
  const sourceLeadHours =
    latestSourceCreatedAtMs != null && newestServedCreatedAtMs != null
      ? Number(((latestSourceCreatedAtMs - newestServedCreatedAtMs) / 36e5).toFixed(2))
      : null;

  if (!generatedAtMs || !nowMs) {
    return {
      status: "unavailable",
      label: "Export timestamp unavailable",
      detail: "The published catalog metadata does not include a valid generatedAt timestamp yet.",
      generatedAt,
      hoursSinceGeneratedAt,
      staleHours,
      servingSource,
      exportRowCount,
      servedRowCount,
      newestServedCreatedAt,
      latestSourceCreatedAt,
      sourceContentAgeHours,
      sourceLeadHours,
    };
  }

  if (!servedInspection) {
    return {
      status: "unavailable",
      label: "Catalog source unavailable",
      detail: "Neither the live export nor the local fallback snapshot is currently healthy.",
      generatedAt,
      hoursSinceGeneratedAt,
      staleHours,
      servingSource,
      exportRowCount,
      servedRowCount,
      newestServedCreatedAt,
      latestSourceCreatedAt,
      sourceContentAgeHours,
      sourceLeadHours,
    };
  }

  if (exportRowCount > 0 && servedRowCount > 0 && exportRowCount !== servedRowCount) {
    return {
      status: "mismatch",
      label: "Published row count mismatch",
      detail: `Metadata reports ${exportRowCount} rows while the served ${servingSource} catalog currently has ${servedRowCount}.`,
      generatedAt,
      hoursSinceGeneratedAt,
      staleHours,
      servingSource,
      exportRowCount,
      servedRowCount,
      newestServedCreatedAt,
      latestSourceCreatedAt,
      sourceLeadHours,
    };
  }

  if (hoursSinceGeneratedAt != null && hoursSinceGeneratedAt > staleHours) {
    return {
      status: "stale",
      label: "Catalog export is stale",
      detail: `The published catalog is ${hoursSinceGeneratedAt} hours old, which is beyond the ${staleHours}-hour freshness threshold.`,
      generatedAt,
      hoursSinceGeneratedAt,
      staleHours,
      servingSource,
      exportRowCount,
      servedRowCount,
      newestServedCreatedAt,
      latestSourceCreatedAt,
      sourceContentAgeHours,
      sourceLeadHours,
    };
  }

  if (sourceLeadHours != null && sourceLeadHours > staleHours) {
    return {
      status: "source_ahead",
      label: "Source truth is ahead of the published export",
      detail: `Firestore has newer song data than the served catalog by ${sourceLeadHours} hours, which is beyond the ${staleHours}-hour drift threshold.`,
      generatedAt,
      hoursSinceGeneratedAt,
      staleHours,
      servingSource,
      exportRowCount,
      servedRowCount,
      newestServedCreatedAt,
      latestSourceCreatedAt,
      sourceContentAgeHours,
      sourceLeadHours,
    };
  }

  return {
    status: "healthy",
    label: "Catalog is current",
    detail:
      sourceContentAgeHours != null && sourceContentAgeHours > staleHours
        ? `The published catalog was refreshed ${hoursSinceGeneratedAt} hours ago and matches the latest readable public source snapshot. No newer public Suno track has appeared in ${sourceContentAgeHours} hours.`
        : `The published catalog was refreshed ${hoursSinceGeneratedAt} hours ago and the served ${servingSource} row count matches metadata.`,
    generatedAt,
    hoursSinceGeneratedAt,
    staleHours,
    servingSource,
    exportRowCount,
    servedRowCount,
    newestServedCreatedAt,
    latestSourceCreatedAt,
    sourceContentAgeHours,
    sourceLeadHours,
  };
}

function pickNewestByCreatedAt(docs = [], getCreatedAt = (doc) => doc?.createdAt) {
  let best = null;
  let bestMs = -Infinity;
  for (const doc of docs || []) {
    if (!doc) continue;
    const ms = parseIsoTimestamp(getCreatedAt(doc));
    const score = ms == null ? -Infinity : ms;
    if (best === null || score > bestMs) {
      best = doc;
      bestMs = score;
    }
  }
  return best;
}

module.exports = {
  summarizeExportFreshness,
  pickNewestByCreatedAt,
};
