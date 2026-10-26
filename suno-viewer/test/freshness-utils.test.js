const test = require("node:test");
const assert = require("node:assert/strict");

const { summarizeExportFreshness } = require("../freshness-utils");

function baseCatalogHealth(overrides = {}) {
  return {
    servingSource: "gcs",
    gcs: {
      rowCount: 2451,
      newestCreatedAt: "2026-06-13T23:20:55.989Z",
      ...overrides.gcs,
    },
    fallback: {
      rowCount: 2451,
      newestCreatedAt: "2026-06-13T23:20:55.989Z",
      ...overrides.fallback,
    },
    ...overrides,
  };
}

test("summarizeExportFreshness reports healthy when export is recent and row counts align", () => {
  const summary = summarizeExportFreshness({
    exportMeta: {
      generatedAt: "2026-06-14T09:00:00Z",
      rowCount: 2451,
    },
    catalogHealth: baseCatalogHealth(),
    now: new Date("2026-06-14T12:00:00Z"),
    staleHours: 26,
  });

  assert.equal(summary.status, "healthy");
  assert.equal(summary.servingSource, "gcs");
  assert.equal(summary.exportRowCount, 2451);
  assert.equal(summary.servedRowCount, 2451);
  assert.equal(summary.hoursSinceGeneratedAt, 3);
});

test("summarizeExportFreshness reports stale when export age exceeds threshold", () => {
  const summary = summarizeExportFreshness({
    exportMeta: {
      generatedAt: "2026-06-10T09:00:00Z",
      rowCount: 2441,
    },
    catalogHealth: baseCatalogHealth({
      gcs: { rowCount: 2441 },
    }),
    now: new Date("2026-06-14T12:00:00Z"),
    staleHours: 26,
  });

  assert.equal(summary.status, "stale");
  assert.match(summary.detail, /beyond the 26-hour freshness threshold/i);
});

test("summarizeExportFreshness reports mismatch when metadata and served rows diverge", () => {
  const summary = summarizeExportFreshness({
    exportMeta: {
      generatedAt: "2026-06-14T09:00:00Z",
      rowCount: 2441,
    },
    catalogHealth: baseCatalogHealth({
      gcs: { rowCount: 2451 },
    }),
    now: new Date("2026-06-14T12:00:00Z"),
    staleHours: 26,
  });

  assert.equal(summary.status, "mismatch");
  assert.match(summary.detail, /metadata reports 2441 rows/i);
});

test("summarizeExportFreshness reports unavailable when generatedAt is missing", () => {
  const summary = summarizeExportFreshness({
    exportMeta: {
      generatedAt: "",
      rowCount: 2451,
    },
    catalogHealth: baseCatalogHealth(),
    now: new Date("2026-06-14T12:00:00Z"),
  });

  assert.equal(summary.status, "unavailable");
  assert.match(summary.detail, /does not include a valid generatedAt timestamp/i);
});

test("summarizeExportFreshness reports source_ahead when Firestore is far newer than served export", () => {
  const summary = summarizeExportFreshness({
    exportMeta: {
      generatedAt: "2026-06-14T09:00:00Z",
      rowCount: 2451,
    },
    catalogHealth: baseCatalogHealth({
      gcs: { newestCreatedAt: "2026-06-10T09:00:00Z" },
    }),
    latestSource: {
      createdAt: "2026-06-14T12:00:00Z",
    },
    now: new Date("2026-06-14T12:00:00Z"),
    staleHours: 26,
  });

  assert.equal(summary.status, "source_ahead");
  assert.match(summary.detail, /Firestore has newer song data than the served catalog/i);
});

