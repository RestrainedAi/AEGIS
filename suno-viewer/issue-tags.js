// Vault song issue tags. Keep in sync with src/lib/issue-tags.ts
// (test/issue-tags.test.js checks both files agree).
const STUB_AUDIO_HINT = /\/sil-\d+\.(mp3|m4a|wav)/i;

const ISSUE_TAGS = [
  { id: "removed_from_suno", label: "Removed from Suno", tone: "danger",
    info: "Suno no longer has this song (its page returns \u201cnot found\u201d). The Vault keeps our saved copy so nothing is lost." },
  { id: "audio_from_video", label: "Audio from video", tone: "notice",
    info: "Suno would not hand over the original MP3, so the audio you hear was taken from the song's video. It sounds the same but is not the original file. The harvest keeps trying for the original each week." },
  { id: "silent_placeholder", label: "Silent placeholder", tone: "warn",
    info: "The stored MP3 is Suno's short silent stand-in, not the real song. The nightly harvest will replace it when Suno releases the audio." },
  { id: "no_audio", label: "No audio", tone: "warn",
    info: "There is no audio file for this song in the Vault yet. The nightly harvest tries again every night." },
  { id: "no_video", label: "No video", tone: "muted",
    info: "There is no MP4 video for this song in the Vault. Audio and artwork are not affected." },
  { id: "no_thumb", label: "No thumbnail", tone: "muted",
    info: "There is no cover image stored for this song, so a placeholder is shown." },
];
const ORDER = ISSUE_TAGS.map((t) => t.id);

function str(v) { return String(v == null ? "" : v).trim(); }

function issueIdsForSong(song) {
  const s = song || {};
  const listed = str(s.mediaIssues);
  let ids;
  if (listed) {
    ids = listed.split(/[;,\s]+/).filter((id) => ORDER.includes(id));
  } else {
    // Older catalogs without mediaIssues: derive from the paths we have.
    ids = [];
    if (s.status === "removed_from_suno") ids.push("removed_from_suno");
    if (s.audio_asset_role === "derived-from-video") ids.push("audio_from_video");
    else if (STUB_AUDIO_HINT.test(str(s.audio_url))) ids.push("silent_placeholder");
    else if (!str(s.gcs_latest_audio) && !str(s.gcs_mp3)) ids.push("no_audio");
    if (!str(s.gcs_mp4) && !str(s.gcs_latest_mp4)) ids.push("no_video");
    if (!str(s.gcs_thumb) && !str(s.gcs_latest_thumb) && !str(s.image_url)) ids.push("no_thumb");
  }
  if (s.status === "removed_from_suno" && !ids.includes("removed_from_suno")) ids.push("removed_from_suno");
  return ORDER.filter((id) => ids.includes(id));
}

function issueTagsForSong(song) {
  const ids = issueIdsForSong(song);
  return ISSUE_TAGS.filter((t) => ids.includes(t.id));
}

function songHasIssues(song) { return issueIdsForSong(song).length > 0; }

module.exports = { ISSUE_TAGS, issueIdsForSong, issueTagsForSong, songHasIssues };
