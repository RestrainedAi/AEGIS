import express, { Request, Response, NextFunction } from "express";
import { Storage } from "@google-cloud/storage";
import { Firestore } from "@google-cloud/firestore";
import createDebug from "debug";
import { decode } from "html-entities";
import { z, ZodType } from "zod";
import crypto from "crypto";
import { registerYouTubeRoutes } from "./routes/youtube";

import {
  ItemSchema,
  type Item,
  type Run,
  type SourceDoc,
  type RunDoc,
  pipelineShort,
  gcsRunPrefix,
  gcsRunPaths
} from "./schema";



// --- SUNO helpers ---
const SunoIngestBodySchema = z.object({
  handle: z.string().optional(),
  url: z.string().url().optional(),
});

function extractSunoHandle(input: unknown): string | null {
  if (!input) return null;
  const s = String(input).trim();
  const m1 = s.match(/^@?([a-zA-Z0-9_]+)$/);
  if (m1) return m1[1];
  const m2 = s.match(/suno\.com\/@([a-zA-Z0-9_]+)/i);
  return m2 ? m2[1] : null;
}

function sha1(input: string) {
  return crypto.createHash("sha1").update(input).digest("hex");
}

async function fetchHtml(url: string): Promise<string> {
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "text/html,application/xhtml+xml",
    },
  });
  if (!r.ok) throw new Error(`Suno fetch failed HTTP ${r.status}`);
  return await r.text();
}

function extractJsonPayloadsFromHtml(html: string): any[] {
  const payloads: any[] = [];

  // 1) Classic Next.js __NEXT_DATA__
  const nextDataMatch = html.match(
    /<script[^>]*id="__NEXT_DATA__"[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/i
  );
  if (nextDataMatch?.[1]) {
    try { payloads.push(JSON.parse(nextDataMatch[1])); } catch {}
  }

  // 2) Other application/json scripts
  const reJsonScripts = /<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = reJsonScripts.exec(html))) {
    const raw = m[1]?.trim();
    if (!raw) continue;
    if (nextDataMatch?.[1] && raw === nextDataMatch[1]) continue;
    try { payloads.push(JSON.parse(raw)); } catch {}
  }

  // 3) Next.js App Router streaming: (self.)__next_f.push(<ARG>)
  // We MUST parse the arg with balanced parentheses, not regex.
  const pushNeedle = "__next_f.push(";
  let i = 0;

  while (true) {
    const start = html.indexOf(pushNeedle, i);
    if (start === -1) break;

    const argStart = start + pushNeedle.length;
    const { argText, endIdx } = readBalancedParenArg(html, argStart);
    i = endIdx;

    const trimmed = argText.trim();
    if (!trimmed.startsWith("[")) continue;

    // The push arg is a JSON array like: [1,"5:[\"$\",...{...\"clips\":[...]...}]"]
    try {
      const arr = JSON.parse(trimmed);
      payloads.push({ __next_f: arr });

      // If the second element is a string, it often contains a JSON object with profile/clips.
      if (Array.isArray(arr) && typeof arr[1] === "string") {
        const s = arr[1] as string;

        // Fast path: find a {"profile":{...}} object inside the string and parse it
        const profIdx = s.indexOf('"profile":');
        if (profIdx !== -1) {
          const objStart = s.indexOf("{", profIdx);
          if (objStart !== -1) {
            const objEnd = findMatchingBrace(s, objStart);
            if (objEnd !== -1) {
              const objText = s.slice(objStart, objEnd + 1);
              try { payloads.push(JSON.parse(objText)); } catch {}
            }
          }
        }
      }
    } catch {
      // ignore malformed fragments; we only need the ones that parse
    }
  }

  return payloads;

  // -------- local helpers --------

  function readBalancedParenArg(src: string, from: number) {
    let depth = 1;
    let inStr = false;
    let esc = false;

    let j = from;
    for (; j < src.length; j++) {
      const ch = src[j];

      if (esc) { esc = false; continue; }
      if (ch === "\\") { esc = true; continue; }

      if (ch === '"') inStr = !inStr;
      if (inStr) continue;

      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) break;
      }
    }

    const argText = src.slice(from, j);
    return { argText, endIdx: j + 1 };
  }

  function findMatchingBrace(src: string, from: number) {
    let depth = 0;
    let inStr = false;
    let esc = false;

    for (let j = from; j < src.length; j++) {
      const ch = src[j];

      if (esc) { esc = false; continue; }
      if (ch === "\\") { esc = true; continue; }

      if (ch === '"') inStr = !inStr;
      if (inStr) continue;

      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) return j;
      }
    }
    return -1;
  }
}

