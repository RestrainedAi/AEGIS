import {
  GoogleAuthProvider,
  browserLocalPersistence,
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
void setPersistence(firebaseAuth, browserLocalPersistence)

const emailLinkUrl = buildActiveCloudUrl('/vault')
export const MAGIC_LINK_ENABLED = false

type AuthContextValue = {
  clientReady: boolean
  firebaseUser: User | null
  token: string
  session: AuthSession | null
  loadingSession: boolean
  sessionError: string
  refreshSession: () => Promise<void>
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

  useEffect(() => {
    let cancelled = false

    async function completeEmailLinkIfNeeded() {
      if (!isSignInWithEmailLink(firebaseAuth, window.location.href)) return

      let email = window.localStorage.getItem(EMAIL_LINK_STORAGE_KEY) || ''
      if (!email) {
        email = window.prompt('Confirm the email used for your magic link') || ''
      }
      if (!email) return

      await signInWithEmailLink(firebaseAuth, email, window.location.href)
      window.localStorage.removeItem(EMAIL_LINK_STORAGE_KEY)
      window.history.replaceState({}, document.title, window.location.pathname)
    }

    void completeEmailLinkIfNeeded()
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
      refreshSession: async () => {
        setSessionRevision((current) => current + 1)
      },
    signInWithGoogle: async () => {
      await signInWithPopup(firebaseAuth, new GoogleAuthProvider())
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
        await signOut(firebaseAuth)
      },
    }),
    [clientReady, firebaseUser, token, session, loadingSession, sessionError]
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
