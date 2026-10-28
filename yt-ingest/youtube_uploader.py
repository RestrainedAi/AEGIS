#!/usr/bin/env python3
"""
youtube_uploader.py — Aeonimus Vault
Resumable YouTube upload using OAuth 2.0 refresh token from Secret Manager.
Reads clip metadata from Firestore sunoSongs/{songKey}.
Writes back ytVideoId, ytUploadedAt, ytStatus, and best-effort caption status
to Firestore.

Usage:
  python youtube_uploader.py --song-key <songKey> [--dry-run]
"""

import argparse
import json
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

from account_labels import canonical_account_label
from youtube_publish_channels import (
    user_channel_path,
    user_map_path,
    UnmappedPublishChannel,
    account_key,
    oauth_secret_for_channel,
    resolve_publish_channel,
    unmapped_message,
)

# ── Constants ─────────────────────────────────────────────────────────────────
PROJECT         = "stable-framing-482501-t9"
DATABASE        = "(default)"
SECRET_OAUTH    = "youtube-oauth-refresh-token"
SECRET_CLIENT   = "youtube-oauth-client-secrets"
DEFAULT_GCS_BUCKET = "aeonimus-suno-media"
MEDIA_PREFIX    = "suno/handles/"        # fallback GCS path prefix for mp4 files
YT_UPLOAD_URL   = "https://www.googleapis.com/upload/youtube/v3/videos"
YT_CAPTIONS_UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/captions"
YT_TOKEN_URL    = "https://oauth2.googleapis.com/token"
YT_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo"
CHUNK_SIZE      = 8 * 1024 * 1024       # 8 MB resumable chunks
MAX_RETRIES     = 5
CATEGORY_ID     = "10"                  # Music
YT_SCOPE_UPLOAD = "https://www.googleapis.com/auth/youtube.upload"
YT_SCOPE_CAPTIONS = "https://www.googleapis.com/auth/youtube.force-ssl"

# ── YouTube URL canonicalization ──────────────────────────────────────────────
# Per ChatGPT doc: normalize all YouTube link forms to watch?v=ID to prevent
# hidden duplicates across Firestore/CSV/playlist crawls.

_ID11 = re.compile(r'^[A-Za-z0-9_-]{11}$')
_LANG_RE = re.compile(r"^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$")
_PUBLISH_TAG_WORD_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9'&+._-]*")
_YOUTUBE_TEXT_REPLACEMENTS = str.maketrans({
    "\u00a0": " ",
    "\u2010": "-",
    "\u2011": "-",
    "\u2012": "-",
    "\u2013": "-",
    "\u2014": "-",
    "\u2015": "-",
    "\u2018": "'",
    "\u2019": "'",
    "\u201c": '"',
    "\u201d": '"',
    "\u2022": "-",
    "\u2026": "...",
})


def http_error_detail(err: urllib.error.HTTPError) -> str:
    """Return a short readable body snippet for HTTP errors."""
    try:
        body = err.read().decode("utf-8", errors="replace").strip()
    except Exception:
        body = ""
    if not body:
        return err.reason or "HTTP error"
    return body[:400]

def canonicalize_yt_url(url: str) -> tuple[str | None, str | None]:
    """Return (video_id, canonical_url) or (None, None) if invalid."""
    try:
        u = urllib.parse.urlparse(url.strip())
        host = (u.hostname or "").replace("www.", "").replace("m.", "")
        q = urllib.parse.parse_qs(u.query)
        vid = None
        if host in {"youtube.com", "music.youtube.com", "gaming.youtube.com"}:
            if u.path == "/watch":
                vid = q.get("v", [None])[0]
            m = re.match(r"^/(shorts|live)/([A-Za-z0-9_-]{11})", u.path or "")
            if not vid and m:
                vid = m.group(2)
        elif host == "youtu.be":
            m = re.match(r"^/([A-Za-z0-9_-]{11})", u.path or "")
            if m:
                vid = m.group(1)
        if not (vid and _ID11.match(vid)):
            return None, None
        return vid, f"https://www.youtube.com/watch?v={vid}"
    except Exception:
        return None, None


# ── Token helpers ──────────────────────────────────────────────────────────────

def get_gcp_token() -> str:
    """Get GCP access token from metadata server."""
    req = urllib.request.Request(
        "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
        headers={"Metadata-Flavor": "Google"},
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())["access_token"]


def get_secret(gcp_token: str, secret_id: str) -> str:
    """Fetch latest version of a Secret Manager secret."""
    url = (f"https://secretmanager.googleapis.com/v1/projects/{PROJECT}"
           f"/secrets/{secret_id}/versions/latest:access")
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {gcp_token}"})
    with urllib.request.urlopen(req, timeout=15) as r:
        data = json.loads(r.read())
    import base64
    return base64.b64decode(data["payload"]["data"]).decode("utf-8")


