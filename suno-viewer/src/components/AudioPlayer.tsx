import { useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import { authFetch } from '../lib/firebaseAuth'

interface Props {
  audioUrl: string
  songKey: string
}

const fmt = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

import { ACTIVE_PLAYER_EVENT } from '../lib/branding'

export default function AudioPlayer({ audioUrl, songKey }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const ws = useRef<WaveSurfer | null>(null)
  const [playing, setPlaying] = useState(false)
  const [ready, setReady] = useState(false)
  const [cur, setCur] = useState('0:00')
  const [dur, setDur] = useState('0:00')
  const [err, setErr] = useState(false)

  useEffect(() => {
    if (!ref.current || !audioUrl) return
    let cancelled = false
    let objectUrl = ''
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
    w.on('play', () => {
      setPlaying(true)
      window.dispatchEvent(new CustomEvent(ACTIVE_PLAYER_EVENT, { detail: { songKey } }))
    })
    w.on('pause', () => setPlaying(false))
    w.on('finish', () => setPlaying(false))
    w.on('error', () => setErr(true))
    ws.current = w

    const handleActivePlayerChange = (event: Event) => {
      const customEvent = event as CustomEvent<{ songKey?: string }>
      if (!customEvent.detail?.songKey || customEvent.detail.songKey === songKey) return
      if (w.isPlaying()) {
        w.pause()
      }
    }

    window.addEventListener(ACTIVE_PLAYER_EVENT, handleActivePlayerChange as EventListener)
    const loadAudio = async () => {
      try {
        if (audioUrl.startsWith('/api/song-media/')) {
          const response = await authFetch(audioUrl)
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`)
          }
          const blob = await response.blob()
          if (cancelled) return
          objectUrl = URL.createObjectURL(blob)
          w.load(objectUrl)
          return
        }

        w.load(audioUrl)
      } catch {
        if (!cancelled) {
          setErr(true)
        }
      }
    }

    void loadAudio()

    return () => {
      cancelled = true
      window.removeEventListener(ACTIVE_PLAYER_EVENT, handleActivePlayerChange as EventListener)
      w.destroy()
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [audioUrl, songKey])

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