type SunoSongCandidate = {
  songKey: string;
  title: string | null;
  audioUrl: string | null;
  imageUrl: string | null;
  createdAt: string | null;
  raw: any;
};

function pickFirstString(...vals: any[]): string | null {
  for (const v of vals) if (typeof v === "string" && v.trim()) return v;
  return null;
}

function looksLikeSongObj(o: any): boolean {
  if (!o || typeof o !== "object") return false;

  const hasTitle = typeof o.title === "string" || typeof o.name === "string";
  const hasAudio =
    typeof o.audio_url === "string" ||
    typeof o.audioUrl === "string" ||
    typeof o.audio === "string" ||
    typeof o.stream_url === "string";
  const hasId =
    typeof o.id === "string" ||
    typeof o.songId === "string" ||
    typeof o.clip_id === "string" ||
    typeof o.uuid === "string";

  return [hasTitle, hasAudio, hasId].filter(Boolean).length >= 2;
}

function normalizeSongCandidate(o: any): SunoSongCandidate {
  const title = pickFirstString(o.title, o.name) ?? null;
  const audioUrl =
    pickFirstString(o.audio_url, o.audioUrl, o.audio, o.stream_url, o.audioSource) ?? null;
  const imageUrl =
    pickFirstString(o.image_url, o.imageUrl, o.cover_url, o.coverUrl, o.thumbnail_url) ?? null;

  const id =
    pickFirstString(o.id, o.songId, o.clip_id, o.uuid, o.slug) ??
    sha1(JSON.stringify({ title, audioUrl, imageUrl, seed: "suno" }));

  const createdAt =
    pickFirstString(o.created_at, o.createdAt, o.created, o.created_time, o.timestamp) ?? null;

  return { songKey: id, title, audioUrl, imageUrl, createdAt, raw: o };
}

function collectSongCandidatesFromPayload(payload: any): SunoSongCandidate[] {
  const out: SunoSongCandidate[] = [];
  const seen = new Set<string>();

  function walk(x: any) {
    if (!x) return;
    if (Array.isArray(x)) { for (const v of x) walk(v); return; }
    if (typeof x !== "object") return;

    if (looksLikeSongObj(x)) {
      const c = normalizeSongCandidate(x);
      if (!seen.has(c.songKey)) { seen.add(c.songKey); out.push(c); }
    }

    for (const k of Object.keys(x)) walk((x as any)[k]);
  }

  walk(payload);
  return out;
}



const logApp = createDebug("app");
const logHttp = createDebug("http");
const logIngest = createDebug("ingest");
const logCaptions = createDebug("captions");
const logError = createDebug("error");

const app = express();
const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res, next)).catch(next);

app.use(express.json());
registerYouTubeRoutes(app);

app.use((req: Request, _res: Response, next: NextFunction) => {
  logHttp(`${req.method} ${req.path}`);
  next();
});

const storage = new Storage();
const firestore = new Firestore();



// Keep your current bucket default
const BUCKET = process.env.BUCKET || "sunopipeline-artifacts-prod";

const IngestBodySchema = z.object({
  playlist: z.string().optional(),
});

const FetchCaptionsBodySchema = z.object({
  playlistId: z.string(),
  runId: z.string(),
  videoId: z.string(),
});

function resolveYouTubeApiKey() {
  return process.env.YOUTUBE_API_KEY || process.env.YT_API_KEY || "";
}

const ItemEventSchema = z.object({
  item_id: z.string(),
  timestamp: z.string().datetime(),
  event_type: z.string(),
  data: z.record(z.any()).optional(),
});
type ItemEvent = z.infer<typeof ItemEventSchema>;

type TypedRequest<T extends ZodType> = Request & { body: z.infer<T> };

function nowIso() {
  return new Date().toISOString();
}

