import { z } from "zod";

/* =========================================================
   Legacy (YT v1) Schemas — KEEP for backward compatibility
   ========================================================= */

export const ItemSchema = z.object({
  runId: z.string(),
  playlistId: z.string(),
  playlistItemId: z.string(),
  position: z.number().nullable(),
  videoId: z.string(),
  videoUrl: z.string().url(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  channelId: z.string().nullable(),
  channelTitle: z.string().nullable(),
  videoPublishedAt: z.string().datetime().nullable(),
  thumbnails: z.record(z.any()).nullable(),
  retrievedAt: z.string().datetime(),
  provenance: z.object({
    source: z.string(),
    method: z.string(),
    apiVersion: z.string(),
  }),
  paths: z.object({
    gcsVideoJson: z.string(),
    gcsCaptionsVtt: z.string(),
    gcsTranscriptTxt: z.string(),
  }),
  captions: z.object({
    status: z.enum(["PENDING", "OK", "MISSING", "ERROR"]),
    method: z.string().optional(),
    lang: z.string().optional(),
    gcsVtt: z.string().optional(),
    gcsText: z.string().optional(),
    retrievedAt: z.string().datetime().optional(),
    updatedAt: z.string().datetime().optional(),
  }),
});

export type Item = z.infer<typeof ItemSchema>;

export const RunSchema = z.object({
  runId: z.string(),
  playlistId: z.string(),
  count: z.number(),
  createdAt: z.string().datetime(),
  status: z.string(),
});

export type Run = z.infer<typeof RunSchema>;

/* =========================================================
   Unified Library Contract (YT + SUNO + future pipelines)
   ========================================================= */

export type ISO8601 = string;

export type Pipeline = "YT_PLAYLIST" | "SUNO_PROFILE";
export type RunStatus = "RUNNING" | "READY" | "ERROR";

export type SourceType = "YT_PLAYLIST" | "SUNO_PROFILE";
export type ItemType = "YT_VIDEO" | "SUNO_SONG";
export type Visibility = "public" | "unlisted" | "private" | "unknown";
export type InteractionPlatform = "youtube" | "suno" | "unknown";

export interface CreationLayerDoc {
  songKey: string;
  sourceId: string;
  sourcePlatform?: "youtube" | "suno" | null;
  handle?: string | null;
  title?: string | null;
  rawTitle?: string | null;
  createdAt?: string | null;
  prompt?: string | null;
  lyrics?: string | null;
  lyricsStatus?: "OK" | "MISSING" | "ERROR" | "PARTIAL" | null;
  lyricsSource?: "SUNO_STUDIO_API" | "AUDIO_TRANSCRIBE" | "MANUAL" | "UNKNOWN" | null;
  lyricsRetrievedAt?: string | null;
  tags?: string[];
  displayTags?: string[];
  styles?: string[];
  styleText?: string | null;
  modelName?: string | null;
  modelMajorVersion?: string | null;
  isInstrumental?: boolean | null;
  description?: string | null;
  caption?: string | null;
  negativePrompt?: string | null;
  explicit?: boolean | null;
  rawMetadataRef?: string | null;
  rawPayloadRef?: string | null;
}

export interface AssetLayerDoc {
  media: {
    videoUrl?: string | null;
    audioUrl?: string | null;
    imageUrl?: string | null;
  };
  gcs?: {
    audio?: boolean | null;
    video?: boolean | null;
    thumb?: boolean | null;
  };
  artworkUrl?: string | null;
  gcsLyricsTxt?: string | null;
  gcsLyricsJson?: string | null;
  gcsLyricsVtt?: string | null;
  gcsTranscriptTxt?: string | null;
  gcsCaptionsVtt?: string | null;
}

export interface DistributionLayerDoc {
  ytStatus?: string | null;
  ytVideoId?: string | null;
  ytCanonicalUrl?: string | null;
  ytStartedAt?: string | null;
  ytUploadedAt?: string | null;
  ytPublishedAt?: string | null;
  ytError?: string | null;
  ytErrorAt?: string | null;
}

export interface InteractionRecordDoc {
  songKey: string;
  platform: InteractionPlatform;
  destinationId?: string | null;
  publishedTo?: string[] | null;
  viewCount?: number | null;
  playCount?: number | null;
  uniqueListeners?: number | null;
  commentCount?: number | null;
  likeCount?: number | null;
  shareCount?: number | null;
  lastEngagementSyncAt?: string | null;
  snapshots?: Array<Record<string, unknown>> | null;
}

export interface SourceDoc {
  sourceId: string;              // "yt_<playlistId>" | "suno_<handle>"
  type: SourceType;
  platform: "youtube" | "suno";
  url: string;

  title?: string | null;
  ownerLabel?: string | null;
  displayLabel?: string | null;

  handle?: string | null;        // suno handle sans "@"
  playlistId?: string | null;    // yt playlistId

  crawl: {
    enabled: boolean;
    frequencyHours?: number | null;
    lastRunId?: ISO8601 | null;
    lastCrawledAt?: string | null;  // ISO string for now
    status?: RunStatus | "IDLE" | null;
  };

  createdAt?: string;
  updatedAt?: string;
}

export interface ItemDoc {
  itemId: string;        // "yt_<videoId>" | "suno_<songKeyOrHash>"
  sourceId: string;      // "yt_<playlistId>" | "suno_<handle>"
  type: ItemType;

  url: string;
  key?: string | null;   // videoId or songKey
  title?: string | null;
  visibility?: Visibility;

  publishedAt?: string | null;       // ISO
  createdAtSource?: string | null;   // alias for suno

  media: {
    videoUrl?: string | null;
    audioUrl?: string | null;
    imageUrl?: string | null;
  };

  text: {
    transcript?: string | null; // store short preview only, prefer refs in other fields
    prompt?: string | null;
    lyrics?: string | null;
    captionPreview?: string | null;
  };

  description?: string | null;
  caption?: string | null;
  negativePrompt?: string | null;
  modelMajorVersion?: string | null;
  explicit?: boolean | null;
  displayTags?: string[];
  styles?: string[];
  styleText?: string | null;

  lyricsStatus?: "OK" | "MISSING" | "ERROR" | "PARTIAL" | null;
  transcriptStatus?: "OK" | "MISSING" | "ERROR" | "PARTIAL" | null;
  lyricsSource?: "SUNO_STUDIO_API" | "AUDIO_TRANSCRIBE" | "MANUAL" | "UNKNOWN" | null;
  transcriptSource?: "SUNO_STUDIO_API" | "AUDIO_TRANSCRIBE" | "MANUAL" | "UNKNOWN" | null;
  textRetrievedAt?: string | null;
  lyricsRetrievedAt?: string | null;
  transcriptRetrievedAt?: string | null;

  gcsLyricsTxt?: string | null;
  gcsLyricsJson?: string | null;
  gcsLyricsVtt?: string | null;
  gcsTranscriptTxt?: string | null;
  gcsCaptionsVtt?: string | null;

  metrics?: {
    views?: number | null;
    likes?: number | null;
    comments?: number | null;
    plays?: number | null;
  };

  tags?: string[];
  layers?: {
    creation?: CreationLayerDoc | null;
    assets?: AssetLayerDoc | null;
    distribution?: DistributionLayerDoc | null;
  };

  lastRunId?: ISO8601 | null;
  hash?: {
    content?: string | null;
    rawSnapshotRef?: string | null;
  };

  timestamps: {
    firstSeenAt: string;
    lastSeenAt: string;
    updatedAt: string;
  };
}

export interface RunDoc {
  runId: ISO8601;
  pipeline: Pipeline;

  sourceId: string;  // "yt_<playlistId>" | "suno_<handle>"
  entityId: string;  // playlistId | handle

  status: RunStatus;

  startedAt: string;
  finishedAt?: string | null;

  gcsPrefix: string;

  counts?: {
    foundOnPage?: number;
    fetchedItems?: number;
    newItems?: number;
    updatedItems?: number;
    unchangedItems?: number;
    errors?: number;
    transcriptsOk?: number;
    transcriptsMissing?: number;
  };

  error?: {
    message?: string | null;
    stack?: string | null;
  };

  meta?: Record<string, unknown>;
}

/* =========================================================
   GCS helpers (aligns with your current yt/runs/... layout)
   ========================================================= */

export function pipelineShort(p: Pipeline): "yt" | "suno" {
  return p === "YT_PLAYLIST" ? "yt" : "suno";
}

export function gcsRunPrefix(args: {
  bucket: string;
  pipeline: Pipeline;
  entityId: string;
  runId: ISO8601;
}) {
  const p = pipelineShort(args.pipeline);
  return `gs://${args.bucket}/${p}/runs/${args.entityId}/${args.runId}/`;
}

export function gcsRunPaths(prefix: string) {
  return {
    raw: `${prefix}raw/`,
    parsed: `${prefix}parsed/`,
    exports: `${prefix}exports/`,
    logs: `${prefix}logs/`,
  };
}
