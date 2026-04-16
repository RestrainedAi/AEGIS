import { google } from "googleapis";

function resolveYouTubeApiKey() {
  const canonical = process.env.YOUTUBE_API_KEY;
  const legacy = process.env.YT_API_KEY;
  return canonical || legacy || "";
}

export function getYouTubeClient() {
  const apiKey = resolveYouTubeApiKey();

  console.log("YT key prefix:", apiKey?.slice(0, 8));

  if (!apiKey) {
    throw new Error("YOUTUBE_API_KEY not set (legacy alias: YT_API_KEY)");
  }

  const youtube = google.youtube("v3");
  google.options({ auth: apiKey });
  return youtube;
}

export async function fetchPlaylistItems(playlistId: string) {
  const youtube = getYouTubeClient();

  const res = await youtube.playlistItems.list({
    part: ["snippet", "contentDetails"],
    playlistId,
    maxResults: 50,
  });

  return res.data.items ?? [];
}