function extractPlaylistId(input: unknown): string | null {
  if (!input) return null;
  const s = String(input).trim();
  const m = s.match(/[?&]list=([a-zA-Z0-9_-]+)/);
  return m ? m[1] : s;
}

const validate =
  (schema: ZodType) => (req: Request, res: Response, next: NextFunction) => {
    try {
      schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ ok: false, error: "Invalid request body", issues: error.issues });
      }
      next(error);
    }
  };

async function createItemEvent(event: Omit<ItemEvent, "timestamp">) {
  const doc: ItemEvent = { ...event, timestamp: nowIso() };
  await firestore.collection("item_events").add(doc);
}

// Firestore batch: hard limit 500 ops. Use 450 as safe chunk.
const BATCH_LIMIT = 450;

async function batchSetChunked(
  sets: Array<{
    ref: FirebaseFirestore.DocumentReference;
    data: any;
    options?: FirebaseFirestore.SetOptions;
  }>
) {
  let batch = firestore.batch();
  let ops = 0;

  for (const s of sets) {
    batch.set(s.ref, s.data, s.options ?? { merge: true });
    ops++;
    if (ops >= BATCH_LIMIT) {
      await batch.commit();
      batch = firestore.batch();
      ops = 0;
    }
  }

  if (ops > 0) await batch.commit();
}

