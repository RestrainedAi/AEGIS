export function isoRunId(date = new Date()) {
  // stable, filename-safe
  return date.toISOString().replace(/[:.]/g, "-");
}

export function ytPrefixes(playlistId: string, runId: string) {
  const base = `yt/runs/${playlistId}/${runId}`;

  return {
    gcsMediaPrefix: `gs://aeonimus-youtube-media/${base}/`,
    gcsTranscriptPrefix: `gs://aeonimus-transcripts/${base}/`,
    gcsWorkspacePrefix: `gs://aeonimus-workspaces/${base}/`,
    relativeBase: base,
  };
}

export function parsePlaylistId(input: string): string | null {
  // Accept playlist URL or raw playlistId
  try {
    const u = new URL(input);
    return u.searchParams.get("list");
  } catch {
    // not a URL, assume it's already an id
    return input?.trim() || null;
  }
}
