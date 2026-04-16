const express = require("express");
const fetch = require("node-fetch");
const { Storage } = require("@google-cloud/storage");
const { Firestore } = require("@google-cloud/firestore");

const app = express();
app.use(express.json());

const storage = new Storage();
const firestore = new Firestore();
const BUCKET = "sunopipeline-artifacts-prod";

function extractPlaylistId(input) {
  if (!input) return null;
  const m = String(input).match(/[?&]list=([a-zA-Z0-9_-]+)/);
  return m ? m[1] : String(input).trim();
}

async function ytListPlaylistItems({ apiKey, playlistId, pageToken }) {
  const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
  url.searchParams.set("part", "snippet,contentDetails");
  url.searchParams.set("maxResults", "50");
  url.searchParams.set("playlistId", playlistId);
  url.searchParams.set("key", apiKey);
  if (pageToken) url.searchParams.set("pageToken", pageToken);

  const r = await fetch(url.toString());
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || `YouTube API error (${r.status})`);
  return j;
}

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/ingest", async (req, res) => {
  try {
    const apiKey = process.env.YT_API_KEY;
    if (!apiKey) return res.status(500).json({ ok: false, error: "Missing YT_API_KEY" });

    const playlistInput = req.query.playlist || req.body?.playlist;
    const playlistId = extractPlaylistId(playlistInput);
    if (!playlistId) return res.status(400).json({ ok: false, error: "Missing playlist (id or url)" });

    const runId = new Date().toISOString().replace(/[:.]/g, "-");
    const prefix = `yt/runs/${playlistId}/${runId}`;

    let pageToken;
    let count = 0;
    const batch = firestore.batch();

    do {
      const data = await ytListPlaylistItems({ apiKey, playlistId, pageToken });
      pageToken = data.nextPageToken;

      for (const item of (data.items || [])) {
        const videoId = item?.contentDetails?.videoId;
        if (!videoId) continue;

        const record = {
          runId,
          playlistId,
          playlistItemId: item.id,
          position: item?.snippet?.position ?? null,
          videoId,
          videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
          title: item?.snippet?.title ?? null,
          description: item?.snippet?.description ?? null,
          channelId: item?.snippet?.videoOwnerChannelId ?? item?.snippet?.channelId ?? null,
          channelTitle: item?.snippet?.videoOwnerChannelTitle ?? item?.snippet?.channelTitle ?? null,
          videoPublishedAt: item?.contentDetails?.videoPublishedAt ?? null,
          thumbnails: item?.snippet?.thumbnails ?? null,
          retrievedAt: new Date().toISOString(),
          provenance: { source: "youtubeDataApiV3", method: "playlistItems.list", apiVersion: "v3" },
          paths: {
            gcsVideoJson: `gs://${BUCKET}/${prefix}/videos/${videoId}/video.json`,
            gcsCaptionsVtt: `gs://${BUCKET}/${prefix}/videos/${videoId}/captions.vtt`,
            gcsTranscriptTxt: `gs://${BUCKET}/${prefix}/videos/${videoId}/transcript.txt`
          },
          captions: { status: "PENDING" }
        };

        const itemRef = firestore.collection("items").doc(`${playlistId}:${videoId}`);
        batch.set(itemRef, record, { merge: true });
        count++;
      }
    } while (pageToken);

    const runRef = firestore.collection("runs").doc(runId);
    batch.set(runRef, {
      playlistId, runId, count, createdAt: new Date().toISOString(), status: "MANIFEST_WRITTEN"
    });

    await batch.commit();

    res.json({ ok: true, playlistId, count, runId, gcsPrefix: `gs://${BUCKET}/${prefix}/` });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

/**
 * POST /suno/ingest
 * Query or body:
 * - handle=unshakableechos2341
 * - or url=https://suno.com/@unshakableechos2341?page=songs
 *
 * Writes:
 * - sources/suno_{handle}
 * - runs/{runId} pipeline=SUNO_PROFILE
 * - items/suno:{songKey} with unified subobject + raw suno blob
 */
app.post(
  "/suno/ingest",
  validate(SunoIngestBodySchema),
  asyncHandler(async (req: TypedRequest<typeof SunoIngestBodySchema>, res: Response) => {
    const handleInput = req.query.handle ?? req.body?.handle ?? req.query.profile ?? req.body?.url;
    const handle = extractSunoHandle(handleInput);
    const url =
      req.body?.url ??
      (handle ? `https://suno.com/@${handle}?page=songs` : null);

    if (!handle || !url) {
      return res.status(400).json({ ok: false, error: "Provide handle (preferred) or url" });
    }

    const runId = new Date().toISOString().replace(/[:.]/g, "-");
    const sourceId = `suno_${handle}`;

    // Unified GCS prefix: gs://bucket/suno/runs/{handle}/{runId}/
    const unifiedGcsPrefix = gcsRunPrefix({
      bucket: BUCKET,
      pipeline: "SUNO_PROFILE",
      entityId: handle,
      runId,
    });
    const gcsPaths = gcsRunPaths(unifiedGcsPrefix);

    logIngest(`SUNO ingest start handle=${handle} runId=${runId} url=${url}`);

    // Upsert source doc
    const sourceDoc: SourceDoc = {
      sourceId,
      type: "SUNO_PROFILE",
      platform: "suno",
      handle,
      playlistId: null,
      url: `https://suno.com/@${handle}?page=songs`,
      title: null,
      ownerLabel: null,
      displayLabel: null,
      crawl: {
        enabled: true,
        frequencyHours: 6,
        lastRunId: runId,
        lastCrawledAt: nowIso(),
        status: "RUNNING",
      },
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    await firestore.collection("sources").doc(sourceId).set(sourceDoc, { merge: true });

    // Create run doc RUNNING
    const runDocRunning: RunDoc = {
      runId,
      pipeline: "SUNO_PROFILE",
      sourceId,
      entityId: handle,
      status: "RUNNING",
      startedAt: nowIso(),
      gcsPrefix: unifiedGcsPrefix,
      counts: { foundOnPage: 0, fetchedItems: 0, newItems: 0, updatedItems: 0, unchangedItems: 0, errors: 0 },
      meta: { url, gcsRaw: gcsPaths.raw, gcsParsed: gcsPaths.parsed },
    };

    await firestore.collection("runs").doc(runId).set(runDocRunning, { merge: true });

    // Fetch + snapshot raw HTML
    const html = await fetchHtml(url);

    const rawHtmlPath = `${pipelineShort("SUNO_PROFILE")}/runs/${handle}/${runId}/raw/page.html`;
    await storage.bucket(BUCKET).file(rawHtmlPath).save(html, { contentType: "text/html" });

    // Extract payloads and snapshot parsed JSON (best effort)
    const payloads = extractJsonPayloadsFromHtml(html);
    const payloadPath = `${pipelineShort("SUNO_PROFILE")}/runs/${handle}/${runId}/parsed/payloads.json`;
    await storage.bucket(BUCKET).file(payloadPath).save(JSON.stringify(payloads, null, 2), {
      contentType: "application/json",
    });

    // Collect songs
    const candidates: SunoSongCandidate[] = [];
    for (const p of payloads) {
      candidates.push(...collectSongCandidatesFromPayload(p));
    }

    // Snapshot extracted items
    const extractedPath = `${pipelineShort("SUNO_PROFILE")}/runs/${handle}/${runId}/parsed/songs.extracted.json`;
    await storage.bucket(BUCKET).file(extractedPath).save(JSON.stringify(candidates, null, 2), {
      contentType: "application/json",
    });

    // Write items (chunked)
    const writes: Array<{
      ref: FirebaseFirestore.DocumentReference;
      data: any;
      options?: FirebaseFirestore.SetOptions;
    }> = [];

    const now = nowIso();
    let count = 0;

    for (const c of candidates) {
      const songKey = c.songKey;
      const docId = `suno:${songKey}`;
      const songUrl = c.raw?.url
        ? String(c.raw.url)
        : `https://suno.com/@${handle}?page=songs`; // fallback

      const itemDoc: Record<string, any> = {
        // Unified attachment (mirrors your YT “unified” approach)
        sourceId,
        unified: {
          itemId: `suno_${songKey}`,
          type: "SUNO_SONG",
          key: songKey,
          url: songUrl,
          media: {
            videoUrl: null,
            audioUrl: c.audioUrl,
            imageUrl: c.imageUrl,
          },
          text: {
            transcript: null,
            prompt: typeof c.raw?.prompt === "string" ? c.raw.prompt : null,
            lyrics: typeof c.raw?.lyrics === "string" ? c.raw.lyrics : null,
          },
          timestamps: {
            firstSeenAt: now,
            lastSeenAt: now,
            updatedAt: now,
          },
          lastRunId: runId,
        },

        // Raw suno payload, preserved (helpful for future fields)
        suno: {
          handle,
          songKey,
          title: c.title,
          createdAt: c.createdAt,
          audioUrl: c.audioUrl,
          imageUrl: c.imageUrl,
          raw: c.raw,
          runId,
        },
      };

      const itemRef = firestore.collection("items").doc(docId);
      writes.push({ ref: itemRef, data: itemDoc, options: { merge: true } });
      count++;
    }

    // Reuse your chunked batch helper (already in your file)
    await batchSetChunked(writes);

    // Finalize run + source
    const finishedAt = nowIso();
    await firestore.collection("runs").doc(runId).set(
      {
        status: "READY",
        finishedAt,
        counts: { foundOnPage: count, fetchedItems: count },
      },
      { merge: true }
    );

    await firestore.collection("sources").doc(sourceId).set(
      {
        updatedAt: finishedAt,
        crawl: { status: "READY", lastRunId: runId, lastCrawledAt: finishedAt },
      },
      { merge: true }
    );

    logIngest(`SUNO ingest complete handle=${handle} runId=${runId} items=${count}`);

    return res.json({
      ok: true,
      handle,
      runId,
      count,
      url,
      unifiedGcsPrefix,
      rawHtml: `gs://${BUCKET}/${rawHtmlPath}`,
      payloads: `gs://${BUCKET}/${payloadPath}`,
      extracted: `gs://${BUCKET}/${extractedPath}`,
    });
  })
);

// Versioned alias (nice for long-term)
app.post(
  "/v1/admin/suno/ingest",
  validate(SunoIngestBodySchema),
  asyncHandler(async (req: TypedRequest<typeof SunoIngestBodySchema>, res: Response, next) => {
    // forward to the same handler by calling the route functionally:
    // simplest is to just duplicate call via express, but here we re-run logic:
    // (keep it simple: call the same URL from client, or just use /suno/ingest)
    return res.status(400).json({
      ok: false,
      error: "Use POST /suno/ingest (alias wiring optional).",
    });
  })
);




const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Listening on ${port}`));

async function fetchTimedTextVtt(videoId, lang) {
  const url = new URL("https://www.youtube.com/api/timedtext");
  url.searchParams.set("fmt", "vtt");
  url.searchParams.set("v", videoId);
  if (lang) url.searchParams.set("lang", lang);

  const r = await fetch(url.toString(), {
    headers: { "User-Agent": "Mozilla/5.0" }
  });

  if (!r.ok) throw new Error(`timedtext HTTP ${r.status}`);

  const text = await r.text();
  if (!text || !text.includes("WEBVTT")) {
    throw new Error("No VTT returned");
  }

  return text.slice(text.indexOf("WEBVTT"));
}

function vttToPlainText(vtt) {
  return vtt
    .split("\n")
    .filter(line =>
      line.trim() &&
      !line.startsWith("WEBVTT") &&
      !line.includes("-->") &&
      !/^\d+$/.test(line)
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

// POST /fetch_captions
// Body: { playlistId, runId, videoId }
app.post("/fetch_captions", async (req, res) => {
  try {
    const { playlistId, runId, videoId } = req.body || {};
    if (!playlistId || !runId || !videoId) {
      return res.status(400).json({ ok:false, error:"Missing playlistId, runId, or videoId" });
    }

    const prefix = `yt/runs/${playlistId}/${runId}/videos/${videoId}`;
    const vttPath = `${prefix}/captions.vtt`;
    const txtPath = `${prefix}/transcript.txt`;

    const [exists] = await storage.bucket(BUCKET).file(vttPath).exists();
    if (exists) return res.json({ ok:true, videoId, status:"SKIPPED" });

let vtt;
try {
  vtt = await fetchTimedTextVtt(videoId, "en");
} catch (e) {
  if (String(e.message || e).includes("No VTT returned")) {
    return res.json({ ok:true, videoId, status:"MISSING" });
  }
  res.status(500).json({ ok:false, error:String(e.message || e) });
}

    const txt = vttToPlainText(vtt);

    await storage.bucket(BUCKET).file(vttPath).save(vtt, { contentType: "text/vtt" });
    await storage.bucket(BUCKET).file(txtPath).save(txt, { contentType: "text/plain" });

    const itemRef = firestore.collection("items").doc(`${playlistId}:${videoId}`);
    await itemRef.set({
      captions: {
        status: "OK",
        method: "timedtext",
        lang: "en",
        gcsVtt: `gs://${BUCKET}/${vttPath}`,
        gcsText: `gs://${BUCKET}/${txtPath}`,
        retrievedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    }, { merge: true });

    // TODO: Create an item_event document
    res.json({ ok:true, videoId, status:"OK" });
  } catch (e) {
    res.status(500).json({ ok:false, error:String(e.message || e) });
  }
});
