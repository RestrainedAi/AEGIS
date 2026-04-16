"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerYouTubeRoutes = registerYouTubeRoutes;
const paths_1 = require("../lib/paths");
const firestore_1 = require("../lib/firestore");
const pubsub_1 = require("../lib/pubsub");
function registerYouTubeRoutes(app) {
    // Create a run
    app.post("/yt/runs", async (req, res) => {
        try {
            const playlistUrl = req.body?.playlistUrl;
            if (!playlistUrl)
                return res.status(400).json({ error: "playlistUrl required" });
            const playlistId = (0, paths_1.parsePlaylistId)(playlistUrl);
            if (!playlistId)
                return res.status(400).json({ error: "Could not parse playlistId" });
            const runId = (0, paths_1.isoRunId)();
            const prefixes = (0, paths_1.ytPrefixes)(playlistId, runId);
            await (0, firestore_1.ytRunRef)(runId).set({
                runId,
                playlistId,
                playlistUrl,
                status: "QUEUED",
                createdAt: new Date(),
                ...prefixes,
                counts: {
                    queued: 0,
                    enriched: 0,
                    transcriptsOk: 0,
                    transcriptsMissing: 0,
                    blocked: 0,
                    errors: 0,
                },
            });
            await (0, pubsub_1.publishYtJob)({
                stage: "expandPlaylist",
                runId,
                playlistId,
                playlistUrl,
                prefixes,
            });
            return res.json({ ok: true, runId, playlistId, ...prefixes });
        }
        catch (e) {
            return res.status(500).json({ ok: false, error: String(e?.message || e) });
        }
    });
    // List recent runs
    app.get("/yt/runs", async (_req, res) => {
        const snap = await (await Promise.resolve().then(() => __importStar(require("../lib/firestore")))).db
            .collection("yt_runs")
            .orderBy("createdAt", "desc")
            .limit(20)
            .get();
        res.json(snap.docs.map((d) => d.data()));
    });
}
