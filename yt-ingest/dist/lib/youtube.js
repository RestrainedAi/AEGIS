"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getYouTubeClient = getYouTubeClient;
exports.fetchPlaylistItems = fetchPlaylistItems;
const googleapis_1 = require("googleapis");
function resolveYouTubeApiKey() {
    const canonical = process.env.YOUTUBE_API_KEY;
    const legacy = process.env.YT_API_KEY;
    return canonical || legacy || "";
}
function getYouTubeClient() {
    const apiKey = resolveYouTubeApiKey();
    console.log("YT key prefix:", apiKey?.slice(0, 8));
    if (!apiKey) {
        throw new Error("YOUTUBE_API_KEY not set (legacy alias: YT_API_KEY)");
    }
    const youtube = googleapis_1.google.youtube("v3");
    googleapis_1.google.options({ auth: apiKey });
    return youtube;
}
async function fetchPlaylistItems(playlistId) {
    const youtube = getYouTubeClient();
    const res = await youtube.playlistItems.list({
        part: ["snippet", "contentDetails"],
        playlistId,
        maxResults: 50,
    });
    return res.data.items ?? [];
}
