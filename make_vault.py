#!/usr/bin/env python3
"""Run this on Cloud Shell: python3 make_vault.py
Creates the full React+TypeScript+Vite+WaveSurfer frontend in ~/suno-viewer/"""
import os, json

B = os.path.expanduser('~/suno-viewer')
S = os.path.join(B, 'src')
C = os.path.join(S, 'components')
os.makedirs(C, exist_ok=True)

def w(path, content):
    with open(path, 'w') as f:
        f.write(content)
    print('wrote', path)

# ── package.json ──────────────────────────────────────────────────────────────
w(B+'/package.json', json.dumps({
  "name": "suno-viewer", "version": "2.0.0", "private": True,
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "serve": "node server.js"
  },
  "dependencies": {
    "@google-cloud/storage": "^7.0.0",
    "express": "^4.18.2",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "wavesurfer.js": "^7.7.3"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@vitejs/plugin-react": "^4.2.1",
    "typescript": "^5.3.3",
    "vite": "^5.1.0"
  }
}, indent=2))

# ── vite.config.ts ────────────────────────────────────────────────────────────
w(B+'/vite.config.ts', """\
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/catalog.csv': 'http://localhost:8080' }
  },
  build: { outDir: 'dist' }
})
""")

# ── tsconfig.json ─────────────────────────────────────────────────────────────
w(B+'/tsconfig.json', json.dumps({
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": True,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": True,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": True,
    "resolveJsonModule": True,
    "isolatedModules": True,
    "noEmit": True,
    "jsx": "react-jsx",
    "strict": True,
    "noUnusedLocals": True,
    "noUnusedParameters": True,
    "noFallthroughCasesInSwitch": True
  },
  "include": ["src"]
}, indent=2))

# ── index.html (Vite entry) ───────────────────────────────────────────────────
w(B+'/index.html', """\
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Aeonimus Vault</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { background: #0a0a0f; color: #e0e0e8; font-family: system-ui, sans-serif; }
      ::-webkit-scrollbar { width: 6px; }
      ::-webkit-scrollbar-track { background: #0a0a0f; }
      ::-webkit-scrollbar-thumb { background: #2a2a4a; border-radius: 3px; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
""")

# ── src/types.ts ──────────────────────────────────────────────────────────────
w(S+'/types.ts', """\
export interface SunoSong {
  songKey: string
  account_sourceId: string
  account_handle: string
  account_label: string
  title: string
  createdAt: string
  updatedAt: string
  duration: string
  views: string
  likes: string
  commentsCount: string
  remixCount: string
  audio_url: string
  video_url: string
  image_url: string
  gcs_mp3: string
  gcs_mp4: string
  gcs_thumb: string
  gcs_latest_audio: string
  gcs_latest_mp4: string
  gcs_latest_thumb: string
  rawClipJsonGs: string
  runId: string
  lastSeen: string
}
""")

# ── src/main.tsx ──────────────────────────────────────────────────────────────
w(S+'/main.tsx', """\
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
""")

# ── src/App.tsx ───────────────────────────────────────────────────────────────
w(S+'/App.tsx', """\
import VaultGrid from './components/VaultGrid'

export default function App() {
  return <VaultGrid />
}
""")

