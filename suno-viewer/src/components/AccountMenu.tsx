import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../lib/firebaseAuth'

export default function AccountMenu() {
  const { firebaseUser, signOutUser, switchAccount } = useAuth()
  const [open, setOpen] = useState(false)
  const [working, setWorking] = useState(false)
  const [notice, setNotice] = useState('')
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!firebaseUser) return null
  const label = firebaseUser.email || firebaseUser.displayName || 'Signed in'

  async function run(action: () => Promise<void>, failure: string) {
    setWorking(true)
    setNotice('')
    try {
      await action()
      setOpen(false)
    } catch (error) {
      const code = (error as { code?: string })?.code || ''
      setNotice(code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request'
        ? 'Account chooser closed. You are signed out; choose Continue with Google to sign back in.'
        : `${failure}: ${(error as Error)?.message || error}`)
    } finally {
      setWorking(false)
    }
  }

  return (
    <div ref={ref} style={{ position: 'relative' }} data-testid="account-menu">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        style={{
          background: 'rgba(129,236,255,0.06)', border: '1px solid rgba(129,236,255,0.3)', color: '#c8f8ff',
          padding: '7px 12px', fontSize: 12, borderRadius: 8, cursor: 'pointer', maxWidth: 280,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
      >
        {label} ▾
      </button>
      {open && (
        <div role="menu" style={{
          position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 50, minWidth: 230,
          background: '#0a1018', border: '1px solid rgba(129,236,255,0.3)', borderRadius: 10, padding: 6,
          boxShadow: '0 12px 30px rgba(0,0,0,0.5)',
        }}>
          <div style={{ padding: '8px 10px', color: '#91a3c6', fontSize: 11 }}>Signed in as<br /><strong style={{ color: '#eaf6ff' }}>{label}</strong></div>
          <button type="button" role="menuitem" disabled={working}
            onClick={() => void run(switchAccount, 'Switch account failed')} style={itemStyle}>
            Switch account
          </button>
          <button type="button" role="menuitem" disabled={working}
            onClick={() => void run(signOutUser, 'Sign out failed')} style={itemStyle}>
            Sign out
          </button>
        </div>
      )}
      {notice && (
        <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 49, width: 280, padding: 10,
          background: '#2a1418', border: '1px solid rgba(255,117,117,0.4)', color: '#ffd6d6', fontSize: 12, borderRadius: 8 }}
          onClick={() => setNotice('')}>
          {notice}
        </div>
      )}
    </div>
  )
}

const itemStyle = {
  display: 'block', width: '100%', textAlign: 'left' as const, background: 'transparent', border: 'none',
  color: '#dce7ff', padding: '9px 10px', fontSize: 13, cursor: 'pointer', borderRadius: 6,
}