async function ytListPlaylistItems({
  apiKey,
  playlistId,
  pageToken,
}: {
  apiKey: string;
  playlistId: string;
  pageToken?: string;
}) {
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

app.get("/health", (_req: Request, res: Response) => res.json({ ok: true }));

/**
 * POST /ingest
 * - legacy: writes items + runs using ItemSchema/Run
 * - new: also upserts sources + unified run metadata
 */


app.post("/suno/ingest", validate(SunoIngestBodySchema), asyncHandler(async (req: TypedRequest<typeof SunoIngestBodySchema>, res: Response) => {
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

  // Create/Update source doc
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

  // Run doc
  const runDocRunning: RunDoc = {
    runId,
    pipeline: "SUNO_PROFILE",
    sourceId,
    entityId: handle,
    status: "RUNNING",
    startedAt: nowIso(),
    gcsPrefix: `gs://${BUCKET}/suno/runs/${handle}/${runId}/`,
    counts: { foundOnPage: 0, fetchedItems: 0, newItems: 0, updatedItems: 0, unchangedItems: 0, errors: 0 },
    meta: { url },
  };

  await firestore.collection("runs").doc(runId).set(runDocRunning, { merge: true });

  // Fetch HTML
  const html = await fetchHtml(url);

  // Save raw snapshot to GCS
  const rawHtmlPath = `suno/runs/${handle}/${runId}/raw/page.html`;
  await storage.bucket(BUCKET).file(rawHtmlPath).save(html, { contentType: "text/html" });

  // Extract payloads and snapshot parsed JSON (best effort)
const payloads = extractJsonPayloadsFromHtml(html);
const payloadPath = `suno/runs/${handle}/${runId}/parsed/payloads.json`;

await storage.bucket(BUCKET).file(payloadPath).save(JSON.stringify(payloads, null, 2), {
  contentType: "application/json",
});

  
  // Collect song candidates
  const candidates: SunoSongCandidate[] = [];
  for (const p of payloads) candidates.push(...collectSongCandidatesFromPayload(p));

  const extractedPath = `suno/runs/${handle}/${runId}/parsed/songs.extracted.json`;
  await storage.bucket(BUCKET).file(extractedPath).save(JSON.stringify(candidates, null, 2), {
    contentType: "application/json",
  });

  // Write items (chunked) using your existing batchSetChunked helper
  const now = nowIso();
  const writes: Array<{ ref: FirebaseFirestore.DocumentReference; data: any; options?: FirebaseFirestore.SetOptions }> = [];

  for (const c of candidates) {
    const docId = `suno:${c.songKey}`;

    const songUrl =
      typeof c.raw?.url === "string"
        ? c.raw.url
        : `https://suno.com/@${handle}?page=songs`;

    const itemDoc: Record<string, any> = {
      sourceId,
      unified: {
        itemId: `suno_${c.songKey}`,
        type: "SUNO_SONG",
        key: c.songKey,
        url: songUrl,
        media: { videoUrl: null, audioUrl: c.audioUrl, imageUrl: c.imageUrl },
        text: {
          transcript: null,
          prompt: typeof c.raw?.prompt === "string" ? c.raw.prompt : null,
          lyrics: typeof c.raw?.lyrics === "string" ? c.raw.lyrics : null,
        },
        timestamps: { firstSeenAt: now, lastSeenAt: now, updatedAt: now },
        lastRunId: runId,
      },
      suno: {
        handle,
        songKey: c.songKey,
        title: c.title,
        createdAt: c.createdAt,
        audioUrl: c.audioUrl,
        imageUrl: c.imageUrl,
        raw: c.raw,
        runId,
      },
    };

    writes.push({ ref: firestore.collection("items").doc(docId), data: itemDoc, options: { merge: true } });
  }

  await batchSetChunked(writes);

  // Finalize run/source
  const finishedAt = nowIso();
  await firestore.collection("runs").doc(runId).set(
    { status: "READY", finishedAt, counts: { foundOnPage: candidates.length, fetchedItems: candidates.length } },
    { merge: true }
  );

  await firestore.collection("sources").doc(sourceId).set(
    { updatedAt: finishedAt, crawl: { status: "READY", lastRunId: runId, lastCrawledAt: finishedAt } },
    { merge: true }
  );

  return res.json({
    ok: true,
    handle,
    runId,
    count: candidates.length,
    url,
    rawHtml: `gs://${BUCKET}/${rawHtmlPath}`,
    payloads: `gs://${BUCKET}/${payloadPath}`,
    extracted: `gs://${BUCKET}/${extractedPath}`,
  });
}));



app.post(
  "/ingest",
  validate(IngestBodySchema),
  asyncHandler(async (req: TypedRequest<typeof IngestBodySchema>, res: Response) => {
    const apiKey = resolveYouTubeApiKey();
    if (!apiKey) {
      return res.status(500).json({
        ok: false,
        error: "Missing YOUTUBE_API_KEY (legacy alias supported: YT_API_KEY)",
      });
    }

    const playlistInput = req.query.playlist ?? req.body?.playlist;
    const playlistId = extractPlaylistId(playlistInput);
    if (!playlistId) return res.status(400).json({ ok: false, error: "Missing playlist (id or url)" });

    const runId = new Date().toISOString().replace(/[:.]/g, "-");

    // Keep your existing GCS layout (yt/runs/...)
    const legacyPrefix = `yt/runs/${playlistId}/${runId}`;

    // Unified gcsPrefix grammar (gs://bucket/yt/runs/...)
    const unifiedGcsPrefix = gcsRunPrefix({
      bucket: BUCKET,
      pipeline: "YT_PLAYLIST",
      entityId: playlistId,
      runId,
    });
    const gcsPaths = gcsRunPaths(unifiedGcsPrefix);

    const sourceId = `yt_${playlistId}`;

    logIngest(`Starting ingest playlistId=${playlistId} runId=${runId}`);

    // 1) Upsert unified source doc (playlist)
    const sourceDoc: SourceDoc = {
      sourceId,
      type: "YT_PLAYLIST",
      platform: "youtube",
      playlistId,
      handle: null,
      url: `https://www.youtube.com/playlist?list=${playlistId}`,
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

    // 2) Create unified run doc RUNNING (in addition to your legacy Run)
    const runDocRunning: RunDoc = {
      runId,
      pipeline: "YT_PLAYLIST",
      sourceId,
      entityId: playlistId,
      status: "RUNNING",
      startedAt: nowIso(),
      gcsPrefix: unifiedGcsPrefix,
      counts: {
        foundOnPage: 0,
        fetchedItems: 0,
        newItems: 0,
        updatedItems: 0,
        unchangedItems: 0,
        errors: 0,
        transcriptsOk: 0,
        transcriptsMissing: 0,
      },
      meta: {
        gcsRaw: gcsPaths.raw,
        gcsParsed: gcsPaths.parsed,
        gcsExports: gcsPaths.exports,
      },
    };

    await firestore.collection("runs").doc(runId).set(runDocRunning, { merge: true });

    // 3) Fetch items and prepare chunked writes
    let pageToken: string | undefined;
    let count = 0;

    const writes: Array<{
      ref: FirebaseFirestore.DocumentReference;
      data: any;
      options?: FirebaseFirestore.SetOptions;
    }> = [];

    do {
      const data = await ytListPlaylistItems({ apiKey, playlistId, pageToken });
      logIngest(`Fetched ${data.items?.length || 0} playlist items`);
      pageToken = data.nextPageToken;

      for (const item of data.items || []) {
        const videoId = item?.contentDetails?.videoId;
        if (!videoId) continue;

        const record: Item & Record<string, any> = {
          // Legacy fields (validated)
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
          retrievedAt: nowIso(),
          provenance: { source: "youtubeDataApiV3", method: "playlistItems.list", apiVersion: "v3" },
          paths: {
            gcsVideoJson: `gs://${BUCKET}/${legacyPrefix}/videos/${videoId}/video.json`,
            gcsCaptionsVtt: `gs://${BUCKET}/${legacyPrefix}/videos/${videoId}/captions.vtt`,
            gcsTranscriptTxt: `gs://${BUCKET}/${legacyPrefix}/videos/${videoId}/transcript.txt`,
          },
          captions: { status: "PENDING" },

          // Unified add-ons (do NOT break legacy)
          sourceId,
          unified: {
            itemId: `yt_${videoId}`,
            type: "YT_VIDEO",
            key: videoId,
            url: `https://www.youtube.com/watch?v=${videoId}`,
            media: {
              videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
              imageUrl:
                item?.snippet?.thumbnails?.maxres?.url ||
                item?.snippet?.thumbnails?.standard?.url ||
                item?.snippet?.thumbnails?.high?.url ||
                item?.snippet?.thumbnails?.medium?.url ||
                item?.snippet?.thumbnails?.default?.url ||
                null,
              audioUrl: null,
            },
            text: { transcript: null, prompt: null, lyrics: null },
            timestamps: { firstSeenAt: nowIso(), lastSeenAt: nowIso(), updatedAt: nowIso() },
            lastRunId: runId,
          },
        };

        // Validate legacy record strictly
        ItemSchema.parse(record);

        const itemRef = firestore.collection("items").doc(`${playlistId}:${videoId}`);
        writes.push({ ref: itemRef, data: record, options: { merge: true } });
        count++;
      }
    } while (pageToken);

    // 4) Commit item writes chunked (prevents >500 ops failure)
    await batchSetChunked(writes);

    // 5) Legacy run record (kept)
    const runRecord: Run = {
      playlistId,
      runId,
      count,
      createdAt: nowIso(),
      status: "MANIFEST_WRITTEN",
    };
    await firestore.collection("runs_legacy").doc(runId).set(runRecord, { merge: true });

    // 6) Update unified run + source
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

    logIngest(`Committed ${count} items and run record for runId=${runId}`);
    res.json({
      ok: true,
      playlistId,
      count,
      runId,
      gcsPrefix: `gs://${BUCKET}/${legacyPrefix}/`, // keep your existing response contract
      unifiedGcsPrefix,
    });
  })
);

async function fetchTimedTextVtt(videoId: string, lang?: string): Promise<string> {
  const url = new URL("https://www.youtube.com/api/timedtext");
  url.searchParams.set("fmt", "vtt");
  url.searchParams.set("v", videoId);
  if (lang) url.searchParams.set("lang", lang);

  const r = await fetch(url.toString(), {
    headers: { "User-Agent": "Mozilla/5.0" },
  });

  if (!r.ok) throw new Error(`timedtext HTTP ${r.status}`);

  const text = await r.text();
  if (!text || !text.includes("WEBVTT")) throw new Error("No VTT returned");
  return text.slice(text.indexOf("WEBVTT"));
}

function vttToPlainText(vtt: string): string {
  return vtt
    .split("\n")
    .filter(
      (line) =>
        line.trim() &&
        !line.startsWith("WEBVTT") &&
        !line.includes("-->") &&
        !/^\d+$/.test(line)
    )
    .join(" ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

app.post(
  "/fetch_captions",
  validate(FetchCaptionsBodySchema),
  asyncHandler(async (req: TypedRequest<typeof FetchCaptionsBodySchema>, res: Response) => {
    const { playlistId, runId, videoId } = req.body;
    const itemId = `${playlistId}:${videoId}`;
    logCaptions(`Fetching captions videoId=${videoId}`);

    const prefix = `yt/runs/${playlistId}/${runId}/videos/${videoId}`;
    const vttPath = `${prefix}/captions.vtt`;
    const txtPath = `${prefix}/transcript.txt`;

    const [exists] = await storage.bucket(BUCKET).file(vttPath).exists();
    if (exists) {
      await createItemEvent({
        item_id: itemId,
        event_type: "fetch_captions",
        data: { status: "SKIPPED", reason: "GCS file exists" },
      });
      return res.json({ ok: true, videoId, status: "SKIPPED" });
    }

    let vtt: string;
    try {
      vtt = await fetchTimedTextVtt(videoId, "en");
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      if (error.includes("No VTT returned") || error.includes("timedtext HTTP 404")) {
        const now = nowIso();
        await firestore.collection("items").doc(itemId).set(
          {
            captions: { status: "MISSING", updatedAt: now },
            // unified add-on timestamp update
            unified: { lastRunId: runId, timestamps: { lastSeenAt: now, updatedAt: now } },
          },
          { merge: true }
        );
        await createItemEvent({
          item_id: itemId,
          event_type: "fetch_captions",
          data: { status: "MISSING", error },
        });
        return res.json({ ok: true, videoId, status: "MISSING" });
      }
      throw e;
    }

    const txt = decode(vttToPlainText(vtt));

    await storage.bucket(BUCKET).file(vttPath).save(vtt, { contentType: "text/vtt" });
    await storage.bucket(BUCKET).file(txtPath).save(txt, { contentType: "text/plain" });

    const now = nowIso();
    const captionsUpdate = {
      status: "OK",
      method: "timedtext",
      lang: "en",
      gcsVtt: `gs://${BUCKET}/${vttPath}`,
      gcsText: `gs://${BUCKET}/${txtPath}`,
      retrievedAt: now,
      updatedAt: now,
    };

    await firestore.collection("items").doc(itemId).set(
      {
        captions: captionsUpdate,
        // unified add-on (store refs; avoid giant transcript in Firestore)
        unified: {
          lastRunId: runId,
          timestamps: { lastSeenAt: now, updatedAt: now },
          text: { transcript: null },
          transcriptRef: captionsUpdate.gcsText,
        },
      },
      { merge: true }
    );

    await createItemEvent({
      item_id: itemId,
      event_type: "fetch_captions",
      data: { status: "OK", gcsText: captionsUpdate.gcsText },
    });

    res.json({ ok: true, videoId, status: "OK" });
  })
);

// Global error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logError(err?.stack || String(err));
  const error = err instanceof Error ? err.message : String(err);
  res.status(500).json({ ok: false, error });
});

app.get("/healthz", (_req, res) => res.status(200).send("ok"));


app.post("/internal/yt-job", async (req, res) => {
  try {
    const message = req.body?.message;
    if (!message?.data) return res.status(400).send("No message");

    const payload = JSON.parse(
      Buffer.from(message.data, "base64").toString()
    );

    console.log("Received job:", payload);

if (payload.stage === "expandPlaylist") {
  const { playlistId, runId } = payload;

  const { fetchPlaylistItems } = await import("./lib/youtube");
  const { writePlaylistItemsToRun } = await import("./lib/ytRunItems");
  const { ytRunRef } = await import("./lib/firestore");

  const items = await fetchPlaylistItems(playlistId);

  console.log("Playlist items fetched:", items.length);

  await writePlaylistItemsToRun(runId, playlistId, items);

  await ytRunRef(runId).set({
    status: "EXPANDED",
    counts: {
      queued: items.length,
      enriched: 0,
      transcriptsOk: 0,
      transcriptsMissing: 0,
      blocked: 0,
      errors: 0,
    },
    updatedAt: new Date(),
  }, { merge: true });

  console.log("Playlist items written to Firestore:", items.length);
}
    

    res.status(200).send("OK");
  } catch (err) {
    console.error("yt-job handler error:", err);
    res.status(500).send("Error");
  }
});

const port = process.env.PORT || 8080;
app.listen(port, () => logApp(`Listening on ${port}`));
