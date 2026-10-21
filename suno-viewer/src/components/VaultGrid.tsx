import { Fragment, useEffect, useState, useMemo, useCallback, useRef, CSSProperties, type ReactNode } from 'react'
import { SunoSong, YouTubePublishState } from '../types'
import AudioPlayer from './AudioPlayer'
import AuthControls from './AuthControls'
import AccountMenu from './AccountMenu'
import { authFetch, useAuth } from '../lib/firebaseAuth'
import { SUNDROP_VAULT_NAME } from '../lib/branding'
import { getSearchMatchSummary, type SearchMatchSummary } from '../lib/search-utils'

const ACCOUNT_ALIASES: Record<string, string[]> = {
  vanessa_primary: ['vanessa_primary', 'unshakableechos2341', 'suno_unshakableechos2341'],
  vanessa_secondary: ['vanessa_secondary', 'nessihenize', 'suno_nessihenize', 'aeonimus'],
}

const ACCOUNT_DISPLAY_NAMES: Record<string, string> = {
  vanessa_primary: 'unshakableechos2341',
  vanessa_secondary: 'nessihenize',
}

const accountDisplayName = (account: string) => ACCOUNT_DISPLAY_NAMES[account] || account
const accountAliases = (account: string) => {
  const normalized = account.trim().toLowerCase()
  if (!normalized) return []
  const match = Object.values(ACCOUNT_ALIASES).find((aliases) => aliases.includes(normalized))
  return match || [normalized]
}
const accountsMatch = (left: string, right: string) => {
  const leftAliases = new Set(accountAliases(left))
  return accountAliases(right).some((alias) => leftAliases.has(alias))
}

// ── YouTube metadata types ────────────────────────────────────────────────────
type YtPrivacy = 'public' | 'private' | 'unlisted'
type YtLicense = 'youtube' | 'creativeCommon'
type YtLyricsPolicy = 'none' | 'excerpt' | 'full'
type YtPromptPolicy = 'none' | 'excerpt' | 'full-note'

interface YtMeta {
  title: string
  description: string
  tags: string
  promptPolicy: YtPromptPolicy
  lyricsPolicy: YtLyricsPolicy
  alteredContent: boolean   // AI-generated disclosure
  language: string
  license: YtLicense
  privacy: YtPrivacy
  shortsRemixing: boolean
  category: string
}

const DEFAULT_YT_META: YtMeta = {
  title: '',
  description: '',
  tags: '',
  promptPolicy: 'none',
  lyricsPolicy: 'excerpt',
  alteredContent: true,      // AI-generated content: default to true
  language: 'en',
  license: 'youtube',
  privacy: 'public',
  shortsRemixing: true,
  category: '10',            // Music
}

const YT_CATEGORIES: { value: string; label: string }[] = [
  { value: '10', label: 'Music' },
  { value: '22', label: 'People & Blogs' },
  { value: '24', label: 'Entertainment' },
  { value: '26', label: 'Howto & Style' },
  { value: '28', label: 'Science & Technology' },
]

type CatalogExportPart = {
  partName: string
  fileName: string
  rowCount: number
  assetCount: number
  estimatedBytes: number
  estimatedBytesLabel: string
  sizeBytes: number
  sizeLabel: string
  downloadUrl: string
  available?: boolean
}

type CatalogExportJob = {
  exportId: string
  workspaceId: string
  requestScope?: 'catalog' | 'selection' | 'song'
  requestAccountHandle?: string
  selectionCount?: number
  scopeLabel?: string
  requestLabel?: string
  status: 'preparing' | 'building' | 'ready' | 'partial' | 'error'
  phaseLabel?: string
  progressMessage?: string
  stepCurrent?: number
  stepTotal?: number
  currentPart?: number
  createdAt?: string
  updatedAt?: string
  expiresAt?: string
  totalRows: number
  totalAssets: number
  totalBytes: number
  totalBytesLabel?: string
  missingAssets: number
  partCount: number
  parts: CatalogExportPart[]
  manifestUrl: string
  summaryUrl?: string
  downloadReady?: boolean
  downloadUnavailableReason?: string
  error?: string
}

type CatalogDownloadListItem = {
  key: string
  label: string
  typeLabel: string
  sizeLabel: string
  actionLabel: string
  downloadUrl: string
  fileName: string
  available?: boolean
}

type DownloadAccess = {
  centerEnabled: boolean
  singleEnabled: boolean
  batchEnabled: boolean
  catalogEnabled: boolean
  maxBatchSize: number
}

type VaultFreshnessSummary = {
  status: 'healthy' | 'stale' | 'mismatch' | 'unavailable' | 'source_ahead' | 'source_idle'
  label: string
  detail: string
  generatedAt?: string
  hoursSinceGeneratedAt: number | null
  staleHours: number
  servingSource: 'gcs' | 'fallback' | 'unavailable'
  exportRowCount: number
  servedRowCount: number
  newestServedCreatedAt?: string
  latestSourceCreatedAt?: string
  sourceContentAgeHours: number | null
  sourceLeadHours: number | null
}

type VaultFreshnessPayload = {
  ok: boolean
  exportFreshness: VaultFreshnessSummary
  exportArtifact?: {
    generatedAt?: string
    rowCount?: number
    generator?: string
    artifact?: string
  }
  latestSourceSong?: {
    title?: string
    createdAt?: string
    accountHandle?: string
    accountLabel?: string
  } | null
  sourceAccounts?: Array<{
    title?: string
    createdAt?: string
    accountHandle?: string
    accountLabel?: string
    handle?: string
    sourceId?: string
  }>
}

type VaultSection = 'archives' | 'downloads' | 'security' | 'truth' | 'history'

const SUPPORT_EMAIL = 'blahnikdigitaldesigns@gmail.com'
const MISSING_ASSET_GRACE_MS = 24 * 60 * 60 * 1000

const catalogExportStatusLabel = (job: CatalogExportJob) => {
  if (job.phaseLabel) return job.phaseLabel
  switch (job.status) {
    case 'preparing':
      return 'Preparing'
    case 'building':
      return 'Building'
    case 'partial':
      return 'Partially ready'
    case 'ready':
      return 'Ready'
    case 'error':
      return 'Failed'
    default:
      return job.status
  }
}

const catalogExportRequestLabel = (job?: CatalogExportJob | null) => {
  if (!job) return 'Full catalog package'
  if (job.requestLabel) return job.requestLabel
  if (job.requestScope === 'song') return 'Single-song package'
  if (job.requestScope === 'selection') return 'Selected songs package'
  return 'Full catalog package'
}

const catalogExportScopeLabel = (job?: CatalogExportJob | null) => {
  if (!job) return 'Full catalog'
  if (job.scopeLabel) return job.scopeLabel
  if (job.requestScope === 'song') return 'Single song'
  if (job.requestScope === 'selection') {
    const count = job.selectionCount || 0
    return `${count.toLocaleString()} selected song${count === 1 ? '' : 's'}`
  }
  return 'Full catalog'
}

// ── CSV parser (supports quoted fields, escaped quotes, and embedded newlines) ──
function parseCSV(text: string): SunoSong[] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  const pushField = () => {
    row.push(field)
    field = ''
  }

  const pushRow = () => {
    const hasContent = row.some(cell => cell.trim() !== '') || field.trim() !== ''
    pushField()
    if (hasContent) rows.push(row)
    row = []
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const next = text[i + 1]

    if (ch === '"') {
      if (inQuotes && next === '"') {
        field += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (ch === ',' && !inQuotes) {
      pushField()
      continue
    }

    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i += 1
      pushRow()
      continue
    }

    field += ch
  }

  if (field.length > 0 || row.length > 0) {
    pushRow()
  }

  if (rows.length < 2) return []

  const headers = rows[0].map(header => header.trim())
  return rows
    .slice(1)
    .filter(candidate => candidate.some(value => value.trim() !== ''))
    .map(candidate => {
      const record: Record<string, string> = {}
      headers.forEach((header, idx) => {
        record[header] = candidate[idx] ?? ''
      })
      return record as unknown as SunoSong
    })
}

const fmtDur = (s: string) => {
  const n = parseFloat(s)
  if (isNaN(n)) return s
  return `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}`
}

const fmtDate = (iso: string) => {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    })
  } catch { return iso }
}

const fmtDateTime = (iso: string) => {
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    })
  } catch { return iso }
}

const fmtBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let scaled = bytes
  let index = 0
  while (scaled >= 1024 && index < units.length - 1) {
    scaled /= 1024
    index += 1
  }
  return `${scaled >= 10 || index === 0 ? scaled.toFixed(0) : scaled.toFixed(1)} ${units[index]}`
}

