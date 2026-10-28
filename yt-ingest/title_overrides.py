"""Vault title overrides and best-guess titles.

One JSON object in GCS (TITLE_OVERRIDES_GCS) maps song id -> entry:
    {"title": str, "source": "user" | "old_file", "setBy": str, "setAt": ISO,
     "previousTitle": str, "note": str (optional)}
The committed seed (fixtures/title_overrides.seed.json) holds titles recovered from
older files; it is only used for ids the GCS object does not have.

Precedence (see apply_titles):
  1. a title the owner typed in the Vault (source "user") always wins
  2. Suno's own title from Firestore
  3. an old-file title (source "old_file"), shown as a best guess
  4. the first real lyric line, shown as "Title from lyrics"
  5. blank (the Vault shows "Untitled")
The viewer server applies the same rules at serve time (suno-viewer/title-overrides.cjs),
so edits show immediately without waiting for a harvest.
"""

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request

TITLE_OVERRIDES_GCS = os.environ.get(
    "TITLE_OVERRIDES_GCS", "gs://aeonimus-workspaces/exports/suno/state/title_overrides.json"
)
SEED_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "title_overrides.seed.json")
LYRIC_TITLE_MAX = 80

SECTION_WORDS = (
    "verse|chorus|pre[- ]?chorus|post[- ]?chorus|hook|bridge|intro|outro|interlude|refrain|"
    "break|breakdown|drop|build|build[- ]?up|instrumental|solo|guitar solo|spoken|spoken word|"
    "end|ending|fade|fade out|coda|tag|vamp|ad[- ]?libs?|outro chorus|final chorus|instrumental break"
)
_SECTION_RE = re.compile(rf"^\s*(?:{SECTION_WORDS})(?:\s*[\divx]+)?\s*(?:[:\-–—|].*)?$", re.I)
_BRACKETED_RE = re.compile(r"\[[^\]]*\]|\([^)]*\)|\{[^}]*\}|<[^>]*>|\*[^*]*\*")
# "Guitar: low-gain, palm-muted" style production notes.
_NOTE_RE = re.compile(r"^[A-Za-z][A-Za-z /&+'-]{0,30}:\s")

# Cautious "Title from lyrics" (matches title-overrides.cjs): skip lines that are clearly not
# sung lyrics and use the first real lyric line below them; otherwise stay Untitled.
_HEADING_RE = re.compile(r"^#+")
_LABEL_RE = re.compile(r"^(?:(?:the|full|final|song|new)\s+)?(?:lyrics?|song|title|track|untitled|chorus|verse|intro|outro|hook|bridge)(?:\s+(?:lyrics?|below|here))?$", re.I)
_FILLER_RE = re.compile(r"^(?:(?:now|so|ok(?:ay)?|and)[\s,]+)?(?:(?:the|your|my|full|final)\s+)*(?:song|lyrics|track)s?$", re.I)
_CHATTER_RE = re.compile(r"^(?:here(?:'s|\u2019s|\s+is|\s+are)|understood|below\s+is|as\s+requested|great\s+question|absolutely|certainly|of\s+course|got\s+it|sure|okay|ok)\b", re.I)
_COUNT_RE = re.compile(r"\b\d[\d,.]*\s*-?\s*(?:characters?|chars?)\b|\bcharacter\s+(?:count|limit)\b", re.I)


def is_junk_lyric_line(line, limit=LYRIC_TITLE_MAX):
    if len(line) > limit:
        return True
    letters = len(re.findall(r"[^\W\d_]", line))
    visible = len(re.sub(r"\s+", "", line))
    alnum = len(re.findall(r"[^\W_]", line))
    if letters < 2 or alnum / visible < 0.6:
        return True
    return bool(_LABEL_RE.match(line) or _FILLER_RE.match(line) or _CHATTER_RE.match(line) or _COUNT_RE.search(line))


def split_lyric_lines(lyrics):
    text = str(lyrics or "").replace("\\r\\n", "\n").replace("\\n", "\n").replace("\r\n", "\n").replace("\r", "\n")
    return text.split("\n")


def clean_title(value, limit=200):
    text = re.sub(r"[\x00-\x1f\x7f]", " ", str(value or ""))
    return re.sub(r"\s+", " ", text).strip()[:limit].strip()


def pick_lyric_title(lyrics, limit=LYRIC_TITLE_MAX):
    """First line that is an actual sung lyric, or '' when there is none."""
    for raw in split_lyric_lines(lyrics):
        line = raw.strip()
        if not line:
            continue
        if _HEADING_RE.match(line):
            continue
        # Lines carrying an unbalanced bracket are fragments of a production note.
        if line.count("[") != line.count("]") or line.count("(") != line.count(")"):
            continue
        line = _BRACKETED_RE.sub(" ", line)
        line = clean_title(line)
        line = line.strip(" -–—|:;,").strip()
        if line.endswith(".") and not re.search(r"\b\w\.\w\.$", line):
            line = line.rstrip(".").strip()
        if not line or not re.search(r"[A-Za-z0-9]", line):
            continue
        if _SECTION_RE.match(line) or _NOTE_RE.match(line):
            continue
        if is_junk_lyric_line(line, limit):
            continue
        return line
    return ""


def _valid_entries(data):
    entries = data.get("overrides", data) if isinstance(data, dict) else {}
    out = {}
    for song_id, entry in (entries or {}).items():
        if isinstance(entry, dict) and clean_title(entry.get("title")) and str(song_id).strip():
            out[str(song_id).strip()] = entry
    return out


def load_seed(path=SEED_FILE):
    try:
        with open(path, encoding="utf-8") as fh:
            return _valid_entries(json.load(fh))
    except (OSError, ValueError):
        return {}


def load_gcs_overrides(token, gs_uri=TITLE_OVERRIDES_GCS):
    """Return the GCS overrides, {} when the object does not exist yet."""
    bucket, name = gs_uri[len("gs://"):].split("/", 1)
    url = (f"https://storage.googleapis.com/storage/v1/b/{bucket}/o/"
           f"{urllib.parse.quote(name, safe='')}?alt=media")
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        return _valid_entries(json.loads(urllib.request.urlopen(req, timeout=30).read()))
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return {}
        raise


def merged_overrides(gcs_entries, seed_entries):
    merged = dict(seed_entries or {})
    merged.update(gcs_entries or {})
    return merged


def resolve_title(row, override=None):
    """(title, titleSource) for one catalog row."""
    suno_title = clean_title(row.get("title"))
    if override and str(override.get("source") or "user") == "user":
        return clean_title(override.get("title")), "user"
    if suno_title:
        return suno_title, "suno"
    if override:
        return clean_title(override.get("title")), str(override.get("source") or "old_file")
    guess = pick_lyric_title(row.get("lyrics"))
    if guess:
        return guess, "lyrics"
    return "", ""


def apply_titles(rows, overrides):
    counts = {}
    for row in rows:
        title, source = resolve_title(row, overrides.get(str(row.get("songKey") or "")))
        row["title"] = title
        row["titleSource"] = source
        counts[source or "blank"] = counts.get(source or "blank", 0) + 1
    return counts
