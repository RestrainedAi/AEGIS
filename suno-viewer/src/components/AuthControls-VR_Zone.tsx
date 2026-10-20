import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import {
  MAGIC_LINK_ENABLED,
  VAULT_SESSION_DURATION_OPTIONS,
  VAULT_SESSION_EVERY_VISIT_HOURS,
  authFetch,
  useAuth,
} from '../lib/firebaseAuth'
import { signupCatalog, signupCatalogById } from '../lib/signupCatalog'
import { useMediaQuery } from '../lib/useMediaQuery'

type AuthControlsProps = {
  variant?: 'compact' | 'signup' | 'login'
  preferredTierId?: string
}

function formatSessionDuration(durationHours: number) {
  if (durationHours === VAULT_SESSION_EVERY_VISIT_HOURS) return 'this browser visit'
  if (durationHours % 24 === 0) {
    const days = durationHours / 24
    return `${days} day${days === 1 ? '' : 's'}`
  }
  return `${durationHours} hours`
}

export default function AuthControls({ variant = 'compact', preferredTierId }: AuthControlsProps) {
  const isCompact = useMediaQuery('(max-width: 840px)')
  const {
    clientReady,
    firebaseUser,
    session,
    token,
    loadingSession,
    sessionError,
    sessionDurationHours,
    refreshSession,
    setSessionDurationHours,
    signInWithGoogle,
    sendMagicLink,
    signOutUser,
  } = useAuth()
  const [email, setEmail] = useState('')
  const [notice, setNotice] = useState('')
  const [working, setWorking] = useState(false)
  const [approvalNote, setApprovalNote] = useState('')
  const [requestedWorkspaceName, setRequestedWorkspaceName] = useState('')
  const [sunoHandle, setSunoHandle] = useState('')
  const [sunoProfileUrl, setSunoProfileUrl] = useState('')
  const [youtubeChannelUrl, setYoutubeChannelUrl] = useState('')
  const [intendedUse, setIntendedUse] = useState('')
  const [requestedTierId, setRequestedTierId] = useState(preferredTierId || 'creator')
  const [preferredUpgradePlanId, setPreferredUpgradePlanId] = useState('creator-monthly')

  useEffect(() => {
    if (!session?.accessRequest) return
    setApprovalNote(session.accessRequest.note || '')
    setRequestedWorkspaceName(session.accessRequest.requestedWorkspaceName || '')
    setSunoHandle(session.accessRequest.sunoHandle || '')
    setSunoProfileUrl(session.accessRequest.sunoProfileUrl || '')
    setYoutubeChannelUrl(session.accessRequest.youtubeChannelUrl || '')
    setIntendedUse(session.accessRequest.intendedUse || '')
    setRequestedTierId(session.accessRequest.requestedTier || preferredTierId || 'creator')
    setPreferredUpgradePlanId(session.accessRequest.preferredUpgradePlanId || 'creator-monthly')
  }, [session?.accessRequest])

  useEffect(() => {
    if (!preferredTierId || session?.accessRequest?.status === 'pending') return
    const preferredTier = signupCatalogById[preferredTierId]
    if (!preferredTier) return
    setRequestedTierId(preferredTier.id)
    if (preferredTier.defaultPlanId) setPreferredUpgradePlanId(preferredTier.defaultPlanId)
  }, [preferredTierId, session?.accessRequest?.status])

  const requestedTier = signupCatalogById[requestedTierId] || signupCatalogById.creator
  const publicTierOptions = useMemo(() => signupCatalog.filter((tier) => tier.publicBetaVisible), [])
  const migrationOptions = useMemo(() => signupCatalog.filter((tier) => tier.id !== 'artist'), [])

  const identityLabel =
    session?.user?.displayName ||
    session?.user?.email ||
    firebaseUser?.displayName ||
    firebaseUser?.email ||
    'Guest'

  const accessRequestStatus = session?.accessRequest?.status || ''
  const hasWorkspaceAccess = Boolean(session?.activeWorkspace) || Boolean(session?.platformAdmin)
  const canSubmitFreshRequest = accessRequestStatus !== 'pending'
  const needsApproval = Boolean(firebaseUser && session?.needsApproval && !session?.activeWorkspace && !session?.platformAdmin)
  const loginStateMessage = useMemo(() => {
    if (variant !== 'login') return ''
    if (loadingSession) return 'Checking your access…'
    if (sessionError) return sessionError
    if (!firebaseUser) return ''
    if (hasWorkspaceAccess) return 'Account confirmed. Opening your vault…'
    if (accessRequestStatus === 'pending') {
      return 'Your beta signup is pending review. You can wait for approval or open Beta Signup to update your request.'
    }
    if (accessRequestStatus === 'denied') {
      return 'No active account was opened for this Google login. You can try a different Google account or return to Beta Signup to request access again.'
    }
    if (accessRequestStatus === 'withdrawn') {
      return 'This Google login does not have an active account right now. You can try again with another Google account or start a fresh Beta Signup request.'
    }
    return 'No account found for this Google login. Try another Google account or continue to Beta Signup if you still need access.'
  }, [variant, loadingSession, sessionError, firebaseUser, hasWorkspaceAccess, accessRequestStatus])

  useEffect(() => {
    if (variant !== 'login') return
    if (loadingSession || !hasWorkspaceAccess || typeof window === 'undefined') return
    const nextPath = '/vault'
    if (window.location.pathname !== nextPath) {
      window.location.assign(nextPath)
    }
  }, [variant, loadingSession, hasWorkspaceAccess])

  async function handleGoogleSignIn() {
    setWorking(true)
    setNotice('')
    try {
      await signInWithGoogle()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setWorking(false)
    }
  }

  async function handleMagicLink() {
    if (!email.trim()) {
      setNotice('Enter an email first.')
      return
    }
    setWorking(true)
    setNotice('')
    try {
      await sendMagicLink(email.trim())
      setNotice(`Magic link sent to ${email.trim()}.`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setWorking(false)
    }
  }

  async function handleSignOut() {
    setWorking(true)
    setNotice('')
    try {
      await signOutUser()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setWorking(false)
    }
  }

  async function handleSessionDurationChange(rawValue: string) {
    const durationHours = Number(rawValue)
    if (!VAULT_SESSION_DURATION_OPTIONS.some((option) => option.hours === durationHours)) {
      setNotice('Choose one of the available stay-signed-in options.')
      return
    }
    setWorking(true)
    setNotice('')
    try {
      await setSessionDurationHours(durationHours)
      setNotice(durationHours === VAULT_SESSION_EVERY_VISIT_HOURS
        ? 'You will be signed out when this browser session ends.'
        : `You will stay signed in for up to ${formatSessionDuration(durationHours)} on this browser.`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setWorking(false)
    }
  }

  async function handleRetryGoogleSignIn() {
    setWorking(true)
    setNotice('')
    try {
      if (firebaseUser) {
        await signOutUser()
      }
      await signInWithGoogle()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setWorking(false)
    }
  }

  async function handleWorkspaceSelect(workspaceId: string) {
    if (!workspaceId || workspaceId === session?.activeWorkspace?.workspaceId) return
    setWorking(true)
    setNotice('')
    try {
      const response = await authFetch('/api/workspaces/select', {
        token,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      })
      const payload = await response.json()
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || `HTTP ${response.status}`)
      }
      await refreshSession()
      setNotice('Workspace updated.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setWorking(false)
    }
  }

  async function handleRequestAccess() {
    if (!sunoHandle.trim()) {
      setNotice('Add the SUNO username for this beta request.')
      return
    }
    if (!sunoProfileUrl.trim()) {
      setNotice('Add the SUNO profile URL so we can verify the source account.')
      return
    }
    if (!intendedUse.trim()) {
      setNotice('Tell us how you plan to use sundrop during beta.')
      return
    }
    setWorking(true)
    setNotice('')
    try {
      const response = await authFetch('/api/access-requests', {
        token,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestKind: 'beta',
          requestedTier: requestedTierId,
          requestedWorkspaceName: requestedWorkspaceName.trim(),
          sunoHandle: sunoHandle.trim(),
          sunoProfileUrl: sunoProfileUrl.trim(),
          youtubeChannelUrl: youtubeChannelUrl.trim(),
          intendedUse: intendedUse.trim(),
          preferredUpgradePlanId: preferredUpgradePlanId.trim() || requestedTier?.defaultPlanId || 'creator-monthly',
          note: approvalNote.trim(),
        }),
      })
      const payload = await response.json()
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || `HTTP ${response.status}`)
      }
      await refreshSession()
      setNotice('Beta request submitted. It is now in the approval queue.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setWorking(false)
    }
  }

  async function handleWithdrawAccessRequest() {
    setWorking(true)
    setNotice('')
    try {
      const response = await authFetch('/api/access-requests/withdraw', {
        token,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewNotes: 'Withdrawn by requester' }),
      })
      const payload = await response.json()
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || `HTTP ${response.status}`)
      }
      await refreshSession()
      setNotice('Access request withdrawn. You can submit a fresh request whenever you are ready.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setWorking(false)
    }
  }

  if (variant === 'compact') {
    const compactShellLayoutStyle: CSSProperties = {
      ...compactShellStyle(isCompact),
      padding: isCompact ? 14 : compactShellStyle(isCompact).padding,
      gap: isCompact ? 10 : compactShellStyle(isCompact).gap,
    }

    const compactTopRowLayoutStyle: CSSProperties = {
      ...compactTopRowStyle,
      flexDirection: isCompact ? 'column' : 'row',
      alignItems: isCompact ? 'stretch' : 'flex-start',
    }

    const compactActionStackLayoutStyle: CSSProperties = {
      ...compactActionStackStyle,
      gap: isCompact ? 12 : compactActionStackStyle.gap,
    }

    const compactEmailRowLayoutStyle: CSSProperties = {
      ...compactEmailRowStyle,
      gridTemplateColumns: isCompact ? '1fr' : compactEmailRowStyle.gridTemplateColumns,
    }

    const compactPrimaryButtonLayoutStyle: CSSProperties = {
      ...compactPrimaryButtonStyle,
      width: '100%',
    }

    const compactSecondaryButtonLayoutStyle: CSSProperties = {
      ...compactSecondaryButtonStyle,
      width: '100%',
      whiteSpace: 'normal',
    }

    const compactLinkButtonLayoutStyle: CSSProperties = {
      ...compactLinkButtonStyle,
      width: '100%',
      textAlign: 'center',
    }

    const compactNoticePanelLayoutStyle: CSSProperties = {
      ...compactNoticePanelStyle,
      gap: isCompact ? 10 : compactNoticePanelStyle.gap,
    }

    return (
      <div style={compactShellLayoutStyle}>
        <div style={compactTopRowLayoutStyle}>
          <div>
            <div style={labelStyle}>Access</div>
            <div style={identityStyle}>{identityLabel}</div>
          </div>
          <div style={statusPillStyle}>
            {loadingSession ? 'Checking' : session?.legacyMode ? 'Legacy' : firebaseUser ? 'Signed in' : 'Ready'}
          </div>
        </div>

        <div style={compactActionStackLayoutStyle}>
          {!firebaseUser ? (
            <>
              <button
                style={compactPrimaryButtonLayoutStyle}
                onClick={() => void handleGoogleSignIn()}
                disabled={!clientReady || working}
              >
                Continue with Google
              </button>
              {MAGIC_LINK_ENABLED ? (
                <div style={compactEmailRowLayoutStyle}>
                  <input
                    style={inputStyle}
                    type="email"
                    placeholder="Email magic link"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    disabled={working}
                  />
                  <button
                    style={compactSecondaryButtonLayoutStyle}
                    onClick={() => void handleMagicLink()}
                    disabled={!clientReady || working}
                  >
                    Send
                  </button>
                </div>
              ) : (
                <p style={compactMetaStyle}>Google sign-in is the active beta sign-in path right now.</p>
              )}
              <a href="/signup" style={compactLinkButtonLayoutStyle}>
                Beta Signup
              </a>
            </>
          ) : (
            <>
              <button style={compactSecondaryButtonLayoutStyle} onClick={() => void handleSignOut()} disabled={working}>
                Sign Out
              </button>
              <label style={compactFieldLabelStyle}>
                Stay signed in
                <select
                  style={inputStyle}
                  value={sessionDurationHours}
                  onChange={(event) => void handleSessionDurationChange(event.target.value)}
                  disabled={working || loadingSession}
                >
                  {VAULT_SESSION_DURATION_OPTIONS.map((option) => (
                    <option key={option.hours} value={option.hours}>{option.label}</option>
                  ))}
                </select>
                <span style={compactMetaStyle}>Default: 30 days. Choose every visit or up to 90 days.</span>
              </label>
              {session?.workspaces?.length && session.workspaces.length > 1 ? (
                <label style={compactFieldLabelStyle}>
                  Workspace
                  <select
                    style={inputStyle}
                    value={session?.activeWorkspace?.workspaceId || ''}
                    onChange={(event) => void handleWorkspaceSelect(event.target.value)}
                    disabled={working || loadingSession}
                  >
                    {session.workspaces.map((workspace) => (
                      <option key={workspace.workspaceId} value={workspace.workspaceId}>
                        {workspace.name} · {workspace.planId || 'plan pending'}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </>
          )}
        </div>

        {firebaseUser && needsApproval && (
          <div style={compactNoticePanelLayoutStyle}>
            <strong style={requestTitleStyle}>
              {accessRequestStatus === 'pending'
                ? 'Access request pending approval'
                : accessRequestStatus === 'denied'
                  ? 'Access request denied'
                  : accessRequestStatus === 'withdrawn'
                    ? 'Access request withdrawn'
                    : 'Request beta access'}
            </strong>
            <p style={compactMetaStyle}>
              {accessRequestStatus === 'pending'
                ? 'Your beta application is waiting for review.'
                : accessRequestStatus === 'denied'
                  ? 'You can update and submit a new request.'
                  : accessRequestStatus === 'withdrawn'
                    ? 'You can submit a fresh request whenever you are ready.'
                    : 'Beta is the only public signup path right now.'}
            </p>
            <a href="/signup" style={compactLinkButtonLayoutStyle}>
              Open Signup
            </a>
          </div>
        )}

      </div>
    )
  }

  if (variant === 'login') {
    const loginShellLayoutStyle: CSSProperties = {
      display: 'grid',
      gap: 14,
      width: '100%',
    }

    return (
      <div style={loginShellLayoutStyle}>
        <button
          style={{ ...loginPrimaryButtonStyle, opacity: loadingSession ? 0.72 : 1 }}
          onClick={() => void (firebaseUser ? handleRetryGoogleSignIn() : handleGoogleSignIn())}
          disabled={!clientReady || working || loadingSession}
        >
          {firebaseUser && !hasWorkspaceAccess ? 'Google Login Again' : 'Google Login'}
        </button>
        <a href="/signup" style={loginSecondaryLinkStyle}>
          Beta Signup
        </a>
        {!!loginStateMessage && (
          <p style={loginMessageStyle(hasWorkspaceAccess, Boolean(sessionError), Boolean(firebaseUser && !hasWorkspaceAccess))}>
            {loginStateMessage}
          </p>
        )}
      </div>
    )
  }

  if (variant === 'signup') {
    const signupHasWorkspaceAccess = hasWorkspaceAccess
    const signupStatusLabel = loadingSession
      ? 'Checking session'
      : session?.legacyMode
        ? 'Legacy mode'
        : firebaseUser
          ? 'Identity linked'
          : 'Sign in ready'
    const signupInfoLabel = firebaseUser
      ? `Linked to ${identityLabel}`
      : 'Sign in with Google to unlock the request form.'
    const signupRequestButtonLabel =
      accessRequestStatus === 'denied' || accessRequestStatus === 'withdrawn'
        ? 'Request Access Again'
        : 'Send the beta request'
    const sourceOptions = ['Artist Catalog', 'Label Operations', 'Publisher Review', 'Security Administration']

    const signupShellLayoutStyle: CSSProperties = {
      ...signupShellStyle,
      padding: isCompact ? 20 : signupShellStyle.padding,
      gap: isCompact ? 14 : signupShellStyle.gap,
      borderRadius: isCompact ? 20 : signupShellStyle.borderRadius,
    }

    const signupHeaderLayoutStyle: CSSProperties = {
      ...signupHeaderStyle,
      gap: isCompact ? 10 : signupHeaderStyle.gap,
    }

    const signupActionRowLayoutStyle: CSSProperties = {
      ...signupActionRowStyle,
      gap: isCompact ? 12 : signupActionRowStyle.gap,
    }

    const signupEmailRowLayoutStyle: CSSProperties = {
      ...signupEmailRowStyle,
      gridTemplateColumns: isCompact ? '1fr' : signupEmailRowStyle.gridTemplateColumns,
    }

    const signupFormStackLayoutStyle: CSSProperties = {
      ...signupFormStackStyle,
      gap: isCompact ? 14 : signupFormStackStyle.gap,
    }

    const signupSourceSectionLayoutStyle: CSSProperties = {
      ...signupSourceSectionStyle,
      gap: isCompact ? 12 : signupSourceSectionStyle.gap,
    }

    const signupSourceGridLayoutStyle: CSSProperties = {
      ...signupSourceGridStyle,
      gridTemplateColumns: isCompact ? '1fr' : signupSourceGridStyle.gridTemplateColumns,
    }

    const signupNoticeActionsLayoutStyle: CSSProperties = {
      ...signupNoticeActionsStyle,
      flexDirection: isCompact ? 'column' : 'row',
    }

    const signupDividerLayoutStyle: CSSProperties = {
      ...signupDividerStyle,
      padding: isCompact ? '4px 0' : signupDividerStyle.padding,
    }

    const signupPrimaryButtonLayoutStyle: CSSProperties = {
      ...signupPrimaryButtonStyle,
      width: '100%',
    }

    const signupSecondaryButtonLayoutStyle: CSSProperties = {
      ...signupSecondaryButtonStyle,
      width: '100%',
      whiteSpace: 'normal',
    }

    const signupSignedInPillLayoutStyle: CSSProperties = {
      ...signedInPillStyle,
      width: '100%',
      justifyContent: 'center',
    }

    return (
      <div style={signupShellLayoutStyle}>
        <div style={signupHeaderLayoutStyle}>
          <div>
            <p style={signupKickerStyle}>Beta Request</p>
            <h2 style={signupTitleStyle}>Start your beta request by connecting your Google account.</h2>
          </div>
          <p style={signupStatusStyle}>{signupStatusLabel}</p>
        </div>

        <div style={signupActionRowLayoutStyle}>
          {!firebaseUser ? (
            <button
              style={signupPrimaryButtonLayoutStyle}
              onClick={() => void handleGoogleSignIn()}
              disabled={!clientReady || working}
            >
              Sign in with Google
            </button>
          ) : (
            <div style={signupSignedInPillLayoutStyle}>
              <span className="material-symbols-outlined" aria-hidden="true">
                person
              </span>
              <span>{identityLabel}</span>
            </div>
          )}

          {MAGIC_LINK_ENABLED && !firebaseUser ? (
            <div style={signupEmailRowLayoutStyle}>
              <input
                style={inputStyle}
                type="email"
                placeholder="Email magic link"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={working}
              />
              <button
                style={signupSecondaryButtonLayoutStyle}
                onClick={() => void handleMagicLink()}
                disabled={!clientReady || working}
              >
                Send link
              </button>
            </div>
          ) : (
            <p style={signupMetaStyle}>{signupInfoLabel}</p>
          )}
        </div>

        <div style={signupDividerLayoutStyle}>
          <div style={signupDividerRuleStyle} />
          <span style={signupDividerTextStyle}>Request details</span>
        </div>

        <div style={signupFormStackLayoutStyle}>
          <label style={signupFieldLabelStyle}>
            Workspace focus
            <select
              style={inputStyle}
              value={requestedWorkspaceName}
              onChange={(event) => setRequestedWorkspaceName(event.target.value)}
              disabled={working}
            >
              {sourceOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label style={signupFieldLabelStyle}>
            Intended use
            <textarea
              style={textareaStyle}
              placeholder="Tell us how you plan to use sundrop music."
              value={intendedUse}
              onChange={(event) => setIntendedUse(event.target.value)}
              disabled={working}
            />
          </label>
        </div>

        <section style={signupSourceSectionLayoutStyle}>
          <div style={signupSourceHeaderStyle}>
            <p style={signupSourceKickerStyle}>Source account</p>
            <p style={signupSourceMetaStyle}>{signupInfoLabel}</p>
          </div>

          <div style={signupSourceGridLayoutStyle}>
            <label style={signupFieldLabelStyle}>
              SUNO username
              <input
                style={inputStyle}
                value={sunoHandle}
                onChange={(event) => setSunoHandle(event.target.value)}
                disabled={working}
                placeholder="Your SUNO handle"
              />
            </label>

            <label style={signupFieldLabelStyle}>
              SUNO profile URL
              <input
                style={inputStyle}
                value={sunoProfileUrl}
                onChange={(event) => setSunoProfileUrl(event.target.value)}
                disabled={working}
                placeholder="https://suno.com/@your-handle"
              />
            </label>

            <label style={signupFieldLabelStyle}>
              YouTube channel URL
              <input
                style={inputStyle}
                value={youtubeChannelUrl}
                onChange={(event) => setYoutubeChannelUrl(event.target.value)}
                disabled={working}
                placeholder="Optional during beta"
              />
            </label>

            <label style={signupFieldLabelStyle}>
              Requested lane
              <select
                style={inputStyle}
                value={requestedTierId}
                onChange={(event) => {
                  const nextTierId = event.target.value
                  setRequestedTierId(nextTierId)
                  const nextTier = signupCatalogById[nextTierId]
                  if (nextTier?.defaultPlanId) {
                    setPreferredUpgradePlanId(nextTier.defaultPlanId)
                  }
                }}
                disabled={working}
              >
                {publicTierOptions.map((tier) => (
                  <option key={tier.id} value={tier.id}>
                    {tier.label}
                  </option>
                ))}
              </select>
            </label>

            <label style={signupFieldLabelStyle}>
              Post-beta paid path
              <select
                style={inputStyle}
                value={preferredUpgradePlanId}
                onChange={(event) => setPreferredUpgradePlanId(event.target.value)}
                disabled={working}
              >
                {migrationOptions.map((tier) => (
                  <option key={tier.defaultPlanId} value={tier.defaultPlanId}>
                    {tier.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label style={signupFieldLabelStyle}>
            Optional note for approval
            <textarea
              style={textareaStyle}
              placeholder="Add any context that helps the approval queue."
              value={approvalNote}
              onChange={(event) => setApprovalNote(event.target.value)}
              disabled={working}
            />
          </label>
        </section>

        {firebaseUser && needsApproval && (
          <div style={signupNoticePanelStyle}>
            <strong style={requestTitleStyle}>
              {accessRequestStatus === 'pending'
                ? 'Access request pending approval'
                : accessRequestStatus === 'denied'
                  ? 'Access request denied'
                  : accessRequestStatus === 'withdrawn'
                    ? 'Access request withdrawn'
                    : 'Request beta access'}
            </strong>
            <p style={signupMetaStyle}>
              {accessRequestStatus === 'pending'
                ? 'Your beta application is waiting for review.'
                : accessRequestStatus === 'denied'
                  ? 'You can update and submit a new request.'
                  : accessRequestStatus === 'withdrawn'
                    ? 'You can submit a fresh request whenever you are ready.'
                    : 'Beta is the only public signup path right now.'}
            </p>
            <div style={signupNoticeActionsLayoutStyle}>
              {accessRequestStatus === 'pending' ? (
                <button
                  style={signupSecondaryButtonLayoutStyle}
                  onClick={() => void handleWithdrawAccessRequest()}
                  disabled={working}
                >
                  Withdraw request
                </button>
              ) : (
                <button
                  style={signupSecondaryButtonLayoutStyle}
                  onClick={() => void handleRequestAccess()}
                  disabled={working || !canSubmitFreshRequest}
                >
                  Update request
                </button>
              )}
            </div>
          </div>
        )}

        <button
          style={signupPrimaryButtonLayoutStyle}
          onClick={() => void handleRequestAccess()}
          disabled={working || !canSubmitFreshRequest}
        >
          {signupRequestButtonLabel}
        </button>

        <p style={signupFootnoteStyle}>Google sign-in and workspace security checks are active.</p>

        {variant === 'signup' && !firebaseUser && (
          <p style={signupHelperStyle}>
            Sign in first, then complete the beta application. Approval, workspace setup, beta
            expiry, and future upgrade planning all happen from the control center.
          </p>
        )}

        {variant === 'signup' && firebaseUser && !signupHasWorkspaceAccess && !needsApproval && (
          <p style={signupHelperStyle}>
            Your account is signed in. If you need a new workspace, submit the beta request below.
          </p>
        )}

        {!!sessionError && <p style={noticeStyle}>{sessionError}</p>}
        {!!notice && <p style={noticeStyle}>{notice}</p>}
      </div>
    )
  }

  const requestButtonLabel =
    accessRequestStatus === 'denied' || accessRequestStatus === 'withdrawn' ? 'Request Access Again' : 'Request Access'

  return (
    <div style={signupShellStyle}>
      <div style={signupTopRowStyle}>
        <div>
          <div style={labelStyle}>Access</div>
          <div style={identityStyle}>{identityLabel}</div>
        </div>
        <div style={statusPillStyle}>
          {loadingSession ? 'Checking session' : session?.legacyMode ? 'Legacy mode' : firebaseUser ? 'Signed in' : 'Sign in ready'}
        </div>
      </div>

      <div style={actionsStyle}>
        {!firebaseUser && (
          <>
            <button style={primaryButtonStyle} onClick={() => void handleGoogleSignIn()} disabled={!clientReady || working}>
              Continue with Google
            </button>
            {MAGIC_LINK_ENABLED ? (
              <div style={emailRowStyle}>
                <input
                  style={inputStyle}
                  type="email"
                  placeholder="Email magic link"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={working}
                />
                <button style={secondaryButtonStyle} onClick={() => void handleMagicLink()} disabled={!clientReady || working}>
                  Send Link
                </button>
              </div>
            ) : (
              <p style={metaStyle}>Google sign-in is the active beta sign-in path right now.</p>
            )}
          </>
        )}

        {firebaseUser && (
          <>
            <button style={secondaryButtonStyle} onClick={() => void handleSignOut()} disabled={working}>
              Sign Out
            </button>
            <label style={fieldLabelStyle}>
              Stay signed in
              <select
                style={inputStyle}
                value={sessionDurationHours}
                onChange={(event) => void handleSessionDurationChange(event.target.value)}
                disabled={working || loadingSession}
              >
                {VAULT_SESSION_DURATION_OPTIONS.map((option) => (
                  <option key={option.hours} value={option.hours}>{option.label}</option>
                ))}
              </select>
              <span style={metaStyle}>Default: 30 days. Choose every visit or up to 90 days.</span>
            </label>
          </>
        )}
      </div>

      <p style={metaStyle}>
        {session?.activeWorkspace ? `Workspace: ${session.activeWorkspace.name}` : 'No workspace selected yet'}
      </p>

      {Boolean(session?.workspaces?.length && session.workspaces.length > 1) && (
        <label style={{ ...fieldLabelStyle, marginTop: 10 }}>
          Active workspace
          <select
            style={inputStyle}
            value={session?.activeWorkspace?.workspaceId || ''}
            onChange={(event) => void handleWorkspaceSelect(event.target.value)}
            disabled={working || loadingSession}
          >
            {session?.workspaces.map((workspace) => (
              <option key={workspace.workspaceId} value={workspace.workspaceId}>
                {workspace.name} · {workspace.planId || 'plan pending'}
              </option>
            ))}
          </select>
        </label>
      )}

      {firebaseUser && needsApproval && (
        <div style={requestShellStyle}>
          <p style={requestTitleStyle}>
            {accessRequestStatus === 'pending'
              ? 'Access request pending approval'
              : accessRequestStatus === 'denied'
                ? 'Access request denied'
                : accessRequestStatus === 'withdrawn'
                  ? 'Access request withdrawn'
                  : 'Request beta access'}
          </p>
          <p style={metaStyle}>
            {accessRequestStatus === 'pending'
              ? 'Your identity is confirmed, and your beta application is waiting for review.'
              : accessRequestStatus === 'denied'
                ? 'You can update the beta application below and submit again.'
                : accessRequestStatus === 'withdrawn'
                  ? 'You can submit a fresh request whenever you are ready.'
                  : 'Beta is the only public signup path right now. Approval creates the workspace and timed beta access.'}
          </p>
          {!!session?.accessRequest?.reviewNotes && accessRequestStatus !== 'pending' && (
            <div style={tierPreviewStyle}>
              <strong>Review note</strong>
              <span>{session.accessRequest.reviewNotes}</span>
            </div>
          )}
          {accessRequestStatus === 'pending' && (
            <>
              <div style={tierPreviewStyle}>
              <strong>{requestedTier?.label || 'Requested lane'} application in review</strong>
              <span>{requestedTier?.summary || 'Approval is pending for the beta program.'}</span>
              </div>
              {!!session?.accessRequest?.betaExpiresAt && (
                <div style={tierPreviewStyle}>
                  <strong>Planned beta expiry</strong>
                  <span>{session.accessRequest.betaExpiresAt}</span>
                </div>
              )}
              <button style={secondaryButtonStyle} onClick={() => void handleWithdrawAccessRequest()} disabled={working}>
                Withdraw Request
              </button>
            </>
          )}
          {accessRequestStatus !== 'pending' && (
            <>
              <div style={requestGridStyle}>
                <label style={fieldLabelStyle}>
                  Workspace / artist label
                  <input
                    style={inputStyle}
                    value={requestedWorkspaceName}
                    onChange={(event) => setRequestedWorkspaceName(event.target.value)}
                    disabled={working}
                    placeholder="How should we label your workspace?"
                  />
                </label>

                <label style={fieldLabelStyle}>
                  SUNO username
                  <input
                    style={inputStyle}
                    value={sunoHandle}
                    onChange={(event) => setSunoHandle(event.target.value)}
                    disabled={working}
                    placeholder="Your SUNO handle"
                  />
                </label>
              </div>

              <label style={fieldLabelStyle}>
                SUNO profile URL
                <input
                  style={inputStyle}
                  value={sunoProfileUrl}
                  onChange={(event) => setSunoProfileUrl(event.target.value)}
                  disabled={working}
                  placeholder="https://suno.com/@your-handle"
                />
              </label>

              <label style={fieldLabelStyle}>
                YouTube channel URL
                <input
                  style={inputStyle}
                  value={youtubeChannelUrl}
                  onChange={(event) => setYoutubeChannelUrl(event.target.value)}
                  disabled={working}
                  placeholder="Optional during beta"
                />
              </label>

              <label style={fieldLabelStyle}>
                Requested lane
                <select
                  style={inputStyle}
                  value={requestedTierId}
                  onChange={(event) => {
                    const nextTierId = event.target.value
                    setRequestedTierId(nextTierId)
                    const nextTier = signupCatalogById[nextTierId]
                    if (nextTier?.defaultPlanId) {
                      setPreferredUpgradePlanId(nextTier.defaultPlanId)
                    }
                  }}
                  disabled={working}
                >
                  {publicTierOptions.map((tier) => (
                    <option key={tier.id} value={tier.id}>
                      {tier.label}
                    </option>
                  ))}
                </select>
              </label>

              <label style={fieldLabelStyle}>
                Post-beta paid path
                <select
                  style={inputStyle}
                  value={preferredUpgradePlanId}
                  onChange={(event) => setPreferredUpgradePlanId(event.target.value)}
                  disabled={working}
                >
                  {migrationOptions.map((tier) => (
                    <option key={tier.defaultPlanId} value={tier.defaultPlanId}>
                      {tier.label}
                    </option>
                  ))}
                </select>
              </label>

              <div style={tierPreviewStyle}>
                <strong>{requestedTier?.label || 'Requested lane'}</strong>
                <span>{requestedTier?.summary || 'Manual review will place this request into the correct lane.'}</span>
              </div>
              <textarea
                style={textareaStyle}
                placeholder="How will you use sundrop during beta?"
                value={intendedUse}
                onChange={(event) => setIntendedUse(event.target.value)}
                disabled={working}
              />
              <textarea
                style={textareaStyle}
                placeholder="Optional note for the approval queue"
                value={approvalNote}
                onChange={(event) => setApprovalNote(event.target.value)}
                disabled={working}
              />
              <button
                style={primaryButtonStyle}
                onClick={() => void handleRequestAccess()}
                disabled={working || !canSubmitFreshRequest}
              >
                {requestButtonLabel === 'Request Access' ? 'Request Beta Access' : requestButtonLabel.replace('Access', 'Beta Access')}
              </button>
            </>
          )}
        </div>
      )}
      {variant === 'signup' && !firebaseUser && (
        <p style={metaStyle}>
          Sign in first, then complete the beta application. Approval, workspace setup, beta expiry,
          and future upgrade planning all happen from the control center.
        </p>
      )}
      {!!sessionError && <p style={noticeStyle}>{sessionError}</p>}
      {!!notice && <p style={noticeStyle}>{notice}</p>}
      {variant === 'signup' && firebaseUser && !hasWorkspaceAccess && !needsApproval && (
        <p style={metaStyle}>Your account is signed in. If you need a new workspace, submit the beta request below.</p>
      )}
    </div>
  )
}

const compactShellStyle = (isCompact: boolean): CSSProperties => ({
  minWidth: 0,
  maxWidth: isCompact ? '100%' : 380,
  padding: 16,
  borderRadius: 18,
  background: 'rgba(10, 10, 14, 0.9)',
  border: '1px solid rgba(255, 255, 255, 0.08)',
  boxShadow: '0 18px 44px rgba(0, 0, 0, 0.34)',
  color: '#e7e5e7',
  backdropFilter: 'blur(18px)',
  display: 'grid',
  gap: 12,
})

const signupShellStyle: CSSProperties = {
  minWidth: 0,
  width: '100%',
  maxWidth: 'none',
  padding: 28,
  borderRadius: 24,
  background: 'rgba(8, 8, 12, 0.9)',
  border: '1px solid rgba(129, 236, 255, 0.14)',
  boxShadow: '0 30px 72px rgba(0, 0, 0, 0.44)',
  color: '#e7e5e7',
  backdropFilter: 'blur(22px)',
  display: 'grid',
  gap: 18,
}

const compactTopRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: 12,
}

const signupTopRowStyle: CSSProperties = {
  ...compactTopRowStyle,
}

const labelStyle: CSSProperties = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.18em',
  color: 'rgba(231, 229, 231, 0.56)',
  marginBottom: 4,
}

const identityStyle: CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  color: '#ffffff',
  lineHeight: 1.35,
}

const statusPillStyle: CSSProperties = {
  padding: '6px 10px',
  borderRadius: 999,
  background: 'rgba(255, 255, 255, 0.06)',
  color: '#81ecff',
  fontSize: 12,
  whiteSpace: 'nowrap',
}

const compactActionStackStyle: CSSProperties = {
  display: 'grid',
  gap: 10,
}

const actionsStyle: CSSProperties = {
  display: 'grid',
  gap: 10,
  marginTop: 2,
}

const compactEmailRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr auto',
  gap: 8,
}

const emailRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr auto',
  gap: 8,
}

const inputStyle: CSSProperties = {
  borderRadius: 12,
  border: '1px solid rgba(255, 255, 255, 0.1)',
  padding: '10px 12px',
  fontSize: 14,
  background: '#0b0b0f',
  color: '#ffffff',
  outline: 'none',
}

const primaryButtonStyle: CSSProperties = {
  border: 0,
  borderRadius: 999,
  padding: '12px 16px',
  background: 'linear-gradient(135deg, #81ecff 0%, #00e3fd 100%)',
  color: '#003840',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
}

const compactPrimaryButtonStyle: CSSProperties = {
  ...primaryButtonStyle,
  width: '100%',
}

const secondaryButtonStyle: CSSProperties = {
  border: 0,
  borderRadius: 999,
  padding: '12px 16px',
  background: 'rgba(255, 255, 255, 0.06)',
  color: '#e7e5e7',
  fontSize: 13,
  cursor: 'pointer',
}

const compactSecondaryButtonStyle: CSSProperties = {
  ...secondaryButtonStyle,
  whiteSpace: 'nowrap',
}

const compactLinkButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 42,
  padding: '0 14px',
  borderRadius: 999,
  border: '1px solid rgba(129, 236, 255, 0.22)',
  color: '#81ecff',
  textDecoration: 'none',
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
}

const metaStyle: CSSProperties = {
  margin: '6px 0 0',
  fontSize: 13,
  color: 'rgba(231, 229, 231, 0.62)',
  lineHeight: 1.55,
}

const compactMetaStyle: CSSProperties = {
  ...metaStyle,
  marginTop: 2,
}

const noticeStyle: CSSProperties = {
  margin: '2px 0 0',
  fontSize: 13,
  color: '#ffb1a9',
  lineHeight: 1.5,
}

const compactNoticePanelStyle: CSSProperties = {
  display: 'grid',
  gap: 8,
  paddingTop: 4,
  borderTop: '1px solid rgba(255, 255, 255, 0.08)',
}

const requestShellStyle: CSSProperties = {
  marginTop: 8,
  paddingTop: 14,
  borderTop: '1px solid rgba(255, 255, 255, 0.08)',
  display: 'grid',
  gap: 10,
}

const requestGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
  gap: 10,
}

const fieldLabelStyle: CSSProperties = {
  display: 'grid',
  gap: 6,
  fontSize: 13,
  color: 'rgba(231, 229, 231, 0.72)',
}

const compactFieldLabelStyle: CSSProperties = {
  ...fieldLabelStyle,
}

const tierPreviewStyle: CSSProperties = {
  display: 'grid',
  gap: 4,
  padding: '10px 12px',
  borderRadius: 14,
  background: 'rgba(255, 255, 255, 0.04)',
  color: '#e7e5e7',
  fontSize: 13,
  lineHeight: 1.5,
}

const requestTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: 14,
  fontWeight: 700,
  color: '#ffffff',
}

const textareaStyle: CSSProperties = {
  minHeight: 74,
  borderRadius: 14,
  border: '1px solid rgba(255, 255, 255, 0.1)',
  padding: '10px 12px',
  fontSize: 14,
  background: '#0b0b0f',
  color: '#ffffff',
  resize: 'vertical',
  outline: 'none',
}

const signupHeaderStyle: CSSProperties = {
  display: 'grid',
  gap: 12,
}

const signupKickerStyle: CSSProperties = {
  margin: 0,
  color: '#81ecff',
  fontFamily: '"Space Grotesk", "Segoe UI", sans-serif',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.36em',
}

const signupTitleStyle: CSSProperties = {
  margin: 0,
  color: '#ffffff',
  fontFamily: '"Newsreader", Georgia, serif',
  fontStyle: 'italic',
  fontWeight: 400,
  fontSize: 'clamp(2rem, 3vw, 3rem)',
  lineHeight: 1,
  letterSpacing: '-0.04em',
}

const signupStatusStyle: CSSProperties = {
  margin: 0,
  color: 'rgba(231, 229, 231, 0.56)',
  fontFamily: '"Space Grotesk", "Segoe UI", sans-serif',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.24em',
}

const signupActionRowStyle: CSSProperties = {
  display: 'grid',
  gap: 10,
}

const signupPrimaryButtonStyle: CSSProperties = {
  border: 0,
  borderRadius: 2,
  minHeight: 56,
  padding: '0 18px',
  background: 'linear-gradient(135deg, #81ecff 0%, #00e3fd 100%)',
  color: '#003840',
  fontFamily: '"Space Grotesk", "Segoe UI", sans-serif',
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.24em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  boxShadow: '0 18px 36px rgba(0, 227, 253, 0.16)',
}

const signupSecondaryButtonStyle: CSSProperties = {
  border: '1px solid rgba(255, 255, 255, 0.08)',
  borderRadius: 2,
  minHeight: 48,
  padding: '0 16px',
  background: 'rgba(255, 255, 255, 0.02)',
  color: '#e7e5e7',
  fontFamily: '"Space Grotesk", "Segoe UI", sans-serif',
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.2em',
  textTransform: 'uppercase',
  cursor: 'pointer',
}

const signedInPillStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 10,
  minHeight: 48,
  padding: '0 14px',
  border: '1px solid rgba(129, 236, 255, 0.18)',
  background: 'rgba(129, 236, 255, 0.04)',
  color: '#81ecff',
  fontFamily: '"Space Grotesk", "Segoe UI", sans-serif',
  fontSize: 12,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
}

const signupEmailRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr auto',
  gap: 8,
}

const signupMetaStyle: CSSProperties = {
  margin: 0,
  color: 'rgba(231, 229, 231, 0.68)',
  lineHeight: 1.6,
  fontSize: 13,
}

const signupDividerStyle: CSSProperties = {
  position: 'relative',
  padding: '8px 0',
  display: 'grid',
  placeItems: 'center',
}

const signupDividerTextStyle: CSSProperties = {
  position: 'relative',
  zIndex: 1,
  padding: '0 12px',
  background: '#08080c',
  color: 'rgba(231, 229, 231, 0.44)',
  fontFamily: '"Space Grotesk", "Segoe UI", sans-serif',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.28em',
}

const signupDividerRuleStyle: CSSProperties = {
  position: 'absolute',
  inset: '50% 0 auto',
  height: 1,
  background: 'rgba(255, 255, 255, 0.08)',
}

const signupFormStackStyle: CSSProperties = {
  display: 'grid',
  gap: 16,
}

const signupFieldLabelStyle: CSSProperties = {
  display: 'grid',
  gap: 8,
  color: 'rgba(231, 229, 231, 0.72)',
  fontSize: 13,
}

const signupSourceSectionStyle: CSSProperties = {
  display: 'grid',
  gap: 14,
  paddingTop: 6,
}

