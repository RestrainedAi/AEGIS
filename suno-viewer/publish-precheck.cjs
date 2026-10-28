"use strict";

// "Already on YouTube / already queued" warning. Pure, so it is unit-tested.

function pick(obj, key) {
  return String((obj && obj[key]) || "").trim();
}

/**
 * @param song         plain song fields (ytVideoId, ytCanonicalUrl, ytPublishedAt, ytPublishChannel, ytPrivacy, ytStatus)
 * @param queueRows    plain queue rows for the song, newest first
 * @param chosenChannel channel picked in the Publish form
 */
function describePriorPublish({ song = {}, queueRows = [], chosenChannel = "", channelNames = {}, legacyChannelMap = {} } = {}) {
  const active = queueRows.find((r) => ["queued", "uploading", "new"].includes(pick(r, "status")));
  const lastDone = queueRows.find((r) => pick(r, "status") === "done" && pick(r, "ytVideoId"));
  // Rows written before linked channels existed stored the Suno account name (e.g. "vanessa_primary")
  // as the channel. Translate those through the user's own account -> channel map.
  const norm = (k) => (k && !channelNames[k] && legacyChannelMap[k] ? legacyChannelMap[k] : k);
  const name = (k) => (k ? channelNames[k] || k : "");

  if (active) {
    const ch = norm(pick(active, "ytPublishChannel"));
    return {
      state: pick(active, "status") === "uploading" ? "uploading" : "queued",
      canProceed: false, // it will go out once; publishing again now would duplicate it
      sameChannel: !chosenChannel || !ch || ch === chosenChannel,
      details: {
        queuedAt: pick(active, "queuedAt") || pick(active, "createdAt"),
        channel: ch,
        channelName: name(ch),
        privacy: pick(active, "ytPrivacy"),
        queueId: pick(active, "queueId"),
      },
      message: "This song is already waiting in the YouTube queue.",
    };
  }

  const videoId = pick(song, "ytVideoId") || pick(lastDone, "ytVideoId");
  if (!videoId) return { state: "none", canProceed: true, sameChannel: false, details: null, message: "" };

  const channel = norm(pick(song, "ytPublishChannel") || pick(lastDone, "ytPublishChannel"));
  const sameChannel = !channel || !chosenChannel || channel === chosenChannel;
  return {
    state: "on_youtube",
    canProceed: true, // allowed only after the user confirms
    sameChannel,
    details: {
      ytVideoId: videoId,
      url: pick(song, "ytCanonicalUrl") || `https://www.youtube.com/watch?v=${videoId}`,
      publishedAt: pick(song, "ytPublishedAt") || pick(lastDone, "uploadedAt"),
      channel,
      channelName: name(channel) || "unknown channel (published before channels were tracked)",
      privacy: pick(song, "ytPrivacy") || pick(lastDone, "ytPrivacy") || "unknown",
    },
    message: sameChannel
      ? "This song is already on YouTube on this channel. Publishing again creates a second video."
      : "This song is already on YouTube on a different channel. Publishing here creates another video.",
  };
}

module.exports = { describePriorPublish };
