import {
  GoogleAuthProvider,
  browserLocalPersistence,
  browserSessionPersistence,
  getAuth,
  isSignInWithEmailLink,
  onIdTokenChanged,
  sendSignInLinkToEmail,
  setPersistence,
  signInWithEmailLink,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth'
import { initializeApp } from 'firebase/app'
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react'
import type { AuthSession } from '../types'
import { buildActiveCloudUrl, EMAIL_LINK_STORAGE_KEY } from './branding'

const firebaseConfig = {
  apiKey: 'AIzaSyCwaZJmcslKhJ-Kgl_w3IgmRvMBc-xy9Sw',
  authDomain: 'stable-framing-482501-t9.firebaseapp.com',
  projectId: 'stable-framing-482501-t9',
  storageBucket: 'stable-framing-482501-t9.firebasestorage.app',
  messagingSenderId: '206866140882',
  appId: '1:206866140882:web:a411281f60fda5c3f6270b',
}

const firebaseApp = initializeApp(firebaseConfig)
const firebaseAuth = getAuth(firebaseApp)

const emailLinkUrl = buildActiveCloudUrl('/vault')
export const MAGIC_LINK_ENABLED = false
export const VAULT_SESSION_EVERY_VISIT_HOURS = 0
export const DEFAULT_VAULT_SESSION_HOURS = 30 * 24
export const MIN_VAULT_SESSION_HOURS = 1
export const MAX_VAULT_SESSION_HOURS = 90 * 24
export const VAULT_SESSION_DURATION_OPTIONS = [
  { hours: VAULT_SESSION_EVERY_VISIT_HOURS, label: 'Every visit' },
  { hours: 7 * 24, label: '7 days' },
  { hours: DEFAULT_VAULT_SESSION_HOURS, label: '30 days (default)' },
  { hours: 60 * 24, label: '60 days' },
  { hours: MAX_VAULT_SESSION_HOURS, label: '90 days' },
] as const

const VAULT_SESSION_PREFERENCE_KEY = 'sundrop.vault.session-preference.v2'
const LEGACY_VAULT_SESSION_PREFERENCE_KEY = 'sundrop.vault.session-preference.v1'
const VAULT_SESSION_PREFERENCE_VERSION = 2
const TOKEN_REFRESH_INTERVAL_MS = 30 * 60 * 1000
const SESSION_EXPIRY_CHECK_INTERVAL_MS = 15 * 60 * 1000

type VaultSessionPreference = {
  uid: string
  durationHours: number
  // Kept only while existing browser preferences migrate to the hour-based setting.
  durationDays?: number
  expiresAt: number
  version?: number
  requiresMigration?: boolean
}

function normalizeSessionDurationHours(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_VAULT_SESSION_HOURS
  const roundedHours = Math.round(value)
  if (roundedHours <= VAULT_SESSION_EVERY_VISIT_HOURS) return VAULT_SESSION_EVERY_VISIT_HOURS
  return Math.min(MAX_VAULT_SESSION_HOURS, Math.max(MIN_VAULT_SESSION_HOURS, roundedHours))
}

async function applyAuthPersistence(durationHours: number) {
  const normalizedHours = normalizeSessionDurationHours(durationHours)
  const persistence = normalizedHours === VAULT_SESSION_EVERY_VISIT_HOURS
    ? browserSessionPersistence
    : browserLocalPersistence
  await setPersistence(firebaseAuth, persistence)
}

function readVaultSessionPreference(): VaultSessionPreference | null {
  try {
    const raw = window.localStorage.getItem(VAULT_SESSION_PREFERENCE_KEY)
      || window.localStorage.getItem(LEGACY_VAULT_SESSION_PREFERENCE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<VaultSessionPreference>
    if (!parsed.uid || !Number.isFinite(parsed.expiresAt)) return null
    const legacyDurationDays = Number(parsed.durationDays)
    const requestedHours = Number.isFinite(parsed.durationHours)
      ? Number(parsed.durationHours)
      : legacyDurationDays * 24
    const requiresMigration = parsed.version !== VAULT_SESSION_PREFERENCE_VERSION && requestedHours === 10 * 24
    const durationHours = requiresMigration
      ? DEFAULT_VAULT_SESSION_HOURS
      : normalizeSessionDurationHours(requestedHours)
    return {
      uid: parsed.uid,
      durationHours,
      // The previous product default was 10 days. Upgrade those browser sessions to the new 30-day default.
      expiresAt: requiresMigration
        ? Date.now() + DEFAULT_VAULT_SESSION_HOURS * 60 * 60 * 1000
        : Number(parsed.expiresAt),
      requiresMigration,
    }
  } catch {
    return null
  }
}

function saveVaultSessionPreference(uid: string, durationHours: number) {
  const normalizedHours = normalizeSessionDurationHours(durationHours)
  const preference: VaultSessionPreference = {
    uid,
    durationHours: normalizedHours,
    expiresAt: normalizedHours === VAULT_SESSION_EVERY_VISIT_HOURS
      ? 0
      : Date.now() + normalizedHours * 60 * 60 * 1000,
    version: VAULT_SESSION_PREFERENCE_VERSION,
  }
  window.localStorage.setItem(VAULT_SESSION_PREFERENCE_KEY, JSON.stringify(preference))
  return preference
}

function clearVaultSessionPreference() {
  window.localStorage.removeItem(VAULT_SESSION_PREFERENCE_KEY)
  window.localStorage.removeItem(LEGACY_VAULT_SESSION_PREFERENCE_KEY)
}

type AuthContextValue = {
  clientReady: boolean
  firebaseUser: User | null
  token: string
  session: AuthSession | null
  loadingSession: boolean
  sessionError: string
  sessionDurationHours: number
  refreshSession: () => Promise<void>
  setSessionDurationHours: (durationHours: number) => Promise<void>
  signInWithGoogle: () => Promise<void>
  sendMagicLink: (email: string) => Promise<void>
  signOutUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: PropsWithChildren) {
  const [clientReady, setClientReady] = useState(false)
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null)
  const [token, setToken] = useState('')
  const [session, setSession] = useState<AuthSession | null>(null)
  const [loadingSession, setLoadingSession] = useState(true)
  const [sessionError, setSessionError] = useState('')
  const [sessionRevision, setSessionRevision] = useState(0)
  const [authResolved, setAuthResolved] = useState(false)
  const [sessionDurationHours, setSessionDurationHoursState] = useState(DEFAULT_VAULT_SESSION_HOURS)

  useEffect(() => {
    let cancelled = false

    async function prepareAuthPersistence() {
      const preference = readVaultSessionPreference()
      await applyAuthPersistence(preference?.durationHours ?? DEFAULT_VAULT_SESSION_HOURS)
    }

    async function completeEmailLinkIfNeeded() {
      if (!isSignInWithEmailLink(firebaseAuth, window.location.href)) return

      let email = window.localStorage.getItem(EMAIL_LINK_STORAGE_KEY) || ''
      if (!email) {
        email = window.prompt('Confirm the email used for your magic link') || ''
      }
      if (!email) return

      await applyAuthPersistence(readVaultSessionPreference()?.durationHours ?? DEFAULT_VAULT_SESSION_HOURS)
      await signInWithEmailLink(firebaseAuth, email, window.location.href)
      window.localStorage.removeItem(EMAIL_LINK_STORAGE_KEY)
      window.history.replaceState({}, document.title, window.location.pathname)
    }

    void prepareAuthPersistence()
      .then(() => completeEmailLinkIfNeeded())
      .catch((error) => {
        if (!cancelled) {
          setSessionError(error instanceof Error ? error.message : String(error))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setClientReady(true)
        }
      })

    const unsubscribe = onIdTokenChanged(firebaseAuth, async (user) => {
      if (cancelled) return

      if (user) {
        const savedPreference = readVaultSessionPreference()
        if (
          savedPreference?.uid === user.uid &&
          savedPreference.durationHours !== VAULT_SESSION_EVERY_VISIT_HOURS &&
          savedPreference.expiresAt <= Date.now()
        ) {
          clearVaultSessionPreference()
          await signOut(firebaseAuth)
          return
        }

        const storedPreference = savedPreference?.uid === user.uid
          ? savedPreference
          : saveVaultSessionPreference(user.uid, DEFAULT_VAULT_SESSION_HOURS)
        const preference = storedPreference.requiresMigration
          ? saveVaultSessionPreference(user.uid, storedPreference.durationHours)
          : storedPreference
        await applyAuthPersistence(preference.durationHours)
        setSessionDurationHoursState(preference.durationHours)
      } else {
        setSessionDurationHoursState(DEFAULT_VAULT_SESSION_HOURS)
      }

      setFirebaseUser(user)
      const nextToken = user ? await user.getIdToken() : ''
      if (!cancelled) {
        setToken(nextToken)
        setAuthResolved(true)
      }
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!firebaseUser) return

    let cancelled = false
    const renewToken = async () => {
      try {
        const refreshedToken = await firebaseAuth.currentUser?.getIdToken(true)
        if (!cancelled && refreshedToken) {
          setToken(refreshedToken)
          setSessionRevision((current) => current + 1)
        }
      } catch (error) {
        if (!cancelled) {
          setSessionError(error instanceof Error ? error.message : String(error))
        }
      }
    }
    const enforceSessionExpiry = async () => {
      const preference = readVaultSessionPreference()
      if (!preference || preference.uid !== firebaseUser.uid) {
        const nextPreference = saveVaultSessionPreference(firebaseUser.uid, DEFAULT_VAULT_SESSION_HOURS)
        setSessionDurationHoursState(nextPreference.durationHours)
        return
      }
      if (
        preference.durationHours !== VAULT_SESSION_EVERY_VISIT_HOURS &&
        preference.expiresAt <= Date.now()
      ) {
        clearVaultSessionPreference()
        await signOut(firebaseAuth)
      }
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void enforceSessionExpiry()
        void renewToken()
      }
    }

    void enforceSessionExpiry()
    const refreshTimer = window.setInterval(() => void renewToken(), TOKEN_REFRESH_INTERVAL_MS)
    const expiryTimer = window.setInterval(() => void enforceSessionExpiry(), SESSION_EXPIRY_CHECK_INTERVAL_MS)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      cancelled = true
      window.clearInterval(refreshTimer)
      window.clearInterval(expiryTimer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [firebaseUser])

  useEffect(() => {
    let cancelled = false

    if (!clientReady || !authResolved) {
      return () => {
        cancelled = true
      }
    }

    async function loadSession() {
      const controller = new AbortController()
      setLoadingSession(true)
      setSessionError('')

      try {
        const response = await authFetch('/api/auth/session', {
          token,
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        })
        const payload = await response.json()
        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.error || `HTTP ${response.status}`)
        }
        if (!cancelled) {
          setSession(payload as AuthSession)
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return
        }
        if (!cancelled) {
          setSession(null)
          setSessionError(error instanceof Error ? error.message : String(error))
        }
      } finally {
        if (!cancelled) {
          setLoadingSession(false)
        }
      }

      return controller
    }

    let controller: AbortController | null = null
    void loadSession().then((nextController) => {
      controller = nextController ?? null
    })

    return () => {
      cancelled = true
      controller?.abort()
    }
  }, [authResolved, clientReady, token, sessionRevision])

  const value = useMemo<AuthContextValue>(
    () => ({
      clientReady,
      firebaseUser,
      token,
      session,
      loadingSession,
      sessionError,
      sessionDurationHours,
      refreshSession: async () => {
        setSessionRevision((current) => current + 1)
      },
      setSessionDurationHours: async (durationHours: number) => {
        const user = firebaseAuth.currentUser
        if (!user) throw new Error('Sign in before changing the stay-signed-in setting.')
        await applyAuthPersistence(durationHours)
        const preference = saveVaultSessionPreference(user.uid, durationHours)
        setSessionDurationHoursState(preference.durationHours)
        const refreshedToken = await user.getIdToken(true)
        setToken(refreshedToken)
        setSessionRevision((current) => current + 1)
      },
      signInWithGoogle: async () => {
        const provider = new GoogleAuthProvider()
        provider.setCustomParameters({ prompt: 'select_account' })
        await applyAuthPersistence(sessionDurationHours)
        const result = await signInWithPopup(firebaseAuth, provider)
        const preference = saveVaultSessionPreference(result.user.uid, sessionDurationHours)
        setSessionDurationHoursState(preference.durationHours)
      },
      sendMagicLink: async (email: string) => {
        if (!MAGIC_LINK_ENABLED) {
          throw new Error('Email magic link is not enabled during beta yet. Use Google sign-in for now.')
        }
        await sendSignInLinkToEmail(firebaseAuth, email, {
          url: emailLinkUrl,
          handleCodeInApp: true,
        })
        window.localStorage.setItem(EMAIL_LINK_STORAGE_KEY, email)
      },
      signOutUser: async () => {
        clearVaultSessionPreference()
        await signOut(firebaseAuth)
      },
    }),
    [clientReady, firebaseUser, token, session, loadingSession, sessionError, sessionDurationHours]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider')
  }
  return context
}

export async function authFetch(
  input: RequestInfo | URL,
  init: RequestInit & { token?: string } = {}
) {
  const headers = new Headers(init.headers || {})
  const explicitToken = init.token
  const activeToken = explicitToken ?? (await firebaseAuth.currentUser?.getIdToken()) ?? ''
  if (activeToken) {
    headers.set('Authorization', `Bearer ${activeToken}`)
  }
  return fetch(input, {
    ...init,
    headers,
  })
}
