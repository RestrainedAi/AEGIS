"use strict";

// Plug-in point for "Connect YouTube channel" (OAuth). Not built yet.
//
// Intended flow when implemented:
//   1. POST /api/youtube/connect/start  -> server builds a Google OAuth URL
//      (scopes youtube.upload + youtube.force-ssl, access_type=offline,
//      prompt=consent, state = signed {uid, nonce}) and returns it.
//   2. GET  /api/youtube/connect/callback?code&state -> verify state belongs to
//      the signed-in uid, exchange code for tokens, call channels.list(mine=true),
//      store the refresh token in Secret Manager as
//      yt-token-{uid}-{channelId}, then create
//      users/{uid}/youtubeChannels/{channelKey} with
//      { name, youtubeChannelId, tokenSecret, enabled: true, linkedVia: "oauth" }.
//   3. Never return tokens or tokenSecret to the browser.
// Until then, channels are linked by migrate_channels_to_user.py or by an admin.

function installYouTubeConnectRoutes(app) {
  const notYet = (_req, res) =>
    res.status(501).json({
      ok: false,
      code: "youtube_connect_not_built",
      error: "Connecting a YouTube channel from the Vault is not available yet. Ask an admin to link it.",
    });
  app.post("/api/youtube/connect/start", notYet);
  app.get("/api/youtube/connect/callback", notYet);
}

module.exports = { installYouTubeConnectRoutes };
