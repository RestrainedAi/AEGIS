"use strict";

// Multi-user, multi-channel YouTube publish setting. Nothing is hardcoded.
//   users/{uid}/youtubeChannels/{channelKey} -> { name, youtubeChannelId, tokenSecret, enabled }
//       tokenSecret = Secret Manager secret ID for that channel's OAuth refresh
//       token. Tokens stay server-side; the browser never sees tokenSecret.
//   users/{uid}/publishChannelMap/{account}  -> { channel }  (user's default per Suno account)
// A user can only publish to channels under their own uid (checked on queue and
// again in the upload job). No default channel -> blocked; no fallback.

const PUBLISH_CHANNELS_COLLECTION = "youtubeChannels";
const PUBLISH_CHANNEL_MAP_COLLECTION = "publishChannelMap";

function userChannelsPath(uid) {
  return `users/${uid}/${PUBLISH_CHANNELS_COLLECTION}`;
}

function userChannelMapPath(uid) {
  return `users/${uid}/${PUBLISH_CHANNEL_MAP_COLLECTION}`;
}

const CHANNEL_KEY_RE = /^[a-z0-9][a-z0-9_-]{1,62}$/;

function accountCandidates({ label = "", handle = "", sourceId = "" } = {}) {
  const src = String(sourceId || "").trim();
  const srcHandle = src.toLowerCase().startsWith("suno_") ? src.slice(5) : "";
  return [...new Set([label, handle, srcHandle].map((v) => String(v || "").trim()).filter(Boolean))];
}

function mergeRegistry(registryDocs = {}) {
  const out = {};
  for (const [key, ch] of Object.entries(registryDocs || {})) out[key] = { key, ...ch };
  return out;
}

/** Public view of linked channels (never exposes the token secret reference). */
function listChannels(registryDocs = {}) {
  return Object.values(mergeRegistry(registryDocs))
    .map((c) => ({ key: c.key, name: c.name || c.key, youtubeChannelId: c.youtubeChannelId || "", enabled: c.enabled !== false }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function unmappedMessage(account) {
  return (
    `No YouTube channel is set for Suno account '${account || "unknown"}'. ` +
    "Publishing is blocked until an admin picks a channel in Publish settings > Channels."
  );
}

/**
 * Resolve the channel to publish to: the user's pick from the Publish form if
 * given, else the account's default channel. Never falls back to anything else.
 */
function resolveChannel({ candidates = [], channelMap = {}, registry = {}, requested = "" }) {
  const reg = mergeRegistry(registry);
  const account = candidates[0] || "";
  let channel = String(requested || "").trim();
  if (!channel) {
    for (const c of candidates) {
      if (channelMap[c]) { channel = channelMap[c]; break; }
    }
  }
  if (!channel) return { ok: false, code: "channel_unmapped", account, error: unmappedMessage(account) };
  const entry = reg[channel];
  if (!entry) {
    return { ok: false, code: "channel_unknown", account, channel, error: `YouTube channel '${channel}' is not one of your linked channels.` };
  }
  if (entry.enabled === false) {
    return { ok: false, code: "channel_disabled", account, channel, error: `YouTube channel '${entry.name || channel}' is disabled.` };
  }
  if (!entry.tokenSecret) {
    return { ok: false, code: "channel_no_token", account, channel, error: `YouTube channel '${entry.name || channel}' has no linked token yet.` };
  }
  return { ok: true, account, channel, channelName: entry.name || channel, defaultChannel: channelMap[candidates.find((c) => channelMap[c])] || "" };
}

function validateChannelKey(key) {
  return CHANNEL_KEY_RE.test(String(key || ""));
}

/**
 * DEV-57: when an account moves to a different channel, its songs' published
 * state is reset so they can be published to the new channel. The old video is
 * kept in history (ytPreviousVideoIds), never deleted.
 */
function planChannelChange({ account, oldChannel = "", newChannel = "", songs = [], now = new Date().toISOString(), by = "" }) {
  if ((oldChannel || "") === (newChannel || "")) return { changed: false, resets: [] };
  const resets = [];
  for (const song of songs) {
    const vid = String(song.ytVideoId || "").trim();
    const status = String(song.ytStatus || "").trim();
    if (!vid && !status && !song.ytCanonicalUrl) continue;
    const prev = Array.isArray(song.ytPreviousVideoIds) ? song.ytPreviousVideoIds.filter(Boolean) : [];
    resets.push({
      songKey: song.songKey,
      fields: {
        ytVideoId: { stringValue: "" },
        ytCanonicalUrl: { stringValue: "" },
        ytStatus: { stringValue: "" },
        ytPublishedAt: { stringValue: "" },
        ytUploadedAt: { stringValue: "" },
        ytRepublishedAt: { stringValue: "" },
        ytPreviousVideoIds: { arrayValue: { values: [...prev, ...(vid ? [vid] : [])].map((v) => ({ stringValue: v })) } },
        ytPreviousChannel: { stringValue: oldChannel || "" },
        ytResetAt: { stringValue: now },
        ytResetReason: { stringValue: `channel changed for ${account}: ${oldChannel || "(none)"} -> ${newChannel || "(none)"}${by ? ` by ${by}` : ""}` },
      },
    });
  }
  return { changed: true, resets };
}

module.exports = {
  userChannelsPath,
  userChannelMapPath,
  PUBLISH_CHANNELS_COLLECTION,
  PUBLISH_CHANNEL_MAP_COLLECTION,
  listChannels,
  accountCandidates,
  mergeRegistry,
  resolveChannel,
  validateChannelKey,
  planChannelChange,
  unmappedMessage,
};
