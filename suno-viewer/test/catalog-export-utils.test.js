const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_CATALOG_EXPORT_TTL_MS,
  buildCatalogExportBaseFileName,
  catalogExportScopeDetails,
  hydrateCatalogExportParts,
  migrateLegacyCatalogExportExpiry,
} = require("../catalog-export-utils");

test("catalogExportScopeDetails maps customer-facing labels for all request scopes", () => {
  assert.deepEqual(
    catalogExportScopeDetails({ requestScope: "song", requestSongKeys: ["song-1"] }),
    {
      requestScope: "song",
      scopeLabel: "Single song",
      requestLabel: "Single-song package",
      selectionCount: 1,
    }
  );

  assert.deepEqual(
    catalogExportScopeDetails({ requestScope: "selection", requestSongKeys: ["song-1", "song-2"] }),
    {
      requestScope: "selection",
      scopeLabel: "2 selected songs",
      requestLabel: "Selected songs package",
      selectionCount: 2,
    }
  );

  assert.deepEqual(
    catalogExportScopeDetails({ requestScope: "catalog", requestSongKeys: [] }),
    {
      requestScope: "catalog",
      scopeLabel: "Full catalog",
      requestLabel: "Full catalog package",
      selectionCount: 0,
    }
  );
});

test("hydrateCatalogExportParts restores download URLs for persisted ready jobs", () => {
  const hydrated = hydrateCatalogExportParts({
    exportId: "exp123",
    parts: [
      {
        partName: "catalog_part_01.zip",
        fileName: "catalog_part_01.zip",
        objectName: "exports/catalog-jobs/exp123/parts/catalog_part_01.zip",
      },
      {
        partName: "catalog_part_02.zip",
        fileName: "",
        objectName: "exports/catalog-jobs/exp123/parts/catalog_part_02.zip",
      },
    ],
  });

  assert.equal(hydrated[0].downloadUrl, "/api/catalog-export/exp123/parts/catalog_part_01.zip");
  assert.equal(hydrated[0].fileName, "catalog_part_01.zip");
  assert.equal(hydrated[1].downloadUrl, "/api/catalog-export/exp123/parts/catalog_part_02.zip");
  assert.equal(hydrated[1].fileName, "catalog_part_02.zip");
});

test("hydrateCatalogExportParts preserves intentionally blank download URLs", () => {
  const hydrated = hydrateCatalogExportParts({
    exportId: "exp123",
    parts: [
      {
        partName: "catalog_part_01.zip",
        downloadUrl: "",
      },
    ],
  });

  assert.equal(hydrated[0].downloadUrl, "");
});

test("buildCatalogExportBaseFileName creates customer-style filenames by scope", () => {
  assert.equal(
    buildCatalogExportBaseFileName(
      { workspaceId: "ws-1", requestScope: "song", requestSongKeys: ["song-1"] },
      { workspaceName: "Aeonimus AI-gml" }
    ),
    "Aeonimus AI-gml-single-song-package"
  );

  assert.equal(
    buildCatalogExportBaseFileName(
      { workspaceId: "ws-1", requestScope: "selection", requestSongKeys: ["song-1", "song-2", "song-3"] },
      { workspaceName: "Aeonimus AI-gml" }
    ),
    "Aeonimus AI-gml-3-song-package"
  );

  assert.equal(
    buildCatalogExportBaseFileName(
      { workspaceId: "ws-1", requestScope: "catalog", requestSongKeys: [] },
      { workspaceName: "Aeonimus AI-gml" }
    ),
    "Aeonimus AI-gml-full-catalog-package"
  );
});

test("migrateLegacyCatalogExportExpiry extends one-day package records to the customer window", () => {
  const createdAt = "2026-08-17T00:00:00.000Z";
  const legacyExpiry = "2026-08-18T00:00:00.000Z";
  const result = migrateLegacyCatalogExportExpiry(
    { exportId: "exp123", createdAt, expiresAt: legacyExpiry },
    Date.parse("2026-08-17T12:00:00.000Z")
  );

  assert.equal(result.migrated, true);
  assert.equal(
    result.job.expiresAt,
    new Date(Date.parse(createdAt) + DEFAULT_CATALOG_EXPORT_TTL_MS).toISOString()
  );
});

test("migrateLegacyCatalogExportExpiry leaves custom and already-expired records unchanged", () => {
  const custom = migrateLegacyCatalogExportExpiry({
    exportId: "custom",
    createdAt: "2026-08-17T00:00:00.000Z",
    expiresAt: "2026-08-24T00:00:00.000Z",
  }, Date.parse("2026-08-17T12:00:00.000Z"));
  assert.equal(custom.migrated, false);

  const expired = migrateLegacyCatalogExportExpiry({
    exportId: "expired",
    createdAt: "2026-08-01T00:00:00.000Z",
    expiresAt: "2026-08-02T00:00:00.000Z",
  }, Date.parse("2026-08-17T12:00:00.000Z"));
  assert.equal(expired.migrated, false);
});
