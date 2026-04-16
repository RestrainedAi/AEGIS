#!/usr/bin/env bash
set -euo pipefail

WORK_DIR="${HOME}/yt-ingest/scoped-fallback-20260331"
mkdir -p "$WORK_DIR"
cd "$WORK_DIR"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "[fallback-mp4] installing ffmpeg..."
  sudo apt-get update
  sudo apt-get install -y ffmpeg
fi

build_one() {
  local clip_id="$1"
  local handle="unshakableechos2341"
  local audio_gs="gs://aeonimus-suno-media/suno/handles/${handle}/${clip_id}.mp3"
  local image_gs="gs://aeonimus-suno-media/suno/handles/${handle}/${clip_id}.jpg"
  local video_gs="gs://aeonimus-suno-media/suno/handles/${handle}/${clip_id}.mp4"
  local audio_file="${clip_id}.mp3"
  local image_file="${clip_id}.jpg"
  local video_file="${clip_id}.mp4"

  echo "[fallback-mp4] pulling source assets for ${clip_id}..."
  gcloud storage cp "$audio_gs" "$audio_file"
  gcloud storage cp "$image_gs" "$image_file"

  echo "[fallback-mp4] building MP4 for ${clip_id}..."
  ffmpeg -y \
    -loop 1 \
    -framerate 2 \
    -i "$image_file" \
    -i "$audio_file" \
    -c:v libx264 \
    -tune stillimage \
    -pix_fmt yuv420p \
    -vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2" \
    -c:a aac \
    -b:a 192k \
    -movflags +faststart \
    -shortest \
    "$video_file"

  echo "[fallback-mp4] uploading canonical MP4 for ${clip_id}..."
  gcloud storage cp "$video_file" "$video_gs"
  gcloud storage ls -L "$video_gs"
}

build_one "63cae7f5-8d32-4ef1-9fd7-79983121501c"
build_one "c901a10f-9e5c-40a0-b395-a456e17c98d0"