# ── src/components/AudioPlayer.tsx ────────────────────────────────────────────
w(C+'/AudioPlayer.tsx', """\
import { useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'

interface Props {
  audioUrl: string
  songKey: string
}

const fmt = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

export default function AudioPlayer({ audioUrl }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const ws = useRef<WaveSurfer | null>(null)
  const [playing, setPlaying] = useState(false)
  const [ready, setReady] = useState(false)
  const [cur, setCur] = useState('0:00')
  const [dur, setDur] = useState('0:00')
  const [err, setErr] = useState(false)

  useEffect(() => {
    if (!ref.current || !audioUrl) return
    const w = WaveSurfer.create({
      container: ref.current,
      waveColor: '#4a4a8a',
      progressColor: '#7c6fff',
      height: 48,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      normalize: true,
    })
    w.on('ready', () => { setReady(true); setDur(fmt(w.getDuration())) })
    w.on('audioprocess', () => setCur(fmt(w.getCurrentTime())))
    w.on('play', () => setPlaying(true))
    w.on('pause', () => setPlaying(false))
    w.on('finish', () => setPlaying(false))
    w.on('error', () => setErr(true))
    w.load(audioUrl)
    ws.current = w
    return () => w.destroy()
  }, [audioUrl])

  if (err) return <div style={{ color: '#f66', fontSize: 12 }}>Audio unavailable</div>

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' }}>
      <button
        onClick={() => ws.current?.playPause()}
        disabled={!ready}
        style={{
          background: ready ? '#7c6fff' : '#333',
          border: 'none', borderRadius: '50%',
          width: 32, height: 32, color: '#fff', fontSize: 14,
          cursor: ready ? 'pointer' : 'not-allowed', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {playing ? '⏸' : '▶'}
      </button>
      <div ref={ref} style={{ flex: 1 }} />
      <div style={{ fontSize: 11, color: '#888', whiteSpace: 'nowrap' }}>
        {cur} / {dur}
      </div>
    </div>
  )
}
""")

