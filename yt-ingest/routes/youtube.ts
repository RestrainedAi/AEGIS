import type { Express, Request, Response } from "express";
import { isoRunId, parsePlaylistId, ytPrefixes } from "../lib/paths";
import { ytRunRef } from "../lib/firestore";
import { publishYtJob } from "../lib/pubsub";


export function registerYouTubeRoutes(app: Express) {
  // Create a run
  app.post("/yt/runs", async (req: Request, res: Response) => {
    try {
      const playlistUrl = req.body?.playlistUrl;
      if (!playlistUrl) return res.status(400).json({ error: "playlistUrl required" });

      const playlistId = parsePlaylistId(playlistUrl);
      if (!playlistId) return res.status(400).json({ error: "Could not parse playlistId" });

      const runId = isoRunId();
      const prefixes = ytPrefixes(playlistId, runId);

      await ytRunRef(runId).set({
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

      await publishYtJob({
        stage: "expandPlaylist",
        runId,
        playlistId,
        playlistUrl,
        prefixes,
      });

      return res.json({ ok: true, runId, playlistId, ...prefixes });
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // List recent runs
  app.get("/yt/runs", async (_req: Request, res: Response) => {
    const snap = await (await import("../lib/firestore")).db
      .collection("yt_runs")
      .orderBy("createdAt", "desc")
      .limit(20)
      .get();

    res.json(snap.docs.map((d) => d.data()));
  });
}
