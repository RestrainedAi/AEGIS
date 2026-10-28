// Pure helpers for the Vault Publish form, the "already published" warning,
// and the YouTube state labels. Kept framework-free so they are unit-tested.

export interface PublishChannelOption {
  key: string
  name: string
  youtubeChannelId?: string
  enabled?: boolean
}

export interface PriorPublish {
  state: 'none' | 'on_youtube' | 'queued' | 'uploading' | string
  canProceed?: boolean
  sameChannel?: boolean
  message?: string
  details?: {
    ytVideoId?: string
    url?: string
    publishedAt?: string
    queuedAt?: string
    channel?: string
    channelName?: string
    privacy?: string
  } | null
}

/** Fields that only make sense for one song; hidden and never sent in batch mode. */
export const PER_SONG_FIELDS = ['title', 'description', 'tags'] as const

export function queueMetaForRequest<T extends object>(meta: T, isBatch: boolean): Partial<T> {
  const out: Record<string, unknown> = { ...(meta as Record<string, unknown>) }
  delete out.channel
  if (isBatch) for (const f of PER_SONG_FIELDS) delete out[f]
  return out as Partial<T>
}

/** Default channel for a song: the user's default for its Suno account, if that channel is linked and enabled. */
export function defaultChannelForAccount(
  accountCandidates: string[],
  accountDefaults: Record<string, string>,
  channels: PublishChannelOption[],
): string {
  const usable = new Set(channels.filter(c => c.enabled !== false).map(c => c.key))
  for (const a of accountCandidates) {
    const c = accountDefaults[a]
    if (c && usable.has(c)) return c
  }
  return '' // no silent fallback: the user must pick, or publishing is blocked
}

export function formatWhen(iso?: string): string {
  if (!iso) return 'unknown date'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

/** Plain-language lines for the warning dialog. */
export function priorPublishLines(prior: PriorPublish): string[] {
  const d = prior.details || {}
  if (prior.state === 'queued' || prior.state === 'uploading') {
    return [
      prior.message || 'Already in the YouTube queue.',
      `Queued: ${formatWhen(d.queuedAt)}`,
      `Channel: ${d.channelName || d.channel || 'unknown'}`,
      `Privacy: ${d.privacy || 'unknown'}`,
    ]
  }
  if (prior.state === 'on_youtube') {
    return [
      prior.message || 'Already on YouTube.',
      `Published: ${formatWhen(d.publishedAt)}`,
      `Channel: ${d.channelName || d.channel || 'unknown'}`,
      `Privacy: ${d.privacy || 'unknown'}`,
      `Video: ${d.url || ''}`,
    ]
  }
  return []
}

// ── YouTube vs Suno status (they are different things) ─────────────────────────
export interface YouTubeStateLike {
  status?: string
  ytVideoId?: string
  ytCanonicalUrl?: string
}

/** "On YouTube" is true only when there is a real YouTube video ID. */
export function isOnYouTube(state?: YouTubeStateLike | null): boolean {
  return Boolean(state && String(state.ytVideoId || '').trim())
}

export function youtubeUrl(state?: YouTubeStateLike | null): string {
  const id = String(state?.ytVideoId || '').trim()
  return id ? `https://www.youtube.com/watch?v=${id}` : ''
}

export function youtubeStateLabel(state?: YouTubeStateLike | null): string {
  if (!state) return ''
  if (isOnYouTube(state)) return 'On YouTube'
  switch (state.status) {
    case 'queued': return 'Queued for YouTube'
    case 'uploading': return 'Uploading to YouTube'
    case 'error': return 'YouTube upload failed'
    case 'done': return 'YouTube: no video ID'
    default: return state.status || ''
  }
}

/** Suno's own state (live on Suno vs removed from Suno), never called "Published". */
export function sunoStateLabel(removedFromSuno: boolean): string {
  return removedFromSuno ? 'Removed from Suno' : 'Live on Suno'
}
