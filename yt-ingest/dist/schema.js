"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RunSchema = exports.ItemSchema = void 0;
exports.pipelineShort = pipelineShort;
exports.gcsRunPrefix = gcsRunPrefix;
exports.gcsRunPaths = gcsRunPaths;
const zod_1 = require("zod");
/* =========================================================
   Legacy (YT v1) Schemas — KEEP for backward compatibility
   ========================================================= */
exports.ItemSchema = zod_1.z.object({
    runId: zod_1.z.string(),
    playlistId: zod_1.z.string(),
    playlistItemId: zod_1.z.string(),
    position: zod_1.z.number().nullable(),
    videoId: zod_1.z.string(),
    videoUrl: zod_1.z.string().url(),
    title: zod_1.z.string().nullable(),
    description: zod_1.z.string().nullable(),
    channelId: zod_1.z.string().nullable(),
    channelTitle: zod_1.z.string().nullable(),
    videoPublishedAt: zod_1.z.string().datetime().nullable(),
    thumbnails: zod_1.z.record(zod_1.z.any()).nullable(),
    retrievedAt: zod_1.z.string().datetime(),
    provenance: zod_1.z.object({
        source: zod_1.z.string(),
        method: zod_1.z.string(),
        apiVersion: zod_1.z.string(),
    }),
    paths: zod_1.z.object({
        gcsVideoJson: zod_1.z.string(),
        gcsCaptionsVtt: zod_1.z.string(),
        gcsTranscriptTxt: zod_1.z.string(),
    }),
    captions: zod_1.z.object({
        status: zod_1.z.enum(["PENDING", "OK", "MISSING", "ERROR"]),
        method: zod_1.z.string().optional(),
        lang: zod_1.z.string().optional(),
        gcsVtt: zod_1.z.string().optional(),
        gcsText: zod_1.z.string().optional(),
        retrievedAt: zod_1.z.string().datetime().optional(),
        updatedAt: zod_1.z.string().datetime().optional(),
    }),
});
exports.RunSchema = zod_1.z.object({
    runId: zod_1.z.string(),
    playlistId: zod_1.z.string(),
    count: zod_1.z.number(),
    createdAt: zod_1.z.string().datetime(),
    status: zod_1.z.string(),
});
/* =========================================================
   GCS helpers (aligns with your current yt/runs/... layout)
   ========================================================= */
function pipelineShort(p) {
    return p === "YT_PLAYLIST" ? "yt" : "suno";
}
function gcsRunPrefix(args) {
    const p = pipelineShort(args.pipeline);
    return `gs://${args.bucket}/${p}/runs/${args.entityId}/${args.runId}/`;
}
function gcsRunPaths(prefix) {
    return {
        raw: `${prefix}raw/`,
        parsed: `${prefix}parsed/`,
        exports: `${prefix}exports/`,
        logs: `${prefix}logs/`,
    };
}