def get_youtube_token(gcp_token: str, publish_channel: str, owner_uid: str) -> str:
    """Exchange refresh token for a YouTube API access token."""
    client_secrets = json.loads(get_secret(gcp_token, SECRET_CLIENT))
    installed = client_secrets.get("installed") or client_secrets.get("web")
    secret_id = oauth_secret_for_channel(
        publish_channel, fs_get_channel_registry_entry(gcp_token, owner_uid, publish_channel)
    )
    refresh_token = get_secret(gcp_token, secret_id).strip()
    if not refresh_token:
        raise RuntimeError(f"YouTube refresh token secret is empty: {secret_id}")

    body = urllib.parse.urlencode({
        "client_id":     installed["client_id"],
        "client_secret": installed["client_secret"],
        "refresh_token": refresh_token,
        "grant_type":    "refresh_token",
    }).encode()
    req = urllib.request.Request(YT_TOKEN_URL, data=body, method="POST",
                                  headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read())["access_token"]
    except urllib.error.HTTPError as e:
        detail = http_error_detail(e)
        raise RuntimeError(
            f"YouTube token exchange failed for channel={publish_channel} secret={secret_id}: {detail}"
        ) from e


def _fs_get_optional(gcp_token: str, doc_path: str) -> dict | None:
    if not doc_path:
        return None
    safe = "/".join(urllib.parse.quote(part, safe="") for part in doc_path.split("/"))
    url = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/{DATABASE}/documents/{safe}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {gcp_token}"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise


def fs_get_channel_registry_entry(gcp_token: str, owner_uid: str, channel: str) -> dict:
    """users/{uid}/youtubeChannels/{channel} -> {channel: {tokenSecret, enabled}}; {} if not that user's."""
    if not (gcp_token and owner_uid and channel):
        return {}
    doc = _fs_get_optional(gcp_token, user_channel_path(owner_uid, channel))
    if not doc:
        return {}
    f = doc.get("fields", {})
    return {channel: {
        "tokenSecret": f.get("tokenSecret", {}).get("stringValue", ""),
        "enabled": f.get("enabled", {}).get("booleanValue", True),
    }}


def fs_get_channel_map_entry(gcp_token: str, owner_uid: str, account: str) -> dict:
    """users/{uid}/publishChannelMap/{account} -> {account: channel} or {}."""
    if not (gcp_token and owner_uid and account):
        return {}
    doc = _fs_get_optional(gcp_token, user_map_path(owner_uid, account))
    channel = (doc or {}).get("fields", {}).get("channel", {}).get("stringValue", "")
    return {account: channel} if channel else {}


def resolve_publish_target(doc: dict, queue_doc: dict | None = None, gcp_token: str = "") -> tuple[str, str]:
    """(ownerUid, channel) for this publish, checked against the owner's own linked channels.

    Raises UnmappedPublishChannel instead of falling back to any default channel.
    """
    owner = queue_val(queue_doc, "ownerUid")
    if not owner:
        raise UnmappedPublishChannel(
            "Queue row has no ownerUid, so its YouTube channel cannot be verified. Re-queue it from the Vault."
        )
    channel = queue_val(queue_doc, "ytPublishChannel")
    account = ""
    if not channel:
        label = fs_val(doc, "account_label") or canonical_account_label(fs_val(doc, "handle"))
        handle = fs_val(doc, "account_handle") or fs_val(doc, "handle")
        source = fs_val(doc, "account_sourceId") or fs_val(doc, "sourceId")
        account = account_key(account_label=label, account_handle=handle, source_id=source)
        channel = resolve_publish_channel(
            account_label=label, account_handle=handle, source_id=source,
            channel_map=fs_get_channel_map_entry(gcp_token, owner, account),
        )
    if not channel:
        raise UnmappedPublishChannel(unmapped_message(account))
    # Ownership check: the channel must be one of this user's linked channels.
    oauth_secret_for_channel(channel, fs_get_channel_registry_entry(gcp_token, owner, channel))
    return owner, channel


def get_token_scopes(access_token: str) -> set[str]:
    """Return the scopes attached to an OAuth access token."""
    query = urllib.parse.urlencode({"access_token": access_token})
    req = urllib.request.Request(f"{YT_TOKENINFO_URL}?{query}")
    with urllib.request.urlopen(req, timeout=15) as r:
        payload = json.loads(r.read())
    raw_scope = str(payload.get("scope", "")).strip()
    if not raw_scope:
        return set()
    return {part.strip() for part in raw_scope.split() if part.strip()}


# ── Firestore helpers ──────────────────────────────────────────────────────────

def fs_get(gcp_token: str, song_key: str) -> dict:
    url = (f"https://firestore.googleapis.com/v1/projects/{PROJECT}"
           f"/databases/{DATABASE}/documents/sunoSongs/{song_key}")
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {gcp_token}"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())