const isHttpUrl = (value?: string) =>
  Boolean(value && /^https?:\/\//i.test(value))

const isGsUrl = (value?: string) =>
  Boolean(value && /^gs:\/\//i.test(value))

const songMediaProxyUrl = (songKey?: string, kind?: 'audio' | 'thumb') => {
  const safeSongKey = String(songKey || '').trim()
  const safeKind = String(kind || '').trim()
  if (!safeSongKey || !['audio', 'thumb'].includes(safeKind)) return ''
  return `/api/song-media/${encodeURIComponent(safeSongKey)}/${safeKind}`
}

const isProtectedAssetUrl = (value?: string) =>
  Boolean(value && /^\/api\/(song-media|lyrics-artifact)\//.test(value))

function useProtectedAssetUrl(sourceUrl?: string) {
  const [resolvedUrl, setResolvedUrl] = useState(sourceUrl || '')

  useEffect(() => {
    let cancelled = false
    let objectUrl = ''
    const nextUrl = String(sourceUrl || '')

    if (!nextUrl) {
      setResolvedUrl('')
      return
    }

    if (!isProtectedAssetUrl(nextUrl)) {
      setResolvedUrl(nextUrl)
      return
    }

    const load = async () => {
      try {
        const response = await authFetch(nextUrl)
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }
        const blob = await response.blob()
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setResolvedUrl(objectUrl)
      } catch {
        if (!cancelled) {
          setResolvedUrl('')
        }
      }
    }

    setResolvedUrl('')
    void load()

    return () => {
      cancelled = true
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [sourceUrl])

  return resolvedUrl
}

const hasRenderableVaultIdentity = (song: SunoSong) =>
  Boolean(String(song.title || '').trim()) && Boolean(String(song.createdAt || '').trim())

const decodeEscapedMultiline = (value?: string) =>
  String(value || '')
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()

const formatLyricsText = (value?: string) => {
  const decoded = decodeEscapedMultiline(value)
  if (!decoded) return ''

  const withSections = decoded
    .replace(/\s*(\[(?:verse|pre-chorus|prechorus|chorus|post-chorus|postchorus|bridge|hook|outro|intro|refrain|interlude|breakdown)[^\]]*\])/gi, '\n\n$1\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return withSections
}

const parseLyricsBlocks = (value?: string) => {
  const formatted = formatLyricsText(value)
  if (!formatted) return []

  return formatted
    .split(/\n\s*\n/)
    .map(block => block.trim())
    .filter(Boolean)
    .map(block => {
      const lines = block.split('\n').map(line => line.trim()).filter(Boolean)
      const first = lines[0] || ''
      const isSection = /^\[[^\]]+\]$/.test(first)
      return {
        heading: isSection ? first.replace(/^\[|\]$/g, '') : '',
        bodyLines: isSection ? lines.slice(1) : lines,
      }
    })
}

const makeSafeFilePart = (value?: string) =>
  String(value || '')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)

const parseMetadataList = (value?: string) =>
  String(value || '')
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)

const isNonEmptyString = (value: string | undefined | null): value is string =>
  Boolean(String(value || '').trim())

const styleTokensForSong = (song: SunoSong) => {
  const normalizedStyles = parseMetadataList(song.styles || song.styleText)
  if (normalizedStyles.length > 0) return normalizedStyles

  const displayTags = parseMetadataList(song.displayTags)
  if (displayTags.length > 0) return displayTags

  return parseMetadataList(song.tags)
}

const hasVaultMetadata = (song: SunoSong) =>
  Boolean(
    styleTokensForSong(song).length > 0 ||
    normalizePublishText(song.description) ||
    normalizePublishText(song.caption) ||
    normalizePublishText(song.prompt)
  )

type MissingAssetState = {
  phase: 'processing' | 'attention'
  label: string
  body: string
  actionLabel: string
  actionHref: string
}

const buildMissingAssetState = (song: SunoSong): MissingAssetState | null => {
  const hasLyrics = Boolean(
    formatLyricsText(song.lyrics) ||
    song.gcsLyricsTxt ||
    song.gcsLyricsVtt
  )
  if (hasLyrics || hasVaultMetadata(song)) return null

  const createdAtMs = Date.parse(song.createdAt || '')
  const ageMs = Number.isFinite(createdAtMs) ? Date.now() - createdAtMs : 0
  const olderThanGraceWindow = ageMs >= MISSING_ASSET_GRACE_MS
  const subject = olderThanGraceWindow
    ? `Sundrop repair request: ${song.title || song.songKey || 'Untitled track'}`
    : `Sundrop missing assets follow-up: ${song.title || song.songKey || 'Untitled track'}`
  const body = [
    `Workspace: ${canonicalAccount(song) || song.account_handle || 'unknown workspace'}`,
    `Song key: ${song.songKey || 'unknown'}`,
    `Title: ${song.title || 'Untitled track'}`,
    '',
    olderThanGraceWindow
      ? 'This song is still missing lyrics and metadata after the 24-hour processing window.'
      : 'This song is still processing and is missing lyrics and metadata.',
  ].join('\n')

  return olderThanGraceWindow
    ? {
        phase: 'attention',
        label: 'Needs attention',
        body: 'Lyrics and metadata are still missing after 24 hours. Contact us and we will queue a repair pass.',
        actionLabel: 'Contact support',
        actionHref: `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
      }
    : {
        phase: 'processing',
        label: 'Still processing',
        body: 'Lyrics and metadata are still syncing. We keep retrying automatically for up to 24 hours before support needs to step in.',
        actionLabel: 'What to do',
        actionHref: `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
      }
}

const saveBlobAsFile = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

const buildSyntheticLyricsVtt = (lyricsText: string) => {
  const synthNote = [
    'WEBVTT',
    '',
    'NOTE Synthetic pacing artifact generated from Vault lyrics.',
    'NOTE Timing is approximate and provided for portability only.',
    '',
  ]
  const lines = lyricsText.split('\n').map(line => line.trim()).filter(Boolean)
  let cursor = 0
  const cues: string[] = []
  for (let index = 0; index < lines.length; index += 2) {
    const block = lines.slice(index, index + 2)
    const wordCount = block.join(' ').split(/\s+/).filter(Boolean).length
    const duration = Math.max(2, Math.min(8, 1.2 + wordCount / 2.6))
    const startMs = Math.round(cursor * 1000)
    const endMs = Math.round((cursor + duration) * 1000)
    const fmt = (ms: number) => {
      const hours = Math.floor(ms / 3600000)
      const minutes = Math.floor((ms % 3600000) / 60000)
      const seconds = Math.floor((ms % 60000) / 1000)
      const millis = ms % 1000
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`
    }
    cues.push(
      `${Math.floor(index / 2) + 1}`,
      `${fmt(startMs)} --> ${fmt(endMs)}`,
      block.join('\n'),
      '',
    )
    cursor += duration + 0.35
  }
  return [...synthNote, ...cues].join('\n')
}

const exportMetricCardStyle: CSSProperties = {
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.08)',
  background: '#0f121a',
  padding: '12px 13px',
  display: 'grid',
  gap: 4,
}

const exportMetricLabelStyle: CSSProperties = {
  color: '#7fe8ff',
  fontSize: 10,
  letterSpacing: '.16em',
  textTransform: 'uppercase',
}

const exportMetricValueStyle: CSSProperties = {
  color: '#f2f5ff',
  fontSize: 18,
  fontWeight: 600,
}

const normalizePublishText = (value?: string) =>
  String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\\n/g, '\n')
    .trim()

const buildYouTubeTitlePreview = (song: SunoSong) =>
  String(song.title || song.songKey || 'Untitled')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)

const buildYouTubeTagsPreview = (song: SunoSong) => {
  const tags: string[] = []
  const account = canonicalAccount(song)
  const title = buildYouTubeTitlePreview(song)
  if (account) tags.push(account)
  if (title) tags.push(title)
  tags.push(...styleTokensForSong(song))

  const seen = new Set<string>()
  return tags
    .map(tag => tag.trim())
    .filter(Boolean)
    .filter(tag => {
      const key = tag.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 15)
}

const buildYouTubeDescriptionSuggestion = (
  song: SunoSong,
  promptPolicy: YtPromptPolicy = 'none',
  lyricsPolicy: YtLyricsPolicy = 'excerpt',
) => {
  const blurb = normalizePublishText(song.description) || normalizePublishText(song.caption)
  const styles = styleTokensForSong(song)
  const fullLyrics = formatLyricsText(song.lyrics)
  const promptSection = buildPromptSection(song, promptPolicy)
  const lyricsBlocks = parseLyricsBlocks(song.lyrics)
  const excerptLines = lyricsBlocks
    .slice(0, 2)
    .flatMap(block => {
      const heading = block.heading ? [`[${block.heading}]`] : []
      return [...heading, ...block.bodyLines]
    })
    .slice(0, 8)
  const excerpt = excerptLines.join('\n').trim()

  const sections: string[] = []
  if (blurb) sections.push(blurb)
  if (styles.length > 0) sections.push(`Styles: ${styles.slice(0, 8).join(', ')}`)
  if (promptSection) sections.push(promptSection)
  if (lyricsPolicy === 'full' && fullLyrics) {
    sections.push(`Lyrics:\n${fullLyrics}`)
  } else if (lyricsPolicy === 'excerpt' && excerpt) {
    sections.push(`Lyrics excerpt:\n${excerpt}`)
  }
  if (sections.length === 0) sections.push(buildYouTubeTitlePreview(song))

  return sections.join('\n\n').slice(0, 5000)
}

const buildSuggestedYtMeta = (song: SunoSong, defaults: YtMeta): YtMeta => {
  const promptPolicy = defaults.promptPolicy || DEFAULT_YT_META.promptPolicy
  const lyricsPolicy = defaults.lyricsPolicy || DEFAULT_YT_META.lyricsPolicy

  return {
    ...defaults,
    title: buildYouTubeTitlePreview(song),
    description: defaults.description || buildYouTubeDescriptionSuggestion(song, promptPolicy, lyricsPolicy),
    tags: buildYouTubeTagsPreview(song).join(', '),
    promptPolicy,
    lyricsPolicy,
  }
}

const buildPromptSection = (song: SunoSong, promptPolicy: YtPromptPolicy = 'none') => {
  const prompt = normalizePublishText(song.prompt)
  if (!prompt || promptPolicy === 'none') return ''
  if (promptPolicy === 'excerpt') {
    return `Creation note:\n${prompt.length > 500 ? `${prompt.slice(0, 499).trimEnd()}…` : prompt}`
  }
  return `Creation note:\n${prompt}`
}

const canonicalAccount = (song: SunoSong) => {
  const values = [
    song.account_label,
    song.account_handle,
    song.account_sourceId,
  ].filter(Boolean)

  for (const [canonical, aliases] of Object.entries(ACCOUNT_ALIASES)) {
    if (values.some(value => aliases.includes(value))) {
      return canonical
    }
  }

  return song.account_label || song.account_handle || song.account_sourceId || ''
}

const normalizeCatalogKeyPart = (value?: string) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')

const songCreatedDay = (song: SunoSong) => String(song.createdAt || '').trim().slice(0, 10)

const songHasUsableLyrics = (song: SunoSong) => {
  const status = String(song.lyricsStatus || '').trim().toUpperCase()
  return Boolean(
    formatLyricsText(song.lyrics) ||
    String(song.gcsLyricsTxt || '').trim() ||
    String(song.gcsLyricsVtt || '').trim() ||
    status === 'OK'
  )
}

function collapseShadowedLyricsRows(rows: SunoSong[]) {
  const buckets = new Map<string, SunoSong[]>()

  rows.forEach(song => {
    const titleKey = normalizeCatalogKeyPart(song.title)
    const accountKey = normalizeCatalogKeyPart(canonicalAccount(song))
    const createdDay = songCreatedDay(song)

    if (!titleKey || !accountKey || !createdDay) return

    const bucketKey = `${accountKey}__${createdDay}__${titleKey}`
    const bucket = buckets.get(bucketKey)
    if (bucket) {
      bucket.push(song)
    } else {
      buckets.set(bucketKey, [song])
    }
  })

  const shadowedSongKeys = new Set<string>()

  buckets.forEach(bucket => {
    if (bucket.length < 2) return

    const preferredRows = bucket.filter(songHasUsableLyrics)
    if (preferredRows.length === 0) return

    bucket.forEach(song => {
      const status = String(song.lyricsStatus || '').trim().toUpperCase()
      const hasArtifacts = Boolean(
        String(song.gcsLyricsTxt || '').trim() ||
        String(song.gcsLyricsVtt || '').trim()
      )
      if (!songHasUsableLyrics(song) && !hasArtifacts && status === 'MISSING' && song.songKey) {
        shadowedSongKeys.add(song.songKey)
      }
    })
  })

  if (shadowedSongKeys.size === 0) return rows
  return rows.filter(song => !shadowedSongKeys.has(song.songKey))
}

function initialYouTubeState(song: SunoSong): YouTubePublishState | null {
  const status = (song.ytStatus || '').trim()
  const ytVideoId = (song.ytVideoId || '').trim()
  const ytCanonicalUrl = (song.ytCanonicalUrl || '').trim()
  const ytPublishedAt = (song.ytPublishedAt || '').trim()
  const error = (song.ytError || '').trim()
  const ytErrorAt = (song.ytErrorAt || '').trim()

  if (!status && !ytVideoId && !ytCanonicalUrl && !error) {
    return null
  }

  return {
    status: status || (ytVideoId || ytCanonicalUrl ? 'done' : error ? 'error' : ''),
    ytVideoId,
    ytCanonicalUrl,
    ytPublishedAt,
    error,
    ytErrorAt,
  }
}

function isPublishedState(state?: YouTubePublishState | null) {
  return Boolean(state && (state.status === 'done' || state.ytVideoId || state.ytCanonicalUrl))
}

function isPublishBlocked(song: SunoSong, state?: YouTubePublishState | null) {
  if (!song.songKey || song.status === 'removed_from_suno') return true
  if (!state) return false
  return state.status === 'queued' || state.status === 'uploading' || isPublishedState(state)
}

// ── Job banner ────────────────────────────────────────────────────────────────
type JobPhase = 'queued' | 'running' | 'done' | 'error'

interface JobBannerState {
  phase: JobPhase
  queued: number
  uploading: number
  done: number
  error: number
  execution?: string
  message?: string
  submission?: {
    selected: number
    eligible: number
    newlyQueued: number
    retriedErrors: number
    alreadyDone: number
    alreadyRepresented: number
    requestErrors: number
  }
}

function JobBanner({
  state,
  onDismiss,
}: {
  state: JobBannerState
  onDismiss: () => void
}) {
  const bg: Record<JobPhase, string> = {
    queued:   '#1a1a40',
    running:  '#162040',
    done:     '#0f2b1a',
    error:    '#2b0f0f',
  }
  const accent: Record<JobPhase, string> = {
    queued:   '#7c6fff',
    running:  '#4a9fff',
    done:     '#4aff8a',
    error:    '#ff6a6a',
  }
  const icon: Record<JobPhase, string> = {
    queued:   '⏳',
    running:  '🔄',
    done:     '✅',
    error:    '⚠️',
  }
  const label: Record<JobPhase, string> = {
    queued:   'Upload queued — job will start shortly',
    running:  'Upload job is running…',
    done:     'Upload complete — safe to check YouTube',
    error:    'Upload job encountered errors',
  }

  return (
    <div style={{
      background: bg[state.phase],
      border: `1px solid ${accent[state.phase]}44`,
      borderRadius: 12,
      padding: '12px 18px',
      marginBottom: 20,
      display: 'flex',
      alignItems: 'center',
      gap: 14,
      flexWrap: 'wrap',
    }}>
      {/* Spinning indicator while running */}
      <span style={{
        fontSize: 20,
        display: 'inline-block',
        animation: state.phase === 'running' ? 'spin 1.4s linear infinite' : 'none',
      }}>
        {icon[state.phase]}
      </span>

      <div style={{ flex: 1 }}>
        <div style={{ color: accent[state.phase], fontWeight: 600, fontSize: 14 }}>
          {state.message || label[state.phase]}
        </div>
        <div style={{ color: '#888', fontSize: 12, marginTop: 3 }}>
          {state.execution && (
            <span style={{ marginRight: 12 }}>Job: {state.execution}</span>
          )}
          {state.submission && (
            <span style={{ marginRight: 14 }}>
              This submission:
              {' '}selected {state.submission.selected}
              {' '}eligible {state.submission.eligible}
              {' '}newly queued {state.submission.newlyQueued}
              {state.submission.retriedErrors > 0 && ` retried errors ${state.submission.retriedErrors}`}
              {state.submission.alreadyDone > 0 && ` already done ${state.submission.alreadyDone}`}
              {state.submission.alreadyRepresented > 0 && ` already in queue ${state.submission.alreadyRepresented}`}
              {state.submission.requestErrors > 0 && ` request errors ${state.submission.requestErrors}`}
            </span>
          )}
          <span>Global queue totals:</span>
          <span style={{ marginLeft: 6 }}>Queued: {state.queued}</span>
          {state.uploading > 0 && <span style={{ marginLeft: 10 }}>Uploading: {state.uploading}</span>}
          <span style={{ marginLeft: 10, color: '#4aff8a' }}>Done: {state.done}</span>
          {state.error > 0 && <span style={{ marginLeft: 10, color: '#ff6a6a' }}>Errors: {state.error}</span>}
        </div>
      </div>

      {state.phase === 'done' && (
        <a
          href="https://studio.youtube.com/channel/videos"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            background: '#ff0000',
            color: '#fff',
            padding: '7px 14px',
            borderRadius: 8,
            textDecoration: 'none',
            fontSize: 13,
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}
        >
          Open YouTube Studio ↗
        </a>
      )}

      <button
        onClick={onDismiss}
        style={{
          background: 'transparent',
          border: '1px solid #333',
          borderRadius: 6,
          color: '#666',
          fontSize: 12,
          padding: '4px 10px',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        Dismiss
      </button>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
      `}</style>
    </div>
  )
}


// ── YouTube Metadata Modal ────────────────────────────────────────────────────
function YtMetadataModal({
  song,
  defaults,
  onConfirm,
  onCancel,
  onSaveDefaults,
}: {
  song: SunoSong
  defaults: YtMeta
  onConfirm: (meta: YtMeta) => void
  onCancel: () => void
  onSaveDefaults: (meta: YtMeta) => void
}) {
  const titlePreview = buildYouTubeTitlePreview(song)
  const tagsPreview = buildYouTubeTagsPreview(song)
  const suggestedMeta = buildSuggestedYtMeta(song, defaults)
  const [meta, setMeta] = useState<YtMeta>(suggestedMeta)

  const set = <K extends keyof YtMeta>(k: K, v: YtMeta[K]) =>
    setMeta(prev => ({ ...prev, [k]: v }))

  const refreshDescriptionFromPolicy = (policy: YtLyricsPolicy) => {
    setMeta(prev => ({
      ...prev,
      lyricsPolicy: policy,
      description: buildYouTubeDescriptionSuggestion(song, prev.promptPolicy, policy),
    }))
  }

  const refreshDescriptionFromPromptPolicy = (policy: YtPromptPolicy) => {
    setMeta(prev => ({
      ...prev,
      promptPolicy: policy,
      description: buildYouTubeDescriptionSuggestion(song, policy, prev.lyricsPolicy),
    }))
  }

  const resetToSuggested = () => {
    setMeta(buildSuggestedYtMeta(song, defaults))
  }

  const inputStyle: CSSProperties = {
    background: '#0d0d22',
    border: '1px solid #2a2a4a',
    borderRadius: 6,
    color: '#e0e0f0',
    padding: '8px 12px',
    fontSize: 13,
    width: '100%',
    boxSizing: 'border-box',
  }
  const labelStyle: CSSProperties = {
    display: 'block',
    color: '#9999cc',
    fontSize: 12,
    marginBottom: 5,
    fontWeight: 600,
    letterSpacing: '.03em',
  }
  const rowStyle: CSSProperties = {
    marginBottom: 16,
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,.80)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }}>
      <div style={{
        background: '#12121f',
        border: '1px solid #2a2a4a',
        borderRadius: 16,
        padding: 28,
        width: '100%',
        maxWidth: 560,
        maxHeight: '90vh',
        overflowY: 'auto',
      }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ color: '#7c6fff', fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 6 }}>
            YouTube Publish Settings
          </div>
          <div style={{ color: '#e0e0f0', fontSize: 16, fontWeight: 700 }}>
            {song.title || 'Untitled'}
          </div>
          <div style={{ color: '#555', fontSize: 12, marginTop: 2 }}>
            Customize before publishing — or save as new defaults
          </div>
        </div>

        {/* Description */}
        <div style={rowStyle}>
          <label style={labelStyle}>Publish Title</label>
          <input
            type="text"
            value={meta.title}
            onChange={e => set('title', e.target.value)}
            placeholder={titlePreview || 'Untitled'}
            style={inputStyle}
          />
          <div style={{ color: '#666699', fontSize: 11, marginTop: 6 }}>
            Starts from the Vault source title. Editing here changes the publish copy only, never the Vault source record.
          </div>
        </div>

        <div style={rowStyle}>
          <label style={labelStyle}>Description</label>
          <textarea
            value={meta.description}
            onChange={e => set('description', e.target.value)}
            placeholder="Add a description for this video…"
            rows={4}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
          />
          <div style={{ color: '#666699', fontSize: 11, marginTop: 6 }}>
            Derived from description or caption first, then styles, then a short lyrics excerpt. The raw Suno prompt stays preserved in the Vault and is not auto-published.
          </div>
        </div>

        <div style={rowStyle}>
          <label style={labelStyle}>Lyrics in Description</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {([
              { value: 'none', label: 'None' },
              { value: 'excerpt', label: 'Excerpt' },
              { value: 'full', label: 'Full' },
            ] as const).map(option => {
              const active = meta.lyricsPolicy === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => refreshDescriptionFromPolicy(option.value)}
                  style={{
                    background: active ? '#7c6fff' : '#12121f',
                    border: `1px solid ${active ? '#7c6fff' : '#2a2a4a'}`,
                    borderRadius: 999,
                    color: active ? '#fff' : '#b7b7e3',
                    padding: '6px 12px',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
          <div style={{ color: '#666699', fontSize: 11, marginTop: 6 }}>
            Controls whether YouTube gets no lyrics, a short excerpt, or the full lyrics in the description. This changes publish copy only, never the master record.
          </div>
        </div>

        <div style={rowStyle}>
          <label style={labelStyle}>Prompt Context in Description</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {([
              { value: 'none', label: 'None' },
              { value: 'excerpt', label: 'Excerpt' },
              { value: 'full-note', label: 'Full Note' },
            ] as const).map(option => {
              const active = meta.promptPolicy === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => refreshDescriptionFromPromptPolicy(option.value)}
                  style={{
                    background: active ? '#7c6fff' : '#12121f',
                    border: `1px solid ${active ? '#7c6fff' : '#2a2a4a'}`,
                    borderRadius: 999,
                    color: active ? '#fff' : '#b7b7e3',
                    padding: '6px 12px',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
          <div style={{ color: '#666699', fontSize: 11, marginTop: 6 }}>
            Controls whether creator prompt context stays private, appears as a short creation note, or appears as a full creation note in the YouTube description. This affects publish copy only.
          </div>
        </div>

        <div style={rowStyle}>
          <label style={labelStyle}>Publish Tags</label>
          <textarea
            value={meta.tags}
            onChange={e => set('tags', e.target.value)}
            placeholder={tagsPreview.join(', ')}
            rows={2}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
          />
          <div style={{ color: '#666699', fontSize: 11, marginTop: 6 }}>
            Pre-filled from normalized styles plus core identity fields. Editing here changes the YouTube publish copy only; original Suno tags remain untouched in the Vault.
          </div>
        </div>

        {/* Privacy + Category row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <div>
            <label style={labelStyle}>Privacy</label>
            <select
              value={meta.privacy}
              onChange={e => set('privacy', e.target.value as YtPrivacy)}
              style={{ ...inputStyle }}
            >
              <option value="public">Public</option>
              <option value="unlisted">Unlisted</option>
              <option value="private">Private</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Category</label>
            <select
              value={meta.category}
              onChange={e => set('category', e.target.value)}
              style={{ ...inputStyle }}
            >
              {YT_CATEGORIES.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Language + License row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <div>
            <label style={labelStyle}>Video Language</label>
            <select
              value={meta.language}
              onChange={e => set('language', e.target.value)}
              style={{ ...inputStyle }}
            >
              <option value="en">English</option>
              <option value="es">Spanish</option>
              <option value="fr">French</option>
              <option value="de">German</option>
              <option value="ja">Japanese</option>
              <option value="ko">Korean</option>
              <option value="pt">Portuguese</option>
              <option value="zh">Chinese</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>License</label>
            <select
              value={meta.license}
              onChange={e => set('license', e.target.value as YtLicense)}
              style={{ ...inputStyle }}
            >
              <option value="youtube">Standard YouTube License</option>
              <option value="creativeCommon">Creative Commons – Attribution</option>
            </select>
          </div>
        </div>

        {/* Toggle options */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 22 }}>
          {[
            {
              key: 'alteredContent' as const,
              label: 'AI-Generated / Altered Content disclosure',
              hint: 'YouTube requires this for AI-generated audio or visuals',
            },
            {
              key: 'shortsRemixing' as const,
              label: 'Allow Shorts remixing',
              hint: 'Let viewers remix this video in YouTube Shorts',
            },
          ].map(({ key, label, hint }) => (
            <label
              key={key}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                cursor: 'pointer', padding: '10px 12px',
                background: '#0d0d22',
                border: '1px solid #1e1e3a',
                borderRadius: 8,
              }}
            >
              <input
                type="checkbox"
                checked={meta[key] as boolean}
                onChange={e => set(key, e.target.checked)}
                style={{ accentColor: '#7c6fff', marginTop: 1, cursor: 'pointer' }}
              />
              <div>
                <div style={{ color: '#e0e0f0', fontSize: 13, fontWeight: 500 }}>{label}</div>
                <div style={{ color: '#555', fontSize: 11, marginTop: 2 }}>{hint}</div>
              </div>
            </label>
          ))}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={resetToSuggested}
            style={{
              background: '#12121f',
              border: '1px solid #4b4b73',
              borderRadius: 8,
              color: '#d3d3f5',
              fontSize: 13,
              padding: '10px 16px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
            title="Restore the suggested publish title, description, tags, and policy selections for this song"
          >
            Reset to Suggested
          </button>
          <button
            onClick={() => onConfirm(meta)}
            style={{
              background: '#a32626',
              border: 'none',
              borderRadius: 8,
              color: '#fff',
              fontSize: 14,
              fontWeight: 600,
              padding: '10px 20px',
              cursor: 'pointer',
              flex: 1,
            }}
          >
            Publish to YouTube
          </button>
          <button
            onClick={() => { onSaveDefaults(meta); onConfirm(meta) }}
            style={{
              background: '#1a1a40',
              border: '1px solid #7c6fff',
              borderRadius: 8,
              color: '#9999cc',
              fontSize: 13,
              padding: '10px 16px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
            title="Save these settings as channel defaults and publish"
          >
            Save as Defaults & Publish
          </button>
          <button
            onClick={onCancel}
            style={{
              background: 'transparent',
              border: '1px solid #333',
              borderRadius: 8,
              color: '#666',
              fontSize: 13,
              padding: '10px 16px',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}


// ── YtBadge ──────────────────────────────────────────────────────────────────
function YtBadge({ state }: { state?: YouTubePublishState }) {
  if (!state) return null

  const publishedHref =
    state.ytCanonicalUrl ||
    (state.ytVideoId ? `https://www.youtube.com/watch?v=${state.ytVideoId}` : '')

  if (isPublishedState(state) && publishedHref) {
    return (
      <a
        href={publishedHref}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: '#ff8a8a', fontSize: 11, textDecoration: 'none' }}
        title={state.ytPublishedAt ? `Published ${fmtDateTime(state.ytPublishedAt)}` : 'View on YouTube'}
      >
        Published
      </a>
    )
  }

  const label: Record<string, string> = {
    queued: 'Queued for upload',
    uploading: 'Upload running',
    error: 'Publish failed',
    done: 'Published',
  }

  return (
    <span style={{ fontSize: 11, color: state.status === 'error' ? '#ff9a9a' : '#888' }}>
      {label[state.status] || state.status}
    </span>
  )
}


// ── SongCard ──────────────────────────────────────────────────────────────────
function SongCard({
  song,
  ytState,
  onQueueForYouTube,
  selected,
  onToggleSelected,
  accountDisplay,
  publishAccess,
  downloadAccess,
  onRequestDownloadPackage,
  isFocused,
  onFocusCard,
  desktopInteractive,
  searchMatch,
}: {
  song: SunoSong
  ytState?: YouTubePublishState
  onQueueForYouTube: (song: SunoSong) => void
  selected: boolean
  onToggleSelected: (song: SunoSong) => void
  accountDisplay: string
  publishAccess: {
    enabled: boolean
    reason: string
  }
  downloadAccess: DownloadAccess
  onRequestDownloadPackage: (songKeys?: string[]) => Promise<void>
  isFocused: boolean
  onFocusCard: (songKey: string) => void
  desktopInteractive: boolean
  searchMatch?: SearchMatchSummary | null
}) {
  const [showLyrics, setShowLyrics] = useState(false)
  const [showMobilePlayer, setShowMobilePlayer] = useState(false)
  const [hover, setHover] = useState(false)
    const audio = (
      (isHttpUrl(song.audio_url) && song.audio_url) ||
      (isHttpUrl(song.gcs_latest_audio) && song.gcs_latest_audio) ||
      (isHttpUrl(song.gcs_mp3) && song.gcs_mp3) ||
      ((isGsUrl(song.gcs_latest_audio) || isGsUrl(song.gcs_mp3)) && songMediaProxyUrl(song.songKey, 'audio')) ||
      (song.songKey ? `https://cdn1.suno.ai/${song.songKey}.mp3` : '')
    )
    const thumb = (
      (isHttpUrl(song.image_url) && song.image_url) ||
      (isHttpUrl(song.gcs_latest_thumb) && song.gcs_latest_thumb) ||
      (isHttpUrl(song.gcs_thumb) && song.gcs_thumb) ||
      ((isGsUrl(song.gcs_latest_thumb) || isGsUrl(song.gcs_thumb)) && songMediaProxyUrl(song.songKey, 'thumb')) ||
      (song.songKey ? `https://cdn2.suno.ai/image_${song.songKey}.jpeg` : '')
    )
  const isRemoved = song.status === 'removed_from_suno'
  const publishDisabled = isPublishBlocked(song, ytState) || !publishAccess.enabled
  const canDownloadArtifacts = downloadAccess.singleEnabled
  const canSelectForBatch = downloadAccess.batchEnabled
  const lyricsText = formatLyricsText(song.lyrics)
  const lyricsBlocks = parseLyricsBlocks(song.lyrics)
  const lyricsFileUrl = song.gcsLyricsTxt ? `/api/lyrics-artifact/${encodeURIComponent(song.songKey)}/txt` : ''
  const lyricsVttUrl = song.gcsLyricsVtt ? `/api/lyrics-artifact/${encodeURIComponent(song.songKey)}/vtt` : ''
  const hasLyrics = Boolean(lyricsText || lyricsFileUrl)
  const styleTokens = styleTokensForSong(song).slice(0, 3)
  const missingAssetState = buildMissingAssetState(song)
  const artworkSrc = useProtectedAssetUrl(thumb)
  const artworkHref = isProtectedAssetUrl(thumb) ? artworkSrc : thumb
  const isExpanded = desktopInteractive ? isFocused : showMobilePlayer

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  const downloadLyrics = async () => {
    if (lyricsFileUrl) {
      try {
        const response = await authFetch(lyricsFileUrl)
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }
        const fileNameBase = makeSafeFilePart(song.title) || song.songKey || 'lyrics'
        downloadBlob(await response.blob(), `${fileNameBase} lyrics.txt`)
        return
      } catch {
        if (!lyricsText) return
      }
    }

    if (!lyricsText) return

    const fileNameBase = makeSafeFilePart(song.title) || song.songKey || 'lyrics'
    downloadBlob(new Blob([lyricsText], { type: 'text/plain;charset=utf-8' }), `${fileNameBase} lyrics.txt`)
  }

  const openLyricsVtt = async () => {
    if (lyricsVttUrl) {
      try {
        const response = await authFetch(lyricsVttUrl)
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }
        const fileNameBase = makeSafeFilePart(song.title) || song.songKey || 'lyrics'
        downloadBlob(await response.blob(), `${fileNameBase} lyrics.vtt`)
        return
      } catch {
        if (!lyricsText) return
      }
    }

    if (!lyricsText) return

    const fileNameBase = makeSafeFilePart(song.title) || song.songKey || 'lyrics'
    downloadBlob(
      new Blob([buildSyntheticLyricsVtt(lyricsText)], { type: 'text/vtt;charset=utf-8' }),
      `${fileNameBase} lyrics.vtt`
    )
  }

  return (
    <div
      style={{
        background: '#12121f',
        border: `1px solid ${isExpanded ? '#7c6fff' : hover ? (isRemoved ? '#885555' : '#464673') : (isRemoved ? '#3a1e1e' : '#1e1e3a')}`,
        borderRadius: 12,
        overflow: 'hidden',
        transition: 'border-color .2s, box-shadow .2s, transform .2s',
        opacity: isRemoved ? 0.7 : 1,
        gridColumn: desktopInteractive && isFocused ? 'span 2' : 'span 1',
        boxShadow: isExpanded ? '0 0 0 1px rgba(124,111,255,0.22), 0 24px 44px rgba(0,0,0,0.28)' : 'none',
        transform: isExpanded ? 'translateY(-1px)' : 'none',
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => {
        if (desktopInteractive) {
          onFocusCard(song.songKey)
        }
      }}
    >
      {/* Thumbnail */}
      <div style={{ position: 'relative', paddingBottom: '56.25%', background: '#0a0a1a' }}>
        {artworkHref ? (
          <a
            href={artworkHref}
            target="_blank"
            rel="noopener noreferrer"
            title="Open full artwork"
            style={{
              position: 'absolute', inset: 0, display: 'block', cursor: 'zoom-in',
            }}
          >
            {artworkSrc ? (
              <img
                src={artworkSrc} alt={song.title}
                onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                style={{
                  position: 'absolute', top: 0, left: 0,
                  width: '100%', height: '100%', objectFit: 'cover'
                }}
              />
            ) : (
              <div style={{
                position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 32, color: '#333'
              }}>🎵</div>
            )}
          </a>
        ) : (
          <div style={{
            position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 32, color: '#333'
          }}>🎵</div>
        )}
        <div style={{
          position: 'absolute', bottom: 6, right: 6,
          background: 'rgba(0,0,0,.75)', borderRadius: 4,
          padding: '2px 6px', fontSize: 11, color: '#ccc'
        }}>
          {fmtDur(song.duration)}
        </div>
        {isRemoved && (
          <div style={{
            position: 'absolute', top: 6, left: 6,
            background: 'rgba(140,50,50,.9)', borderRadius: 4,
            padding: '2px 7px', fontSize: 10, color: '#ffaaaa',
            fontWeight: 600, letterSpacing: '.3px',
          }}>
            REMOVED FROM SUNO
          </div>
        )}
      </div>

      {/* Meta */}
      <div style={{ padding: '10px 12px' }}>
        <div
          title={song.title}
          style={{
            fontSize: 13, fontWeight: 600, color: '#e0e0f0',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            marginBottom: 4,
          }}
        >
          {song.title || 'Untitled'}
        </div>
        <div style={{ fontSize: 11, color: '#6666aa', marginBottom: 6 }}>
          {accountDisplay}
        </div>
        {searchMatch && (
          <div
            style={{
              marginBottom: 8,
              padding: '7px 8px',
              borderRadius: 8,
              border: '1px solid rgba(127,232,255,0.16)',
              background: 'rgba(11, 23, 34, 0.72)',
              display: 'grid',
              gap: 4,
            }}
          >
            <div style={{ color: '#9fefff', fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase' }}>
              Matched on {searchMatch.fields.join(', ')}
            </div>
            {searchMatch.excerpt && (
              <div style={{ color: '#aeb7d8', fontSize: 11, lineHeight: 1.45 }}>
                {searchMatch.excerpt}
              </div>
            )}
          </div>
        )}
        {styleTokens.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {styleTokens.map(style => (
              <span
                key={`${song.songKey}-${style}`}
                style={{
                  background: '#171a2d',
                  border: '1px solid #2f3a63',
                  borderRadius: 999,
                  color: '#b7c6ff',
                  fontSize: 10,
                  lineHeight: 1,
                  padding: '4px 8px',
                  display: 'inline-block',
                  maxWidth: 180,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={song.styleText || song.styles || style}
              >
                {style}
              </span>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, fontSize: 11, color: '#555' }}>
          <span>👁 {parseInt(song.views || '0').toLocaleString()}</span>
          <span>♥ {parseInt(song.likes || '0').toLocaleString()}</span>
          <span title={song.createdAt}>📅 {fmtDate(song.createdAt)}</span>
        </div>
        <button
          onClick={e => {
            e.stopPropagation()
            if (desktopInteractive) {
              onFocusCard(song.songKey)
              return
            }
            setShowMobilePlayer(v => !v)
          }}
          style={{
            marginTop: 8, background: 'transparent',
            border: '1px solid #333', borderRadius: 6,
            color: '#9999cc', fontSize: 11, padding: '4px 10px',
            cursor: 'pointer', width: '100%',
          }}
        >
          {isExpanded ? 'Hide Player' : '▶ Play / Waveform'}
        </button>
        {isExpanded && audio && <AudioPlayer audioUrl={audio} songKey={song.songKey} audioAssetRole={song.audio_asset_role} />}
        <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            onClick={e => { e.stopPropagation(); if (hasLyrics) setShowLyrics(x => !x) }}
            disabled={!hasLyrics || !canDownloadArtifacts}
            style={{
              flex: 1,
              background: !hasLyrics || !canDownloadArtifacts ? '#141621' : '#18182a',
              border: '1px solid #36365c',
              borderRadius: 6,
              color: !hasLyrics || !canDownloadArtifacts ? '#6d7390' : '#c7c7f0',
              fontSize: 11,
              padding: '5px 10px',
              cursor: hasLyrics && canDownloadArtifacts ? 'pointer' : 'not-allowed',
              opacity: hasLyrics && canDownloadArtifacts ? 1 : 0.7,
            }}
            title={
              !canDownloadArtifacts
                ? 'Artifact downloads are not enabled for the current plan.'
                : hasLyrics
                  ? 'Toggle lyrics'
                  : 'No lyrics in catalog yet'
            }
          >
            {hasLyrics ? (showLyrics ? 'Hide Lyrics' : 'View Lyrics') : 'Lyrics Unavailable'}
          </button>
          <button
            onClick={e => { e.stopPropagation(); void downloadLyrics() }}
            disabled={!hasLyrics || !canDownloadArtifacts}
            style={{
              flex: 1,
              background: !hasLyrics || !canDownloadArtifacts ? '#141621' : '#1f2236',
              border: '1px solid #4c5a8a',
              borderRadius: 6,
              color: !hasLyrics || !canDownloadArtifacts ? '#6d7390' : '#d9e2ff',
              fontSize: 11,
              padding: '5px 10px',
              cursor: hasLyrics && canDownloadArtifacts ? 'pointer' : 'not-allowed',
              opacity: hasLyrics && canDownloadArtifacts ? 1 : 0.7,
            }}
            title={
              !canDownloadArtifacts
                ? 'Artifact downloads are not enabled for the current plan.'
                : !hasLyrics
                  ? 'No lyrics TXT artifact is available yet'
                  : lyricsFileUrl
                    ? 'Open saved lyrics file'
                    : 'Download lyrics as a text file'
            }
          >
            Lyrics TXT
          </button>
          <button
            onClick={e => { e.stopPropagation(); void openLyricsVtt() }}
            disabled={!hasLyrics || !canDownloadArtifacts}
            style={{
              flex: 1,
              background: !hasLyrics || !canDownloadArtifacts ? '#141621' : '#162233',
              border: '1px solid #3d6b96',
              borderRadius: 6,
              color: !hasLyrics || !canDownloadArtifacts ? '#6d7390' : '#d9f0ff',
              fontSize: 11,
              padding: '5px 10px',
              cursor: hasLyrics && canDownloadArtifacts ? 'pointer' : 'not-allowed',
              opacity: hasLyrics && canDownloadArtifacts ? 1 : 0.7,
            }}
            title={
              !canDownloadArtifacts
                ? 'Artifact downloads are not enabled for the current plan.'
                : !hasLyrics
                  ? 'No lyrics VTT artifact is available yet'
                  : lyricsVttUrl
                    ? 'Open saved lyrics VTT file'
                    : 'Download lyrics as a WebVTT file with synthetic pacing'
            }
          >
            Lyrics VTT
          </button>
        </div>
        <div style={{ marginTop: 6, fontSize: 11, color: '#8e96c5' }}>
          Lyrics status: {song.lyricsStatus || (hasLyrics ? 'AVAILABLE' : 'UNAVAILABLE')}
        </div>
        {missingAssetState && (
          <div
            style={{
              marginTop: 8,
              padding: '10px 12px',
              borderRadius: 8,
              background: missingAssetState.phase === 'attention' ? 'rgba(92, 31, 31, 0.28)' : 'rgba(33, 44, 70, 0.28)',
              border: `1px solid ${missingAssetState.phase === 'attention' ? 'rgba(214, 112, 112, 0.32)' : 'rgba(127, 232, 255, 0.18)'}`,
              display: 'grid',
              gap: 4,
            }}
          >
            <div
              style={{
                color: missingAssetState.phase === 'attention' ? '#ffd2d2' : '#dff5ff',
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              {missingAssetState.label}
            </div>
            <div style={{ color: '#aeb7d8', fontSize: 11, lineHeight: 1.5 }}>
              {missingAssetState.body}
            </div>
            <a
              href={missingAssetState.actionHref}
              onClick={event => event.stopPropagation()}
              style={{ color: '#9be6ff', fontSize: 11, textDecoration: 'none' }}
            >
              {missingAssetState.actionLabel}
            </a>
          </div>
        )}
        {showLyrics && lyricsText && (
          <div
            style={{
              marginTop: 8,
              background: '#0f1020',
              border: '1px solid #2a2d4a',
              borderRadius: 8,
              color: '#d7d9ef',
              fontSize: 11,
              lineHeight: 1.55,
              maxHeight: 220,
              overflowY: 'auto',
              padding: '10px 12px',
            }}
          >
            {lyricsBlocks.length > 0 ? lyricsBlocks.map((block, index) => (
              <div key={`${song.songKey}-lyrics-${index}`} style={{ marginBottom: index === lyricsBlocks.length - 1 ? 0 : 12 }}>
                {block.heading && (
                  <div
                    style={{
                      color: '#b7bef8',
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: '.08em',
                      textTransform: 'uppercase',
                      marginBottom: 6,
                    }}
                  >
                    {block.heading}
                  </div>
                )}
                <div style={{ whiteSpace: 'pre-wrap' }}>
                  {block.bodyLines.join('\n')}
                </div>
              </div>
            )) : lyricsText}
          </div>
        )}
        <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
          {canDownloadArtifacts && (
            <button
              onClick={e => { e.stopPropagation(); void onRequestDownloadPackage([song.songKey]) }}
              style={{
                background: '#12263d',
                border: '1px solid rgba(127,232,255,0.22)',
                borderRadius: 6,
                color: '#e8f6ff',
                fontSize: 11,
                padding: '5px 10px',
                cursor: 'pointer',
              }}
              title="Package this song with its audio, lyrics, and artwork"
            >
              Download
            </button>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#9999cc', fontSize: 11 }}>
            <input
              type="checkbox"
              checked={selected}
              onChange={e => { e.stopPropagation(); onToggleSelected(song) }}
              disabled={!canSelectForBatch}
              style={{ accentColor: '#7c6fff', cursor: canSelectForBatch ? 'pointer' : 'not-allowed' }}
            />
            Select
          </label>
          <button
            onClick={e => { e.stopPropagation(); onQueueForYouTube(song) }}
            disabled={publishDisabled}
            style={{
              background: publishDisabled ? '#4a2222' : '#a32626',
              border: 'none', borderRadius: 6,
              color: '#fff', fontSize: 11, padding: '5px 10px',
              cursor: publishDisabled ? 'not-allowed' : 'pointer',
              opacity: publishDisabled ? 0.65 : 1,
            }}
            title={
              isRemoved
                ? 'Removed items cannot be published'
                : publishAccess.enabled
                ? 'Queue this clip for YouTube upload'
                : publishAccess.reason
            }
          >
            Publish
          </button>
          <YtBadge state={ytState} />
        </div>
        {ytState?.error && (
          <div style={{ marginTop: 6, fontSize: 11, color: '#ff9a9a' }}>
            {ytState.error}
          </div>
        )}
      </div>
    </div>
  )
}


// ── Shared styles ─────────────────────────────────────────────────────────────
const selStyle: CSSProperties = {
  background: '#12121f', border: '1px solid #2a2a4a',
  borderRadius: 8, color: '#e0e0f0', padding: '8px 14px', fontSize: 14,
}
const btnStyle = (on: boolean, cur = false): CSSProperties => ({
  background: cur ? 'linear-gradient(135deg, #b18cff 0%, #8e63ff 52%, #6c44f5 100%)' : '#12121f',
  border: `1px solid ${cur ? '#a27bff' : '#2a2a4a'}`,
  boxShadow: cur ? '0 0 0 1px rgba(142, 99, 255, 0.18), inset 0 1px 0 rgba(255,255,255,0.08)' : 'none',
  borderRadius: 6, color: on ? (cur ? '#fff' : '#9999cc') : '#333',
  padding: '6px 14px', fontSize: 13, cursor: on ? 'pointer' : 'not-allowed',
})
const catalogActionButtonStyle = (disabled = false): CSSProperties => ({
  background: '#111111',
  border: '1px solid rgba(255,255,255,0.08)',
  color: disabled ? '#575c70' : '#d2d8e8',
  padding: '8px 12px',
  fontSize: 10,
  letterSpacing: '.09em',
  textTransform: 'uppercase',
  cursor: disabled ? 'not-allowed' : 'pointer',
})
const catalogPublishButtonStyle: CSSProperties = {
  background: '#81ecff',
  border: '1px solid rgba(129,236,255,0.34)',
  color: '#041318',
  padding: '8px 14px',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '.11em',
  textTransform: 'uppercase',
}

// localStorage key for channel defaults
const LS_YT_DEFAULTS = 'sundrop_yt_defaults_v1'

function loadDefaults(): YtMeta {
  try {
    const raw = localStorage.getItem(LS_YT_DEFAULTS)
    if (raw) return { ...DEFAULT_YT_META, ...JSON.parse(raw) }
  } catch { /* ignore */ }
  return { ...DEFAULT_YT_META }
}

function saveDefaults(meta: YtMeta) {
  try {
    localStorage.setItem(LS_YT_DEFAULTS, JSON.stringify(channelDefaultsOnly(meta)))
  } catch { /* ignore */ }
}

function channelDefaultsOnly(meta: YtMeta): YtMeta {
  return {
    ...DEFAULT_YT_META,
    alteredContent: meta.alteredContent,
    language: meta.language,
    license: meta.license,
    privacy: meta.privacy,
    shortsRemixing: meta.shortsRemixing,
    category: meta.category,
    description: meta.description,
    promptPolicy: meta.promptPolicy,
    lyricsPolicy: meta.lyricsPolicy,
    title: '',
    tags: '',
  }
}

const POLL_INTERVAL_MS = 12_000   // poll queue-status every 12s
const DONE_HOLD_MS     = 30_000   // keep banner visible 30s after done

interface QueueRequestResult {
  status: string
  created: boolean
  shouldTriggerUpload: boolean
  ytVideoId: string
  ytCanonicalUrl: string
  errorMsg: string
}

interface QueueInspectorItem {
  queueId: string
  songKey: string
  status: string
  createdAt: string
  queuedAt: string
  startedAt: string
  uploadedAt: string
  retryCount: number
  requestedFrom: string
  ytVideoId: string
  errorMsg: string
}

type QueueInspectorFilter = 'all' | 'active' | 'stuck' | 'error' | 'repair' | 'cleanup' | 'contradictory' | 'done'

const QUEUED_STUCK_MS = 15 * 60 * 1000
const UPLOADING_STUCK_MS = 10 * 60 * 1000

function parseQueueTimestamp(value: string) {
  if (!value) return 0
  const ts = Date.parse(value)
  return Number.isFinite(ts) ? ts : 0
}

function queueAgeMs(item: QueueInspectorItem) {
  const anchor = parseQueueTimestamp(item.startedAt) || parseQueueTimestamp(item.queuedAt) || parseQueueTimestamp(item.createdAt)
  return anchor > 0 ? Date.now() - anchor : 0
}

function formatAgeMs(ms: number) {
  if (ms <= 0) return 'just now'
  const minutes = Math.floor(ms / 60000)
  if (minutes < 1) return 'under 1m'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remMinutes = minutes % 60
  return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`
}

function isStuckQueueRow(item: QueueInspectorItem) {
  const age = queueAgeMs(item)
  if (!age) return false
  if (item.status === 'queued') return age >= QUEUED_STUCK_MS
  if (item.status === 'uploading' || item.status === 'new') return age >= UPLOADING_STUCK_MS
  return false
}

function isContradictoryQueueRow(item: QueueInspectorItem) {
  return item.status === 'error' && Boolean(item.ytVideoId)
}

function hasStaleQueueError(item: QueueInspectorItem) {
  return item.status === 'done' && Boolean(item.errorMsg)
}

function needsMediaRepair(item: QueueInspectorItem) {
  const message = (item.errorMsg || '').toLowerCase()
  return (
    message.includes('0 bytes') ||
    message.includes('media file is empty') ||
    message.includes('content-range header')
  )
}

function needsQueueNormalization(item: QueueInspectorItem) {
  return Boolean(item.ytVideoId) && (isContradictoryQueueRow(item) || hasStaleQueueError(item))
}

function queueDiagnosis(item: QueueInspectorItem) {
  if (needsMediaRepair(item)) {
    return {
      label: 'Repair media',
      detail: 'Recapture or repair the source MP4 before retrying this row.',
      color: '#ffb08c',
    }
  }

  if (isContradictoryQueueRow(item)) {
    return {
      label: 'Normalize row',
      detail: 'Queue row has a YouTube ID but still shows error state.',
      color: '#ffd47d',
    }
  }

  if (hasStaleQueueError(item)) {
    return {
      label: 'Clear stale error',
      detail: 'Queue row is done on YouTube but still carries old error text.',
      color: '#f0cb88',
    }
  }

  if (isStuckQueueRow(item)) {
    return {
      label: 'Check stuck row',
      detail: `This ${item.status || 'active'} row has been sitting for ${formatAgeMs(queueAgeMs(item))}. Refresh once, then inspect logs or retry if it still does not move.`,
      color: '#ffcf7a',
    }
  }

  if (item.status === 'queued' || item.status === 'uploading' || item.status === 'new') {
    return {
      label: 'Watch progress',
      detail: 'This row is still active. Wait for the queue to settle or inspect live updates.',
      color: '#9fc2ff',
    }
  }

  if (item.status === 'error' && !item.ytVideoId) {
    return {
      label: 'Retry failure',
      detail: 'Retry this row if the source media is intact and the error is not a media-repair case.',
      color: '#ffb0b0',
    }
  }

  if (item.status === 'done') {
    return {
      label: 'No action',
      detail: 'This row is settled successfully.',
      color: '#7df0a0',
    }
  }

  return {
    label: 'Review row',
    detail: 'Inspect this row before taking action.',
    color: '#c8c8ef',
  }
}

function matchesQueueInspectorFilter(item: QueueInspectorItem, filter: QueueInspectorFilter) {
  if (filter === 'all') return true
  if (filter === 'active') return item.status === 'queued' || item.status === 'uploading' || item.status === 'new'
  if (filter === 'stuck') return isStuckQueueRow(item)
  if (filter === 'error') return item.status === 'error'
  if (filter === 'repair') return needsMediaRepair(item)
  if (filter === 'cleanup') return needsQueueNormalization(item)
  if (filter === 'contradictory') return isContradictoryQueueRow(item)
  if (filter === 'done') return item.status === 'done'
  return true
}

function QueueStatusPill({ status }: { status: string }) {
  const tone = status === 'done'
    ? { bg: '#12301a', border: '#286b39', color: '#7df0a0' }
    : status === 'uploading'
    ? { bg: '#14253c', border: '#2e6db4', color: '#8cc0ff' }
    : status === 'queued'
    ? { bg: '#1d1740', border: '#5c4fd6', color: '#b4a7ff' }
    : status === 'error'
    ? { bg: '#3a1717', border: '#9f3434', color: '#ffb0b0' }
    : { bg: '#1b1b26', border: '#3d3d52', color: '#c4c4d8' }

  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '3px 8px',
      borderRadius: 999,
      border: `1px solid ${tone.border}`,
      background: tone.bg,
      color: tone.color,
      fontSize: 11,
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: '.04em',
    }}>
      {status || 'unknown'}
    </span>
  )
}

function CatalogRow({
  song,
  selected,
  onToggleSelected,
  onQueueForYouTube,
  ytState,
  publishAccess,
  downloadAccess,
  onRequestDownloadPackage,
  searchMatch,
}: {
  song: SunoSong
  selected: boolean
  onToggleSelected: (song: SunoSong) => void
  onQueueForYouTube: (song: SunoSong) => void
  ytState?: YouTubePublishState | null
  publishAccess: {
    enabled: boolean
    reason: string
  }
  downloadAccess: DownloadAccess
  onRequestDownloadPackage: (songKeys?: string[]) => Promise<void>
  searchMatch?: SearchMatchSummary | null
}) {
  const [showLyrics, setShowLyrics] = useState(false)
  const [showPlayer, setShowPlayer] = useState(false)

  const isRemoved = song.status === 'removed_from_suno'
  const accountDisplay = canonicalAccount(song) || 'unknown source'
  const styleTokens = styleTokensForSong(song).slice(0, 5)
  const lyricsText = formatLyricsText(song.lyrics)
  const lyricsBlocks = parseLyricsBlocks(song.lyrics)
  const hasLyrics = Boolean(lyricsText)
  const lyricsFileUrl = song.gcsLyricsTxt
    ? `/api/lyrics-artifact/${encodeURIComponent(song.songKey)}/txt`
    : ''
  const lyricsVttUrl = song.gcsLyricsVtt
    ? `/api/lyrics-artifact/${encodeURIComponent(song.songKey)}/vtt`
    : ''
  const missingAssetState = buildMissingAssetState(song)

  const audioCandidate =
    song.audio_url ||
    song.gcs_latest_audio ||
    song.gcs_mp3 ||
    songMediaProxyUrl(song.songKey, 'audio')
  const audioUrl = isGsUrl(audioCandidate)
    ? songMediaProxyUrl(song.songKey, 'audio')
    : isHttpUrl(audioCandidate) || isProtectedAssetUrl(audioCandidate) ? audioCandidate : ''

  const artworkCandidate =
    (isHttpUrl(song.image_url) && song.image_url) ||
    (isHttpUrl(song.gcs_latest_thumb) && song.gcs_latest_thumb) ||
    (isHttpUrl(song.gcs_thumb) && song.gcs_thumb) ||
    ((isGsUrl(song.gcs_latest_thumb) || isGsUrl(song.gcs_thumb)) &&
      songMediaProxyUrl(song.songKey, 'thumb')) ||
    (song.songKey ? `https://cdn2.suno.ai/image_${song.songKey}.jpeg` : '')
  const artworkUrl = useProtectedAssetUrl(artworkCandidate)

  const publishDisabled =
    !publishAccess.enabled ||
    isPublishBlocked(song, ytState) ||
    !song.songKey
  const canDownloadArtifacts = downloadAccess.singleEnabled
  const canSelectForBatch = downloadAccess.batchEnabled

  const downloadProtectedFile = useCallback(async (url: string, fallbackName: string) => {
    try {
      const response = await authFetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const blob = await response.blob()
      saveBlobAsFile(blob, fallbackName)
    } catch {
      window.alert('Could not open that artifact yet.')
    }
  }, [])

  const downloadLyricsTxt = useCallback(async () => {
    const fileNameBase = makeSafeFilePart(song.title || song.songKey) || song.songKey || 'lyrics'
    if (lyricsFileUrl) {
      try {
        const response = await authFetch(lyricsFileUrl)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        saveBlobAsFile(await response.blob(), `${fileNameBase} lyrics.txt`)
        return
      } catch {
        // Fallback to inline lyrics when artifact fetch fails.
      }
    }
    if (!lyricsText) return
    saveBlobAsFile(new Blob([lyricsText], { type: 'text/plain;charset=utf-8' }), `${fileNameBase} lyrics.txt`)
  }, [downloadProtectedFile, lyricsFileUrl, lyricsText, song.songKey, song.title])

  const downloadLyricsVtt = useCallback(async () => {
    const fileNameBase = makeSafeFilePart(song.title || song.songKey) || song.songKey || 'lyrics'
    if (lyricsVttUrl) {
      try {
        const response = await authFetch(lyricsVttUrl)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        saveBlobAsFile(await response.blob(), `${fileNameBase} lyrics.vtt`)
        return
      } catch {
        // Fallback to synthetic VTT when artifact fetch fails.
      }
    }
    if (!lyricsText) return
    saveBlobAsFile(
      new Blob([buildSyntheticLyricsVtt(lyricsText)], { type: 'text/vtt;charset=utf-8' }),
      `${fileNameBase} lyrics.vtt`
    )
  }, [downloadProtectedFile, lyricsText, lyricsVttUrl, song.songKey, song.title])

  return (
    <div style={{
      borderBottom: '1px solid rgba(129,236,255,0.08)',
      background: 'rgba(8, 10, 16, 0.92)',
    }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '72px minmax(260px, 1.4fr) minmax(120px, 0.7fr) minmax(180px, 0.95fr) minmax(280px, 1.25fr)',
        gap: 18,
        alignItems: 'center',
        padding: '14px 18px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <div style={{
            width: 56,
            height: 56,
            border: '1px solid rgba(255,255,255,0.08)',
            background: '#111111',
            overflow: 'hidden',
          }}>
            {artworkUrl ? (
              <img
                src={artworkUrl}
                alt={song.title || 'Artwork'}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            ) : (
              <div style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#4c5268',
                fontSize: 10,
                letterSpacing: '.14em',
              }}>
                NONE
              </div>
            )}
          </div>
        </div>

        <div style={{ minWidth: 0 }}>
          <div style={{
            fontFamily: '"Newsreader", serif',
            fontStyle: 'italic',
            fontSize: 26,
            lineHeight: 1,
            color: '#eef1f7',
            marginBottom: 6,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {song.title || 'Untitled'}
          </div>
          <div style={{
            fontSize: 11,
            letterSpacing: '.22em',
            textTransform: 'uppercase',
            color: '#5d6c90',
            marginBottom: 8,
          }}>
            {song.songKey || 'No song key'}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            {styleTokens.map(token => (
              <span key={`${song.songKey}-${token}`} style={{
                padding: '3px 8px',
                border: '1px solid rgba(129,236,255,0.22)',
                color: '#81ecff',
                fontSize: 10,
                letterSpacing: '.08em',
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
                display: 'inline-block',
                maxWidth: 240,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {token}
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', color: '#76809d', fontSize: 11 }}>
            <span>{fmtDate(song.createdAt)}</span>
            <span>{fmtDur(song.duration)}</span>
            <span>👁 {parseInt(song.views || '0').toLocaleString()}</span>
            <span>♥ {parseInt(song.likes || '0').toLocaleString()}</span>
          </div>
          {searchMatch && (
            <div
              style={{
                marginTop: 10,
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid rgba(127,232,255,0.14)',
                background: 'rgba(11, 23, 34, 0.58)',
                display: 'grid',
                gap: 4,
              }}
            >
              <div style={{ color: '#9fefff', fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase' }}>
                Matched on {searchMatch.fields.join(', ')}
              </div>
              {searchMatch.excerpt && (
                <div style={{ color: '#aeb7d8', fontSize: 11, lineHeight: 1.45 }}>
                  {searchMatch.excerpt}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ minWidth: 0 }}>
          <div style={{ color: '#d9e7ff', fontSize: 13, marginBottom: 4 }}>
            @{accountDisplay}
          </div>
          <div style={{ color: '#6f7897', fontSize: 11 }}>
            {song.account_handle || song.account_sourceId || 'Unclaimed source'}
          </div>
        </div>

        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
            {song.lyricsStatus ? (
              <span style={{ color: '#f1c770', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase' }}>
                Lyrics {song.lyricsStatus}
              </span>
            ) : (
              <span style={{ color: '#646a82', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase' }}>
                No lyrics state
              </span>
            )}
            <YtBadge state={ytState || undefined} />
          </div>
          <div style={{ color: isRemoved ? '#c17b7b' : '#8ca3c7', fontSize: 11 }}>
            {isRemoved ? 'Removed from Suno' : 'Active in Vault'}
          </div>
          {missingAssetState && (
            <div style={{
              marginTop: 8,
              padding: '8px 10px',
              borderRadius: 8,
              background: missingAssetState.phase === 'attention' ? 'rgba(92, 31, 31, 0.24)' : 'rgba(33, 44, 70, 0.22)',
              border: `1px solid ${missingAssetState.phase === 'attention' ? 'rgba(214, 112, 112, 0.28)' : 'rgba(127,236,255,0.15)'}`,
              display: 'grid',
              gap: 4,
            }}>
              <div style={{
                color: missingAssetState.phase === 'attention' ? '#ffd2d2' : '#dff5ff',
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '.04em',
              }}>
                {missingAssetState.label}
              </div>
              <div style={{ color: '#9eb1d4', fontSize: 11, lineHeight: 1.45 }}>
                {missingAssetState.body}
              </div>
              <a
                href={missingAssetState.actionHref}
                style={{ color: '#9be6ff', fontSize: 11, textDecoration: 'none' }}
              >
                {missingAssetState.actionLabel}
              </a>
            </div>
          )}
          {(song.description || song.caption || song.prompt) && (
            <div style={{
              color: '#727a93',
              fontSize: 11,
              marginTop: 6,
              lineHeight: 1.5,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}>
              {song.description || song.caption || song.prompt}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => setShowPlayer(v => !v)} style={catalogActionButtonStyle()}>
            {showPlayer ? 'Hide Player' : 'Play'}
          </button>
          <button
            onClick={() => setShowLyrics(v => !v)}
            disabled={!hasLyrics || !canDownloadArtifacts}
            style={catalogActionButtonStyle(!hasLyrics || !canDownloadArtifacts)}
            title={
              !canDownloadArtifacts
                ? 'Artifact downloads are not enabled for the current plan.'
                : hasLyrics
                  ? 'Toggle lyrics'
                  : 'No lyrics in catalog yet'
            }
          >
            Lyrics
          </button>
          <button
            onClick={() => void downloadLyricsTxt()}
            disabled={!hasLyrics || !canDownloadArtifacts}
            style={catalogActionButtonStyle(!hasLyrics || !canDownloadArtifacts)}
            title={
              !canDownloadArtifacts
                ? 'Artifact downloads are not enabled for the current plan.'
                : hasLyrics
                  ? (lyricsFileUrl ? 'Download lyrics TXT' : 'Download lyrics TXT from catalog text')
                  : 'No lyrics in catalog yet'
            }
          >
            TXT
          </button>
          <button
            onClick={() => void downloadLyricsVtt()}
            disabled={!hasLyrics || !canDownloadArtifacts}
            style={catalogActionButtonStyle(!hasLyrics || !canDownloadArtifacts)}
            title={
              !canDownloadArtifacts
                ? 'Artifact downloads are not enabled for the current plan.'
                : hasLyrics
                  ? (lyricsVttUrl ? 'Download lyrics VTT' : 'Download synthetic lyrics VTT from catalog text')
                  : 'No lyrics in catalog yet'
            }
          >
            VTT
          </button>
          <button
            onClick={() => void onRequestDownloadPackage([song.songKey])}
            disabled={!canDownloadArtifacts}
            style={catalogActionButtonStyle(!canDownloadArtifacts)}
            title={canDownloadArtifacts ? 'Package this song with its audio, lyrics, and artwork' : 'Artifact downloads are not enabled for the current plan.'}
          >
            Download
          </button>
          <label style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 10px',
            border: '1px solid rgba(255,255,255,0.08)',
            color: '#c8d0ea',
            fontSize: 10,
            letterSpacing: '.08em',
            textTransform: 'uppercase',
          }}>
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggleSelected(song)}
              disabled={!canSelectForBatch}
              style={{ accentColor: '#81ecff' }}
            />
            Select
          </label>
          <button
            onClick={() => onQueueForYouTube(song)}
            disabled={publishDisabled}
            style={{
              ...catalogPublishButtonStyle,
              opacity: publishDisabled ? 0.45 : 1,
              cursor: publishDisabled ? 'not-allowed' : 'pointer',
            }}
            title={publishDisabled ? publishAccess.reason : 'Open publish flow'}
          >
            Publish
          </button>
        </div>
      </div>

      {(showPlayer || showLyrics) && (
        <div style={{
          padding: '0 18px 18px',
          display: 'grid',
          gap: 12,
          background: 'linear-gradient(180deg, rgba(8, 10, 16, 0.2), rgba(8, 10, 16, 0.92))',
        }}>
          {showPlayer && audioUrl && (
            <div style={{
              border: '1px solid rgba(129,236,255,0.08)',
              background: '#0c0f17',
              padding: 12,
            }}>
              <AudioPlayer audioUrl={audioUrl} songKey={song.songKey} audioAssetRole={song.audio_asset_role} />
            </div>
          )}
          {showLyrics && hasLyrics && (
            <div style={{
              border: '1px solid rgba(129,236,255,0.08)',
              background: '#0c0f17',
              padding: 14,
              color: '#dce2ef',
              fontSize: 12,
              lineHeight: 1.65,
              maxHeight: 280,
              overflowY: 'auto',
            }}>
              {lyricsBlocks.length > 0 ? lyricsBlocks.map((block, index) => (
                <div key={`${song.songKey}-catalog-lyrics-${index}`} style={{ marginBottom: index === lyricsBlocks.length - 1 ? 0 : 12 }}>
                  {block.heading && (
                    <div style={{
                      color: '#81ecff',
                      fontSize: 10,
                      letterSpacing: '.12em',
                      textTransform: 'uppercase',
                      marginBottom: 6,
                    }}>
                      {block.heading}
                    </div>
                  )}
                  <div style={{ whiteSpace: 'pre-wrap' }}>
                    {block.bodyLines.join('\n')}
                  </div>
                </div>
              )) : (
                <div style={{ whiteSpace: 'pre-wrap' }}>{lyricsText}</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── VaultGrid ─────────────────────────────────────────────────────────────────
function formatSessionDuration(durationHours: number) {
  if (durationHours % 24 === 0) {
    const days = durationHours / 24
    return `${days} day${days === 1 ? '' : 's'}`
  }
  return `${durationHours} hours`
}

export default function VaultGrid() {
  const { session, loadingSession, token, sessionDurationHours, setSessionDurationHours, firebaseUser } = useAuth()
  const initialViewMode = useMemo<'grid' | 'catalog'>(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('view') === 'catalog' ? 'catalog' : 'grid'
  }, [])
  const initialVaultSection = useMemo<VaultSection>(() => {
    const params = new URLSearchParams(window.location.search)
    const section = params.get('section')
    // security/truth/history have no real view yet; they fall back to archives.
    return section === 'downloads' ? section : 'archives'
  }, [])
  const [songs, setSongs] = useState<SunoSong[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [acct, setAcct] = useState('')
  const [styleFilter, setStyleFilter] = useState('')
  const [lyricsFilter, setLyricsFilter] = useState<'all' | 'has_lyrics' | 'missing_lyrics'>('all')
  const [publishFilter, setPublishFilter] = useState<'all' | 'published' | 'unpublished'>('all')
  const [sort, setSort] = useState<'createdAt' | 'views' | 'likes' | 'duration'>('createdAt')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(initialViewMode === 'catalog' ? 50 : 24)
  const [viewMode, setViewMode] = useState<'grid' | 'catalog'>(initialViewMode)
  const [vaultSection, setVaultSection] = useState<VaultSection>(initialVaultSection)
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === 'undefined' ? 1440 : window.innerWidth
  )
  const [hideRemoved, setHideRemoved] = useState(true)
  const [ytStatus, setYtStatus] = useState<Record<string, YouTubePublishState>>({})
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [focusedSongKey, setFocusedSongKey] = useState<string | null>(null)
  const [sessionDurationDraft, setSessionDurationDraft] = useState(sessionDurationHours)
  const [sessionDurationNotice, setSessionDurationNotice] = useState('')

  // YouTube metadata state
  const [channelDefaults, setChannelDefaults] = useState<YtMeta>(loadDefaults)
  const [pendingSong, setPendingSong] = useState<SunoSong | null>(null)  // song awaiting modal

  // Job banner / polling state
  const [jobBanner, setJobBanner] = useState<JobBannerState | null>(null)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const doneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingPublishKeysRef = useRef<Set<string>>(new Set())
  const [showQueueInspector, setShowQueueInspector] = useState(false)
  const [queueInspectorLoading, setQueueInspectorLoading] = useState(false)
  const [queueInspectorError, setQueueInspectorError] = useState<string | null>(null)
  const [queueInspectorItems, setQueueInspectorItems] = useState<QueueInspectorItem[]>([])
  const [queueInspectorLastUpdated, setQueueInspectorLastUpdated] = useState<string | null>(null)
  const [queueInspectorLimit, setQueueInspectorLimit] = useState(100)
  const [queueInspectorSearch, setQueueInspectorSearch] = useState('')
  const [expandedQueueInspectorId, setExpandedQueueInspectorId] = useState<string | null>(null)
  const [queueRetryingId, setQueueRetryingId] = useState<string | null>(null)
  const [queueNormalizingId, setQueueNormalizingId] = useState<string | null>(null)
  const [queueBulkAction, setQueueBulkAction] = useState<'retry' | 'normalize' | null>(null)
  const [queueInspectorFilter, setQueueInspectorFilter] = useState<QueueInspectorFilter>('all')
  const [catalogExport, setCatalogExport] = useState<CatalogExportJob | null>(null)
  const [catalogExportWorking, setCatalogExportWorking] = useState(false)
  const [catalogExportError, setCatalogExportError] = useState<string | null>(null)
  const [vaultFreshness, setVaultFreshness] = useState<VaultFreshnessPayload | null>(null)
  const [selectedExportWorkspaceId, setSelectedExportWorkspaceId] = useState('')
  const [catalogExportReadyNotice, setCatalogExportReadyNotice] = useState<string | null>(null)
  const [catalogExportJobs, setCatalogExportJobs] = useState<CatalogExportJob[]>([])
  const lastReadyExportIdRef = useRef<string | null>(null)
  const resetCatalogExportState = useCallback((clearError = false) => {
    setCatalogExport(null)
    setCatalogExportJobs([])
    setCatalogExportWorking(false)
    setCatalogExportReadyNotice(null)
    if (clearError) {
      setCatalogExportError(null)
    }
    lastReadyExportIdRef.current = null
  }, [])

  useEffect(() => {
    setSessionDurationDraft(sessionDurationHours)
  }, [sessionDurationHours])

  async function saveVaultSessionDuration() {
    if (!Number.isInteger(sessionDurationDraft) || sessionDurationDraft < 72 || sessionDurationDraft > 744) {
      setSessionDurationNotice('Choose a whole number from 72 hours to 31 days.')
      return
    }
    try {
      await setSessionDurationHours(sessionDurationDraft)
      setSessionDurationNotice(`Saved. This browser will stay signed in for up to ${formatSessionDuration(sessionDurationDraft)}.`)
    } catch (error) {
      setSessionDurationNotice(error instanceof Error ? error.message : String(error))
    }
  }
  const canBrowseVault = Boolean(
    session?.platformAdmin ||
    (session?.isAuthenticated &&
      session?.activeWorkspace &&
      session?.entitlements?.['vault.browse'] &&
      session?.betaAccess?.status !== 'expired')
  )
  const downloadAccess = useMemo<DownloadAccess>(() => {
    const maxBatchValue = Number(session?.entitlements?.['downloads.max_batch_size'] ?? 0)
    return {
      centerEnabled: Boolean(session?.legacyMode || session?.platformAdmin || session?.entitlements?.['downloads.center']),
      singleEnabled: Boolean(session?.legacyMode || session?.platformAdmin || session?.entitlements?.['downloads.single']),
      batchEnabled: Boolean(session?.legacyMode || session?.platformAdmin || session?.entitlements?.['downloads.batch']),
      catalogEnabled: Boolean(
        session?.legacyMode ||
        session?.platformAdmin ||
        (session?.entitlements?.['downloads.catalog'] && session?.entitlements?.['catalog.export.local'])
      ),
      maxBatchSize: Number.isFinite(maxBatchValue) && maxBatchValue > 0 ? maxBatchValue : 0,
    }
  }, [session])
  const canExportCatalog = Boolean(
    canBrowseVault &&
      downloadAccess.centerEnabled &&
      downloadAccess.catalogEnabled
  )
  const exportWorkspaceOptions = session?.platformAdmin
    ? (session?.workspaces || []).slice().sort((a, b) => (a.name || a.workspaceId).localeCompare(b.name || b.workspaceId))
    : session?.activeWorkspace
      ? [session.activeWorkspace]
      : []
  const exportWorkspaceId = selectedExportWorkspaceId || session?.activeWorkspace?.workspaceId || ''
  const exportWorkspace =
    exportWorkspaceOptions.find((workspace) => workspace.workspaceId === exportWorkspaceId) ||
    session?.activeWorkspace ||
    null
  const showDownloadsHome = canBrowseVault && downloadAccess.centerEnabled && vaultSection === 'downloads'
  const showArchiveHome = vaultSection === 'archives'
  const showPlaceholderVaultSection = vaultSection === 'security' || vaultSection === 'truth' || vaultSection === 'history'
  const vaultSectionMeta: Record<Extract<VaultSection, 'security' | 'truth' | 'history'>, { title: string; body: string }> = {
    security: {
      title: 'Security Nodes',
      body: 'This lane is where we will surface repair status, customer-visible asset integrity notices, and vault health signals. For now, the song cards and queue tools are still the clearest live source of truth.',
    },
    truth: {
      title: 'Truth Stream',
      body: 'Truth Stream will become the running timeline for catalog sync, packaging, and publishing events. Today those signals still live in Downloads, the queue inspector, and the repair messaging we are adding to songs.',
    },
    history: {
      title: 'Vault History',
      body: 'Vault History is reserved for package, publish, and repair audit trails. We have not wired the durable event feed yet, so this is now an honest placeholder instead of a dead click.',
    },
  }
  const hasCatalogExports = Boolean(catalogExport || catalogExportJobs.length > 0)
  const downloadHomeCount = useMemo(() => {
    const exportIds = new Set(catalogExportJobs.map((job) => job.exportId))
    if (catalogExport?.exportId) exportIds.add(catalogExport.exportId)
    return exportIds.size
  }, [catalogExport, catalogExportJobs])

  useEffect(() => {
    if (!session?.activeWorkspace?.workspaceId) return
    setSelectedExportWorkspaceId((current) => current || session.activeWorkspace?.workspaceId || '')
  }, [session?.activeWorkspace?.workspaceId])

  useEffect(() => {
    if (vaultSection === 'downloads' && !downloadAccess.centerEnabled) {
      setVaultSection('archives')
    }
  }, [downloadAccess.centerEnabled, vaultSection])

  // Auto-filter by explicit account query only.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const acc = params.get('account')
    if (acc) setAcct(acc)
  }, [])

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth)
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    const url = new URL(window.location.href)
    if (viewMode === 'catalog') {
      url.searchParams.set('view', 'catalog')
    } else {
      url.searchParams.delete('view')
    }
    if (vaultSection !== 'archives') {
      url.searchParams.set('section', vaultSection)
    } else {
      url.searchParams.delete('section')
    }
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`)
  }, [vaultSection, viewMode])

  useEffect(() => {
    if (loadingSession) return

    if (!canBrowseVault) {
      setSongs([])
      setYtStatus({})
      setError(null)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    const controller = new AbortController()

    authFetch('/catalog.csv', { token, signal: controller.signal })
      .then(async r => {
        const text = await r.text()
        if (!r.ok) {
          throw new Error(text || `HTTP ${r.status}`)
        }
        return text
      })
      .then(t => {
        const parsed = parseCSV(t)
        const initialState: Record<string, YouTubePublishState> = {}

        for (const song of parsed) {
          const state = initialYouTubeState(song)
          if (state && song.songKey) {
            initialState[song.songKey] = state
          }
        }

        setSongs(collapseShadowedLyricsRows(parsed))
        setYtStatus(initialState)
        setLoading(false)
      })
      .catch(e => {
        if (e instanceof DOMException && e.name === 'AbortError') {
          return
        }
        setSongs([])
        setYtStatus({})
        setError(e.message)
        setLoading(false)
      })

    return () => {
      controller.abort()
    }
  }, [canBrowseVault, loadingSession, token])

  useEffect(() => {
    if (loadingSession || !canBrowseVault) {
      setVaultFreshness(null)
      return
    }

    const controller = new AbortController()

    authFetch('/api/vault/freshness', {
      token,
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async response => {
        const payload = await response.json()
        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.error || `HTTP ${response.status}`)
        }
        setVaultFreshness(payload as VaultFreshnessPayload)
      })
      .catch(error => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setVaultFreshness(null)
      })

    return () => {
      controller.abort()
    }
  }, [canBrowseVault, loadingSession, token])

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
      if (doneTimerRef.current) clearTimeout(doneTimerRef.current)
    }
  }, [])

  const downloadExportArtifact = useCallback(async (url: string, fallbackName: string) => {
    try {
      if (!url) {
        throw new Error('This package link is still being restored. Refresh the Downloads center and try again.')
      }
      const response = await authFetch(url, { token })
      const contentType = response.headers.get('content-type') || ''
      if (!response.ok) {
        let detail = ''
        if (contentType.includes('application/json')) {
          try {
            const payload = await response.json()
            detail = payload?.error || ''
          } catch {
            detail = ''
          }
        } else {
          try {
            detail = await response.text()
          } catch {
            detail = ''
          }
        }
        throw new Error(detail || `HTTP ${response.status}`)
      }
      const blob = await response.blob()
      saveBlobAsFile(blob, fallbackName)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not download that export artifact yet.')
    }
  }, [token])

  const loadCatalogExport = useCallback(async (exportId: string) => {
    const response = await authFetch(`/api/catalog-export/${encodeURIComponent(exportId)}`, {
      token,
      cache: 'no-store',
    })
    const payload = await response.json()
    if (!response.ok || !payload?.ok) {
      if (response.status === 401 || response.status === 403) {
        resetCatalogExportState()
      }
      throw new Error(payload?.error || `HTTP ${response.status}`)
    }
    setCatalogExport(payload as CatalogExportJob)
    setCatalogExportError(payload?.error || null)
    return payload as CatalogExportJob
  }, [resetCatalogExportState, token])

  const loadCatalogExports = useCallback(async () => {
    const response = await authFetch('/api/catalog-exports', {
      token,
      cache: 'no-store',
    })
    const payload = await response.json()
    if (!response.ok || !payload?.ok) {
      if (response.status === 401 || response.status === 403) {
        resetCatalogExportState()
      }
      throw new Error(payload?.error || `HTTP ${response.status}`)
    }
    setCatalogExportJobs(Array.isArray(payload.jobs) ? payload.jobs as CatalogExportJob[] : [])
    return Array.isArray(payload.jobs) ? payload.jobs as CatalogExportJob[] : []
  }, [resetCatalogExportState, token])

  useEffect(() => {
    if (!canExportCatalog) {
      resetCatalogExportState(true)
      return
    }

    void loadCatalogExports().catch((error) => {
      setCatalogExportError(error instanceof Error ? error.message : String(error))
    })
  }, [acct, canExportCatalog, exportWorkspaceId, loadCatalogExports, resetCatalogExportState])

  useEffect(() => {
    if (!catalogExport?.exportId) return
    if (!['preparing', 'building'].includes(catalogExport.status)) return

    let cancelled = false

    const poll = async () => {
      try {
        await Promise.all([
          loadCatalogExport(catalogExport.exportId),
          loadCatalogExports(),
        ])
      } catch (error) {
        if (!cancelled) {
          setCatalogExportError(error instanceof Error ? error.message : String(error))
        }
      }
    }

    const timer = window.setInterval(() => {
      void poll()
    }, 1800)

    void poll()

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [catalogExport?.exportId, catalogExport?.status, loadCatalogExport, loadCatalogExports])

  useEffect(() => {
    if (!catalogExport?.exportId || catalogExport.status !== 'ready') return
    if (lastReadyExportIdRef.current === catalogExport.exportId) return

    lastReadyExportIdRef.current = catalogExport.exportId
    setCatalogExportReadyNotice(
      `${exportWorkspace?.name || exportWorkspace?.workspaceId || 'Workspace'} is ready: ${(catalogExport.partCount || 0).toLocaleString()} package part${catalogExport.partCount === 1 ? '' : 's'} and the manifest are ready.`
    )

    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification('Local catalog download ready', {
          body: `${exportWorkspace?.name || exportWorkspace?.workspaceId || 'Workspace'} is ready to download.`,
        })
      } catch {
        // best effort only
      }
    }
  }, [catalogExport?.exportId, catalogExport?.status, catalogExport?.partCount, exportWorkspace?.name, exportWorkspace?.workspaceId])

  const requestCatalogExport = useCallback(async (songKeys?: string[]) => {
    setCatalogExportWorking(true)
    setCatalogExportError(null)
    setCatalogExportReadyNotice(null)
    if (downloadAccess.centerEnabled) {
      setVaultSection('downloads')
    }
    try {
      const response = await authFetch('/api/catalog-export', {
        token,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: exportWorkspaceId,
          ...(acct ? { accountHandle: acct } : {}),
          ...(songKeys && songKeys.length > 0 ? { songKeys } : {}),
        }),
      })
      const payload = await response.json()
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || `HTTP ${response.status}`)
      }
      setCatalogExport(payload as CatalogExportJob)
      if (payload?.exportId) {
        await loadCatalogExport(payload.exportId)
      }
      await loadCatalogExports()
    } catch (error) {
      setCatalogExportError(error instanceof Error ? error.message : String(error))
    } finally {
      setCatalogExportWorking(false)
    }
  }, [acct, downloadAccess.centerEnabled, exportWorkspaceId, loadCatalogExport, loadCatalogExports, token])

  const startCatalogExport = useCallback(async () => {
    await requestCatalogExport()
  }, [requestCatalogExport])

  const scopedCatalogExportJobs = useMemo(() => {
    if (!acct) return catalogExportJobs
    return catalogExportJobs.filter((job) => accountsMatch(job.requestAccountHandle || '', acct))
  }, [acct, catalogExportJobs])
  const activeCatalogExportJobs = useMemo(
    () => scopedCatalogExportJobs.filter((job) => ['preparing', 'building'].includes(job.status)),
    [scopedCatalogExportJobs]
  )
  const primaryCatalogExportJob = activeCatalogExportJobs[0] || catalogExport || null

  const readyCatalogExportJobs = useMemo(
    () => scopedCatalogExportJobs.filter((job) => ['ready', 'partial'].includes(job.status)),
    [scopedCatalogExportJobs]
  )
  const latestReadyCatalogExport = useMemo(() => {
    if (readyCatalogExportJobs.length > 0) return readyCatalogExportJobs[0]
    return ['ready', 'partial'].includes(catalogExport?.status || '') ? catalogExport : null
  }, [catalogExport, readyCatalogExportJobs])
  const displayCatalogExport = useMemo(() => {
    if (latestReadyCatalogExport) return latestReadyCatalogExport
    return catalogExport
  }, [catalogExport, latestReadyCatalogExport])
  const catalogExportHasMeaningfulStats = Boolean(
    displayCatalogExport &&
    (
      (displayCatalogExport.totalRows || 0) > 0 ||
      (displayCatalogExport.totalAssets || 0) > 0 ||
      (displayCatalogExport.partCount || 0) > 0 ||
      (displayCatalogExport.totalBytes || 0) > 0 ||
      (displayCatalogExport.missingAssets || 0) > 0
    )
  )
  const currentCatalogExportScopeLabel = useMemo(() => {
    return catalogExportScopeLabel(primaryCatalogExportJob || undefined)
  }, [primaryCatalogExportJob])
  const downloadHomeStatusLabel = useMemo(() => {
    if (activeCatalogExportJobs.length > 0 && readyCatalogExportJobs.length > 0) {
      return `${activeCatalogExportJobs.length} packaging · ${readyCatalogExportJobs.length} ready`
    }
    if (activeCatalogExportJobs.length > 0) {
      return `${activeCatalogExportJobs.length} packaging`
    }
    if (readyCatalogExportJobs.length > 0) {
      return `${readyCatalogExportJobs.length} ready`
    }
    return 'No packages yet'
  }, [activeCatalogExportJobs.length, readyCatalogExportJobs.length])

  const catalogExportWorkspaceName = useCallback((workspaceId: string) => {
    const matchedWorkspace = exportWorkspaceOptions.find((workspace) => workspace.workspaceId === workspaceId)
    return matchedWorkspace?.name || matchedWorkspace?.slug || workspaceId
  }, [exportWorkspaceOptions])

  const trackPendingPublishKeys = useCallback((songKeys: string[]) => {
    for (const songKey of songKeys) {
      if (!songKey) continue
      pendingPublishKeysRef.current.add(songKey)
    }
  }, [])

  const untrackPendingPublishKeys = useCallback((songKeys: string[]) => {
    for (const songKey of songKeys) {
      if (!songKey) continue
      pendingPublishKeysRef.current.delete(songKey)
    }
  }, [])

  const reconcilePublishStates = useCallback(async (songKeys: string[]) => {
    const uniqueSongKeys = [...new Set(songKeys.filter(Boolean))]
    if (uniqueSongKeys.length === 0) return

    const res = await authFetch('/api/publish-states', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ songKeys: uniqueSongKeys }),
    })
    const data = await res.json()
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `HTTP ${res.status}`)
    }

    const states = data.states || {}
    setYtStatus(prev => {
      const next = { ...prev }

      for (const songKey of uniqueSongKeys) {
        const state = states[songKey]
        if (!state) continue
        next[songKey] = state
      }

      return next
    })

    for (const songKey of uniqueSongKeys) {
      const state = states[songKey]
      if (!state) continue

      const isTerminal = Boolean(
        state.status === 'done' ||
        state.status === 'error' ||
        state.ytVideoId ||
        state.ytCanonicalUrl ||
        state.error
      )

      if (isTerminal) {
        pendingPublishKeysRef.current.delete(songKey)
      }
    }
  }, [])

  const loadQueueInspector = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true
    if (!silent) {
      setQueueInspectorLoading(true)
      setQueueInspectorError(null)
    }
    try {
      const res = await authFetch(`/api/queue-items?limit=${queueInspectorLimit}`)
      const data = await res.json()
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      setQueueInspectorItems(Array.isArray(data.items) ? data.items : [])
      setQueueInspectorLastUpdated(new Date().toISOString())
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setQueueInspectorError(message)
    } finally {
      if (!silent) {
        setQueueInspectorLoading(false)
      }
    }
  }, [queueInspectorLimit])

  // ── Queue status polling ───────────────────────────────────────────────────
  const scheduleNextPoll = useCallback((executionName?: string) => {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
    pollTimerRef.current = setTimeout(async () => {
      try {
        const res = await authFetch('/api/queue-status')
        if (!res.ok) return
        const data = await res.json()
        const c = data.counts || {}
        const stillRunning = (c.queued || 0) + (c.uploading || 0) > 0

        if (stillRunning) {
          if (showQueueInspector) {
            try {
              await loadQueueInspector({ silent: true })
            } catch {
              // Inspector refresh is helpful, not fatal.
            }
          }

          setJobBanner(prev => {
            if (!prev) return null
            return {
              ...prev,
              phase: c.uploading > 0 ? 'running' : 'queued',
              queued:    c.queued    || 0,
              uploading: c.uploading || 0,
              done:      c.done      || 0,
              error:     c.error     || 0,
            }
          })
          scheduleNextPoll(executionName)
        } else {
          const pendingPublishKeys = [...pendingPublishKeysRef.current]
          if (pendingPublishKeys.length > 0) {
            try {
              await reconcilePublishStates(pendingPublishKeys)
            } catch {
              // Reconciliation is helpful, not fatal. The next refresh will still fix state.
            }
          }

          if (showQueueInspector) {
            try {
              await loadQueueInspector()
            } catch {
              // Inspector refresh is helpful, not fatal.
            }
          }

          const hasQueueErrors = (c.error || 0) > 0
          if (doneTimerRef.current) clearTimeout(doneTimerRef.current)
          setJobBanner(prev => {
            if (!prev) return null
            return {
              ...prev,
              phase: hasQueueErrors ? 'error' : 'done',
              queued: 0,
              uploading: 0,
              done: c.done || 0,
              error: c.error || 0,
              message: hasQueueErrors
                ? 'Upload job finished with queue errors — inspect queue for failures'
                : 'Upload complete — safe to check YouTube',
            }
          })

          if (!hasQueueErrors) {
            if (doneTimerRef.current) clearTimeout(doneTimerRef.current)
            doneTimerRef.current = setTimeout(() => {
              setJobBanner(null)
            }, DONE_HOLD_MS)
          }
        }
      } catch (e) {
        // Network error during poll — retry
        scheduleNextPoll(executionName)
      }
    }, POLL_INTERVAL_MS)
  }, [loadQueueInspector, reconcilePublishStates, showQueueInspector])

  // ── Queue + trigger upload job ─────────────────────────────────────────────
  const queueAndPublish = useCallback(async (
    song: SunoSong,
    meta: YtMeta,
    options?: { triggerUploadJob?: boolean }
  ) => {
    const shouldAttemptTrigger = options?.triggerUploadJob !== false
    setYtStatus(prev => ({ ...prev, [song.songKey]: { status: 'queued' } }))

    try {
      // Step 1: create queue doc
      const res = await authFetch('/api/queue-for-youtube', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          songKey:         song.songKey,
          ytMeta: {
            title:          meta.title,
            description:    meta.description,
            tags:           meta.tags,
            promptPolicy:   meta.promptPolicy,
            lyricsPolicy:   meta.lyricsPolicy,
            alteredContent: meta.alteredContent,
            language:       meta.language,
            license:        meta.license,
            privacy:        meta.privacy,
            shortsRemixing: meta.shortsRemixing,
            category:       meta.category,
          },
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`)

      setYtStatus(prev => ({
        ...prev,
        [song.songKey]: {
          status:        data.status || 'queued',
          ytVideoId:     data.ytVideoId || '',
          ytCanonicalUrl: data.ytCanonicalUrl || '',
          error:         data.errorMsg || '',
        },
      }))

      if (data.shouldTriggerUpload || data.status === 'queued' || data.status === 'uploading') {
        trackPendingPublishKeys([song.songKey])
      } else {
        untrackPendingPublishKeys([song.songKey])
      }

      if (!shouldAttemptTrigger || !data.shouldTriggerUpload) {
        return
      }

      // Step 2: trigger Cloud Run yt-upload-job
      let executionName = ''
      try {
        const triggerRes = await authFetch('/api/trigger-upload-job', { method: 'POST' })
        const triggerData = await triggerRes.json()
        if (triggerData.ok) {
          executionName = triggerData.execution || ''
        }
      } catch { /* non-fatal — job may already be running */ }

      // Step 3: show banner and start polling
      const statusRes = await authFetch('/api/queue-status')
      const statusData = statusRes.ok ? await statusRes.json() : { counts: {} }
      const c = statusData.counts || {}
      setJobBanner({
        phase:     'queued',
        queued:    c.queued    || 1,
        uploading: c.uploading || 0,
        done:      c.done      || 0,
        error:     c.error     || 0,
        execution: executionName,
      })
      scheduleNextPoll(executionName)

    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      untrackPendingPublishKeys([song.songKey])
      setYtStatus(prev => ({
        ...prev,
        [song.songKey]: { status: 'error', error: message },
      }))
    }
  }, [scheduleNextPoll, trackPendingPublishKeys, untrackPendingPublishKeys])

  useEffect(() => {
    if (!showQueueInspector) return
    void loadQueueInspector()
  }, [loadQueueInspector, queueInspectorLimit, showQueueInspector])

  // ── Show metadata modal before publishing ──────────────────────────────────
  const queueForYouTube = useCallback((song: SunoSong) => {
    setPendingSong(song)
  }, [])

  const handleMetaConfirm = useCallback((meta: YtMeta) => {
    if (!pendingSong) return
    const song = pendingSong
    setPendingSong(null)
    queueAndPublish(song, meta)
  }, [pendingSong, queueAndPublish])

  const handleSaveDefaults = useCallback((meta: YtMeta) => {
    const nextDefaults = channelDefaultsOnly(meta)
    setChannelDefaults(nextDefaults)
    saveDefaults(nextDefaults)
  }, [])

  // ── Batch publish selected ─────────────────────────────────────────────────
  // Opens modal for first selected song; saves defaults and applies to all.
  const [batchQueue, setBatchQueue] = useState<SunoSong[]>([])
  const [batchSelectedCount, setBatchSelectedCount] = useState(0)

  const loadQueueCounts = useCallback(async () => {
    const statusRes = await authFetch('/api/queue-status')
    const statusData = statusRes.ok ? await statusRes.json() : { counts: {} }
    return statusData.counts || {}
  }, [])

  const triggerUploadJob = useCallback(async () => {
    let executionName = ''
    try {
      const triggerRes = await authFetch('/api/trigger-upload-job', { method: 'POST' })
      const triggerData = await triggerRes.json()
      if (triggerData.ok) {
        executionName = triggerData.execution || ''
      }
    } catch {
      // non-fatal — job may already be running
    }
    return executionName
  }, [])

  const retryQueueInspectorItem = useCallback(async (item: QueueInspectorItem) => {
    if (item.ytVideoId) {
      return
    }

    setQueueRetryingId(item.queueId)
    try {
      const res = await authFetch('/api/queue-for-youtube', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          songKey: item.songKey,
          retryExistingError: true,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`)
      }

      if (data.shouldTriggerUpload || data.status === 'queued' || data.status === 'uploading') {
        trackPendingPublishKeys([item.songKey])
      } else {
        untrackPendingPublishKeys([item.songKey])
      }

      const shouldTriggerUpload = Boolean(data.shouldTriggerUpload)
      const executionName = shouldTriggerUpload ? await triggerUploadJob() : ''
      const counts = await loadQueueCounts()
      setJobBanner({
        phase: shouldTriggerUpload ? 'queued' : 'done',
        queued: counts.queued || 0,
        uploading: counts.uploading || 0,
        done: counts.done || 0,
        error: counts.error || 0,
        execution: executionName,
        submission: {
          selected: 1,
          eligible: 1,
          newlyQueued: 0,
          retriedErrors: 1,
          alreadyDone: data.status === 'done' ? 1 : 0,
          alreadyRepresented: shouldTriggerUpload ? 0 : (data.status === 'done' ? 0 : 1),
          requestErrors: 0,
        },
        message: shouldTriggerUpload
          ? 'Retry queued from inspector — global queue totals are shown separately below'
          : 'Retry request reviewed — no new upload job was needed',
      })

      if (shouldTriggerUpload) {
        scheduleNextPoll(executionName)
      }

      await loadQueueInspector()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      untrackPendingPublishKeys([item.songKey])
      setQueueInspectorError(message)
    } finally {
      setQueueRetryingId(null)
    }
  }, [loadQueueCounts, loadQueueInspector, scheduleNextPoll, trackPendingPublishKeys, triggerUploadJob, untrackPendingPublishKeys])

  const normalizeQueueInspectorItem = useCallback(async (item: QueueInspectorItem) => {
    if (!needsQueueNormalization(item)) {
      return
    }

    setQueueNormalizingId(item.queueId)
    try {
      const res = await authFetch('/api/queue-normalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          queueId: item.queueId,
          action: 'mark-done',
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      await loadQueueInspector()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setQueueInspectorError(message)
    } finally {
      setQueueNormalizingId(null)
    }
  }, [loadQueueInspector])

  const retryVisibleQueueErrors = useCallback(async (items: QueueInspectorItem[]) => {
    if (items.length === 0) return

    setQueueBulkAction('retry')
    setQueueInspectorError(null)
    try {
      let shouldTriggerUpload = false
      let retriedErrors = 0
      let alreadyRepresented = 0

      for (const item of items) {
        const res = await authFetch('/api/queue-for-youtube', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            songKey: item.songKey,
            retryExistingError: true,
          }),
        })
        const data = await res.json()
        if (!res.ok || !data.ok) {
          throw new Error(data.error || `HTTP ${res.status}`)
        }

        if (data.shouldTriggerUpload || data.status === 'queued' || data.status === 'uploading') {
          trackPendingPublishKeys([item.songKey])
        } else {
          untrackPendingPublishKeys([item.songKey])
        }

        if (data.shouldTriggerUpload) {
          shouldTriggerUpload = true
          retriedErrors += 1
        } else {
          alreadyRepresented += 1
        }
      }

      const executionName = shouldTriggerUpload ? await triggerUploadJob() : ''
      const counts = await loadQueueCounts()
      setJobBanner({
        phase: shouldTriggerUpload ? 'queued' : 'done',
        queued: counts.queued || 0,
        uploading: counts.uploading || 0,
        done: counts.done || 0,
        error: counts.error || 0,
        execution: executionName,
        submission: {
          selected: items.length,
          eligible: items.length,
          newlyQueued: 0,
          retriedErrors,
          alreadyDone: 0,
          alreadyRepresented,
          requestErrors: 0,
        },
        message: shouldTriggerUpload
          ? 'Visible error rows requeued from inspector — global queue totals are shown separately below'
          : 'Visible error rows reviewed — no new upload job was needed',
      })

      if (shouldTriggerUpload) {
        scheduleNextPoll(executionName)
      }

      await loadQueueInspector()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setQueueInspectorError(message)
    } finally {
      setQueueBulkAction(null)
    }
  }, [loadQueueCounts, loadQueueInspector, scheduleNextPoll, trackPendingPublishKeys, triggerUploadJob, untrackPendingPublishKeys])

  const normalizeVisibleContradictoryRows = useCallback(async (items: QueueInspectorItem[]) => {
    if (items.length === 0) return

    setQueueBulkAction('normalize')
    setQueueInspectorError(null)
    try {
      for (const item of items) {
        const res = await authFetch('/api/queue-normalize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            queueId: item.queueId,
            action: 'mark-done',
          }),
        })
        const data = await res.json()
        if (!res.ok || !data.ok) {
          throw new Error(data.error || `HTTP ${res.status}`)
        }
      }

      await loadQueueInspector()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setQueueInspectorError(message)
    } finally {
      setQueueBulkAction(null)
    }
  }, [loadQueueInspector])

  const queueSongForYouTube = useCallback(async (
    song: SunoSong,
    meta: YtMeta,
  ): Promise<QueueRequestResult> => {
    setYtStatus(prev => ({ ...prev, [song.songKey]: { status: 'queued' } }))

    try {
      const res = await authFetch('/api/queue-for-youtube', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          songKey:         song.songKey,
          retryExistingError: true,
          ytMeta: {
            title:          meta.title,
            description:    meta.description,
            tags:           meta.tags,
            promptPolicy:   meta.promptPolicy,
            lyricsPolicy:   meta.lyricsPolicy,
            alteredContent: meta.alteredContent,
            language:       meta.language,
            license:        meta.license,
            privacy:        meta.privacy,
            shortsRemixing: meta.shortsRemixing,
            category:       meta.category,
          },
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`)
      }

      const result: QueueRequestResult = {
        status: data.status || 'queued',
        created: Boolean(data.created),
        shouldTriggerUpload: Boolean(data.shouldTriggerUpload),
        ytVideoId: data.ytVideoId || '',
        ytCanonicalUrl: data.ytCanonicalUrl || '',
        errorMsg: data.errorMsg || '',
      }

      setYtStatus(prev => ({
        ...prev,
        [song.songKey]: {
          status: result.status,
          ytVideoId: result.ytVideoId,
          ytCanonicalUrl: result.ytCanonicalUrl,
          error: result.errorMsg,
        },
      }))

      if (result.shouldTriggerUpload || result.status === 'queued' || result.status === 'uploading') {
        trackPendingPublishKeys([song.songKey])
      } else {
        untrackPendingPublishKeys([song.songKey])
      }

      return result
    } catch (e) {
      untrackPendingPublishKeys([song.songKey])
      throw e
    }
  }, [trackPendingPublishKeys, untrackPendingPublishKeys])

  const publishEntitled = Boolean(
    session?.legacyMode ||
    session?.platformAdmin ||
    session?.entitlements?.['youtube.publish.enabled']
  )
  const activePlanLabel = session?.activeWorkspace?.planId || (session?.legacyMode ? 'internal' : '')
  const publishAccessReason = loadingSession
    ? 'Checking workspace access…'
    : !session?.isAuthenticated
    ? 'Sign in and get approved for a publishing-enabled workspace to use YouTube publish controls.'
    : session?.needsApproval
    ? 'Your account is signed in but still waiting for approval before publishing is enabled.'
    : `YouTube publishing is not enabled for the current ${activePlanLabel || 'workspace'} plan.`
  const publishAccess = {
    enabled: publishEntitled,
    reason: publishAccessReason,
  }

  const publishSelected = useCallback(() => {
    if (!publishEntitled) return
    const byKey = new Map(songs.map(s => [s.songKey, s]))
    const selectedKeys = Object.keys(selected).filter(k => selected[k])
    const queue = selectedKeys
      .map(k => byKey.get(k))
      .filter((s): s is SunoSong => s !== undefined && !isPublishBlocked(s, ytStatus[s.songKey]))
    if (queue.length === 0) return
    setBatchSelectedCount(selectedKeys.length)
    setBatchQueue(queue.slice(1))
    setPendingSong(queue[0])
  }, [publishEntitled, songs, selected, ytStatus])

  const handleBatchMetaConfirm = useCallback((meta: YtMeta) => {
    if (!pendingSong) return
    const first = pendingSong
    const remaining = batchQueue
    const selectedCount = batchSelectedCount || (1 + remaining.length)
    setPendingSong(null)
    setBatchQueue([])

    void (async () => {
      handleSaveDefaults(meta)

      const submission = {
        selected: selectedCount,
        eligible: 1 + remaining.length,
        newlyQueued: 0,
        retriedErrors: 0,
        alreadyDone: 0,
        alreadyRepresented: 0,
        requestErrors: 0,
      }

      let shouldTriggerUpload = false
      for (const song of [first, ...remaining]) {
        try {
          const result = await queueSongForYouTube(song, meta)
          if (result.created) {
            submission.newlyQueued += 1
          } else if (result.shouldTriggerUpload && result.status === 'queued') {
            submission.retriedErrors += 1
          } else if (result.status === 'done') {
            submission.alreadyDone += 1
          } else {
            submission.alreadyRepresented += 1
          }
          shouldTriggerUpload = shouldTriggerUpload || result.shouldTriggerUpload
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e)
          submission.requestErrors += 1
          setYtStatus(prev => ({
            ...prev,
            [song.songKey]: { status: 'error', error: message },
          }))
        }
      }

      const executionName = shouldTriggerUpload ? await triggerUploadJob() : ''
      const counts = await loadQueueCounts()
      setJobBanner({
        phase: shouldTriggerUpload ? 'queued' : 'done',
        queued: counts.queued || 0,
        uploading: counts.uploading || 0,
        done: counts.done || 0,
        error: counts.error || 0,
        execution: executionName,
        submission,
        message: shouldTriggerUpload
          ? 'Submission recorded — global queue totals are shown separately below'
          : 'Submission reviewed — no new upload job was needed',
      })

      if (shouldTriggerUpload) {
        scheduleNextPoll(executionName)
      } else {
        if (doneTimerRef.current) clearTimeout(doneTimerRef.current)
        doneTimerRef.current = setTimeout(() => {
          setJobBanner(null)
        }, DONE_HOLD_MS)
      }
    })()
  }, [pendingSong, batchQueue, batchSelectedCount, handleSaveDefaults, loadQueueCounts, queueSongForYouTube, scheduleNextPoll, triggerUploadJob])

  const accounts = useMemo(() => {
    const s = new Set(songs.map(canonicalAccount).filter(Boolean))
    return [...s].sort()
  }, [songs])

  const removedCount = useMemo(() =>
    songs.filter(s => s.status === 'removed_from_suno').length,
  [songs])

  const searchMatchBySongKey = useMemo(() => {
    const matchMap = new Map<string, SearchMatchSummary>()
    if (!search.trim()) return matchMap
    songs.forEach(song => {
      const match = getSearchMatchSummary({
        title: song.title,
        account: [
          canonicalAccount(song),
          song.account_label,
          song.account_handle,
          song.account_sourceId,
        ].filter(isNonEmptyString),
        styles: [song.styleText, song.styles, ...styleTokensForSong(song)].filter(isNonEmptyString),
        tags: [song.displayTags, song.tags].filter(isNonEmptyString),
        lyrics: formatLyricsText(song.lyrics),
      }, search)
      if (match && song.songKey) {
        matchMap.set(song.songKey, match)
      }
    })
    return matchMap
  }, [songs, search])

  const matchesStyleFilter = useCallback((song: SunoSong, query: string) => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return true

    const haystack = [
      song.displayTags,
      song.tags,
      song.styles,
      song.styleText,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()

    return haystack.includes(normalizedQuery)
  }, [])

  const filtered = useMemo(() => {
    let out = songs.filter(hasRenderableVaultIdentity)
    if (hideRemoved) out = out.filter(s => s.status !== 'removed_from_suno')
    if (acct) out = out.filter(s => canonicalAccount(s) === acct)
    if (styleFilter.trim()) out = out.filter(song => matchesStyleFilter(song, styleFilter))
    if (lyricsFilter !== 'all') {
      out = out.filter(song => {
        const hasLyrics = Boolean(formatLyricsText(song.lyrics))
        return lyricsFilter === 'has_lyrics' ? hasLyrics : !hasLyrics
      })
    }
    if (publishFilter !== 'all') {
      out = out.filter(song => {
        const published = isPublishedState(initialYouTubeState(song))
        return publishFilter === 'published' ? published : !published
      })
    }
    if (search.trim()) {
      out = out.filter(s => Boolean(s.songKey && searchMatchBySongKey.get(s.songKey)))
    }
    return [...out].sort((a, b) => {
      if (search.trim()) {
        const aScore = a.songKey ? searchMatchBySongKey.get(a.songKey)?.score || 0 : 0
        const bScore = b.songKey ? searchMatchBySongKey.get(b.songKey)?.score || 0 : 0
        if (bScore !== aScore) return bScore - aScore
      }
      if (sort === 'createdAt')
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      if (sort === 'views')    return parseInt(b.views || '0') - parseInt(a.views || '0')
      if (sort === 'likes')    return parseInt(b.likes || '0') - parseInt(a.likes || '0')
      if (sort === 'duration') return parseFloat(b.duration || '0') - parseFloat(a.duration || '0')
      return 0
    })
  }, [songs, search, acct, styleFilter, sort, hideRemoved, lyricsFilter, publishFilter, searchMatchBySongKey, matchesStyleFilter])

  const total      = Math.max(1, Math.ceil(filtered.length / pageSize))
  const paged      = filtered.slice((page - 1) * pageSize, page * pageSize)
  const newestVisibleAt = filtered[0]?.createdAt || ''
  const activeFilterCount =
    (search.trim() ? 1 : 0) +
    (acct ? 1 : 0) +
    (styleFilter.trim() ? 1 : 0) +
    (hideRemoved ? 1 : 0) +
    (lyricsFilter !== 'all' ? 1 : 0) +
    (publishFilter !== 'all' ? 1 : 0)
  const retrievalFilterChips = useMemo(() => {
    const chips: Array<{ key: string; label: string; clear: () => void }> = []
    if (search.trim()) {
      chips.push({
        key: 'search',
        label: `Query: ${search.trim()}`,
        clear: () => {
          setSearch('')
          setPage(1)
        },
      })
    }
    if (acct) {
      chips.push({
        key: 'account',
        label: `Account: ${acct}`,
        clear: () => {
          setAcct('')
          setPage(1)
        },
      })
    }
    if (styleFilter.trim()) {
      chips.push({
        key: 'style',
        label: `Style/Tag: ${styleFilter.trim()}`,
        clear: () => {
          setStyleFilter('')
          setPage(1)
        },
      })
    }
    if (lyricsFilter !== 'all') {
      chips.push({
        key: 'lyrics',
        label: lyricsFilter === 'has_lyrics' ? 'Lyrics: available' : 'Lyrics: missing',
        clear: () => {
          setLyricsFilter('all')
          setPage(1)
        },
      })
    }
    if (publishFilter !== 'all') {
      chips.push({
        key: 'publish',
        label: publishFilter === 'published' ? 'Publish: done' : 'Publish: not done',
        clear: () => {
          setPublishFilter('all')
          setPage(1)
        },
      })
    }
    if (hideRemoved) {
      chips.push({
        key: 'removed',
        label: 'Removed hidden',
        clear: () => {
          setHideRemoved(false)
          setPage(1)
        },
      })
    }
    return chips
  }, [search, acct, styleFilter, hideRemoved, lyricsFilter, publishFilter])
  const clearRetrievalFilters = useCallback(() => {
    setSearch('')
    setAcct('')
    setStyleFilter('')
    setLyricsFilter('all')
    setPublishFilter('all')
    setSort('createdAt')
    setHideRemoved(true)
    setPage(1)
  }, [])
  const applyQuickView = useCallback((
    preset: 'recent' | 'has_lyrics' | 'missing_lyrics' | 'publish_ready' | 'published'
  ) => {
    setSearch('')
    setAcct('')
    setStyleFilter('')
    setSort('createdAt')
    setHideRemoved(true)
    setPage(1)

    if (preset === 'recent') {
      setLyricsFilter('all')
      setPublishFilter('all')
      return
    }

    if (preset === 'has_lyrics') {
      setLyricsFilter('has_lyrics')
      setPublishFilter('all')
      return
    }

    if (preset === 'missing_lyrics') {
      setLyricsFilter('missing_lyrics')
      setPublishFilter('all')
      return
    }

    if (preset === 'publish_ready') {
      setLyricsFilter('has_lyrics')
      setPublishFilter('unpublished')
      return
    }

    setLyricsFilter('all')
    setPublishFilter('published')
  }, [])
  const selectedKeys = useMemo(
    () => Object.keys(selected).filter(k => selected[k]),
    [selected]
  )
  const filteredSongKeys = useMemo(
    () => filtered.map(song => song.songKey).filter(Boolean),
    [filtered]
  )
  const filteredBatchOverflow =
    downloadAccess.maxBatchSize > 0 && filteredSongKeys.length > downloadAccess.maxBatchSize
  const pagedSelectableSongKeys = useMemo(
    () =>
      paged
        .map(song => song.songKey)
        .filter(Boolean),
    [paged]
  )
  const allVisibleSelected =
    pagedSelectableSongKeys.length > 0 &&
    pagedSelectableSongKeys.every(songKey => Boolean(selected[songKey]))
  const someVisibleSelected =
    pagedSelectableSongKeys.some(songKey => Boolean(selected[songKey]))
  const selectedBatchOverflow = downloadAccess.maxBatchSize > 0 && selectedKeys.length > downloadAccess.maxBatchSize
  const startSelectedCatalogExport = useCallback(async () => {
    if (!downloadAccess.batchEnabled) return
    if (selectedKeys.length === 0 || selectedBatchOverflow) return
    await requestCatalogExport(selectedKeys)
  }, [downloadAccess.batchEnabled, requestCatalogExport, selectedBatchOverflow, selectedKeys])
  const startFilteredCatalogExport = useCallback(async () => {
    if (!downloadAccess.batchEnabled) return
    if (filteredSongKeys.length === 0 || filteredBatchOverflow) return
    await requestCatalogExport(filteredSongKeys)
  }, [downloadAccess.batchEnabled, filteredBatchOverflow, filteredSongKeys, requestCatalogExport])
  const startSongCatalogExport = useCallback(async (songKeys?: string[]) => {
    if (!downloadAccess.singleEnabled || !songKeys || songKeys.length === 0) return
    await requestCatalogExport(songKeys)
  }, [downloadAccess.singleEnabled, requestCatalogExport])
  const songsByKey = useMemo(
    () => new Map(songs.map(song => [song.songKey, song])),
    [songs]
  )
  const queueInspectorCounts = useMemo(() => ({
    all: queueInspectorItems.length,
    active: queueInspectorItems.filter(item =>
      item.status === 'queued' || item.status === 'uploading' || item.status === 'new'
    ).length,
    stuck: queueInspectorItems.filter(isStuckQueueRow).length,
    error: queueInspectorItems.filter(item => item.status === 'error').length,
    repair: queueInspectorItems.filter(needsMediaRepair).length,
    cleanup: queueInspectorItems.filter(needsQueueNormalization).length,
    contradictory: queueInspectorItems.filter(isContradictoryQueueRow).length,
    done: queueInspectorItems.filter(item => item.status === 'done').length,
  }), [queueInspectorItems])
  const visibleQueueInspectorItems = useMemo(
    () => {
      const query = queueInspectorSearch.trim().toLowerCase()
      return queueInspectorItems.filter(item => {
        if (!matchesQueueInspectorFilter(item, queueInspectorFilter)) {
          return false
        }
        if (!query) {
          return true
        }

        const song = songsByKey.get(item.songKey)
        const diagnosis = queueDiagnosis(item)
        const haystack = [
          item.songKey,
          item.status,
          item.requestedFrom,
          item.ytVideoId,
          item.errorMsg,
          diagnosis.label,
          song?.title,
          song ? canonicalAccount(song) : '',
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()

        return haystack.includes(query)
      })
    },
    [queueInspectorItems, queueInspectorFilter, queueInspectorSearch, songsByKey]
  )
  const retryableQueueInspectorItems = useMemo(
    () => visibleQueueInspectorItems.filter(
      item => item.status === 'error' && !item.ytVideoId && !needsMediaRepair(item)
    ),
    [visibleQueueInspectorItems]
  )
  const normalizableQueueInspectorItems = useMemo(
    () => visibleQueueInspectorItems.filter(needsQueueNormalization),
    [visibleQueueInspectorItems]
  )
  const onSearch = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value); setPage(1)
  }, [])
  const clearSearch = useCallback(() => {
    setSearch(''); setPage(1)
  }, [])
  // Search results (and the derived match highlights) belong to one signed-in
  // user and one Suno account: reset the term on sign-out, account switch, or
  // a change of the selected Suno account.
  const signedInUid = firebaseUser?.uid || ''
  const previousUidRef = useRef(signedInUid)
  useEffect(() => {
    if (previousUidRef.current !== signedInUid) {
      previousUidRef.current = signedInUid
      clearSearch()
    }
  }, [signedInUid, clearSearch])
  const previousAcctRef = useRef(acct)
  useEffect(() => {
    if (previousAcctRef.current !== acct) {
      previousAcctRef.current = acct
      clearSearch()
    }
  }, [acct, clearSearch])

  const toggleSelected = useCallback((song: SunoSong) => {
    if (!downloadAccess.batchEnabled) return
    setSelected(prev => {
      const isCurrentlySelected = Boolean(prev[song.songKey])
      if (
        !isCurrentlySelected &&
        downloadAccess.maxBatchSize > 0 &&
        Object.keys(prev).filter(key => prev[key]).length >= downloadAccess.maxBatchSize
      ) {
        return prev
      }
      return { ...prev, [song.songKey]: !prev[song.songKey] }
    })
  }, [downloadAccess.batchEnabled, downloadAccess.maxBatchSize])

  const clearSelection = useCallback(() => setSelected({}), [])
  const toggleVisibleSelection = useCallback(() => {
    if (!downloadAccess.batchEnabled || pagedSelectableSongKeys.length === 0) return

    setSelected(prev => {
      const next = { ...prev }
      const shouldSelectAll = !pagedSelectableSongKeys.every(songKey => Boolean(prev[songKey]))

      if (shouldSelectAll) {
        for (const songKey of pagedSelectableSongKeys) {
          next[songKey] = true
        }
      } else {
        for (const songKey of pagedSelectableSongKeys) {
          delete next[songKey]
        }
      }

      return next
    })
  }, [downloadAccess.batchEnabled, pagedSelectableSongKeys])

  const selectAllFiltered = useCallback(() => {
    if (!downloadAccess.batchEnabled || filteredSongKeys.length === 0) return
    if (filteredBatchOverflow) return
    setSelected(prev => {
      const next = { ...prev }
      for (const songKey of filteredSongKeys) {
        next[songKey] = true
      }
      return next
    })
  }, [downloadAccess.batchEnabled, filteredBatchOverflow, filteredSongKeys])

  const hasVaultBrowseAccess = Boolean(
    session?.platformAdmin ||
    (session?.isAuthenticated &&
      session?.activeWorkspace &&
      session?.entitlements?.['vault.browse'] &&
      session?.betaAccess?.status !== 'expired')
  )
  const betaExpired = session?.betaAccess?.status === 'expired'
  const isDesktopVaultShell = viewportWidth >= 1180
  const desktopInteractiveGrid = isDesktopVaultShell && viewMode === 'grid'
  const shellLeftWidth = 220

  useEffect(() => {
    if (!desktopInteractiveGrid) {
      setFocusedSongKey(null)
      return
    }
    if (paged.length === 0) {
      setFocusedSongKey(null)
      return
    }
    if (!focusedSongKey || !paged.some(song => song.songKey === focusedSongKey)) {
      setFocusedSongKey(paged[0].songKey)
    }
  }, [desktopInteractiveGrid, focusedSongKey, paged])

  if (loadingSession) return (
    <VaultBoundary
      title="Checking access"
      body={`Verifying your ${SUNDROP_VAULT_NAME} session and workspace access.`}
    />
  )
  if (!session?.isAuthenticated) return (
    <VaultBoundary
      title="Sign in required"
      body={`${SUNDROP_VAULT_NAME} is now behind sign-in during the beta. Sign in first, then request beta access if you have not been approved yet.`}
      controls={<AuthControls variant="compact" preferredTierId="beta" />}
    />
  )
  if (betaExpired) return (
    <VaultBoundary
      title="Beta access expired"
      body="This beta workspace has expired. We can migrate you into the next approved plan path or extend access from the Control Center."
      controls={<AuthControls variant="compact" preferredTierId="beta" />}
    />
  )
  if (session?.needsApproval || session?.accessRequest?.status === 'pending') return (
    <VaultBoundary
      title="Approval pending"
      body="Your sign-in is confirmed, but Vault access stays locked until the beta application is approved."
      controls={<AuthControls variant="compact" preferredTierId="beta" />}
    />
  )
  if (!hasVaultBrowseAccess) return (
    <VaultBoundary
      title="Vault access required"
      body="This account does not have an approved Vault workspace yet. Beta access is approval-based during the public beta."
      controls={<AuthControls variant="compact" preferredTierId="beta" />}
    />
  )
  if (loading) return (
    <div style={{
      display: 'flex', justifyContent: 'center', alignItems: 'center',
      height: '80vh', color: '#7c6fff', fontSize: 18
    }}>
      Loading Vault…
    </div>
  )
  if (error) return (
    <div style={{ color: '#f66', padding: 40, textAlign: 'center' }}>
      Error loading catalog: {error}
    </div>
  )

  const pageNums = Array.from(
    { length: Math.min(7, total) },
    (_, i) => Math.max(1, Math.min(page - 3, total - 6)) + i
  )
  const archiveBody = paged.length === 0 ? (
    <div style={{ textAlign: 'center', color: '#444', padding: 60, fontSize: 16 }}>
      No tracks found.
    </div>
  ) : viewMode === 'catalog' ? (
    <div style={{
      marginBottom: 28,
      border: '1px solid rgba(129,236,255,0.08)',
      background: 'linear-gradient(180deg, rgba(12,14,18,0.96), rgba(8,8,10,0.98))',
      overflowX: 'auto',
    }}>
      <div style={{
        minWidth: 1080,
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '72px minmax(260px, 1.4fr) minmax(120px, 0.7fr) minmax(180px, 0.95fr) minmax(280px, 1.25fr)',
          gap: 18,
          padding: '14px 18px',
          borderBottom: '1px solid rgba(129,236,255,0.08)',
          color: '#66708b',
          fontSize: 11,
          letterSpacing: '.22em',
          textTransform: 'uppercase',
        }}>
          <div>Cover</div>
          <div>Asset Identity</div>
          <div>Creator</div>
          <div>State</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <span>Catalog Actions</span>
            {downloadAccess.batchEnabled && (
              <button
                type="button"
                onClick={toggleVisibleSelection}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 10px',
                  borderRadius: 999,
                  border: `1px solid ${allVisibleSelected ? 'rgba(127,232,255,0.38)' : 'rgba(255,255,255,0.1)'}`,
                  background: allVisibleSelected ? 'rgba(16,36,60,0.96)' : 'rgba(12,14,18,0.92)',
                  color: allVisibleSelected ? '#dffaff' : '#a7b2d0',
                  fontSize: 10,
                  letterSpacing: '.1em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                }}
                title={allVisibleSelected ? 'Clear the current page selection' : 'Select every song on this page'}
              >
                <span
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 4,
                    border: `1px solid ${allVisibleSelected ? '#7fe8ff' : '#5d6988'}`,
                    background: allVisibleSelected ? 'linear-gradient(180deg, #7fe8ff 0%, #7c6fff 100%)' : 'transparent',
                    boxShadow: allVisibleSelected ? '0 0 0 2px rgba(127,232,255,0.08)' : 'none',
                  }}
                />
                {allVisibleSelected ? 'Clear page' : someVisibleSelected ? 'Select page' : 'Select page'}
              </button>
            )}
          </div>
        </div>
        <div>
          {paged.map(song => (
            <CatalogRow
              key={song.songKey}
              song={song}
              selected={Boolean(selected[song.songKey])}
              onToggleSelected={toggleSelected}
              onQueueForYouTube={queueForYouTube}
              ytState={ytStatus[song.songKey]}
              publishAccess={publishAccess}
              downloadAccess={downloadAccess}
              onRequestDownloadPackage={startSongCatalogExport}
              searchMatch={song.songKey ? searchMatchBySongKey.get(song.songKey) || null : null}
            />
          ))}
        </div>
      </div>
    </div>
  ) : (
    <div style={{
      display: 'grid',
      gridTemplateColumns: desktopInteractiveGrid
        ? 'repeat(auto-fill, minmax(250px, 1fr))'
        : 'repeat(auto-fill, minmax(240px, 1fr))',
      gap: 16, marginBottom: 32,
    }}>
      {paged.map(s => (
        <SongCard
          key={s.songKey}
          song={s}
          accountDisplay={canonicalAccount(s)}
          ytState={ytStatus[s.songKey]}
          onQueueForYouTube={queueForYouTube}
          selected={Boolean(selected[s.songKey])}
          onToggleSelected={toggleSelected}
          publishAccess={publishAccess}
          downloadAccess={downloadAccess}
          onRequestDownloadPackage={startSongCatalogExport}
          isFocused={desktopInteractiveGrid && focusedSongKey === s.songKey}
          onFocusCard={setFocusedSongKey}
          desktopInteractive={desktopInteractiveGrid}
          searchMatch={s.songKey ? searchMatchBySongKey.get(s.songKey) || null : null}
        />
      ))}
    </div>
  )

  return (
    <div style={{
      minHeight: '100vh',
      background: 'radial-gradient(circle at top, rgba(10, 41, 44, 0.32), transparent 38%), #050608',
      color: '#e7e5e7',
    }}>
      {isDesktopVaultShell && (
        <div style={{
          position: 'sticky',
          top: 0,
          zIndex: 20,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 20,
          padding: '16px 26px',
          background: 'rgba(6, 7, 9, 0.92)',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          backdropFilter: 'blur(14px)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
            <div style={{
              color: '#9ff8ff',
              fontFamily: '"Newsreader", serif',
              fontStyle: 'italic',
              fontSize: 22,
              letterSpacing: '-0.02em',
            }}>
              sundrop Vault
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
              {/* Network had no destination, so it is hidden instead of left dead. */}
              {(['Archives', 'Catalog'] as const).map(label => {
                const isActive = vaultSection === 'archives' && (label === 'Catalog' ? viewMode === 'catalog' : viewMode === 'grid')
                return (
                <button
                  key={label}
                  type="button"
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => {
                    setVaultSection('archives')
                    setViewMode(label === 'Catalog' ? 'catalog' : 'grid')
                    setPage(1)
                    window.scrollTo({ top: 0, behavior: 'smooth' })
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    borderBottom: isActive ? '1px solid #81ecff' : '1px solid transparent',
                    padding: '0 0 3px',
                    color: isActive ? '#81ecff' : '#7b8297',
                    fontSize: 11,
                    letterSpacing: '.26em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                  }}
                >
                  {label}
                </button>
                )
              })}
            </div>
          </div>
          <AccountMenu />
        </div>
      )}
      {!isDesktopVaultShell && session?.isAuthenticated && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '10px 16px 0' }}>
          <AccountMenu />
        </div>
      )}

      <div style={{
        display: isDesktopVaultShell ? 'grid' : 'block',
        gridTemplateColumns: isDesktopVaultShell ? `${shellLeftWidth}px minmax(0, 1fr)` : undefined,
        maxWidth: isDesktopVaultShell ? 1840 : 1400,
        margin: '0 auto',
      }}>
        {isDesktopVaultShell && (
          <aside style={{
            minHeight: 'calc(100vh - 70px)',
            borderRight: '1px solid rgba(255,255,255,0.06)',
            background: 'rgba(0,0,0,0.55)',
            padding: '18px 0 24px',
          }}>
            <div style={{ padding: '0 22px 18px' }}>
              <div style={{
                color: '#9ff8ff',
                fontFamily: '"Newsreader", serif',
                fontStyle: 'italic',
                fontSize: 18,
                marginBottom: 10,
              }}>
                Sundrop Archives
              </div>
              <div style={{
                color: '#4d576d',
                fontSize: 10,
                letterSpacing: '.24em',
                textTransform: 'uppercase',
              }}>
                GCS Truth Sync: Active
              </div>
            </div>
            <div style={{
              padding: '16px 22px 18px',
              borderTop: '1px solid rgba(255,255,255,0.04)',
              borderBottom: '1px solid rgba(255,255,255,0.04)',
              marginBottom: 18,
            }}>
              <div style={{ color: '#b8c6ef', fontFamily: '"Newsreader", serif', fontStyle: 'italic', fontSize: 18 }}>
                VM__
              </div>
              <div style={{
                color: '#69728c',
                fontSize: 10,
                letterSpacing: '.18em',
                textTransform: 'uppercase',
                marginTop: 4,
              }}>
                Catalog Core
              </div>
            </div>
            <div style={{ display: 'grid', gap: 2 }}>
              {[
                {
                  label: 'Asset Archives',
                  active: vaultSection === 'archives' && viewMode === 'grid',
                  action: () => {
                    setVaultSection('archives')
                    setViewMode('grid')
                    setPage(1)
                  },
                },
                {
                  label: 'Music Catalog',
                  active: vaultSection === 'archives' && viewMode === 'catalog',
                  action: () => {
                    setVaultSection('archives')
                    setViewMode('catalog')
                    setPage(1)
                  },
                },
                ...(downloadAccess.centerEnabled
                  ? [{
                      label: 'Downloads',
                      active: vaultSection === 'downloads',
                      action: () => {
                        setVaultSection('downloads')
                        setPage(1)
                      },
                      badge: downloadHomeCount > 0 ? downloadHomeCount : null,
                      detail: downloadHomeStatusLabel,
                    }]
                  : []),
                // Security Nodes, Truth Stream and Vault History have no real view yet,
                // so they are hidden rather than shown as dead items.
              ].map(item => (
                <button
                  key={item.label}
                  type="button"
                  onClick={item.action}
                  style={{
                    textAlign: 'left',
                    background: item.active ? 'rgba(129,236,255,0.08)' : 'transparent',
                    border: 'none',
                    borderLeft: item.active ? '2px solid #81ecff' : '2px solid transparent',
                    color: item.active ? '#dffcff' : '#7b8297',
                    padding: '14px 22px',
                    fontSize: 11,
                    letterSpacing: '.18em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                  }}
                >
                  <span>{item.label}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {'detail' in item && item.detail ? (
                      <span style={{
                        color: item.active ? '#aeefff' : '#6d7897',
                        fontSize: 9,
                        letterSpacing: 'normal',
                        textTransform: 'none',
                      }}>
                        {item.detail}
                      </span>
                    ) : null}
                    {'badge' in item && item.badge ? (
                      <span style={{
                        minWidth: 20,
                        padding: '2px 7px',
                        borderRadius: 999,
                        background: item.active ? 'rgba(129,236,255,0.18)' : 'rgba(255,255,255,0.06)',
                        color: item.active ? '#dffcff' : '#a7b0c8',
                        fontSize: 10,
                        letterSpacing: 'normal',
                      }}>
                        {item.badge}
                      </span>
                    ) : null}
                  </div>
                </button>
              ))}
            </div>
            {/* System Integrity panel removed: its two buttons had no action. */}
          </aside>
        )}

        <div style={{
          padding: isDesktopVaultShell ? '24px 24px 32px' : '24px 16px',
          minWidth: 0,
        }}>

      {/* YouTube metadata modal */}
      {pendingSong && (
        <YtMetadataModal
          song={pendingSong}
          defaults={channelDefaults}
          onConfirm={batchQueue.length > 0 ? handleBatchMetaConfirm : handleMetaConfirm}
          onCancel={() => { setPendingSong(null); setBatchQueue([]) }}
          onSaveDefaults={handleSaveDefaults}
        />
      )}

      {/* Job banner */}
      {jobBanner && (
        <JobBanner
          state={jobBanner}
          onDismiss={() => {
            setJobBanner(null)
            if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
            if (doneTimerRef.current) clearTimeout(doneTimerRef.current)
          }}
        />
      )}

      {/* Header */}
      <div style={{ marginBottom: isDesktopVaultShell ? 18 : 28 }}>
        {isDesktopVaultShell ? (
          <div>
            <div style={{
              color: '#54607b',
              fontSize: 10,
              letterSpacing: '.34em',
              textTransform: 'uppercase',
              marginBottom: 8,
            }}>
              Asset Management System
            </div>
            <p style={{ color: '#6f7890', fontSize: 13, margin: 0 }}>
              {songs.length.toLocaleString()} tracks cataloged
              {removedCount > 0 && (
                <span style={{ color: '#75595d', marginLeft: 8 }}>
                  · {removedCount} removed from Suno
                </span>
              )}
            </p>
          </div>
        ) : (
          <>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: '#c0b0ff', letterSpacing: '-.5px' }}>
              ⚡ {SUNDROP_VAULT_NAME}
            </h1>
            <p style={{ color: '#555', fontSize: 13, marginTop: 4 }}>
              {songs.length.toLocaleString()} tracks cataloged
              {removedCount > 0 && (
                <span style={{ color: '#664444', marginLeft: 8 }}>
                  · {removedCount} removed from Suno
                </span>
              )}
            </p>
          </>
        )}
      </div>

      {session?.isAuthenticated && (
        <details style={{
          marginBottom: 18,
          padding: '10px 12px',
          border: '1px solid rgba(129,236,255,0.18)',
          background: 'rgba(10, 18, 25, 0.72)',
          color: '#dce7ff',
          fontSize: 12,
        }}>
          <summary style={{ cursor: 'pointer', color: '#aeeeff', fontWeight: 700 }}>
            Session settings
          </summary>
          <div style={{ display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap', marginTop: 12 }}>
            <label style={{ display: 'grid', gap: 6, color: '#b6c7e8' }}>
              Stay signed in (hours)
              <input
                type="number"
                min={72}
                max={744}
                step={1}
                value={sessionDurationDraft}
                onChange={(event) => setSessionDurationDraft(Number(event.target.value))}
                style={{
                  width: 92,
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: '1px solid rgba(129,236,255,0.3)',
                  background: '#0a1018',
                  color: '#ffffff',
                }}
              />
            </label>
            <button
              type="button"
              onClick={() => void saveVaultSessionDuration()}
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid rgba(129,236,255,0.35)',
                background: '#123149',
                color: '#effbff',
                cursor: 'pointer',
              }}
            >
              Save
            </button>
            <span style={{ color: '#91a3c6' }}>Default: 240 hours (10 days). Range: 72 hours to 31 days.</span>
          </div>
          {sessionDurationNotice && <div style={{ marginTop: 10, color: '#aeeeff' }}>{sessionDurationNotice}</div>}
        </details>
      )}

      {vaultFreshness && vaultFreshness.exportFreshness.status !== 'healthy' && (
        <div style={{
          marginBottom: 18,
          padding: '12px 14px',
          borderRadius: 12,
          border: vaultFreshness.exportFreshness.status === 'source_idle'
            ? '1px solid rgba(255, 192, 117, 0.38)'
            : '1px solid rgba(255, 117, 117, 0.35)',
          background: vaultFreshness.exportFreshness.status === 'source_idle'
            ? 'rgba(72, 42, 16, 0.34)'
            : 'rgba(72, 20, 20, 0.34)',
          display: 'grid',
          gap: 6,
        }}>
          <div style={{
            color: vaultFreshness.exportFreshness.status === 'source_idle' ? '#ffe3b5' : '#ffd9d9',
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '.04em',
            textTransform: 'uppercase',
          }}>
            {vaultFreshness.exportFreshness.label}
          </div>
          <div style={{
            color: vaultFreshness.exportFreshness.status === 'source_idle' ? '#f7d8b0' : '#f0c4c4',
            fontSize: 13,
            lineHeight: 1.55,
          }}>
            {vaultFreshness.exportFreshness.detail}
          </div>
          {vaultFreshness.latestSourceSong?.title && (
            <div style={{ color: '#c8d3eb', fontSize: 12, lineHeight: 1.45 }}>
              Newest harvested track: <strong>{vaultFreshness.latestSourceSong.title}</strong>
              {vaultFreshness.latestSourceSong.accountLabel || vaultFreshness.latestSourceSong.accountHandle
                ? ` · ${vaultFreshness.latestSourceSong.accountLabel || vaultFreshness.latestSourceSong.accountHandle}`
                : ''}
              {vaultFreshness.latestSourceSong.createdAt ? ` · ${vaultFreshness.latestSourceSong.createdAt}` : ''}
            </div>
          )}
          {(vaultFreshness.sourceAccounts?.length || 0) > 1 && (
            <div style={{ color: '#aeb9d4', fontSize: 12, lineHeight: 1.45 }}>
              Active harvest accounts:{' '}
              {vaultFreshness.sourceAccounts?.map((account) => account.accountLabel || account.handle).filter(Boolean).join(', ')}
            </div>
          )}
        </div>
      )}

      {catalogExportReadyNotice && latestReadyCatalogExport && vaultSection !== 'downloads' && (
        <div style={{
          marginBottom: 18,
          padding: '12px 14px',
          borderRadius: 12,
          border: '1px solid rgba(104, 219, 175, 0.35)',
          background: 'rgba(16, 52, 40, 0.34)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}>
          <div style={{ display: 'grid', gap: 4 }}>
            <div style={{ color: '#dffef4', fontSize: 13, fontWeight: 600 }}>
              Download package ready
            </div>
            <div style={{ color: '#cdeee2', fontSize: 13, lineHeight: 1.55 }}>
              {catalogExportReadyNotice}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setVaultSection('downloads')}
              style={{
                background: '#133125',
                border: '1px solid rgba(104, 219, 175, 0.35)',
                borderRadius: 10,
                color: '#effff8',
                padding: '9px 14px',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Open Downloads
            </button>
            <button
              type="button"
              onClick={() => setCatalogExportReadyNotice(null)}
              style={{
                background: 'transparent',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 10,
                color: '#c9d7f0',
                padding: '9px 14px',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {showArchiveHome && (
      <>
      {/* Controls */}
      <div style={{ marginBottom: 20 }}>
        <div style={{
          marginBottom: 12,
          border: isDesktopVaultShell ? '1px solid rgba(255,255,255,0.07)' : 'none',
          background: isDesktopVaultShell ? 'rgba(11, 12, 14, 0.9)' : 'transparent',
          padding: isDesktopVaultShell ? '14px 16px' : 0,
        }}>
        {isDesktopVaultShell && (
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
            marginBottom: 10,
          }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{
                color: '#8b95b1',
                fontSize: 10,
                letterSpacing: '.18em',
                textTransform: 'uppercase',
              }}>
                Retrieval
              </span>
              {search.trim() && (
                <span style={{
                  background: '#101a24',
                  border: '1px solid rgba(129,236,255,0.14)',
                  color: '#9edcf0',
                  borderRadius: 999,
                  padding: '4px 10px',
                  fontSize: 10,
                }}>
                  Query active
                </span>
              )}
              {acct && (
                <span style={{
                  background: '#15172a',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: '#cfd5ec',
                  borderRadius: 999,
                  padding: '4px 10px',
                  fontSize: 10,
                }}>
                  {acct}
                </span>
              )}
              {hideRemoved && (
                <span style={{
                  background: '#15172a',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: '#cfd5ec',
                  borderRadius: 999,
                  padding: '4px 10px',
                  fontSize: 10,
                }}>
                  Removed hidden
                </span>
              )}
            </div>
            <div style={{
              display: 'flex',
              gap: 14,
              alignItems: 'center',
              flexWrap: 'wrap',
              color: '#6f7890',
              fontSize: 11,
            }}>
              <span>{filtered.length.toLocaleString()} visible relics</span>
              <span>{accounts.length.toLocaleString()} accounts</span>
              <span>Newest: {newestVisibleAt ? fmtDate(newestVisibleAt) : '—'}</span>
            </div>
          </div>
        )}
        <div style={{ position: 'relative', width: '100%' }}>
        <input
          type="text" aria-label="Search the Vault"
          onKeyDown={(event) => { if (event.key === 'Escape' && search) { event.preventDefault(); clearSearch() } }}
          placeholder="Search title, account, tags, or lyrics…"
          value={search} onChange={onSearch}
          style={{
            ...selStyle,
            width: '100%',
            minWidth: 200,
            paddingRight: 32,
            boxSizing: 'border-box',
            outline: 'none',
            background: isDesktopVaultShell ? '#111111' : selStyle.background,
            border: isDesktopVaultShell ? '1px solid rgba(255,255,255,0.06)' : selStyle.border,
          }}
        />
        {search && (
          <button
            type="button"
            onClick={clearSearch}
            aria-label="Clear search"
            title="Clear search (Esc)"
            style={{
              position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
              background: 'transparent', border: 'none', color: '#9fb0d0', fontSize: 16,
              lineHeight: 1, padding: '4px 6px', cursor: 'pointer',
            }}
          >
            ×
          </button>
        )}
        </div>
        </div>

        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 10,
          alignItems: 'center',
          border: isDesktopVaultShell ? '1px solid rgba(255,255,255,0.07)' : 'none',
          background: isDesktopVaultShell ? 'rgba(11, 12, 14, 0.9)' : 'transparent',
          padding: isDesktopVaultShell ? '12px 14px' : 0,
        }}>
        <select value={acct} onChange={e => { setAcct(e.target.value); setPage(1) }} style={selStyle}>
          <option value="">All accounts</option>
          {accounts.map(a => <option key={a} value={a}>{accountDisplayName(a)}</option>)}
        </select>
        <input
          type="text"
          placeholder="Filter style or tag…"
          value={styleFilter}
          onChange={e => { setStyleFilter(e.target.value); setPage(1) }}
          style={{
            ...selStyle,
            minWidth: 190,
            outline: 'none',
          }}
        />
        <select
          value={lyricsFilter}
          onChange={e => { setLyricsFilter(e.target.value as typeof lyricsFilter); setPage(1) }}
          style={selStyle}
        >
          <option value="all">All lyrics states</option>
          <option value="has_lyrics">Has lyrics</option>
          <option value="missing_lyrics">Missing lyrics</option>
        </select>
        <select
          value={publishFilter}
          onChange={e => { setPublishFilter(e.target.value as typeof publishFilter); setPage(1) }}
          style={selStyle}
        >
          <option value="all">All publish states</option>
          <option value="published">Published</option>
          <option value="unpublished">Not published</option>
        </select>
        <select
          value={sort}
          onChange={e => { setSort(e.target.value as typeof sort); setPage(1) }}
          style={selStyle}
        >
          <option value="createdAt">Newest first</option>
          <option value="views">Most views</option>
          <option value="likes">Most likes</option>
          <option value="duration">Longest</option>
        </select>

        <label style={{
          display: 'flex', alignItems: 'center', gap: 7,
          color: '#9999cc', fontSize: 13, cursor: 'pointer',
          userSelect: 'none', padding: '6px 12px',
          background: '#12121f', border: '1px solid #2a2a4a',
          borderRadius: 8, whiteSpace: 'nowrap',
        }}>
          <input
            type="checkbox"
            checked={hideRemoved}
            onChange={e => { setHideRemoved(e.target.checked); setPage(1) }}
            style={{ accentColor: '#7c6fff', width: 14, height: 14, cursor: 'pointer' }}
          />
          Hide Removed from SUNO
        </label>

        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: 4,
          borderRadius: 10,
          background: '#0f1118',
          border: '1px solid rgba(129,236,255,0.08)',
        }}>
          <button
            onClick={() => { setViewMode('grid'); setPage(1) }}
            style={btnStyle(true, viewMode === 'grid')}
          >
            Vault Grid
          </button>
          <button
            onClick={() => { setViewMode('catalog'); setPage(1) }}
            style={btnStyle(true, viewMode === 'catalog')}
          >
            Music Catalog
          </button>
        </div>

        <select
          value={pageSize}
          onChange={e => { setPageSize(Number(e.target.value)); setPage(1) }}
          style={selStyle}
          title="Items per page"
        >
          {[24, 50, 100].map(size => (
            <option key={size} value={size}>
              {size} per page
            </option>
          ))}
        </select>

        {selectedKeys.length > 0 && (
          <>
            {downloadAccess.batchEnabled && (
              <span style={{ color: selectedBatchOverflow ? '#ff9a9a' : '#8b95b1', fontSize: 12 }}>
                {selectedKeys.length} selected
                {downloadAccess.maxBatchSize > 0 ? ` · batch cap ${downloadAccess.maxBatchSize}` : ''}
              </span>
            )}
            <button
              onClick={() => void startSelectedCatalogExport()}
              disabled={!downloadAccess.batchEnabled || selectedBatchOverflow}
              style={{
                background: downloadAccess.batchEnabled && !selectedBatchOverflow ? '#10243c' : '#151520',
                border: '1px solid rgba(127,232,255,0.2)',
                borderRadius: 8,
                color: downloadAccess.batchEnabled && !selectedBatchOverflow ? '#e8f6ff' : '#6f6f94',
                padding: '8px 14px',
                fontSize: 13,
                cursor: downloadAccess.batchEnabled && !selectedBatchOverflow ? 'pointer' : 'not-allowed',
                opacity: downloadAccess.batchEnabled && !selectedBatchOverflow ? 1 : 0.75,
              }}
              title={
                !downloadAccess.batchEnabled
                  ? 'Batch downloads are not enabled for the current plan.'
                  : selectedBatchOverflow
                    ? `Select ${downloadAccess.maxBatchSize} songs or fewer to package them together.`
                    : 'Package the selected songs with audio, lyrics, and artwork.'
              }
            >
              Download Selected ({selectedKeys.length})
            </button>
            <button
              onClick={publishSelected}
              disabled={!publishEntitled}
              style={{
                background: publishEntitled ? '#a32626' : '#4a2222', border: '1px solid #a32626',
                borderRadius: 8, color: '#fff',
                padding: '8px 14px', fontSize: 13, cursor: publishEntitled ? 'pointer' : 'not-allowed',
                opacity: publishEntitled ? 1 : 0.65,
              }}
              title={publishEntitled ? 'Queue selected clips for YouTube upload' : publishAccessReason}
            >
              Publish Selected ({selectedKeys.length})
            </button>
            <button
              onClick={clearSelection}
              style={{
                background: '#12121f', border: '1px solid #2a2a4a',
                borderRadius: 8, color: '#9999cc',
                padding: '8px 14px', fontSize: 13, cursor: 'pointer',
              }}
            >
              Clear
            </button>
          </>
        )}

        {activeFilterCount > 0 && filteredSongKeys.length > 0 && selectedKeys.length === 0 && downloadAccess.batchEnabled && (
          <>
            <button
              onClick={selectAllFiltered}
              disabled={filteredBatchOverflow}
              style={{
                background: filteredBatchOverflow ? '#151520' : '#12121f',
                border: '1px solid #2a2a4a',
                borderRadius: 8,
                color: filteredBatchOverflow ? '#6f6f94' : '#9999cc',
                padding: '8px 14px',
                fontSize: 13,
                cursor: filteredBatchOverflow ? 'not-allowed' : 'pointer',
              }}
              title={
                filteredBatchOverflow
                  ? `Filter matches ${filteredSongKeys.length} songs, above the batch cap of ${downloadAccess.maxBatchSize}.`
                  : `Select all ${filteredSongKeys.length} songs matching the current filters`
              }
            >
              Select all filtered ({filteredSongKeys.length})
            </button>
            <button
              onClick={() => void startFilteredCatalogExport()}
              disabled={filteredBatchOverflow}
              style={{
                background: filteredBatchOverflow ? '#151520' : '#10243c',
                border: '1px solid rgba(127,232,255,0.2)',
                borderRadius: 8,
                color: filteredBatchOverflow ? '#6f6f94' : '#e8f6ff',
                padding: '8px 14px',
                fontSize: 13,
                cursor: filteredBatchOverflow ? 'not-allowed' : 'pointer',
              }}
              title={
                filteredBatchOverflow
                  ? `Use fewer filters or select up to ${downloadAccess.maxBatchSize} songs manually.`
                  : `Package all ${filteredSongKeys.length} songs currently visible under active filters`
              }
            >
              Download filtered ({filteredSongKeys.length})
            </button>
          </>
        )}

        <button
          onClick={() => {
            if (!publishEntitled) return
            const next = !showQueueInspector
            setShowQueueInspector(next)
            if (next) {
              void loadQueueInspector()
            }
          }}
          disabled={!publishEntitled}
          style={{
            background: !publishEntitled ? '#151520' : showQueueInspector ? '#1f2846' : '#12121f',
            border: '1px solid #2a2a4a',
            borderRadius: 8,
            color: !publishEntitled ? '#6f6f94' : showQueueInspector ? '#d9e2ff' : '#9999cc',
            padding: '8px 14px',
            fontSize: 13,
            cursor: publishEntitled ? 'pointer' : 'not-allowed',
            opacity: publishEntitled ? 1 : 0.75,
          }}
          title={publishEntitled ? 'Inspect recent YouTube queue activity' : publishAccessReason}
        >
          {showQueueInspector ? 'Hide Queue Inspector' : 'Inspect Queue'}
        </button>

        <span style={{ color: '#555', fontSize: 13 }}>
          {filtered.length.toLocaleString()} results
        </span>
        </div>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: isDesktopVaultShell ? 'center' : 'flex-start',
          gap: 12,
          flexWrap: 'wrap',
          marginTop: 10,
        }}>
          <div style={{ display: 'grid', gap: 8, minWidth: 0, flex: '1 1 520px' }}>
            <div style={{ color: '#66708b', fontSize: 11, lineHeight: 1.5 }}>
              {viewMode === 'grid'
                ? 'Grid mode is for fast visual browsing. Click a relic to bring it into focus.'
                : 'Music Catalog is the condensed operator view for metadata-heavy scanning and publish work.'}
            </div>
            <div style={{
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
              alignItems: 'center',
            }}>
              <span style={{ color: '#66708b', fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase' }}>
                Quick views
              </span>
              {[
                { key: 'recent', label: 'Newest arrivals' },
                { key: 'publish_ready', label: 'Publish ready' },
                { key: 'has_lyrics', label: 'Has lyrics' },
                { key: 'missing_lyrics', label: 'Missing lyrics' },
                { key: 'published', label: 'Published' },
              ].map(preset => (
                <button
                  key={preset.key}
                  type="button"
                  onClick={() => applyQuickView(preset.key as 'recent' | 'has_lyrics' | 'missing_lyrics' | 'publish_ready' | 'published')}
                  style={{
                    background: '#10131a',
                    border: '1px solid rgba(127,232,255,0.12)',
                    borderRadius: 999,
                    color: '#cfe7ff',
                    padding: isDesktopVaultShell ? '6px 10px' : '7px 11px',
                    fontSize: 11,
                    cursor: 'pointer',
                  }}
                  title={`Apply the ${preset.label.toLowerCase()} retrieval view`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            {retrievalFilterChips.length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {retrievalFilterChips.map(chip => (
                  <button
                    key={chip.key}
                    type="button"
                    onClick={chip.clear}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 10px',
                      borderRadius: 999,
                      border: '1px solid rgba(127,232,255,0.18)',
                      background: 'rgba(11, 17, 26, 0.92)',
                      color: '#d9f7ff',
                      fontSize: 11,
                      cursor: 'pointer',
                    }}
                    title="Clear this retrieval filter"
                  >
                    <span>{chip.label}</span>
                    <span style={{ color: '#7fe8ff', fontWeight: 700 }}>×</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {activeFilterCount > 0 && (
              <span style={{ color: '#8b95b1', fontSize: 11 }}>
                {activeFilterCount} active filter{activeFilterCount === 1 ? '' : 's'}
              </span>
            )}
            <button
              onClick={clearRetrievalFilters}
              style={{
                background: '#10131a',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 8,
                color: '#cfd5ec',
                padding: '7px 12px',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              Reset Retrieval
            </button>
          </div>
        </div>
      </div>
      </>
      )}

      {showDownloadsHome && (
        <div style={{
          marginBottom: 18,
          padding: isDesktopVaultShell ? '14px 16px' : '12px 14px',
          borderRadius: 12,
          border: '1px solid rgba(129,236,255,0.12)',
          background: 'rgba(9, 11, 18, 0.92)',
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 14,
            flexWrap: 'wrap',
          }}>
            <div style={{ maxWidth: 760 }}>
              <div style={{ color: '#7fe8ff', fontSize: 11, letterSpacing: '.18em', textTransform: 'uppercase' }}>
                Local Catalog Export
              </div>
              <div style={{ color: '#eff4ff', fontSize: 18, fontWeight: 600, marginTop: 6 }}>
                Tier 1 portable catalog bundle
              </div>
              <div style={{ color: '#92a0bd', fontSize: 13, lineHeight: 1.65, marginTop: 8 }}>
                Download a package with the song CSV, audio, images, and lyric files for this request.
                Larger requests may split into multiple ZIP files.
              </div>
              {accounts.length > 1 && (
                <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ color: '#8fa2c5', fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase' }}>
                    Account scope
                  </span>
                  <select
                    value={acct}
                    onChange={(event) => {
                      setAcct(event.target.value)
                      setCatalogExport(null)
                      setCatalogExportError(null)
                      setCatalogExportReadyNotice(null)
                    }}
                    style={{
                      minWidth: 260,
                      background: '#11131d',
                      border: '1px solid rgba(127,232,255,0.14)',
                      borderRadius: 10,
                      color: '#dce7ff',
                      padding: '9px 12px',
                      fontSize: 13,
                    }}
                    aria-label="Account scope for download"
                  >
                    <option value="">All accounts</option>
                    {accounts.map((account) => <option key={account} value={account}>{accountDisplayName(account)}</option>)}
                  </select>
                </div>
              )}
                {session?.platformAdmin && exportWorkspaceOptions.length > 1 && (
                  <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ color: '#8fa2c5', fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase' }}>
                      Export workspace
                    </span>
                  <select
                    value={exportWorkspaceId}
                    onChange={(event) => {
                      setSelectedExportWorkspaceId(event.target.value)
                      setCatalogExport(null)
                      setCatalogExportError(null)
                    }}
                    style={{
                      minWidth: 260,
                      background: '#11131d',
                      border: '1px solid rgba(127,232,255,0.14)',
                      borderRadius: 10,
                      color: '#dce7ff',
                      padding: '9px 12px',
                      fontSize: 13,
                    }}
                  >
                    {exportWorkspaceOptions.map((workspace) => (
                      <option key={workspace.workspaceId} value={workspace.workspaceId}>
                        {workspace.name || workspace.slug || workspace.workspaceId}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                onClick={() => void startCatalogExport()}
                disabled={!canExportCatalog || catalogExportWorking}
                style={{
                  background: canExportCatalog ? '#10243c' : '#151520',
                  border: '1px solid rgba(127,232,255,0.2)',
                  borderRadius: 10,
                  color: canExportCatalog ? '#e8f6ff' : '#6f6f94',
                  padding: '10px 14px',
                  fontSize: 13,
                  cursor: canExportCatalog && !catalogExportWorking ? 'pointer' : 'not-allowed',
                  opacity: canExportCatalog ? 1 : 0.75,
                }}
                title={canExportCatalog ? 'Prepare a downloadable local catalog bundle' : 'Local export is not enabled for this workspace'}
              >
                {catalogExportWorking || primaryCatalogExportJob?.status === 'preparing' || primaryCatalogExportJob?.status === 'building'
                  ? 'Preparing export...'
                  : displayCatalogExport?.status === 'ready'
                    ? 'Refresh export package'
                    : 'Prepare full catalog package'}
              </button>
            </div>
          </div>

          {exportWorkspace && (
            <div style={{ marginTop: 12, color: '#8e9bb8', fontSize: 12, lineHeight: 1.55 }}>
              Workspace: <strong style={{ color: '#dce7ff' }}>{exportWorkspace.name || exportWorkspace.workspaceId}</strong>
              {exportWorkspace.planId ? ` · ${exportWorkspace.planId}` : ''}
              <span style={{ marginLeft: 10 }}>
                Account: <strong style={{ color: '#dce7ff' }}>{acct ? accountDisplayName(acct) : 'All accounts'}</strong>
              </span>
              <span style={{ marginLeft: 10 }}>
                Scope: <strong style={{ color: '#dce7ff' }}>{currentCatalogExportScopeLabel}</strong>
              </span>
            </div>
          )}

          <div style={{ marginTop: 14, display: 'grid', gap: 10 }}>
            <div style={{ color: '#8fa2c5', fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase' }}>
              Choose your package scope
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: isDesktopVaultShell ? 'repeat(3, minmax(0, 1fr))' : '1fr',
              gap: 10,
            }}>
              {[
                {
                  key: 'song',
                  title: 'Single song',
                  body: 'Start from any song card when you only need one track with its audio, artwork, and lyric files.',
                  action: 'Use Download on a song',
                },
                {
                  key: 'selection',
                  title: 'Selected songs',
                  body: 'Start from the archive selection bar when you want a handpicked group packaged together.',
                  action: `Use Download Selected${selectedKeys.length > 0 ? ` (${selectedKeys.length})` : ''}`,
                },
                {
                  key: 'catalog',
                  title: 'Full catalog',
                  body: 'Start here when you want the current workspace prepared as a complete customer-ready package.',
                  action: 'Use Prepare full catalog package',
                },
              ].map((scopeCard) => {
                const isActiveScope = (primaryCatalogExportJob?.requestScope || 'catalog') === scopeCard.key
                return (
                  <div
                    key={scopeCard.key}
                    style={{
                      borderRadius: 12,
                      border: isActiveScope ? '1px solid rgba(127,232,255,0.34)' : '1px solid rgba(255,255,255,0.08)',
                      background: isActiveScope ? 'rgba(12, 32, 50, 0.82)' : 'rgba(255,255,255,0.02)',
                      padding: '12px 13px',
                      display: 'grid',
                      gap: 7,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                      <div style={{ color: '#eff4ff', fontSize: 14, fontWeight: 600 }}>{scopeCard.title}</div>
                      {isActiveScope && (
                        <div style={{ color: '#7fe8ff', fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase' }}>
                          Active request
                        </div>
                      )}
                    </div>
                    <div style={{ color: '#91a1bf', fontSize: 12, lineHeight: 1.55 }}>
                      {scopeCard.body}
                    </div>
                    <div style={{ color: '#dce7ff', fontSize: 12, fontWeight: 600 }}>
                      {scopeCard.action}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {catalogExportError && displayCatalogExport?.status !== 'error' && (
            <div style={{
              marginTop: 12,
              padding: '10px 12px',
              borderRadius: 10,
              background: 'rgba(94, 25, 25, 0.24)',
              border: '1px solid rgba(190, 72, 72, 0.34)',
              color: '#ffcccb',
              fontSize: 13,
            }}>
              {catalogExportError}
            </div>
          )}

          {displayCatalogExport && catalogExportHasMeaningfulStats && (
            <div style={{
              marginTop: 14,
              display: 'grid',
              gridTemplateColumns: isDesktopVaultShell ? 'repeat(6, minmax(140px, 1fr))' : 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 10,
            }}>
              <div style={exportMetricCardStyle}>
                <span style={exportMetricLabelStyle}>Status</span>
                <strong style={exportMetricValueStyle}>{displayCatalogExport.status}</strong>
              </div>
              <div style={exportMetricCardStyle}>
                <span style={exportMetricLabelStyle}>Songs</span>
                <strong style={exportMetricValueStyle}>{(displayCatalogExport.totalRows || 0).toLocaleString()}</strong>
              </div>
              <div style={exportMetricCardStyle}>
                <span style={exportMetricLabelStyle}>ZIP parts</span>
                <strong style={exportMetricValueStyle}>{displayCatalogExport.partCount || 0}</strong>
              </div>
              <div style={exportMetricCardStyle}>
                <span style={exportMetricLabelStyle}>Files packaged</span>
                <strong style={exportMetricValueStyle}>{(displayCatalogExport.totalAssets || 0).toLocaleString()}</strong>
              </div>
              <div style={exportMetricCardStyle}>
                <span style={exportMetricLabelStyle}>Size</span>
                <strong style={exportMetricValueStyle}>{displayCatalogExport.totalBytesLabel || fmtBytes(displayCatalogExport.totalBytes)}</strong>
              </div>
              <div style={exportMetricCardStyle}>
                <span style={exportMetricLabelStyle}>Missing files</span>
                <strong style={exportMetricValueStyle}>{(displayCatalogExport.missingAssets || 0).toLocaleString()}</strong>
              </div>
              <div style={exportMetricCardStyle}>
                <span style={exportMetricLabelStyle}>Expires</span>
                <strong style={{ ...exportMetricValueStyle, fontSize: 12 }}>
                  {displayCatalogExport.expiresAt ? fmtDateTime(displayCatalogExport.expiresAt) : '—'}
                </strong>
              </div>
              <div style={exportMetricCardStyle}>
                <span style={exportMetricLabelStyle}>Phase</span>
                <strong style={{ ...exportMetricValueStyle, fontSize: 12 }}>{catalogExportStatusLabel(displayCatalogExport)}</strong>
              </div>
            </div>
          )}

          {displayCatalogExport && ['ready', 'partial'].includes(displayCatalogExport.status) && catalogExportHasMeaningfulStats && (
            <div style={{ marginTop: 10, color: '#7f8aa8', fontSize: 12, lineHeight: 1.6, maxWidth: 980 }}>
              Songs means CSV rows. Files packaged counts the audio, image, and lyric files included in the ZIP.
              Missing files are usually lyric files we could not include, most often missing VTT. The song CSV notes column
              tells you exactly what was unavailable for each row.
            </div>
          )}

          {displayCatalogExport && displayCatalogExport.status === 'error' && readyCatalogExportJobs.length === 0 && (
            <div style={{
              marginTop: 14,
              padding: '14px 16px',
              borderRadius: 12,
              border: '1px solid rgba(190, 72, 72, 0.34)',
              background: 'rgba(36, 12, 14, 0.82)',
              color: '#f4d7d6',
              display: 'grid',
              gap: 8,
            }}>
              <div style={{ color: '#ffb2af', fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase' }}>
                Download package unavailable
              </div>
              <div style={{ color: '#fff1f1', fontSize: 15, fontWeight: 600 }}>
                {displayCatalogExport.requestScope === 'song'
                  ? 'That song is not downloadable yet.'
                  : displayCatalogExport.requestScope === 'selection'
                    ? 'That selected song set is not downloadable yet.'
                    : 'This workspace does not have a downloadable catalog yet.'}
              </div>
              <div style={{ color: '#d9b8b7', fontSize: 13, lineHeight: 1.6 }}>
                {displayCatalogExport.error || displayCatalogExport.progressMessage || 'Wait for catalog sync to finish, then try again here.'}
              </div>
              <div style={{ color: '#caa5a4', fontSize: 12, lineHeight: 1.55 }}>
                {displayCatalogExport.requestScope === 'selection'
                  ? (
                    <>
                      Selection checked: <strong style={{ color: '#fff1f1' }}>{displayCatalogExport.selectionCount || 0} song{displayCatalogExport.selectionCount === 1 ? '' : 's'}</strong>.
                      Nothing was packaged yet, so there is nothing to download right now.
                    </>
                  )
                  : displayCatalogExport.requestScope === 'song'
                    ? (
                      <>
                        Song checked: <strong style={{ color: '#fff1f1' }}>1 song</strong>.
                        Nothing was packaged yet, so there is nothing to download right now.
                      </>
                    )
                    : (
                      <>
                        Scope checked: <strong style={{ color: '#fff1f1' }}>{exportWorkspace?.name || exportWorkspace?.workspaceId || 'selected workspace'}</strong>
                        {displayCatalogExport.requestAccountHandle ? <> · account <strong style={{ color: '#fff1f1' }}>{displayCatalogExport.requestAccountHandle}</strong></> : null}.
                        Nothing was packaged yet, so there is nothing to download right now.
                      </>
                    )}
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 2 }}>
                <a
                  href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`Download package help: ${exportWorkspace?.name || exportWorkspace?.workspaceId || 'workspace'}`)}&body=${encodeURIComponent(`Hi,\n\nI tried to prepare a ${displayCatalogExport.requestScope === 'song' ? 'single-song' : displayCatalogExport.requestScope === 'selection' ? 'selected-song' : 'full catalog'} package for ${displayCatalogExport.requestScope === 'selection' ? `${displayCatalogExport.selectionCount || 0} selected songs` : exportWorkspace?.name || exportWorkspace?.workspaceId || 'this workspace'}, but it was not exportable yet.\n\nPlease help me confirm whether catalog sync is still running or if this selection/workspace needs attention.\n`)}`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '8px 12px',
                    borderRadius: 999,
                    border: '1px solid rgba(255, 178, 175, 0.32)',
                    color: '#fff1f1',
                    textDecoration: 'none',
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  Contact support
                </a>
              </div>
            </div>
          )}

          {primaryCatalogExportJob && ['preparing', 'building'].includes(primaryCatalogExportJob.status) && (
            <div style={{
              marginTop: 14,
              padding: '12px 14px',
              borderRadius: 12,
              border: '1px solid rgba(127,232,255,0.14)',
              background: 'rgba(9, 15, 24, 0.88)',
              color: '#d8e8ff',
              display: 'grid',
              gap: 6,
            }}>
              <div style={{ color: '#7fe8ff', fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase' }}>
                Packaging in progress
              </div>
              <div style={{ color: '#f0f6ff', fontSize: 14, fontWeight: 600 }}>
                {primaryCatalogExportJob.stepCurrent && primaryCatalogExportJob.stepTotal
                  ? `Step ${primaryCatalogExportJob.stepCurrent} of ${primaryCatalogExportJob.stepTotal}: ${catalogExportStatusLabel(primaryCatalogExportJob)}`
                  : catalogExportStatusLabel(primaryCatalogExportJob)}
              </div>
              <div style={{ color: '#93a8cb', fontSize: 13, lineHeight: 1.55 }}>
                {primaryCatalogExportJob.progressMessage || 'We are preparing this download package now.'}
              </div>
            </div>
          )}

          {!hasCatalogExports && (
            <div style={{
              marginTop: 16,
              padding: '16px 18px',
              borderRadius: 12,
              border: '1px dashed rgba(127,232,255,0.18)',
              background: 'rgba(12, 16, 24, 0.82)',
              display: 'grid',
              gap: 8,
            }}>
              <div style={{ color: '#eff4ff', fontSize: 15, fontWeight: 600 }}>
                No download packages yet
              </div>
              <div style={{ color: '#91a1bf', fontSize: 13, lineHeight: 1.6 }}>
                This is where packaged downloads will appear for this workspace. Start with <strong style={{ color: '#dce7ff' }}>Prepare full catalog package</strong>
                to build a downloadable archive of the entire selected workspace, or use <strong style={{ color: '#dce7ff' }}>Download</strong> and <strong style={{ color: '#dce7ff' }}>Download Selected</strong> from the archive views when you only need a song or a smaller set.
              </div>
              <div style={{ color: '#6f7d9d', fontSize: 12, lineHeight: 1.55 }}>
                For larger catalogs, we split the package into multiple ZIP files automatically so the download stays more reliable on real customer machines.
              </div>
            </div>
          )}

          {(activeCatalogExportJobs.length > 0 || readyCatalogExportJobs.length > 0) && (
            <div style={{ marginTop: 16, display: 'grid', gap: 14 }}>
              {activeCatalogExportJobs.length > 0 && (
                <div style={{ display: 'grid', gap: 10 }}>
                  <div style={{ color: '#8fa2c5', fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase' }}>
                    Download queue
                  </div>
                  <div style={{
                    borderRadius: 12,
                    border: '1px solid rgba(255,255,255,0.08)',
                    overflow: 'hidden',
                    background: '#0f121b',
                  }}>
                    {activeCatalogExportJobs.map((job, index) => (
                      <div
                        key={job.exportId}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: isDesktopVaultShell ? 'minmax(220px, 1.4fr) minmax(160px, 1fr) minmax(120px, 1fr)' : '1fr',
                          gap: 12,
                          padding: '12px 14px',
                          alignItems: 'center',
                          borderTop: index === 0 ? 'none' : '1px solid rgba(255,255,255,0.06)',
                        }}
                      >
                        <div style={{ display: 'grid', gap: 4 }}>
                          <div style={{ color: '#e5ebff', fontSize: 14, fontWeight: 600 }}>
                            {catalogExportWorkspaceName(job.workspaceId)}
                          </div>
                          <div style={{ color: '#8fa2c5', fontSize: 12 }}>
                            {job.stepCurrent && job.stepTotal
                              ? `${catalogExportRequestLabel(job)} · Step ${job.stepCurrent} of ${job.stepTotal}`
                              : 'Preparing package'}
                          </div>
                        </div>
                        <div style={{ color: '#dce7ff', fontSize: 13 }}>
                          {catalogExportStatusLabel(job)}
                        </div>
                        <div style={{ color: '#93a8cb', fontSize: 12, lineHeight: 1.45 }}>
                          {job.progressMessage || 'Preparing package'}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {readyCatalogExportJobs.length > 0 && (
                <div style={{ display: 'grid', gap: 10 }}>
                  <div style={{ display: 'grid', gap: 4 }}>
                    <div style={{ color: '#8fa2c5', fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase' }}>
                      Ready downloads
                    </div>
                  </div>
                  <div style={{
                    borderRadius: 12,
                    border: '1px solid rgba(255,255,255,0.08)',
                    overflow: 'hidden',
                    background: '#0f121b',
                  }}>
                    {readyCatalogExportJobs.map((job, index) => {
                      const workspaceStem = makeSafeFilePart(job.workspaceId || 'workspace')
                      const simpleItems: CatalogDownloadListItem[] = []
                      if (job.manifestUrl) {
                        simpleItems.push({
                          key: `${job.exportId}-manifest`,
                          label: 'Song manifest',
                          typeLabel: 'CSV · one row per selected song',
                          sizeLabel: 'Included',
                          actionLabel: 'Download',
                          downloadUrl: job.manifestUrl,
                          fileName: `${workspaceStem}-catalog.csv`,
                          available: true,
                        })
                      }
                      if (job.summaryUrl) {
                        simpleItems.push({
                          key: `${job.exportId}-summary`,
                          label: 'Export summary',
                          typeLabel: 'JSON · package totals',
                          sizeLabel: 'Included',
                          actionLabel: 'Download',
                          downloadUrl: job.summaryUrl,
                          fileName: `${workspaceStem}-catalog-summary.json`,
                          available: true,
                        })
                      }
                      for (const part of job.parts || []) {
                        const partAvailable = Boolean(part.downloadUrl)
                        simpleItems.push({
                          key: `${job.exportId}-${part.partName}`,
                          label: part.partName.replace(/\.zip$/i, ''),
                          typeLabel: 'ZIP · audio, images, lyrics',
                          sizeLabel: part.sizeLabel || fmtBytes(part.sizeBytes),
                          actionLabel: partAvailable ? 'Download' : 'Unavailable',
                          downloadUrl: part.downloadUrl,
                          fileName: part.fileName || part.partName,
                          available: partAvailable,
                        })
                      }
                      return (
                        <div
                          key={job.exportId}
                          style={{
                            padding: '14px',
                            borderTop: index === 0 ? 'none' : '1px solid rgba(255,255,255,0.06)',
                            display: 'grid',
                            gap: 12,
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                          <div style={{ display: 'grid', gap: 4 }}>
                            <div style={{ color: '#e8f0ff', fontSize: 14, fontWeight: 600 }}>
                              {catalogExportWorkspaceName(job.workspaceId)}
                            </div>
                            <div style={{ color: '#8fa2c5', fontSize: 12 }}>
                              {catalogExportRequestLabel(job)} · {catalogExportScopeLabel(job)} · {job.partCount || 0} part{job.partCount === 1 ? '' : 's'} · {(job.totalBytesLabel || fmtBytes(job.totalBytes))}
                            </div>
                          <div style={{ color: '#6f7d9d', fontSize: 11 }}>
                              Prepared {job.updatedAt || job.createdAt ? fmtDateTime(job.updatedAt || job.createdAt || '') : 'recently'}
                            </div>
                            {job.downloadUnavailableReason && (
                              <div style={{ color: '#ffb8a6', fontSize: 11, lineHeight: 1.45 }}>
                                {job.downloadUnavailableReason}
                              </div>
                            )}
                          </div>
                          <div style={{ color: '#93a8cb', fontSize: 12 }}>
                            Expires {job.expiresAt ? fmtDateTime(job.expiresAt) : '—'}
                          </div>
                          </div>
                          <div style={{ display: 'grid', gap: 8 }}>
                            {simpleItems.map((item) => (
                              <div
                                key={item.key}
                                style={{
                                  display: 'grid',
                                  gridTemplateColumns: isDesktopVaultShell ? 'minmax(220px, 2fr) minmax(120px, 1fr) minmax(100px, 1fr) auto' : '1fr',
                                  gap: 12,
                                  alignItems: 'center',
                                  padding: '10px 12px',
                                  borderRadius: 10,
                                  background: 'rgba(255,255,255,0.02)',
                                  border: '1px solid rgba(255,255,255,0.05)',
                                }}
                              >
                                <div style={{ color: '#e5ebff', fontSize: 14, fontWeight: 600 }}>{item.label}</div>
                                <div style={{ color: '#9fb1d3', fontSize: 12 }}>{item.typeLabel}</div>
                                <div style={{ color: '#d6e2ff', fontSize: 12 }}>{item.sizeLabel}</div>
                                <div style={{ display: 'flex', justifyContent: isDesktopVaultShell ? 'flex-end' : 'flex-start' }}>
                                  <button
                                    onClick={() => void downloadExportArtifact(item.downloadUrl, item.fileName)}
                                    disabled={!item.available}
                                    style={{
                                      background: item.available ? '#132945' : 'rgba(255,255,255,0.04)',
                                      border: item.available ? '1px solid rgba(127,232,255,0.2)' : '1px solid rgba(255,255,255,0.08)',
                                      borderRadius: 10,
                                      color: item.available ? '#eff7ff' : '#7d8eaf',
                                      padding: '9px 14px',
                                      fontSize: 13,
                                      cursor: item.available ? 'pointer' : 'not-allowed',
                                      opacity: item.available ? 1 : 0.72,
                                    }}
                                  >
                                    {item.actionLabel}
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {(readyCatalogExportJobs.length > 0 || ['ready', 'partial'].includes(displayCatalogExport?.status || '')) && (
            <div style={{ marginTop: 12, color: '#8392b1', fontSize: 12, lineHeight: 1.55 }}>
              ZIP parts are safe to unzip into the same parent folder. Audio, image, and lyrics filenames are unique, and each manifest file is named per part so it does not overwrite the others.
            </div>
          )}
        </div>
      )}

      {showPlaceholderVaultSection && (
        <div style={{
          marginBottom: 22,
          padding: '20px 22px',
          borderRadius: 12,
          border: '1px solid rgba(129,236,255,0.1)',
          background: 'rgba(9, 12, 18, 0.92)',
          display: 'grid',
          gap: 10,
        }}>
          <div style={{ color: '#7fe8ff', fontSize: 11, letterSpacing: '.18em', textTransform: 'uppercase' }}>
            {vaultSectionMeta[vaultSection as Extract<VaultSection, 'security' | 'truth' | 'history'>]?.title || 'Vault lane'}
          </div>
          <div style={{ color: '#eef4ff', fontSize: 22, fontWeight: 600 }}>
            {vaultSectionMeta[vaultSection as Extract<VaultSection, 'security' | 'truth' | 'history'>]?.title || 'Vault lane'}
          </div>
          <div style={{ color: '#93a8cb', fontSize: 14, lineHeight: 1.7, maxWidth: 820 }}>
            {vaultSectionMeta[vaultSection as Extract<VaultSection, 'security' | 'truth' | 'history'>]?.body}
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
            <button
              type="button"
              onClick={() => setVaultSection('archives')}
              style={{
                background: '#132945',
                border: '1px solid rgba(127,232,255,0.2)',
                borderRadius: 10,
                color: '#eff7ff',
                padding: '9px 14px',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Back to Archive
            </button>
            <a
              href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`Sundrop ${vaultSectionMeta[vaultSection as Extract<VaultSection, 'security' | 'truth' | 'history'>]?.title || 'Vault'} follow-up`)}`}
              style={{
                background: 'transparent',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 10,
                color: '#c9d7f0',
                padding: '9px 14px',
                fontSize: 13,
                textDecoration: 'none',
              }}
            >
              Contact support
            </a>
          </div>
        </div>
      )}

      {showArchiveHome && !publishEntitled && (
        <div style={{
          marginBottom: 18,
          padding: '12px 14px',
          borderRadius: 10,
          border: '1px solid #3b314f',
          background: '#141220',
          color: '#b9b4de',
          fontSize: 13,
          lineHeight: 1.55,
        }}>
          Publish and queue controls are gated right now. {publishAccessReason}
        </div>
      )}

      {showArchiveHome && showQueueInspector && (
        <div style={{
          marginBottom: 22,
          border: '1px solid #2a2a4a',
          borderRadius: 12,
          background: '#10101a',
          overflow: 'hidden',
        }}>
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
            padding: '12px 14px',
            borderBottom: '1px solid #1c1c30',
            background: '#0d0d16',
          }}>
            <span style={{ color: '#9c9cbd', fontSize: 12 }}>
              Showing {visibleQueueInspectorItems.length} of {queueInspectorCounts.all} recent rows
            </span>
            <span style={{ color: '#7df0a0', fontSize: 12 }}>
              Done: {queueInspectorCounts.done}
            </span>
            <span style={{ color: '#ffb0b0', fontSize: 12 }}>
              Error: {queueInspectorCounts.error}
            </span>
            <span style={{ color: '#9fc2ff', fontSize: 12 }}>
              Active: {queueInspectorCounts.active}
            </span>
            <span style={{ color: '#ffcf7a', fontSize: 12 }}>
              Stuck: {queueInspectorCounts.stuck}
            </span>
            <span style={{ color: '#ffb08c', fontSize: 12 }}>
              Media repair: {queueInspectorCounts.repair}
            </span>
            <span style={{ color: '#f0cb88', fontSize: 12 }}>
              Needs cleanup: {queueInspectorCounts.cleanup}
            </span>
            <span style={{ color: '#ffd47d', fontSize: 12 }}>
              Contradictory rows: {queueInspectorCounts.contradictory}
            </span>
          </div>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            padding: '12px 14px',
            borderBottom: '1px solid #22223a',
          }}>
            <div>
              <div style={{ color: '#d8d8ef', fontSize: 14, fontWeight: 600 }}>
                Recent YouTube Queue Activity
              </div>
              <div style={{ color: '#7d7d9f', fontSize: 12, marginTop: 2 }}>
                Recent queue items for publish troubleshooting. Auto-refreshes while active.
                {queueInspectorLastUpdated && ` Last updated ${fmtDateTime(queueInspectorLastUpdated)}.`}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <input
                value={queueInspectorSearch}
                onChange={e => setQueueInspectorSearch(e.target.value)}
                placeholder="Search song, error, YouTube ID..."
                style={{
                  background: '#16162a',
                  border: '1px solid #2a2a4a',
                  borderRadius: 8,
                  color: '#d8d8ef',
                  padding: '7px 12px',
                  fontSize: 12,
                  minWidth: 240,
                }}
              />
              <select
                value={queueInspectorLimit}
                onChange={e => setQueueInspectorLimit(Number(e.target.value))}
                style={{
                  background: '#16162a',
                  border: '1px solid #2a2a4a',
                  borderRadius: 8,
                  color: '#c8c8ef',
                  padding: '7px 12px',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
                title="How many recent queue rows to load"
              >
                {[50, 100, 150, 250].map(limit => (
                  <option key={limit} value={limit}>
                    {limit} rows
                  </option>
                ))}
              </select>
              {([
                ['all', `All (${queueInspectorCounts.all})`],
                ['active', `Active (${queueInspectorCounts.active})`],
                ['stuck', `Stuck (${queueInspectorCounts.stuck})`],
                ['error', `Errors (${queueInspectorCounts.error})`],
                ['repair', `Media Repair (${queueInspectorCounts.repair})`],
                ['cleanup', `Cleanup (${queueInspectorCounts.cleanup})`],
                ['contradictory', `Contradictory (${queueInspectorCounts.contradictory})`],
                ['done', `Done (${queueInspectorCounts.done})`],
              ] as [QueueInspectorFilter, string][]).map(([filter, label]) => (
                <button
                  key={filter}
                  onClick={() => setQueueInspectorFilter(filter)}
                  style={{
                    background: queueInspectorFilter === filter ? '#22325a' : '#16162a',
                    border: `1px solid ${queueInspectorFilter === filter ? '#5577d8' : '#2a2a4a'}`,
                    borderRadius: 999,
                    color: queueInspectorFilter === filter ? '#edf2ff' : '#b9b9de',
                    padding: '6px 10px',
                    fontSize: 11,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {label}
                </button>
              ))}
              <button
                onClick={() => void retryVisibleQueueErrors(retryableQueueInspectorItems)}
                disabled={queueBulkAction !== null || retryableQueueInspectorItems.length === 0}
                style={{
                  background: '#1f2846',
                  border: '1px solid #3e568e',
                  borderRadius: 8,
                  color: (queueBulkAction !== null || retryableQueueInspectorItems.length === 0) ? '#666' : '#d9e2ff',
                  padding: '7px 12px',
                  fontSize: 12,
                  cursor: (queueBulkAction !== null || retryableQueueInspectorItems.length === 0) ? 'not-allowed' : 'pointer',
                }}
                title="Retry all visible error rows that do not already have a YouTube ID"
              >
                {queueBulkAction === 'retry' ? 'Retrying Visible…' : `Retry Visible (${retryableQueueInspectorItems.length})`}
              </button>
              <button
                onClick={() => void normalizeVisibleContradictoryRows(normalizableQueueInspectorItems)}
                disabled={queueBulkAction !== null || normalizableQueueInspectorItems.length === 0}
                style={{
                  background: '#2c2410',
                  border: '1px solid #5f4a17',
                  borderRadius: 8,
                  color: (queueBulkAction !== null || normalizableQueueInspectorItems.length === 0) ? '#666' : '#f3d289',
                  padding: '7px 12px',
                  fontSize: 12,
                  cursor: (queueBulkAction !== null || normalizableQueueInspectorItems.length === 0) ? 'not-allowed' : 'pointer',
                }}
                title="Normalize all visible contradictory rows that already have a YouTube ID"
              >
                {queueBulkAction === 'normalize' ? 'Marking Visible Done…' : `Mark Visible Done (${normalizableQueueInspectorItems.length})`}
              </button>
              <button
                onClick={() => void loadQueueInspector()}
                disabled={queueInspectorLoading}
                style={{
                  background: '#16162a',
                  border: '1px solid #2a2a4a',
                  borderRadius: 8,
                  color: queueInspectorLoading ? '#666' : '#c8c8ef',
                  padding: '7px 12px',
                  fontSize: 12,
                  cursor: queueInspectorLoading ? 'not-allowed' : 'pointer',
                }}
              >
                {queueInspectorLoading ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
          </div>
          <div style={{
            padding: '12px 14px',
            borderBottom: '1px solid #1c1c30',
            background: '#111321',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 10,
          }}>
            <div style={{
              border: '1px solid #2a2f4f',
              borderRadius: 10,
              padding: '10px 12px',
              background: '#14182b',
            }}>
              <div style={{ color: '#dfe6ff', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                Retry real failures
              </div>
              <div style={{ color: '#9ea8d8', fontSize: 11, lineHeight: 1.5 }}>
                Filter to <strong>Errors</strong>, then use <strong>Retry Visible</strong> for rows that do not already have a YouTube ID.
              </div>
            </div>
            <div style={{
              border: '1px solid #4b3e18',
              borderRadius: 10,
              padding: '10px 12px',
              background: '#20190d',
            }}>
              <div style={{ color: '#f3d289', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                Normalize legacy contradictions
              </div>
              <div style={{ color: '#d8c797', fontSize: 11, lineHeight: 1.5 }}>
                Filter to <strong>Contradictory</strong>, then use <strong>Mark Visible Done</strong> for rows that are <strong>error + ytVideoId</strong>.
              </div>
            </div>
            <div style={{
              border: '1px solid #5b4b19',
              borderRadius: 10,
              padding: '10px 12px',
              background: '#1f190f',
            }}>
              <div style={{ color: '#ffcf7a', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                Investigate stuck rows
              </div>
              <div style={{ color: '#e0cca2', fontSize: 11, lineHeight: 1.5 }}>
                Filter to <strong>Stuck</strong> for active rows that have been sitting too long. Refresh once, then inspect logs or retry only if they remain idle.
              </div>
            </div>
            <div style={{
              border: '1px solid #4a3b2e',
              borderRadius: 10,
              padding: '10px 12px',
              background: '#1b1713',
            }}>
              <div style={{ color: '#f1d8b4', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                Clear stale done rows
              </div>
              <div style={{ color: '#d7c0a3', fontSize: 11, lineHeight: 1.5 }}>
                Filter to <strong>Cleanup</strong> to catch rows that are already done on YouTube but still carry stale queue error text.
              </div>
            </div>
            <div style={{
              border: '1px solid #5b3420',
              borderRadius: 10,
              padding: '10px 12px',
              background: '#191110',
            }}>
              <div style={{ color: '#ffb08c', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                Repair bad media
              </div>
              <div style={{ color: '#e0c0ae', fontSize: 11, lineHeight: 1.5 }}>
                Filter to <strong>Media Repair</strong> when a row shows zero-byte media or
                <strong> Content-Range</strong> upload errors. Repair or recapture the source
                object before retrying.
              </div>
            </div>
            <div style={{
              border: '1px solid #20405b',
              borderRadius: 10,
              padding: '10px 12px',
              background: '#121c29',
            }}>
              <div style={{ color: '#a7d5ff', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                Watch active work
              </div>
              <div style={{ color: '#a8bdd0', fontSize: 11, lineHeight: 1.5 }}>
                Filter to <strong>Active</strong> and refresh to watch queued or uploading rows move without starting a new batch.
              </div>
            </div>
          </div>

          {queueInspectorError ? (
            <div style={{ padding: 14, color: '#ff9a9a', fontSize: 12 }}>
              Queue inspector error: {queueInspectorError}
            </div>
          ) : visibleQueueInspectorItems.length === 0 && !queueInspectorLoading ? (
            <div style={{ padding: 14, color: '#8a8aaa', fontSize: 12 }}>
              No queue items match the current filter.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#141424', color: '#8f8fb4', textAlign: 'left' }}>
                    <th style={{ padding: '10px 12px' }}>Song</th>
                    <th style={{ padding: '10px 12px' }}>Vault</th>
                    <th style={{ padding: '10px 12px' }}>Status</th>
                    <th style={{ padding: '10px 12px' }}>Requested From</th>
                    <th style={{ padding: '10px 12px' }}>Created</th>
                    <th style={{ padding: '10px 12px' }}>Started</th>
                    <th style={{ padding: '10px 12px' }}>Uploaded</th>
                    <th style={{ padding: '10px 12px' }}>Retry</th>
                    <th style={{ padding: '10px 12px' }}>YouTube</th>
                    <th style={{ padding: '10px 12px' }}>Error</th>
                    <th style={{ padding: '10px 12px' }}>Next Step</th>
                    <th style={{ padding: '10px 12px' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleQueueInspectorItems.map(item => {
                    const songMatch = songsByKey.get(item.songKey)
                    const accountDisplay = songMatch ? canonicalAccount(songMatch) : ''
                    const vaultState = ytStatus[item.songKey]
                    const diagnosis = queueDiagnosis(item)
                    const isExpanded = expandedQueueInspectorId === item.queueId

                    return (
                    <Fragment key={item.queueId}>
                    <tr
                      style={{
                        borderTop: '1px solid #1f1f34',
                        color: '#d6d6ea',
                        background: needsMediaRepair(item)
                          ? 'rgba(120, 35, 10, 0.16)'
                          : needsQueueNormalization(item)
                            ? 'rgba(120, 80, 10, 0.12)'
                            : 'transparent',
                      }}
                    >
                      <td style={{ padding: '10px 12px', minWidth: 220 }}>
                        <div style={{ color: '#dfe3f8', fontSize: 12, fontWeight: 600 }}>
                          {songMatch?.title || 'Unknown song'}
                        </div>
                        {accountDisplay && (
                          <div style={{ color: '#8f93be', fontSize: 11, marginTop: 2 }}>
                            {accountDisplay}
                          </div>
                        )}
                        <div style={{ color: '#6f7398', fontFamily: 'monospace', fontSize: 10, marginTop: 4 }}>
                          {item.songKey || '—'}
                        </div>
                      </td>
                      <td style={{ padding: '10px 12px', minWidth: 180 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          {songMatch?.status === 'removed_from_suno' ? (
                            <span style={{ color: '#ffb0b0', fontSize: 11 }}>Removed from SUNO</span>
                          ) : vaultState ? (
                            <YtBadge state={vaultState} />
                          ) : (
                            <span style={{ color: '#8f8fb4', fontSize: 11 }}>No Vault publish state</span>
                          )}
                        </div>
                        {vaultState?.error && (
                          <div style={{ color: '#ffaaaa', fontSize: 11, marginTop: 4, maxWidth: 280 }}>
                            {vaultState.error}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <QueueStatusPill status={item.status} />
                          {isStuckQueueRow(item) && (
                            <span style={{ color: '#ffcf7a', fontSize: 11 }}>
                              Stuck {formatAgeMs(queueAgeMs(item))}
                            </span>
                          )}
                          {isContradictoryQueueRow(item) && (
                            <span style={{ color: '#ffd47d', fontSize: 11 }}>Has YouTube ID</span>
                          )}
                          {hasStaleQueueError(item) && (
                            <span style={{ color: '#f0cb88', fontSize: 11 }}>Stale error text</span>
                          )}
                          {needsMediaRepair(item) && (
                            <span style={{ color: '#ffb08c', fontSize: 11 }}>Media repair needed</span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '10px 12px', color: '#9c9cbd' }}>{item.requestedFrom || '—'}</td>
                      <td style={{ padding: '10px 12px', color: '#9c9cbd', whiteSpace: 'nowrap' }}>{item.createdAt ? fmtDateTime(item.createdAt) : '—'}</td>
                      <td style={{ padding: '10px 12px', color: '#9c9cbd', whiteSpace: 'nowrap' }}>{item.startedAt ? fmtDateTime(item.startedAt) : '—'}</td>
                      <td style={{ padding: '10px 12px', color: '#9c9cbd', whiteSpace: 'nowrap' }}>{item.uploadedAt ? fmtDateTime(item.uploadedAt) : '—'}</td>
                      <td style={{ padding: '10px 12px', color: '#9c9cbd' }}>{item.retryCount}</td>
                      <td style={{ padding: '10px 12px', color: '#9c9cbd', fontFamily: 'monospace', fontSize: 11 }}>
                        {item.ytVideoId ? (
                          <a
                            href={`https://www.youtube.com/watch?v=${item.ytVideoId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: '#9fc2ff', textDecoration: 'none' }}
                          >
                            {item.ytVideoId}
                          </a>
                        ) : '—'}
                      </td>
                      <td style={{ padding: '10px 12px', color: item.errorMsg ? '#ffaaaa' : '#777795', maxWidth: 340 }}>
                        {item.errorMsg || '—'}
                      </td>
                      <td style={{ padding: '10px 12px', minWidth: 220 }}>
                        <div style={{ color: diagnosis.color, fontSize: 11, fontWeight: 600 }}>
                          {diagnosis.label}
                        </div>
                        <div style={{ color: '#9c9cbd', fontSize: 11, marginTop: 4, lineHeight: 1.5 }}>
                          {diagnosis.detail}
                        </div>
                        <button
                          onClick={() => setExpandedQueueInspectorId(prev => prev === item.queueId ? null : item.queueId)}
                          style={{
                            marginTop: 8,
                            background: '#16162a',
                            border: '1px solid #2a2a4a',
                            borderRadius: 8,
                            color: '#c8c8ef',
                            padding: '5px 9px',
                            fontSize: 11,
                            cursor: 'pointer',
                          }}
                        >
                          {isExpanded ? 'Hide details' : 'Details'}
                        </button>
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <button
                          onClick={() => void retryQueueInspectorItem(item)}
                          disabled={
                            queueRetryingId === item.queueId ||
                            item.status !== 'error' ||
                            Boolean(item.ytVideoId) ||
                            needsMediaRepair(item)
                          }
                          style={{
                            background: '#16162a',
                            border: '1px solid #2a2a4a',
                            borderRadius: 8,
                            color: (
                              queueRetryingId === item.queueId ||
                              item.status !== 'error' ||
                              Boolean(item.ytVideoId) ||
                              needsMediaRepair(item)
                            ) ? '#666' : '#d6d6ea',
                            padding: '6px 10px',
                            fontSize: 11,
                            cursor: (
                              queueRetryingId === item.queueId ||
                              item.status !== 'error' ||
                              Boolean(item.ytVideoId) ||
                              needsMediaRepair(item)
                            ) ? 'not-allowed' : 'pointer',
                            whiteSpace: 'nowrap',
                          }}
                          title={
                            item.ytVideoId
                              ? 'Already has a YouTube ID'
                              : needsMediaRepair(item)
                                ? 'Repair or recapture the source media object before retrying'
                                : 'Retry this error row'
                          }
                        >
                          {queueRetryingId === item.queueId ? 'Retrying…' : 'Retry'}
                        </button>
                        <button
                          onClick={() => void normalizeQueueInspectorItem(item)}
                          disabled={queueNormalizingId === item.queueId || !needsQueueNormalization(item)}
                          style={{
                            marginLeft: 8,
                            background: '#2c2410',
                            border: '1px solid #5f4a17',
                            borderRadius: 8,
                            color: (queueNormalizingId === item.queueId || !needsQueueNormalization(item)) ? '#666' : '#f3d289',
                            padding: '6px 10px',
                            fontSize: 11,
                            cursor: (queueNormalizingId === item.queueId || !needsQueueNormalization(item)) ? 'not-allowed' : 'pointer',
                            whiteSpace: 'nowrap',
                          }}
                          title="Normalize rows with a YouTube ID that still show contradictory or stale queue state"
                        >
                          {queueNormalizingId === item.queueId ? 'Normalizing…' : 'Mark Done'}
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr style={{ background: '#0e1020', borderTop: '1px solid #1a1d32' }}>
                        <td colSpan={12} style={{ padding: '12px 14px' }}>
                          <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                            gap: 12,
                          }}>
                            <div style={{
                              background: '#15192c',
                              border: '1px solid #25304f',
                              borderRadius: 10,
                              padding: '10px 12px',
                            }}>
                              <div style={{ color: diagnosis.color, fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                                Why this row is flagged
                              </div>
                              <div style={{ color: '#c7cbea', fontSize: 11, lineHeight: 1.6 }}>
                                {diagnosis.detail}
                              </div>
                              <div style={{ color: '#8e96c5', fontSize: 11, marginTop: 8 }}>
                                Queue status: <strong>{item.status || 'unknown'}</strong>
                              </div>
                              {item.errorMsg && (
                                <div style={{ color: '#ffb3b3', fontSize: 11, marginTop: 8, lineHeight: 1.5 }}>
                                  Raw error: {item.errorMsg}
                                </div>
                              )}
                            </div>
                            <div style={{
                              background: '#14171f',
                              border: '1px solid #2b3340',
                              borderRadius: 10,
                              padding: '10px 12px',
                            }}>
                              <div style={{ color: '#dfe3f8', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                                Operate from here
                              </div>
                              <div style={{ color: '#aeb6d8', fontSize: 11, lineHeight: 1.6 }}>
                                {needsMediaRepair(item)
                                  ? 'Do not retry yet. Repair or recapture the source MP4 first, then rerun or retry the queue row.'
                                  : needsQueueNormalization(item)
                                    ? 'Normalization is safe here because the queue row already has a YouTube ID and only needs state cleanup.'
                                    : item.status === 'error'
                                      ? 'Retry is appropriate if the source media is intact and this is not a zero-byte/media-repair case.'
                                      : item.status === 'queued' || item.status === 'uploading' || item.status === 'new'
                                        ? 'Wait and watch. This row is still active and the inspector will keep auto-refreshing while the queue runs.'
                                        : 'No immediate action is needed on this row.'}
                              </div>
                            </div>
                            <div style={{
                              background: '#16131a',
                              border: '1px solid #3a3040',
                              borderRadius: 10,
                              padding: '10px 12px',
                            }}>
                              <div style={{ color: '#d8d0ef', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                                Timeline
                              </div>
                              <div style={{ color: '#a5a0bd', fontSize: 11, lineHeight: 1.7 }}>
                                <div>Created: {item.createdAt ? fmtDateTime(item.createdAt) : '—'}</div>
                                <div>Queued: {item.queuedAt ? fmtDateTime(item.queuedAt) : '—'}</div>
                                <div>Started: {item.startedAt ? fmtDateTime(item.startedAt) : '—'}</div>
                                <div>Uploaded: {item.uploadedAt ? fmtDateTime(item.uploadedAt) : '—'}</div>
                                <div>YouTube ID: {item.ytVideoId || '—'}</div>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  )})}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {showArchiveHome && archiveBody}

      {showArchiveHome && paged.length > 0 && (
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}>
          <div style={{ color: '#6f7398', fontSize: 12 }}>
            Page {page} of {total}
          </div>
          {total > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1} style={btnStyle(page !== 1)}
              >← Prev</button>
              {pageNums.map(p => (
                <button key={p} onClick={() => setPage(p)} style={btnStyle(true, p === page)}>
                  {p}
                </button>
              ))}
              <button
                onClick={() => setPage(p => Math.min(total, p + 1))}
                disabled={page === total} style={btnStyle(page !== total)}
              >Next →</button>
            </div>
          )}
        </div>
      )}
        </div>
      </div>
    </div>
  )
}

function VaultBoundary({
  title,
  body,
  controls,
}: {
  title: string
  body: string
  controls?: ReactNode
}) {
  return (
    <div style={{
      maxWidth: 980,
      margin: '0 auto',
      padding: '36px 16px 48px',
    }}>
      <div style={{
        marginBottom: 20,
      }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: '#c0b0ff', letterSpacing: '-.5px' }}>
          ⚡ {SUNDROP_VAULT_NAME}
        </h1>
        <p style={{ color: '#7e7aa6', fontSize: 14, marginTop: 6, lineHeight: 1.6 }}>
          The Vault is locked to approved beta users while we harden access, publishing, and workspace controls.
        </p>
      </div>
      <div style={{
        background: '#141220',
        border: '1px solid #2b2741',
        borderRadius: 20,
        padding: 24,
        boxShadow: '0 18px 44px rgba(8, 9, 20, 0.28)',
      }}>
        <div style={{ color: '#938cd4', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.12em', marginBottom: 10 }}>
          Beta access boundary
        </div>
        <h2 style={{ color: '#f2eeff', fontSize: 34, lineHeight: 1.05, margin: '0 0 12px' }}>{title}</h2>
        <p style={{ color: '#b7b2db', fontSize: 15, lineHeight: 1.7, maxWidth: 720, margin: 0 }}>
          {body}
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 18, marginBottom: controls ? 22 : 0 }}>
          <a
            href="/login"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 42,
              padding: '0 16px',
              borderRadius: 12,
              background: 'linear-gradient(135deg, #6f5ef7 0%, #8a7fff 100%)',
              color: '#ffffff',
              fontWeight: 700,
              textDecoration: 'none',
            }}
          >
            Login Here
          </a>
          <a
            href="/signup"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 42,
              padding: '0 16px',
              borderRadius: 12,
              background: '#19172a',
              border: '1px solid #35304f',
              color: '#ddd8ff',
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            Beta Signup
          </a>
        </div>
        {controls}
      </div>
    </div>
  )
}
