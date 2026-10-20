import { useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import { authFetch } from '../lib/firebaseAuth'

interface Props {
  audioUrl: string
  songKey: string
  audioAssetRole?: string
}

const fmt = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

import { ACTIVE_PLAYER_EVENT } from '../lib/branding'

export default function AudioPlayer({ audioUrl, songKey, audioAssetRole }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const ws = useRef<WaveSurfer | null>(null)
  const nativeAudioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [ready, setReady] = useState(false)
  const [cur, setCur] = useState('0:00')
  const [dur, setDur] = useState('0:00')
  const [resolvedAudioUrl, setResolvedAudioUrl] = useState('')
  const [err, setErr] = useState(false)
  const [preferNativeControls, setPreferNativeControls] = useState(false)
  const [waveformFailed, setWaveformFailed] = useState(false)

  const togglePlayback = async () => {
    const player = ws.current
    if (preferNativeControls || waveformFailed) {
      const mediaElement = nativeAudioRef.current
      if (!mediaElement) return

      try {
        if (mediaElement.paused) {
          mediaElement.muted = false
          mediaElement.setAttribute('playsinline', 'true')
          window.dispatchEvent(new CustomEvent(ACTIVE_PLAYER_EVENT, { detail: { songKey } }))
          await mediaElement.play()
        } else {
          mediaElement.pause()
        }
      } catch {
        setErr(true)
      }
      return
    }

    if (!player || !ready) return

    try {
      const mediaElement = player.getMediaElement()
      if (player.isPlaying()) {
        mediaElement?.pause()
        player.pause()
        return
      }

      if (mediaElement) {
        mediaElement.muted = false
        mediaElement.setAttribute('playsinline', 'true')
        try {
          await mediaElement.play()
          return
        } catch {
          // Fall through to the WaveSurfer transport path.
        }
      }

      await player.play()
    } catch {
      setErr(true)
    }
  }

  useEffect(() => {
    if (typeof window === 'undefined') return
    const isCoarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false
    const isMobileViewport = window.matchMedia?.('(max-width: 900px)').matches ?? false
    const ua = navigator.userAgent || ''
    const isMobileUserAgent = /android|iphone|ipad|ipod|mobile/i.test(ua)
    setPreferNativeControls(isCoarsePointer || isMobileViewport || isMobileUserAgent)
  }, [])

  useEffect(() => {
    let cancelled = false
    let objectUrl = ''
    setErr(false)
    setReady(false)
    setResolvedAudioUrl('')

    const resolveAudio = async () => {
      try {
        if (audioUrl.startsWith('/api/song-media/')) {
          const response = await authFetch(audioUrl)
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`)
          }
          const blob = await response.blob()
          if (cancelled) return
          objectUrl = URL.createObjectURL(blob)
          setResolvedAudioUrl(objectUrl)
          return
        }

        setResolvedAudioUrl(audioUrl)
      } catch {
        if (!cancelled) {
          setErr(true)
        }
      }
    }

    void resolveAudio()

    return () => {
      cancelled = true
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [audioUrl])

  useEffect(() => {
    const mediaElement = nativeAudioRef.current
    if (!mediaElement || !resolvedAudioUrl || (!preferNativeControls && !waveformFailed)) return

    const handleLoadedMetadata = () => {
      setReady(true)
      setDur(fmt(mediaElement.duration || 0))
    }
    const handleTimeUpdate = () => setCur(fmt(mediaElement.currentTime || 0))
    const handlePlay = () => {
      setPlaying(true)
      window.dispatchEvent(new CustomEvent(ACTIVE_PLAYER_EVENT, { detail: { songKey } }))
    }
    const handlePause = () => setPlaying(false)
    const handleError = () => setErr(true)
    const handleActivePlayerChange = (event: Event) => {
      const customEvent = event as CustomEvent<{ songKey?: string }>
      if (!customEvent.detail?.songKey || customEvent.detail.songKey === songKey) return
      mediaElement.pause()
    }

    mediaElement.addEventListener('loadedmetadata', handleLoadedMetadata)
    mediaElement.addEventListener('timeupdate', handleTimeUpdate)
    mediaElement.addEventListener('play', handlePlay)
    mediaElement.addEventListener('pause', handlePause)
    mediaElement.addEventListener('ended', handlePause)
    mediaElement.addEventListener('error', handleError)
    window.addEventListener(ACTIVE_PLAYER_EVENT, handleActivePlayerChange as EventListener)

    return () => {
      mediaElement.removeEventListener('loadedmetadata', handleLoadedMetadata)
      mediaElement.removeEventListener('timeupdate', handleTimeUpdate)
      mediaElement.removeEventListener('play', handlePlay)
      mediaElement.removeEventListener('pause', handlePause)
      mediaElement.removeEventListener('ended', handlePause)
      mediaElement.removeEventListener('error', handleError)
      window.removeEventListener(ACTIVE_PLAYER_EVENT, handleActivePlayerChange as EventListener)
    }
  }, [preferNativeControls, resolvedAudioUrl, songKey, waveformFailed])

  useEffect(() => {
    if (!ref.current || !resolvedAudioUrl || preferNativeControls) return
    let destroyed = false
    setWaveformFailed(false)
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
    w.on('ready', () => {
      if (destroyed) return
      setReady(true)
      setDur(fmt(w.getDuration()))
    })
    w.on('audioprocess', () => setCur(fmt(w.getCurrentTime())))
    w.on('play', () => {
      setPlaying(true)
      window.dispatchEvent(new CustomEvent(ACTIVE_PLAYER_EVENT, { detail: { songKey } }))
    })
    w.on('pause', () => setPlaying(false))
    w.on('finish', () => setPlaying(false))
    w.on('error', () => {
      if (destroyed) return
      setWaveformFailed(true)
    })
    ws.current = w

    const handleActivePlayerChange = (event: Event) => {
      const customEvent = event as CustomEvent<{ songKey?: string }>
      if (!customEvent.detail?.songKey || customEvent.detail.songKey === songKey) return
      if (w.isPlaying()) {
        w.pause()
      }
    }

    window.addEventListener(ACTIVE_PLAYER_EVENT, handleActivePlayerChange as EventListener)

    try {
      w.load(resolvedAudioUrl)
    } catch {
      setWaveformFailed(true)
    }

    return () => {
      destroyed = true
      window.removeEventListener(ACTIVE_PLAYER_EVENT, handleActivePlayerChange as EventListener)
      ws.current = null
      w.destroy()
    }
  }, [preferNativeControls, resolvedAudioUrl, songKey])

  const derivativeNotice = audioAssetRole === 'derived-from-video' ? (
    <div style={{ color: '#d8c38a', fontSize: 12, marginBottom: 4 }}>
      Listening copy derived from video — original MP3 incomplete
    </div>
  ) : null

  if (err) return (
    <div>
      {derivativeNotice}
      <div style={{ color: '#f66', fontSize: 12 }}>Audio unavailable</div>
    </div>
  )

  const useNativeControls = preferNativeControls || waveformFailed

  return (
    <div>
      {derivativeNotice}
    <div style={{ display: 'flex', alignItems: useNativeControls ? 'stretch' : 'center', gap: 8, padding: '8px 0', flexDirection: useNativeControls ? 'column' : 'row' }}>
      <button
        onClick={() => { void togglePlayback() }}
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
      {useNativeControls ? (
        <audio
          ref={nativeAudioRef}
          controls
          preload="metadata"
          playsInline
          src={resolvedAudioUrl}
          style={{
            width: '100%',
            minHeight: 36,
            borderRadius: 10,
            background: '#111522',
          }}
        />
      ) : (
        <div ref={ref} style={{ flex: 1 }} />
      )}
      <div style={{ fontSize: 11, color: '#888', whiteSpace: 'nowrap' }}>
        {cur} / {dur}
      </div>
    </div>
    </div>
  )
}
