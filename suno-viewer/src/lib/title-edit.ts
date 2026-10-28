// Vault title editing: validation, best-guess title tags, and an optimistic save/undo
// controller. Server rules live in ../../title-overrides.cjs (PUT /api/song-title/:songKey).
import type { IssueTag } from './issue-tags'

export const TITLE_MAX = 200

export type TitleSource = '' | 'suno' | 'user' | 'old_file' | 'lyrics'
export type TitleEdit = { title: string; titleSource: TitleSource | string }
export type TitleSaveResult = TitleEdit & { previousTitle?: string; canRevert?: boolean }
type TitledSong = { songKey: string; title?: string; titleSource?: string }

// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/

export function normalizeTitleInput(value: string): string {
  return String(value ?? '').trim().replace(/ {2,}/g, ' ')
}

// Returns a plain-language problem, or '' when the title can be saved.
export function validateTitleInput(value: string): string {
  if (CONTROL_RE.test(String(value ?? ''))) return 'Titles cannot contain line breaks or hidden characters.'
  const length = Array.from(normalizeTitleInput(value)).length
  if (length < 1) return 'Type a title first.'
  if (length > TITLE_MAX) return `Keep it to ${TITLE_MAX} characters or fewer.`
  return ''
}

export const TITLE_SOURCE_TAGS: Record<string, IssueTag> = {
  lyrics: {
    id: 'title_from_lyrics', label: 'Title from lyrics', tone: 'muted',
    info: 'Suno has no title for this song, so the Vault is showing its first sung lyric line as a best guess. Click the pencil to give it a real name.',
  },
  old_file: {
    id: 'title_best_guess', label: 'Best guess', tone: 'muted',
    info: 'Suno has no title for this song any more. This name was found in our older harvest files, so it is probably right but Suno cannot confirm it. Click the pencil to change it.',
  },
}

export function titleSourceTag(song: TitledSong | null | undefined): IssueTag | null {
  return TITLE_SOURCE_TAGS[String(song?.titleSource || '')] || null
}

// What search should see for a song's title: the title shown on the card (including the
// "Untitled" fallback) plus any best-guess tag label, so "Untitled", "Best guess" and
// "Title from lyrics" all find the songs the user can see with those words.
export function titleSearchTerms(song: TitledSong | null | undefined): { title: string; tags: string[] } {
  const title = String(song?.title || '').trim() || 'Untitled'
  const tag = titleSourceTag(song)
  return { title, tags: tag ? [tag.label] : [] }
}
export function applyTitleEdits<T extends TitledSong>(rows: T[], edits: Record<string, TitleEdit>): T[] {
  if (!Object.keys(edits).length) return rows
  return rows.map(row => {
    const edit = row.songKey ? edits[row.songKey] : undefined
    return edit && (edit.title !== row.title || edit.titleSource !== row.titleSource)
      ? { ...row, title: edit.title, titleSource: edit.titleSource }
      : row
  })
}

export type TitleSender = (songKey: string, body: { title: string } | { revert: true }) => Promise<TitleSaveResult>

// Keeps local edits so a background catalog refresh cannot undo a save the user just made.
export function createTitleEditor({ send, onChange }: { send: TitleSender; onChange: (edits: Record<string, TitleEdit>) => void }) {
  let edits: Record<string, TitleEdit> = {}
  const set = (key: string, value: TitleEdit | undefined) => {
    const next = { ...edits }
    if (value) next[key] = value
    else delete next[key]
    edits = next
    onChange(edits)
  }

  async function run(song: TitledSong, optimistic: TitleEdit, body: { title: string } | { revert: true }) {
    const key = song.songKey
    // Restore exactly what was on screen; rows already carry the optimistic title,
    // so dropping the edit alone would leave it showing.
    const before = edits[key] || { title: song.title || '', titleSource: song.titleSource || '' }
    set(key, optimistic)
    try {
      const result = await send(key, body)
      set(key, { title: result.title, titleSource: result.titleSource })
      return result
    } catch (error) {
      set(key, before) // roll back to exactly what was on screen
      throw error
    }
  }

  return {
    get edits() { return edits },
    async save(song: TitledSong, rawTitle: string): Promise<TitleSaveResult> {
      const problem = validateTitleInput(rawTitle)
      if (problem) throw new Error(problem)
      const title = normalizeTitleInput(rawTitle)
      const result = await run(song, { title, titleSource: 'user' }, { title })
      return { ...result, previousTitle: result.previousTitle ?? song.title ?? '' }
    },
    // Go back to the title the song had before the last edit.
    async undo(song: TitledSong, previous?: TitleEdit): Promise<TitleSaveResult> {
      const optimistic = previous || { title: song.title || '', titleSource: song.titleSource || '' }
      return run(song, optimistic, { revert: true })
    },
  }
}

export async function readTitleResponse(response: Response): Promise<TitleSaveResult> {
  let payload: { ok?: boolean; error?: string } & Partial<TitleSaveResult> = {}
  try { payload = await response.json() } catch { /* keep default message */ }
  if (!response.ok || !payload.ok) {
    const fallback = response.status === 429 ? 'Too many edits in a row. Wait a minute and try again.'
      : response.status === 403 ? 'Only the Vault owner can edit titles.'
      : 'Could not save the title. Please try again.'
    throw new Error(payload.error || fallback)
  }
  return { title: String(payload.title || ''), titleSource: String(payload.titleSource || ''), previousTitle: payload.previousTitle, canRevert: payload.canRevert }
}