# ── src/components/VaultGrid.tsx ──────────────────────────────────────────────
w(C+'/VaultGrid.tsx', """\
import { useEffect, useState, useMemo, useCallback, CSSProperties } from 'react'
import { SunoSong } from '../types'
import AudioPlayer from './AudioPlayer'

const PAGE = 24

// ── CSV parser (handles quoted fields) ──────────────────────────────────────
function parseCSV(text: string): SunoSong[] {
  const lines = text.trim().split('\\n')
  if (lines.length < 2) return []
  const headers = lines[0].split(',')
  const out: SunoSong[] = []
  for (let i = 1; i < lines.length; i++) {
    const row: string[] = []
    let cur = '', inQ = false
    for (const ch of lines[i]) {
      if (ch === '"') { inQ = !inQ }
      else if (ch === ',' && !inQ) { row.push(cur); cur = '' }
      else { cur += ch }
    }
    row.push(cur)
    if (row.length >= headers.length) {
      const o: Record<string, string> = {}
      headers.forEach((h, idx) => { o[h.trim()] = (row[idx] || '').trim() })
      out.push(o as unknown as SunoSong)
    }
  }
  return out
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

// ── SongCard ─────────────────────────────────────────────────────────────────
function SongCard({ song }: { song: SunoSong }) {
  const [exp, setExp] = useState(false)
  const [hover, setHover] = useState(false)
  const audio = song.audio_url || song.gcs_latest_audio || song.gcs_mp3 || ''
  const thumb = song.image_url || song.gcs_latest_thumb || song.gcs_thumb || ''

  return (
    <div
      style={{
        background: '#12121f',
        border: `1px solid ${hover ? '#7c6fff' : '#1e1e3a'}`,
        borderRadius: 12, overflow: 'hidden', transition: 'border-color .2s',
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* Thumbnail */}
      <div style={{ position: 'relative', paddingBottom: '56.25%', background: '#0a0a1a' }}>
        {thumb ? (
          <img
            src={thumb} alt={song.title}
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
        <div style={{
          position: 'absolute', bottom: 6, right: 6,
          background: 'rgba(0,0,0,.75)', borderRadius: 4,
          padding: '2px 6px', fontSize: 11, color: '#ccc'
        }}>
          {fmtDur(song.duration)}
        </div>
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
          {song.account_label || song.account_handle}
        </div>
        <div style={{ display: 'flex', gap: 10, fontSize: 11, color: '#555' }}>
          <span>👁 {parseInt(song.views || '0').toLocaleString()}</span>
          <span>♥ {parseInt(song.likes || '0').toLocaleString()}</span>
          <span title={song.createdAt}>📅 {fmtDate(song.createdAt)}</span>
        </div>
        <button
          onClick={e => { e.stopPropagation(); setExp(x => !x) }}
          style={{
            marginTop: 8, background: 'transparent',
            border: '1px solid #333', borderRadius: 6,
            color: '#9999cc', fontSize: 11, padding: '4px 10px',
            cursor: 'pointer', width: '100%',
          }}
        >
          {exp ? 'Hide Player' : '▶ Play / Waveform'}
        </button>
        {exp && audio && <AudioPlayer audioUrl={audio} songKey={song.songKey} />}
      </div>
    </div>
  )
}

// ── shared styles ─────────────────────────────────────────────────────────────
const selStyle: CSSProperties = {
  background: '#12121f', border: '1px solid #2a2a4a',
  borderRadius: 8, color: '#e0e0f0', padding: '8px 14px', fontSize: 14,
}
const btnStyle = (on: boolean, cur = false): CSSProperties => ({
  background: cur ? '#7c6fff' : '#12121f',
  border: `1px solid ${cur ? '#7c6fff' : '#2a2a4a'}`,
  borderRadius: 6, color: on ? (cur ? '#fff' : '#9999cc') : '#333',
  padding: '6px 14px', fontSize: 13, cursor: on ? 'pointer' : 'not-allowed',
})

// ── VaultGrid ─────────────────────────────────────────────────────────────────
export default function VaultGrid() {
  const [songs, setSongs] = useState<SunoSong[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [acct, setAcct] = useState('')
  const [sort, setSort] = useState<'createdAt' | 'views' | 'likes' | 'duration'>('createdAt')
  const [page, setPage] = useState(1)

  useEffect(() => {
    fetch('/catalog.csv')
      .then(r => r.text())
      .then(t => { setSongs(parseCSV(t)); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  const accounts = useMemo(() => {
    const s = new Set(songs.map(x => x.account_label || x.account_handle).filter(Boolean))
    return [...s].sort()
  }, [songs])

  const filtered = useMemo(() => {
    let out = songs
    if (acct) out = out.filter(s => (s.account_label || s.account_handle) === acct)
    if (search) {
      const q = search.toLowerCase()
      out = out.filter(s =>
        (s.title || '').toLowerCase().includes(q) ||
        (s.account_label || '').toLowerCase().includes(q) ||
        (s.account_handle || '').toLowerCase().includes(q)
      )
    }
    return [...out].sort((a, b) => {
      if (sort === 'createdAt')
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      if (sort === 'views') return parseInt(b.views || '0') - parseInt(a.views || '0')
      if (sort === 'likes') return parseInt(b.likes || '0') - parseInt(a.likes || '0')
      if (sort === 'duration')
        return parseFloat(b.duration || '0') - parseFloat(a.duration || '0')
      return 0
    })
  }, [songs, search, acct, sort])

  const total = Math.ceil(filtered.length / PAGE)
  const paged = filtered.slice((page - 1) * PAGE, page * PAGE)

  const onSearch = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value); setPage(1)
  }, [])

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

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: '24px 16px' }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: '#c0b0ff', letterSpacing: '-.5px' }}>
          ⚡ Aeonimus Vault
        </h1>
        <p style={{ color: '#555', fontSize: 13, marginTop: 4 }}>
          {songs.length.toLocaleString()} tracks cataloged
        </p>
      </div>

      {/* Controls */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 10,
        marginBottom: 20, alignItems: 'center',
      }}>
        <input
          type="text" placeholder="Search title, artist…"
          value={search} onChange={onSearch}
          style={{ ...selStyle, flex: 1, minWidth: 200, outline: 'none' }}
        />
        <select value={acct} onChange={e => { setAcct(e.target.value); setPage(1) }} style={selStyle}>
          <option value="">All accounts</option>
          {accounts.map(a => <option key={a} value={a}>{a}</option>)}
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
        <span style={{ color: '#555', fontSize: 13 }}>
          {filtered.length.toLocaleString()} results
        </span>
      </div>

      {/* Grid */}
      {paged.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#444', padding: 60, fontSize: 16 }}>
          No tracks found.
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          gap: 16, marginBottom: 32,
        }}>
          {paged.map(s => <SongCard key={s.songKey} song={s} />)}
        </div>
      )}

      {/* Pagination */}
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
  )
}
""")

print()
print('=== All files written ===')
print()
print('Next steps on Cloud Shell:')
print('  cd ~/suno-viewer')
print('  npm install')
print('  npm run build')
print('  # built output lands in ~/suno-viewer/dist/')
print()
print('To serve the built app, update server.js to serve dist/ as static,')
print('then: node server.js')