test("summarizeExportFreshness remains healthy when the current public source has not posted recently", () => {
  const summary = summarizeExportFreshness({
    exportMeta: {
      generatedAt: "2026-06-17T06:13:22Z",
      rowCount: 2456,
    },
    catalogHealth: {
      servingSource: "gcs",
      gcs: {
        rowCount: 2456,
        newestCreatedAt: "2026-06-14T19:52:17.658Z",
      },
      fallback: {
        rowCount: 2456,
        newestCreatedAt: "2026-06-14T19:52:17.658Z",
      },
    },
    latestSource: {
      createdAt: "2026-06-14T19:52:17.658Z",
      newestCreatedAt: "2026-06-14T19:52:17.658Z",
    },
    now: new Date("2026-06-17T06:18:42Z"),
    staleHours: 26,
  });

  assert.equal(summary.status, "healthy");
  assert.equal(summary.label, "Catalog is current");
  assert.match(summary.detail, /No newer public Suno track has appeared in 58\.44 hours/i);
});

test("summarizeExportFreshness uses newestCreatedAt across harvest accounts", () => {
  const summary = summarizeExportFreshness({
    exportMeta: {
      generatedAt: "2026-06-17T06:13:22Z",
      rowCount: 2471,
    },
    catalogHealth: baseCatalogHealth({
      gcs: {
        rowCount: 2471,
        newestCreatedAt: "2026-06-16T10:00:00.000Z",
      },
    }),
    latestSource: {
      newestCreatedAt: "2026-06-17T05:00:00.000Z",
      createdAt: "2026-06-17T05:00:00.000Z",
      accounts: [
        {
          handle: "unshakableechos2341",
          accountLabel: "vanessa_primary",
          createdAt: "2026-06-16T10:00:00.000Z",
        },
        {
          handle: "nessihenize",
          accountLabel: "vanessa_secondary",
          createdAt: "2026-06-17T05:00:00.000Z",
        },
      ],
      latestSourceSong: {
        handle: "nessihenize",
        accountLabel: "vanessa_secondary",
        createdAt: "2026-06-17T05:00:00.000Z",
      },
    },
    now: new Date("2026-06-17T06:18:42Z"),
    staleHours: 26,
  });

  assert.equal(summary.status, "healthy");
  assert.equal(summary.latestSourceCreatedAt, "2026-06-17T05:00:00.000Z");
});

test("summarizeExportFreshness remains healthy when no active account has posted recently", () => {
  const summary = summarizeExportFreshness({
    exportMeta: {
      generatedAt: "2026-06-17T06:13:22Z",
      rowCount: 2471,
    },
    catalogHealth: baseCatalogHealth({
      gcs: {
        rowCount: 2471,
        newestCreatedAt: "2026-06-10T09:00:00.000Z",
      },
    }),
    latestSource: {
      newestCreatedAt: "2026-06-10T09:00:00.000Z",
      createdAt: "2026-06-10T09:00:00.000Z",
      accounts: [
        {
          handle: "unshakableechos2341",
          accountLabel: "vanessa_primary",
          createdAt: "2026-06-10T09:00:00.000Z",
        },
        {
          handle: "nessihenize",
          accountLabel: "vanessa_secondary",
          createdAt: "2026-06-09T12:00:00.000Z",
        },
      ],
    },
    now: new Date("2026-06-17T06:18:42Z"),
    staleHours: 26,
  });

  assert.equal(summary.status, "healthy");
  assert.match(summary.detail, /No newer public Suno track has appeared/i);
});

test("pickNewestByCreatedAt picks newest createdAt regardless of input order", () => {
  const { pickNewestByCreatedAt } = require("../freshness-utils");
  const docs = [
    { id: "a", createdAt: "2026-10-15T14:08:28.862Z" },
    { id: "b", createdAt: "2026-10-20T01:00:00.000Z" },
    { id: "c", createdAt: "" },
  ];
  assert.equal(pickNewestByCreatedAt(docs).id, "b");
  assert.equal(pickNewestByCreatedAt([]), null);
  assert.equal(pickNewestByCreatedAt([{ id: "x", createdAt: "" }]).id, "x");
});