const signupSourceHeaderStyle: CSSProperties = {
  display: 'grid',
  gap: 4,
}

const signupSourceKickerStyle: CSSProperties = {
  margin: 0,
  color: '#81ecff',
  fontFamily: '"Space Grotesk", "Segoe UI", sans-serif',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.3em',
}

const signupSourceMetaStyle: CSSProperties = {
  margin: 0,
  color: 'rgba(231, 229, 231, 0.5)',
  fontSize: 12,
  lineHeight: 1.6,
}

const signupSourceGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 12,
}

const signupNoticePanelStyle: CSSProperties = {
  display: 'grid',
  gap: 8,
  paddingTop: 8,
  borderTop: '1px solid rgba(255, 255, 255, 0.08)',
}

const signupNoticeActionsStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
}

const signupFootnoteStyle: CSSProperties = {
  margin: 0,
  color: 'rgba(231, 229, 231, 0.36)',
  fontFamily: '"Space Grotesk", "Segoe UI", sans-serif',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.22em',
  textAlign: 'center',
}

const signupHelperStyle: CSSProperties = {
  margin: 0,
  color: 'rgba(231, 229, 231, 0.6)',
  lineHeight: 1.6,
  fontSize: 13,
}

const loginPrimaryButtonStyle: CSSProperties = {
  ...signupPrimaryButtonStyle,
  minHeight: 72,
  borderRadius: 18,
  fontSize: 13,
  letterSpacing: '0.22em',
}

const loginSecondaryLinkStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 72,
  padding: '0 18px',
  borderRadius: 18,
  border: '1px solid rgba(255, 255, 255, 0.1)',
  background: 'rgba(255, 255, 255, 0.03)',
  color: '#f3f6ff',
  fontFamily: '"Space Grotesk", "Segoe UI", sans-serif',
  fontSize: 13,
  fontWeight: 700,
  letterSpacing: '0.22em',
  textTransform: 'uppercase',
  textDecoration: 'none',
}

const loginMessageStyle = (hasAccess: boolean, hasError: boolean, needsAction: boolean): CSSProperties => ({
  margin: 0,
  padding: '14px 16px',
  borderRadius: 16,
  background: hasError
    ? 'rgba(255, 113, 108, 0.08)'
    : hasAccess
      ? 'rgba(0, 227, 253, 0.08)'
      : needsAction
        ? 'rgba(255, 189, 92, 0.08)'
        : 'rgba(255, 255, 255, 0.04)',
  border: hasError
    ? '1px solid rgba(255, 113, 108, 0.18)'
    : hasAccess
      ? '1px solid rgba(0, 227, 253, 0.18)'
      : needsAction
        ? '1px solid rgba(255, 189, 92, 0.18)'
        : '1px solid rgba(255, 255, 255, 0.08)',
  color: hasError ? '#ffb1a9' : hasAccess ? '#bdf8ff' : needsAction ? '#ffd699' : 'rgba(231, 229, 231, 0.72)',
  lineHeight: 1.6,
  fontSize: 13,
  textAlign: 'center',
})
