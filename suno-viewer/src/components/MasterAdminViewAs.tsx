import { useCallback, useEffect, useState } from 'react'
import { authFetch, VIEW_AS_SESSION_KEY, VIEW_AS_TOKEN_KEY } from '../lib/firebaseAuth'
import { ViewAsBanner, type ViewAsSession } from './ViewAsBanner'

interface UserRow { uid: string; email: string; displayName: string }

function readStoredSession(): ViewAsSession | null {
  try {
    const raw = window.sessionStorage.getItem(VIEW_AS_SESSION_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as ViewAsSession
    return s.exp > Date.now() ? s : null
  } catch {
    return null
  }
}

/**
 * Master Admin "view as user" entry point + banner. Renders nothing unless the
 * server has MASTER_ADMIN_ENABLED=true and the signed-in user has role=master_admin.
 * The server enforces everything; this is UI only.
 */
export function MasterAdminViewAs() {
  const [session, setSession] = useState<ViewAsSession | null>(() => readStoredSession())
  const [isAdmin, setIsAdmin] = useState(false)
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [users, setUsers] = useState<UserRow[]>([])
  const [picked, setPicked] = useState<UserRow | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    const check = () =>
      authFetch('/api/admin/whoami', { headers: { 'x-view-as-session': '' } })
        .then((r) => r.json())
        .then((j) => alive && setIsAdmin(Boolean(j?.enabled && j?.masterAdmin)))
        .catch(() => {})
    check()
    const t = setInterval(check, 60000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  const exit = useCallback(() => {
    authFetch('/api/admin/view-as/end', { method: 'POST' }).catch(() => {}).finally(() => {
      window.sessionStorage.removeItem(VIEW_AS_TOKEN_KEY)
      window.sessionStorage.removeItem(VIEW_AS_SESSION_KEY)
      setSession(null)
      window.location.reload()
    })
  }, [])

  const search = async () => {
    setError('')
    const r = await authFetch(`/api/admin/view-as/users?q=${encodeURIComponent(q)}`)
    const j = await r.json().catch(() => ({}))
    if (!r.ok) return setError(j?.error || 'Search failed')
    setUsers(j.users || [])
  }

  const start = async () => {
    if (!picked) return
    setError('')
    const r = await authFetch('/api/admin/view-as/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-view-as-session': '' },
      body: JSON.stringify({ subjectUid: picked.uid, reason }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) return setError(j?.error || 'Could not start')
    const s: ViewAsSession = {
      subjectName: picked.displayName || picked.email || picked.uid,
      mode: j.session.mode,
      startedAt: j.session.startedAt,
      exp: j.session.exp,
    }
    window.sessionStorage.setItem(VIEW_AS_TOKEN_KEY, j.token)
    window.sessionStorage.setItem(VIEW_AS_SESSION_KEY, JSON.stringify(s))
    window.location.reload()
  }

  if (session) return <ViewAsBanner session={session} onExit={exit} />
  if (!isAdmin) return null
  return (
    <div style={{ position: 'fixed', right: 16, bottom: 16, zIndex: 9999 }}>
      {!open ? (
        <button type="button" data-testid="view-as-open" onClick={() => setOpen(true)}
          style={{ background: '#7a5a00', color: '#fff', border: 0, borderRadius: 8, padding: '8px 14px', fontWeight: 600 }}>
          View as user
        </button>
      ) : (
        <div style={{ background: '#15151c', color: '#eee', border: '1px solid #7a5a00', borderRadius: 10, padding: 14, width: 340 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>View as user (read-only, 30 min, logged)</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="email or name" style={{ flex: 1 }} />
            <button type="button" onClick={search}>Search</button>
          </div>
          <div style={{ maxHeight: 160, overflow: 'auto', margin: '8px 0' }}>
            {users.map((u) => (
              <div key={u.uid} onClick={() => setPicked(u)}
                style={{ padding: 4, cursor: 'pointer', background: picked?.uid === u.uid ? '#333' : undefined }}>
                {u.email || u.uid} {u.displayName ? `(${u.displayName})` : ''}
              </div>
            ))}
          </div>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason / ticket #" style={{ width: '100%' }} />
          {error && <div style={{ color: '#ff8080', marginTop: 6 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" disabled={!picked || reason.trim().length < 4} onClick={start}>Start</button>
            <button type="button" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