def fs_patch(gcp_token: str, song_key: str, fields: dict):
    """PATCH specific fields on a sunoSongs document."""
    mask = "&".join(f"updateMask.fieldPaths={k}" for k in fields)
    url = (f"https://firestore.googleapis.com/v1/projects/{PROJECT}"
           f"/databases/{DATABASE}/documents/sunoSongs/{song_key}?{mask}")
    body = json.dumps({"fields": fields}).encode()
    req = urllib.request.Request(url, data=body, method="PATCH",
                                  headers={"Authorization": f"Bearer {gcp_token}",
                                           "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())


def fs_val(doc: dict, field: str, kind: str = "stringValue") -> str:
    return doc.get("fields", {}).get(field, {}).get(kind, "")


def fs_map(doc: dict, field: str) -> dict:
    return doc.get("fields", {}).get(field, {}).get("mapValue", {}).get("fields", {})


def fs_array_strings(doc: dict, field: str) -> list[str]:
    values = doc.get("fields", {}).get(field, {}).get("arrayValue", {}).get("values", [])
    return [str(v.get("stringValue", "")).strip() for v in values if str(v.get("stringValue", "")).strip()]


def queue_val(queue_doc: dict | None, field: str, kind: str = "stringValue") -> str:
    return (queue_doc or {}).get("fields", {}).get(field, {}).get(kind, "")


def parse_gs_uri(gs_uri: str) -> tuple[str, str]:
    if not gs_uri.startswith("gs://"):
        raise ValueError(f"Expected gs:// URI, got: {gs_uri}")
    rest = gs_uri[len("gs://"):]
    parts = rest.split("/", 1)
    if len(parts) != 2 or not parts[0] or not parts[1]:
        raise ValueError(f"Invalid gs:// URI: {gs_uri}")
    return parts[0], parts[1]


# ── GCS download ──────────────────────────────────────────────────────────────

def download_gcs_media(gcp_token: str, bucket: str, object_path: str) -> bytes:
    """Stream an object from GCS into memory."""
    url = (f"https://storage.googleapis.com/storage/v1/b/{bucket}"
           f"/o/{urllib.parse.quote(object_path, safe='')}?alt=media")
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {gcp_token}"})
    chunks = []
    with urllib.request.urlopen(req, timeout=120) as r:
        while True:
            chunk = r.read(CHUNK_SIZE)
            if not chunk:
                break
            chunks.append(chunk)
    return b"".join(chunks)


def download_http_bytes(url: str) -> bytes:
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def parse_public_gcs_url(url: str) -> tuple[str, str] | tuple[None, None]:
    try:
        parsed = urllib.parse.urlparse(url)
    except Exception:
        return None, None

    host = (parsed.netloc or "").lower()
    path = parsed.path.lstrip("/")
    if host == "storage.googleapis.com" and "/" in path:
        bucket, object_path = path.split("/", 1)
        if bucket and object_path:
            return bucket, object_path
    return None, None


def ensure_nonempty_media(data: bytes, bucket: str, object_path: str):
    """Fail early with a high-signal operator-facing error for empty media."""
    if data:
        return
    gs_uri = f"gs://{bucket}/{object_path}"
    raise RuntimeError(
        f"Media file is empty (0 bytes): {gs_uri}. "
        "Recapture or repair the source video object before retrying YouTube upload."
    )


# ── YouTube resumable upload ───────────────────────────────────────────────────

def yt_initiate_upload(yt_token: str, metadata: dict, content_length: int) -> str:
    """Start a resumable upload session and return the upload URI."""
    params = urllib.parse.urlencode({
        "uploadType": "resumable",
        "part": "snippet,status",
    })
    url = f"{YT_UPLOAD_URL}?{params}"
    body = json.dumps(metadata).encode()
    req = urllib.request.Request(url, data=body, method="POST", headers={
        "Authorization":           f"Bearer {yt_token}",
        "Content-Type":            "application/json; charset=UTF-8",
        "X-Upload-Content-Type":   "video/mp4",
        "X-Upload-Content-Length": str(content_length),
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.headers["Location"]
    except urllib.error.HTTPError as e:
        detail = http_error_detail(e)
        raise RuntimeError(f"YouTube initiation HTTP {e.code}: {detail}") from e


def yt_upload_chunks(yt_token: str, upload_uri: str, data: bytes) -> str:
    """Upload data in chunks; return video ID on success."""
    total = len(data)
    offset = 0
    for attempt in range(MAX_RETRIES):
        chunk = data[offset:offset + CHUNK_SIZE]
        end = offset + len(chunk) - 1
        req = urllib.request.Request(upload_uri, data=chunk, method="PUT", headers={
            "Authorization":  f"Bearer {yt_token}",
            "Content-Type":   "video/mp4",
            "Content-Range":  f"bytes {offset}-{end}/{total}",
        })
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                resp = json.loads(r.read())
                return resp["id"]
        except urllib.error.HTTPError as e:
            if e.code == 308:  # Resume Incomplete
                rng = e.headers.get("Range", "")
                if rng:
                    offset = int(rng.split("-")[1]) + 1
                print(f"  chunk ok offset={offset}/{total}", file=sys.stderr)
                continue
            if e.code in (500, 502, 503, 504) and attempt < MAX_RETRIES - 1:
                time.sleep(2 ** attempt)
                continue
            detail = http_error_detail(e)
            raise RuntimeError(f"YouTube chunk upload HTTP {e.code}: {detail}") from e
    raise RuntimeError("Upload failed after max retries")


def yt_insert_caption(
    yt_token: str,
    video_id: str,
    caption_bytes: bytes,
    language: str = "en",
    name: str = "Vault Lyrics",
    is_draft: bool = False,
) -> str:
    params = urllib.parse.urlencode({
        "uploadType": "multipart",
        "part": "snippet",
    })
    url = f"{YT_CAPTIONS_UPLOAD_URL}?{params}"
    boundary = "aeonimus-boundary"
    metadata = {
        "snippet": {
            "videoId": video_id,
            "language": language,
            "name": name,
            "isDraft": is_draft,
        }
    }
    body = (
        f"--{boundary}\r\n"
        "Content-Type: application/json; charset=UTF-8\r\n\r\n"
        f"{json.dumps(metadata)}\r\n"
        f"--{boundary}\r\n"
        "Content-Type: text/vtt\r\n\r\n"
    ).encode("utf-8") + caption_bytes + f"\r\n--{boundary}--\r\n".encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST", headers={
        "Authorization": f"Bearer {yt_token}",
        "Content-Type": f"multipart/related; boundary={boundary}",
    })
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            resp = json.loads(r.read())
            return resp["id"]
    except urllib.error.HTTPError as e:
        detail = http_error_detail(e)
        if e.code == 403 and "insufficientPermissions" in detail:
            try:
                scopes = sorted(get_token_scopes(yt_token))
            except Exception:
                scopes = []
            scope_note = (
                f" Caption upload requires OAuth scopes {YT_SCOPE_UPLOAD} and {YT_SCOPE_CAPTIONS}."
            )
            if scopes:
                scope_note += f" Active token scopes: {', '.join(scopes)}."
            detail = f"{detail}{scope_note}"
        raise RuntimeError(f"YouTube caption upload HTTP {e.code}: {detail}") from e


# ── Main upload flow ───────────────────────────────────────────────────────────

def normalized_privacy(value: str | None) -> str:
    value = (value or "").strip().lower()
    return value if value in {"public", "private", "unlisted"} else "public"


def normalized_license(value: str | None) -> str:
    value = (value or "").strip()
    return value if value in {"youtube", "creativeCommon"} else "youtube"


def normalized_language(value: str | None) -> str:
    value = (value or "").strip()
    return value if _LANG_RE.match(value) else "en"


def split_csvish(value: str | None) -> list[str]:
    return [part.strip() for part in str(value or "").split(",") if part.strip()]


def dedupe_keep_order(values: list[str]) -> list[str]:
    seen: set[str] = set()
    normalized: list[str] = []
    for value in values:
        key = value.strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        normalized.append(value.strip())
    return normalized


def normalize_whitespace(value: str | None) -> str:
    return re.sub(r"\s+", " ", sanitize_youtube_text(value, multiline=False)).strip()


def normalize_multiline(value: str | None) -> str:
    text = sanitize_youtube_text(value, multiline=True).replace("\r\n", "\n").replace("\r", "\n").replace("\\n", "\n")
    lines = [line.rstrip() for line in text.split("\n")]
    cleaned: list[str] = []
    blank = False
    for line in lines:
        stripped = line.strip()
        if not stripped:
            if cleaned and not blank:
                cleaned.append("")
            blank = True
            continue
        cleaned.append(stripped)
        blank = False
    return "\n".join(cleaned).strip()


def sanitize_youtube_text(
    value: str | None,
    *,
    multiline: bool,
    strict_ascii: bool = False,
) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).translate(_YOUTUBE_TEXT_REPLACEMENTS)
    cleaned_chars: list[str] = []
    for char in text:
        category = unicodedata.category(char)
        if char in {"\n", "\r", "\t"}:
            cleaned_chars.append(char if multiline else " ")
            continue
        if category.startswith("C"):
            continue
        cleaned_chars.append(char)
    cleaned = "".join(cleaned_chars)
    if strict_ascii:
        cleaned = unicodedata.normalize("NFKD", cleaned).encode("ascii", "ignore").decode("ascii")
    return cleaned


def sanitize_youtube_tags(tags: list[str]) -> list[str]:
    cleaned: list[str] = []
    for tag in tags:
        normalized = normalize_whitespace(sanitize_youtube_text(tag, multiline=False, strict_ascii=True))
        if normalized:
            cleaned.append(normalized[:30])
    return dedupe_keep_order(cleaned)[:15]


def sanitize_youtube_description(value: str, *, strict_ascii: bool = False) -> str:
    text = sanitize_youtube_text(value, multiline=True, strict_ascii=strict_ascii)
    text = normalize_multiline(text)
    return text[:5000]


def fallback_publish_description(doc: dict, song_key: str) -> str:
    title = normalize_whitespace(fs_val(doc, "title") or song_key)
    styles = [normalize_whitespace(style) for style in derive_publish_styles(doc)[:6] if normalize_whitespace(style)]
    sections = [title] if title else [song_key]
    if styles:
        sections.append(f"Styles: {', '.join(styles)}")
    return sanitize_youtube_description("\n\n".join(sections), strict_ascii=True)


def derive_publish_title(doc: dict, song_key: str, queue_doc: dict | None = None) -> str:
    override_title = queue_val(queue_doc, "ytTitle")
    title = override_title or fs_val(doc, "title") or fs_val(doc, "songKey") or song_key
    return normalize_whitespace(title)[:100] or song_key[:100]


def derive_publish_styles(doc: dict) -> list[str]:
    styles = fs_array_strings(doc, "styles")
    if styles:
        return styles
    style_text = split_csvish(fs_val(doc, "styleText"))
    if style_text:
        return style_text
    display_tags = fs_array_strings(doc, "displayTags")
    if display_tags:
        return display_tags
    return fs_array_strings(doc, "tags")


def derive_publish_tags(doc: dict, song_key: str, queue_doc: dict | None = None) -> list[str]:
    override_tags = split_csvish(queue_val(queue_doc, "ytTags"))
    if override_tags:
        return dedupe_keep_order(override_tags)[:15]

    tags: list[str] = []
    title = normalize_whitespace(fs_val(doc, "title") or song_key)
    account = normalize_whitespace(fs_val(doc, "handle"))
    if account:
        tags.append(account)
    if title:
        tags.append(title)
        title_words = [word for word in _PUBLISH_TAG_WORD_RE.findall(title) if len(word) > 2]
        tags.extend(title_words[:6])
    tags.extend(derive_publish_styles(doc))
    return dedupe_keep_order(tags)[:15]


def derive_lyrics_excerpt(doc: dict, max_lines: int = 8, max_chars: int = 900) -> str:
    lyrics = normalize_multiline(fs_val(doc, "lyrics"))
    if not lyrics:
        return ""
    lines = [line.strip() for line in lyrics.split("\n") if line.strip()]
    excerpt = "\n".join(lines[:max_lines]).strip()
    if len(excerpt) > max_chars:
        excerpt = excerpt[: max_chars - 1].rstrip() + "…"
    return excerpt


def normalized_lyrics_policy(value: str | None) -> str:
    value = (value or "").strip().lower()
    return value if value in {"none", "excerpt", "full"} else "excerpt"


def normalized_prompt_policy(value: str | None) -> str:
    value = (value or "").strip().lower()
    return value if value in {"none", "excerpt", "full-note"} else "none"


def derive_prompt_excerpt(doc: dict, max_chars: int = 500) -> str:
    prompt = normalize_multiline(fs_val(doc, "prompt"))
    if not prompt:
        return ""
    if len(prompt) <= max_chars:
        return prompt
    return prompt[: max_chars - 1].rstrip() + "…"


def derive_publish_description(doc: dict, queue_doc: dict | None = None) -> str:
    override_desc = queue_val(queue_doc, "ytDescription")
    if override_desc:
        return normalize_multiline(override_desc)[:5000]

    blurb = normalize_multiline(fs_val(doc, "description")) or normalize_multiline(fs_val(doc, "caption"))
    styles = derive_publish_styles(doc)
    prompt_policy = normalized_prompt_policy(queue_val(queue_doc, "ytPromptPolicy"))
    full_prompt = normalize_multiline(fs_val(doc, "prompt"))
    prompt_excerpt = derive_prompt_excerpt(doc)
    lyrics_policy = normalized_lyrics_policy(queue_val(queue_doc, "ytLyricsPolicy"))
    full_lyrics = normalize_multiline(fs_val(doc, "lyrics"))
    lyrics_excerpt = derive_lyrics_excerpt(doc)
    sections: list[str] = []
    if blurb:
        sections.append(blurb)
    if styles:
        sections.append(f"Styles: {', '.join(styles[:8])}")
    if prompt_policy == "full-note" and full_prompt:
        sections.append(f"Creation note:\n{full_prompt}")
    elif prompt_policy == "excerpt" and prompt_excerpt:
        sections.append(f"Creation note:\n{prompt_excerpt}")
    if lyrics_policy == "full" and full_lyrics:
        sections.append(f"Lyrics:\n{full_lyrics}")
    elif lyrics_policy == "excerpt" and lyrics_excerpt:
        sections.append(f"Lyrics excerpt:\n{lyrics_excerpt}")
    if not sections:
        sections.append(normalize_whitespace(fs_val(doc, "title") or fs_val(doc, "songKey")))
    return "\n\n".join(section for section in sections if section).strip()[:5000]


def format_vtt_timestamp(seconds: float) -> str:
    total_ms = max(0, int(round(seconds * 1000)))
    hours = total_ms // 3_600_000
    remainder = total_ms % 3_600_000
    minutes = remainder // 60_000
    remainder %= 60_000
    secs = remainder // 1000
    millis = remainder % 1000
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{millis:03d}"


def build_synthetic_vtt_from_doc(doc: dict) -> bytes:
    lyrics = normalize_multiline(fs_val(doc, "lyrics"))
    if not lyrics:
        return b""

    blocks: list[list[str]] = []
    current: list[str] = []
    for raw_line in lyrics.split("\n"):
        line = raw_line.strip()
        if not line:
            if current:
                blocks.append(current)
                current = []
            continue
        current.append(line)
    if current:
        blocks.append(current)

    lines = [
        "WEBVTT",
        "",
        "NOTE Synthetic pacing artifact generated from Vault lyrics.",
        "NOTE Timing is approximate and provided for portability only.",
        "",
    ]
    cursor = 0.0
    for index, block in enumerate(blocks, start=1):
        word_count = len(" ".join(block).split())
        duration = max(2.0, min(8.0, 1.2 + (word_count / 2.6)))
        start = format_vtt_timestamp(cursor)
        end = format_vtt_timestamp(cursor + duration)
        cursor += duration + 0.35
        lines.extend([
            str(index),
            f"{start} --> {end}",
            "\n".join(block),
            "",
        ])
    return "\n".join(lines).encode("utf-8")


def resolve_caption_payload(gcp_token: str, doc: dict) -> tuple[bytes, str]:
    vtt_url = fs_val(doc, "gcsLyricsVtt")
    if vtt_url:
        bucket, object_path = parse_public_gcs_url(vtt_url)
        if bucket and object_path:
            return download_gcs_media(gcp_token, bucket, object_path), "gcsLyricsVtt"
        return download_http_bytes(vtt_url), "gcsLyricsVtt"

    synthetic = build_synthetic_vtt_from_doc(doc)
    if synthetic:
        return synthetic, "lyrics-synthetic"
    return b"", ""


def maybe_upload_lyrics_caption(
    gcp_token: str,
    yt_token: str,
    doc: dict,
    song_key: str,
    video_id: str,
    queue_doc: dict | None = None,
) -> dict[str, dict]:
    caption_bytes, source = resolve_caption_payload(gcp_token, doc)
    if not caption_bytes:
        return {
            "ytCaptionsStatus": {"stringValue": "missing"},
            "ytCaptionsTrackId": {"stringValue": ""},
            "ytCaptionsUpdatedAt": {"stringValue": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")},
            "ytCaptionsSource": {"stringValue": ""},
            "ytCaptionsError": {"stringValue": ""},
        }

    language = normalized_language(queue_val(queue_doc, "ytLanguage") or fs_val(doc, "language") or "en")
    try:
        track_id = yt_insert_caption(
            yt_token,
            video_id,
            caption_bytes,
            language=language,
            name="Vault Lyrics",
            is_draft=False,
        )
        print(f"  captions uploaded → trackId={track_id} source={source}")
        return {
            "ytCaptionsStatus": {"stringValue": "done"},
            "ytCaptionsTrackId": {"stringValue": track_id},
            "ytCaptionsUpdatedAt": {"stringValue": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")},
            "ytCaptionsSource": {"stringValue": source},
            "ytCaptionsError": {"stringValue": ""},
        }
    except Exception as exc:
        print(f"  [WARN] caption upload skipped for {song_key}: {exc}", file=sys.stderr)
        return {
            "ytCaptionsStatus": {"stringValue": "error"},
            "ytCaptionsTrackId": {"stringValue": ""},
            "ytCaptionsUpdatedAt": {"stringValue": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")},
            "ytCaptionsSource": {"stringValue": source},
            "ytCaptionsError": {"stringValue": str(exc)[:500]},
        }


def normalized_category(value: str | None) -> str:
    value = (value or "").strip()
    return value if value.isdigit() else CATEGORY_ID


def build_yt_metadata(
    doc: dict,
    song_key: str,
    queue_doc: dict | None = None,
    minimal: bool = False,
) -> dict:
    """
    Build YouTube video resource metadata.

    Priority:
      1. Per-song overrides stored in the ytUploadQueue queue_doc (set by the Vault UI)
      2. Fields from the sunoSongs Firestore doc (title, description, caption, styles, lyrics)
      3. Hard-coded defaults

    queue_doc fields used: ytTitle, ytDescription, ytTags, ytPromptPolicy, ytLyricsPolicy,
                           ytPrivacy, ytLanguage, ytLicense, ytCategory,
                           ytAlteredContent, ytShortsRemixing
    """
    title = derive_publish_title(doc, song_key, queue_doc=queue_doc)
    description = derive_publish_description(doc, queue_doc=queue_doc)
    tags = derive_publish_tags(doc, song_key, queue_doc=queue_doc)

    # Apply per-song overrides from queue doc
    qf = (queue_doc or {}).get("fields", {})
    def qval(key: str, kind: str = "stringValue", default=None):
        return qf.get(key, {}).get(kind, default)

    override_privacy = qval("ytPrivacy")
    override_lang    = qval("ytLanguage")
    override_license = qval("ytLicense")
    override_cat     = qval("ytCategory")
    override_altered = qval("ytAlteredContent", "booleanValue", None)
    override_shorts  = qval("ytShortsRemixing", "booleanValue", None)

    final_title = normalize_whitespace(
        sanitize_youtube_text(title, multiline=False, strict_ascii=minimal)
    )[:100] or song_key[:100]
    final_description = (
        fallback_publish_description(doc, song_key)
        if minimal
        else sanitize_youtube_description(description, strict_ascii=False)
    )
    if not final_description:
        final_description = fallback_publish_description(doc, song_key)
    final_privacy     = normalized_privacy(override_privacy)
    final_category    = normalized_category(override_cat)
    final_license     = normalized_license(override_license)
    final_language    = normalized_language(override_lang)
    # AI-altered: default True for AI-generated music; override if specified
    final_altered     = override_altered if override_altered is not None else True
    # Shorts remixing: default allow
    final_shorts      = override_shorts if override_shorts is not None else True

    metadata = {
        "snippet": {
            "title":           final_title,
            "description":     final_description,
            "categoryId":      final_category,
        },
        "status": {
            "privacyStatus":           final_privacy,
            "madeForKids":             False,
        },
    }

    if not minimal:
        metadata["snippet"]["tags"] = sanitize_youtube_tags(tags)
        metadata["snippet"]["defaultLanguage"] = final_language
        metadata["status"]["selfDeclaredMadeForKids"] = False
        metadata["status"]["license"] = final_license

        # AI-generated content / altered content disclosure
        if final_altered:
            metadata["status"]["containsSyntheticMedia"] = True

        # Shorts remixing (allowShareRemix)
        # Note: not available in all API versions; include as best-effort
        metadata["status"]["allowShareRemix"] = final_shorts

    return metadata


def resolve_video_gcs_location(doc: dict, song_key: str) -> tuple[str, str, str]:
    media = fs_map(doc, "media")
    media_video = media.get("videoUrl", {}).get("stringValue", "")
    if media_video:
        bucket, object_path = parse_gs_uri(media_video)
        return bucket, object_path, "media.videoUrl"

    gcs_path = fs_val(doc, "gcsPath")
    if gcs_path:
        if gcs_path.startswith("gs://"):
            bucket, object_path = parse_gs_uri(gcs_path)
            return bucket, object_path, "gcsPath"
        return DEFAULT_GCS_BUCKET, gcs_path.lstrip("/"), "gcsPath"

    handle = fs_val(doc, "handle")
    if handle:
        return DEFAULT_GCS_BUCKET, f"{MEDIA_PREFIX}{handle}/{song_key}.mp4", "handle-fallback"

    return DEFAULT_GCS_BUCKET, f"{MEDIA_PREFIX}{song_key}.mp4", "songKey-fallback"


def existing_uploaded_video(doc: dict) -> tuple[str, str]:
    yt_video_id = fs_val(doc, "ytVideoId")
    yt_canonical_url = fs_val(doc, "ytCanonicalUrl")

    if yt_video_id:
        _, canonical_url = canonicalize_yt_url(f"https://www.youtube.com/watch?v={yt_video_id}")
        return yt_video_id, canonical_url or yt_canonical_url

    if yt_canonical_url:
        video_id, canonical_url = canonicalize_yt_url(yt_canonical_url)
        if video_id:
            return video_id, canonical_url or yt_canonical_url

    return "", ""


def needs_caption_retry(doc: dict) -> bool:
    status = (fs_val(doc, "ytCaptionsStatus") or "").strip().lower()
    if status in {"", "missing", "error"}:
        return True
    track_id = (fs_val(doc, "ytCaptionsTrackId") or "").strip()
    return not track_id


def republish_history_fields(doc: dict, previous_id: str, at: str, is_republish: bool) -> dict:
    """Keep the earlier video in history when a song is deliberately published again."""
    if not (is_republish and previous_id):
        return {}
    prev = [v.get("stringValue", "") for v in
            doc.get("fields", {}).get("ytPreviousVideoIds", {}).get("arrayValue", {}).get("values", [])]
    prev = [v for v in prev if v] + [previous_id]
    return {
        "ytPreviousVideoIds": {"arrayValue": {"values": [{"stringValue": v} for v in prev]}},
        "ytRepublishedAt": {"stringValue": at},
    }


def upload_clip(
    gcp_token: str,
    song_key:  str,
    dry_run:   bool = False,
    queue_doc: dict | None = None,   # ytUploadQueue document (for per-song overrides)
) -> str | None:
    print(f"\n[uploader] song_key={song_key} dry_run={dry_run}")

    # 1 — Fetch Firestore sunoSongs doc
    doc = fs_get(gcp_token, song_key)

    # ── Duplicate-upload guard ────────────────────────────────────────────────
    # If a durable YouTube result already exists, skip to prevent duplicates.
    existing_yt_id, existing_canonical = existing_uploaded_video(doc)
    # A confirmed "publish again" from the Vault carries republishOf=<current video id>.
    republish_of = queue_val(queue_doc, "republishOf")
    is_republish = bool(existing_yt_id) and republish_of == existing_yt_id
    if is_republish:
        print(f"  republish confirmed in Vault: previous ytVideoId={existing_yt_id}")
    if existing_yt_id and dry_run and not is_republish:
        # Dry runs must exercise the guard too, but never write or call YouTube.
        print(f"  [DRY RUN] duplicate guard: already uploaded ytVideoId={existing_yt_id}; would skip upload")
        return existing_yt_id

    owner_uid, publish_channel = resolve_publish_target(doc, queue_doc, gcp_token)
    print(f"  publish_channel={publish_channel} owner={owner_uid}")

    if existing_yt_id and not is_republish:
        yt_token = get_youtube_token(gcp_token, publish_channel, owner_uid)
        patch_fields = {
            "ytStatus": {"stringValue": "done"},
            "ytError": {"stringValue": ""},
            "ytErrorAt": {"stringValue": ""},
        }
        if not fs_val(doc, "ytCanonicalUrl") and existing_canonical:
            patch_fields["ytCanonicalUrl"] = {"stringValue": existing_canonical}
        retried_captions = False
        if needs_caption_retry(doc):
            patch_fields.update(
                maybe_upload_lyrics_caption(
                    gcp_token,
                    yt_token,
                    doc,
                    song_key,
                    existing_yt_id,
                    queue_doc=queue_doc,
                )
            )
            retried_captions = True
        fs_patch(gcp_token, song_key, patch_fields)
        if retried_captions:
            print(
                f"  [SKIP] Already uploaded: ytVideoId={existing_yt_id} → {existing_canonical} "
                "(caption retry attempted)"
            )
        else:
            print(f"  [SKIP] Already uploaded: ytVideoId={existing_yt_id} → {existing_canonical}")
        return existing_yt_id
    # ─────────────────────────────────────────────────────────────────────────

    bucket, object_path, resolution_source = resolve_video_gcs_location(doc, song_key)
    print(f"  gcs_path=gs://{bucket}/{object_path} source={resolution_source}")

    if dry_run:
        print("  [DRY RUN] would upload to YouTube — skipping")
        return None

    # 2 — Mark uploading in Firestore
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    fs_patch(gcp_token, song_key, {
        "ytStatus":   {"stringValue": "uploading"},
        "ytStartedAt": {"stringValue": now},
    })

    try:
        # 3 — Get YouTube token
        yt_token = get_youtube_token(gcp_token, publish_channel, owner_uid)

        # 4 — Download media from GCS
        print("  downloading media from GCS...")
        media_bytes = download_gcs_media(gcp_token, bucket, object_path)
        print(f"  downloaded {len(media_bytes):,} bytes")
        ensure_nonempty_media(media_bytes, bucket, object_path)

        # 5 — Build metadata and initiate resumable upload
        metadata = build_yt_metadata(doc, song_key, queue_doc=queue_doc)
        print(f"  initiating upload: title={metadata['snippet']['title']!r}")
        try:
            upload_uri = yt_initiate_upload(yt_token, metadata, len(media_bytes))
        except RuntimeError as e:
            if "YouTube initiation HTTP 400" not in str(e):
                raise
            fallback_metadata = build_yt_metadata(doc, song_key, queue_doc=queue_doc, minimal=True)
            print("  [WARN] init 400 with full metadata; retrying with minimal metadata", file=sys.stderr)
            upload_uri = yt_initiate_upload(yt_token, fallback_metadata, len(media_bytes))

        # 6 — Upload chunks
        video_id = yt_upload_chunks(yt_token, upload_uri, media_bytes)
        print(f"  uploaded → videoId={video_id}")

        caption_patch = maybe_upload_lyrics_caption(gcp_token, yt_token, doc, song_key, video_id, queue_doc=queue_doc)

        # 7 — Write back to Firestore (canonical URL per canonicalization spec)
        done_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        _, canonical_url = canonicalize_yt_url(f"https://www.youtube.com/watch?v={video_id}")
        fs_patch(gcp_token, song_key, {
            "ytVideoId":      {"stringValue": video_id},
            "ytCanonicalUrl": {"stringValue": canonical_url or ""},
            "ytStatus":       {"stringValue": "done"},
            "ytUploadedAt":   {"stringValue": done_at},
            "ytPublishedAt":  {"stringValue": done_at},
            "ytError":        {"stringValue": ""},
            "ytErrorAt":      {"stringValue": ""},
            # Where and how it went out, for the Vault's "already on YouTube" warning.
            "ytPublishChannel": {"stringValue": publish_channel},
            "ytPrivacy":      {"stringValue": metadata["status"].get("privacyStatus", "")},
            **republish_history_fields(doc, existing_yt_id, done_at, is_republish),
            **caption_patch,
        })
        print(f"  Firestore updated: ytVideoId={video_id} → {canonical_url}")
        return video_id

    except Exception as e:
        err_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        queue_context = ""
        requested_from = queue_val(queue_doc, "requestedFrom")
        if requested_from:
            queue_context = f" [requestedFrom={requested_from}]"
        error_text = str(e)
        if isinstance(e, urllib.error.HTTPError):
            try:
                detail = http_error_detail(e)
                if detail and detail not in error_text:
                    error_text = f"{error_text} :: {detail}"
            except Exception:
                pass
        fs_patch(gcp_token, song_key, {
            "ytStatus":  {"stringValue": "error"},
            "ytError":   {"stringValue": error_text[:500]},
            "ytErrorAt": {"stringValue": err_at},
        })
        print(f"  [ERROR]{queue_context} {error_text}", file=sys.stderr)
        raise


# ── CLI ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Upload a Suno clip to YouTube")
    parser.add_argument("--song-key", required=True, help="Firestore sunoSongs document ID")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    gcp_token = get_gcp_token()
    upload_clip(gcp_token, args.song_key, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
