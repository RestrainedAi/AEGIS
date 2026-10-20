import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { AccessRequest, AdminOverview, WorkspaceRole } from '../types'
import { authFetch, useAuth } from '../lib/firebaseAuth'
import { signupCatalog, signupCatalogById } from '../lib/signupCatalog'
import { SUNDROP_VAULT_NAME } from '../lib/branding'
import { useMediaQuery } from '../lib/useMediaQuery'

type ApprovalDraft = {
  workspaceMode: 'legacy' | 'new' | 'requested'
  workspaceName: string
  role: WorkspaceRole
  planId: string
  betaExpiresAt: string
  migrationTargetPlanId: string
  reviewNotes: string
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; data: AdminOverview }
  | { status: 'error'; message: string }

function isAccessBoundaryMessage(message: string) {
  const normalized = String(message || '').toLowerCase()
  return (
    normalized.includes('platform admin access is required') ||
    normalized.includes('authentication is required') ||
    normalized.includes('http 401') ||
    normalized.includes('http 403')
  )
}

export default function AdminControlCenter() {
  const isCompact = useMediaQuery('(max-width: 920px)')
  const { clientReady, loadingSession, token } = useAuth()
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [actionNotice, setActionNotice] = useState('')
  const [approvalDrafts, setApprovalDrafts] = useState<Record<string, ApprovalDraft>>({})

  useEffect(() => {
    let cancelled = false

    if (!clientReady || loadingSession) {
      setState({ status: 'loading' })
      return () => {
        cancelled = true
      }
    }

    async function load() {
      try {
        const response = await authFetch('/api/admin/overview', { cache: 'no-store', token })
        const payload = await response.json()
        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.error || `HTTP ${response.status}`)
        }
        if (!cancelled) {
          setState({ status: 'ready', data: payload as AdminOverview })
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [clientReady, loadingSession, token])

  const accessRequestDraft = (request: AccessRequest): ApprovalDraft => {
    const tier = signupCatalogById[request.requestedTier || 'artist']
    return (
      approvalDrafts[request.requestId] || {
        workspaceMode: request.requestedWorkspaceId ? 'requested' : 'new',
        workspaceName: request.requestedWorkspaceName || request.requestedWorkspaceId || request.displayName || request.email.split('@')[0] || 'Workspace',
        role: tier?.defaultRole || 'viewer',
        planId: tier?.defaultPlanId || request.requestedTier || 'artist',
        betaExpiresAt: request.betaExpiresAt || '',
        migrationTargetPlanId: request.betaMigrationTargetPlanId || request.preferredUpgradePlanId || 'creator-monthly',
        reviewNotes: '',
      }
    )
  }

  const pendingRequests = useMemo(
    () => (state.status === 'ready' ? state.data.accessRequests.recent.filter((request) => request.status === 'pending') : []),
    [state]
  )

  const heroMetrics =
    state.status === 'ready'
      ? [
          {
            label: 'Auth',
            value: state.data.session.authEnabled ? 'Ready' : 'Offline',
            detail: state.data.session.legacyMode ? 'Legacy on' : 'Legacy off',
          },
          {
            label: 'Export',
            value:
              state.data.catalogHealth.servingSource === 'gcs'
                ? 'Live GCS'
                : state.data.catalogHealth.servingSource === 'fallback'
                  ? 'Fallback'
                  : 'Unavailable',
            detail: `${state.data.exportArtifact.rowCount || 0} rows`,
          },
          {
            label: 'Access',
            value: `${pendingRequests.length} pending`,
            detail: `${state.data.accessRequests.summary.approved} approved`,
          },
        ]
      : state.status === 'error'
        ? [
            {
              label: 'Status',
              value: isAccessBoundaryMessage(state.message) ? 'Sign-in required' : 'Unavailable',
              detail: isAccessBoundaryMessage(state.message) ? 'Approved operators only' : 'Check runtime',
            },
          ]
        : [
            {
              label: 'Status',
              value: 'Loading',
              detail: 'Pulling live overview',
            },
          ]

  const pageLayoutStyle: CSSProperties = {
    ...pageStyle,
    padding: isCompact ? '14px 12px 32px' : pageStyle.padding,
  }

  const heroLayoutStyle: CSSProperties = {
    ...heroStyle,
    padding: isCompact ? 18 : 34,
    gap: isCompact ? 16 : 20,
    marginBottom: isCompact ? 18 : 24,
    gridTemplateColumns: isCompact ? '1fr' : heroStyle.gridTemplateColumns,
  }

  const heroActionsLayoutStyle: CSSProperties = {
    ...heroActionsStyle,
    flexDirection: isCompact ? 'column' : 'row',
    width: isCompact ? '100%' : 'auto',
    alignItems: isCompact ? 'stretch' : 'center',
  }

  const heroMetricsLayoutStyle: CSSProperties = {
    ...heroMetricsStyle,
    gridTemplateColumns: isCompact ? '1fr' : heroMetricsStyle.gridTemplateColumns,
    gap: isCompact ? 12 : 14,
  }

  const entryGateLayoutStyle: CSSProperties = {
    ...entryGateStyle,
    padding: isCompact ? 18 : 36,
    gap: isCompact ? 16 : 18,
    gridTemplateColumns: isCompact ? '1fr' : entryGateStyle.gridTemplateColumns,
  }

  const overviewRailLayoutStyle: CSSProperties = {
    ...overviewRailStyle,
    gridTemplateColumns: isCompact ? '1fr' : overviewRailStyle.gridTemplateColumns,
    gap: isCompact ? 12 : 16,
  }

  const sectionBlockLayoutStyle: CSSProperties = {
    ...sectionBlockStyle,
    padding: isCompact ? 18 : 24,
  }

  const summaryPanelLayoutStyle: CSSProperties = {
    ...summaryPanelStyle,
    padding: isCompact ? '16px 16px 15px' : summaryPanelStyle.padding,
  }

  const queueGridLayoutStyle: CSSProperties = {
    ...queueGridStyle,
    gridTemplateColumns: isCompact ? '1fr' : queueGridStyle.gridTemplateColumns,
  }

  const requestCardLayoutStyle: CSSProperties = {
    ...requestCardStyle,
    padding: isCompact ? '14px 14px' : requestCardStyle.padding,
  }

  const requestTitleRowLayoutStyle: CSSProperties = {
    ...requestTitleRowStyle,
    flexDirection: isCompact ? 'column' : 'row',
    alignItems: isCompact ? 'flex-start' : 'center',
  }

  const approvalGridLayoutStyle: CSSProperties = {
    ...approvalGridStyle,
    gridTemplateColumns: isCompact ? '1fr' : approvalGridStyle.gridTemplateColumns,
  }

  const buttonRowLayoutStyle: CSSProperties = {
    ...buttonRowStyle,
    flexDirection: isCompact ? 'column' : 'row',
    alignItems: isCompact ? 'stretch' : 'center',
  }

  return (
    <div style={pageLayoutStyle}>
      {state.status !== 'error' && (
        <section style={heroLayoutStyle}>
          <div style={heroCopyStyle}>
            <p style={eyebrowStyle}>Platform Admin</p>
            <h1 style={titleStyle}>Control Center</h1>
            <p style={leadStyle}>
              This is the operator home for sundrop. It is reserved for approved platform admins
              and operators managing auth, workspace, export, and access posture around{' '}
              {SUNDROP_VAULT_NAME.toLowerCase()}.
            </p>
            <div style={heroActionsLayoutStyle}>
              <a href="/signup" style={buttonLinkStyle}>
                Admin Sign-In
              </a>
              <a href="/vault" style={secondaryLinkStyle}>
                Open Vault
              </a>
            </div>
            <div style={heroSignatureStyle}>
              <span>Operational readout</span>
              <span>Approved operators only</span>
              <span>Live auth / export / access signals</span>
            </div>
          </div>
          <div style={heroMetricsLayoutStyle}>
            {heroMetrics.map((item) => (
              <div key={item.label} style={heroMetricCardStyle}>
                <span style={heroMetricLabelStyle}>{item.label}</span>
                <strong style={heroMetricValueStyle}>{item.value}</strong>
                <span style={heroMetricDetailStyle}>{item.detail}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {state.status === 'loading' && (
        <section style={panelStyle}>
          <h2 style={sectionTitleStyle}>Loading overview</h2>
          <p style={bodyStyle}>Pulling queue state, export freshness, and current auth mode.</p>
        </section>
      )}

      {state.status === 'error' && (
        <section style={entryGateLayoutStyle}>
          <div style={entryCopyStyle}>
            <p style={eyebrowStyle}>Platform Admin</p>
            <h2 style={entryTitleStyle}>
              {isAccessBoundaryMessage(state.message) ? 'Operator sign-in required' : 'Overview unavailable'}
            </h2>
            <p style={entryLeadStyle}>
              The Control Center is reserved for approved admins and operators inside
              {` sundrop`}. Sign in with an approved operator account, then return here
              once access is confirmed.
            </p>
            {!isAccessBoundaryMessage(state.message) && <p style={warningStyle}>{state.message}</p>}
            <div style={heroActionsLayoutStyle}>
              <a href="/signup" style={buttonLinkStyle}>Admin Sign-In</a>
              <a href="/vault" style={secondaryLinkStyle}>Open Vault</a>
            </div>
            <div style={entrySignatureStyle}>
              <span>Approved operators only</span>
              <span>Live auth / export / access signals</span>
              <span>sundrop control surface</span>
            </div>
          </div>
          <aside style={entryStatusCardStyle}>
            <span style={heroMetricLabelStyle}>Status</span>
            <strong style={entryStatusValueStyle}>
              {isAccessBoundaryMessage(state.message) ? 'Sign-in required' : 'Unavailable'}
            </strong>
            <p style={heroMetricDetailStyle}>
              {isAccessBoundaryMessage(state.message)
                ? 'Approved operators only'
                : 'Check the runtime before proceeding'}
            </p>
          </aside>
        </section>
      )}

      {state.status === 'ready' && (
        <>
          <section style={overviewRailLayoutStyle}>
            <article style={summaryPanelLayoutStyle}>
              <h2 style={sectionTitleStyle}>Auth posture</h2>
              <p style={metricStyle}>
                {state.data.session.authEnabled ? 'Firebase-backed session runtime ready' : 'Auth runtime unavailable'}
              </p>
              <p style={bodyStyle}>
                Legacy mode: <strong>{state.data.session.legacyMode ? 'on' : 'off'}</strong>
              </p>
              <p style={bodyStyle}>
                Platform admin: <strong>{state.data.session.platformAdmin ? 'yes' : 'no'}</strong>
              </p>
              <p style={bodyStyle}>
                Signed in: <strong>{state.data.session.isAuthenticated ? 'yes' : 'no'}</strong>
              </p>
              {state.data.session.user && (
                <p style={bodyStyle}>
                  User: <strong>{state.data.session.user.displayName || state.data.session.user.email}</strong>
                </p>
              )}
            </article>

            <article style={summaryPanelLayoutStyle}>
              <h2 style={sectionTitleStyle}>Workspace focus</h2>
              <p style={metricStyle}>{state.data.session.activeWorkspace?.name || 'No active workspace yet'}</p>
              <p style={bodyStyle}>
                Available workspaces: <strong>{state.data.session.workspaces.length}</strong>
              </p>
              <p style={bodyStyle}>
                Current role: <strong>{state.data.session.activeWorkspace?.role || 'n/a'}</strong>
              </p>
              <p style={bodyStyle}>
                Plan: <strong>{state.data.session.activeWorkspace?.planId || 'n/a'}</strong>
              </p>
            </article>

            <article style={summaryPanelLayoutStyle}>
              <h2 style={sectionTitleStyle}>Export freshness</h2>
              <p style={metricStyle}>{state.data.exportFreshness.label}</p>
              <p style={bodyStyle}>
                Last export: <strong>{state.data.exportArtifact.generatedAt || 'No export timestamp yet'}</strong>
              </p>
              <p style={bodyStyle}>{state.data.exportFreshness.detail}</p>
              <p style={bodyStyle}>
                Rows: <strong>{state.data.exportArtifact.rowCount || 0}</strong>
              </p>
              <p style={bodyStyle}>
                Served rows: <strong>{state.data.exportFreshness.servedRowCount || 0}</strong>
              </p>
              {state.data.exportFreshness.newestServedCreatedAt && (
                <p style={bodyStyle}>
                  Newest served song: <strong>{state.data.exportFreshness.newestServedCreatedAt}</strong>
                </p>
              )}
              {state.data.exportFreshness.latestSourceCreatedAt && (
                <p style={bodyStyle}>
                  Newest source song: <strong>{state.data.exportFreshness.latestSourceCreatedAt}</strong>
                </p>
              )}
              {state.data.latestSourceSong?.title && (
                <p style={bodyStyle}>
                  Source lead title: <strong>{state.data.latestSourceSong.title}</strong>
                </p>
              )}
              <p style={bodyStyle}>
                Generator: <strong>{state.data.exportArtifact.generator || 'unknown'}</strong>
              </p>
              <p style={bodyStyle}>
                Artifact: <code style={codeStyle}>{state.data.exportArtifact.object}</code>
              </p>
              {state.data.exportFreshness.status !== 'healthy' && (
                <p style={warningStyle}>Freshness warning: {state.data.exportFreshness.status}</p>
              )}
            </article>

            <article style={summaryPanelLayoutStyle}>
              <h2 style={sectionTitleStyle}>Catalog contract</h2>
              <p style={metricStyle}>
                {state.data.catalogHealth.servingSource === 'gcs'
                  ? 'Serving live GCS export'
                  : state.data.catalogHealth.servingSource === 'fallback'
                    ? 'Serving fallback snapshot'
                    : 'Catalog source unavailable'}
              </p>
              <p style={bodyStyle}>
                GCS health: <strong>{state.data.catalogHealth.gcs.healthy ? 'healthy' : 'degraded'}</strong>
              </p>
              <p style={bodyStyle}>
                Fallback health: <strong>{state.data.catalogHealth.fallback.healthy ? 'healthy' : 'degraded'}</strong>
              </p>
              <p style={bodyStyle}>
                Required columns: <strong>{state.data.catalogHealth.requiredColumns.length}</strong>
              </p>
              {state.data.catalogHealth.gcs.missingRequired.length > 0 && (
                <p style={warningStyle}>
                  GCS missing: {state.data.catalogHealth.gcs.missingRequired.join(', ')}
                </p>
              )}
              {state.data.catalogHealth.gcs.error && (
                <p style={warningStyle}>GCS error: {state.data.catalogHealth.gcs.error}</p>
              )}
            </article>
          </section>

          <section style={sectionBlockLayoutStyle}>
            <h2 style={sectionTitleStyle}>Queue pulse</h2>
            <div style={queueGridLayoutStyle}>
              {renderQueueCard('Queued', state.data.queue.queued)}
              {renderQueueCard('Uploading', state.data.queue.uploading)}
              {renderQueueCard('Done', state.data.queue.done)}
              {renderQueueCard('Errors', state.data.queue.error)}
              {renderQueueCard('Total', state.data.queue.total)}
            </div>
          </section>

          <section style={sectionBlockLayoutStyle}>
            <h2 style={sectionTitleStyle}>Access requests</h2>
            <p style={metricStyle}>{pendingRequests.length} pending</p>
            <div style={queueGridLayoutStyle}>
              {renderQueueCard('Total', state.data.accessRequests.summary.total)}
              {renderQueueCard('Pending', state.data.accessRequests.summary.pending)}
              {renderQueueCard('Approved', state.data.accessRequests.summary.approved)}
              {renderQueueCard('Denied', state.data.accessRequests.summary.denied)}
              {renderQueueCard('Withdrawn', state.data.accessRequests.summary.withdrawn)}
              {renderQueueCard('Beta', state.data.accessRequests.summary.beta)}
            </div>
            {state.data.accessRequests.recent.length === 0 ? (
              <p style={bodyStyle}>No beta or signup access requests yet.</p>
            ) : (
              <div style={requestListStyle}>
                {state.data.accessRequests.recent.map((request) => (
                  <article key={request.requestId} style={requestCardLayoutStyle}>
                    {(() => {
                      const draft = accessRequestDraft(request)
                      const tier = signupCatalogById[request.requestedTier || 'artist']
                      return (
                        <>
                    <div style={requestTitleRowLayoutStyle}>
                      <strong>{request.displayName || request.email}</strong>
                      <span style={requestStatusStyle}>{request.status}</span>
                    </div>
                    <p style={bodyStyle}>{request.email}</p>
                    <p style={bodyStyle}>
                      Lane: <strong>{request.requestKind || 'beta'}</strong> · Tier:{' '}
                      <strong>{request.requestedTier || 'artist'}</strong>
                    </p>
                    {tier && <p style={bodyStyle}>{tier.summary}</p>}
                    {request.requestedWorkspaceName && (
                      <p style={bodyStyle}>
                        Requested workspace: <strong>{request.requestedWorkspaceName}</strong>
                      </p>
                    )}
                    {request.sunoHandle && (
                      <p style={bodyStyle}>
                        SUNO handle: <strong>{request.sunoHandle}</strong>
                      </p>
                    )}
                    {request.sunoProfileUrl && (
                      <p style={bodyStyle}>
                        SUNO profile:{' '}
                        <a href={request.sunoProfileUrl} target="_blank" rel="noopener noreferrer" style={inlineLinkStyle}>
                          {request.sunoProfileUrl}
                        </a>
                      </p>
                    )}
                    {request.youtubeChannelUrl && (
                      <p style={bodyStyle}>
                        YouTube channel:{' '}
                        <a href={request.youtubeChannelUrl} target="_blank" rel="noopener noreferrer" style={inlineLinkStyle}>
                          {request.youtubeChannelUrl}
                        </a>
                      </p>
                    )}
                    {request.intendedUse && (
                      <div style={detailCardStyle}>
                        <strong>Intended beta use</strong>
                        <span>{request.intendedUse}</span>
                      </div>
                    )}
                    {request.preferredUpgradePlanId && (
                      <p style={bodyStyle}>
                        Preferred upgrade after beta: <strong>{request.preferredUpgradePlanId}</strong>
                      </p>
                    )}
                    {request.note && <p style={bodyStyle}>{request.note}</p>}
                    {request.status === 'pending' && (
                      <div style={requestActionsStyle}>
                        <div style={approvalGridLayoutStyle}>
                          <label style={fieldLabelStyle}>
                            Workspace mode
                            <select
                              style={selectStyle}
                              value={draft.workspaceMode}
                              onChange={(event) =>
                                updateDraft(request.requestId, { workspaceMode: event.target.value as ApprovalDraft['workspaceMode'] })
                              }
                            >
                              <option value="legacy">Legacy workspace</option>
                              <option value="new">New workspace</option>
                              <option value="requested">Requested workspace</option>
                            </select>
                          </label>

                          <label style={fieldLabelStyle}>
                            Role
                            <select
                              style={selectStyle}
                              value={draft.role}
                              onChange={(event) =>
                                updateDraft(request.requestId, { role: event.target.value as WorkspaceRole })
                              }
                            >
                              <option value="viewer">viewer</option>
                              <option value="editor">editor</option>
                              <option value="admin">admin</option>
                              <option value="owner">owner</option>
                            </select>
                          </label>

                          <label style={fieldLabelStyle}>
                            Plan
                            <select
                              style={selectStyle}
                              value={draft.planId}
                              onChange={(event) => updateDraft(request.requestId, { planId: event.target.value })}
                            >
                              {signupCatalog.map((tierOption) => (
                                <option key={tierOption.defaultPlanId} value={tierOption.defaultPlanId}>
                                  {tierOption.label}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label style={fieldLabelStyle}>
                            Workspace name
                            <input
                              style={inputStyle}
                              value={draft.workspaceName}
                              onChange={(event) => updateDraft(request.requestId, { workspaceName: event.target.value })}
                            />
                          </label>

                          <label style={fieldLabelStyle}>
                            Beta expires at
                            <input
                              style={inputStyle}
                              type="datetime-local"
                              value={toDateTimeLocalValue(draft.betaExpiresAt)}
                              onChange={(event) => updateDraft(request.requestId, { betaExpiresAt: fromDateTimeLocalValue(event.target.value) })}
                            />
                          </label>

                          <label style={fieldLabelStyle}>
                            Migration target
                            <select
                              style={selectStyle}
                              value={draft.migrationTargetPlanId}
                              onChange={(event) => updateDraft(request.requestId, { migrationTargetPlanId: event.target.value })}
                            >
                              {signupCatalog
                                .filter((tierOption) => tierOption.id !== 'artist')
                                .map((tierOption) => (
                                  <option key={tierOption.defaultPlanId} value={tierOption.defaultPlanId}>
                                    {tierOption.label}
                                  </option>
                                ))}
                            </select>
                          </label>
                        </div>
                        {signupCatalog.find((tierOption) => tierOption.defaultPlanId === draft.planId) && (
                          <div style={tierPreviewCardStyle}>
                            {(() => {
                              const selectedTier = signupCatalog.find((tierOption) => tierOption.defaultPlanId === draft.planId)!
                              return (
                                <>
                                  <strong>{selectedTier.label}</strong>
                                  <span>{selectedTier.summary}</span>
                                  <span>
                                    Beta expiry: {draft.betaExpiresAt || 'Use default beta window'}
                                  </span>
                                  <span>
                                    Migrate to: {draft.migrationTargetPlanId || 'creator-monthly'}
                                  </span>
                                  <span>
                                    Defaults: {selectedTier.limits.sourcesMax} sources · {selectedTier.limits.storageGbIncluded} GB ·{' '}
                                    {selectedTier.limits.membersMax} members · {selectedTier.limits.youtubePublishMonthlyLimit} YouTube / month
                                  </span>
                                </>
                              )
                            })()}
                          </div>
                        )}
                        <textarea
                          style={reviewNoteStyle}
                          placeholder="Review note for approval or denial"
                          value={draft.reviewNotes}
                          onChange={(event) => updateDraft(request.requestId, { reviewNotes: event.target.value })}
                        />
                        <div style={buttonRowLayoutStyle}>
                        <button
                          style={approveButtonStyle}
                          onClick={() => void approveRequest(request, draft)}
                        >
                          Approve Request
                        </button>
                        <button
                          style={denyButtonStyle}
                          onClick={() => void denyRequest(request, draft.reviewNotes)}
                        >
                          Deny
                        </button>
                        </div>
                      </div>
                    )}
                    {request.status !== 'pending' && request.reviewNotes && (
                      <p style={bodyStyle}>Review note: {request.reviewNotes}</p>
                    )}
                    {(request.betaApprovedAt || request.betaExpiresAt || request.betaMigrationTargetPlanId) && (
                      <div style={detailCardStyle}>
                        <strong>Beta lifecycle</strong>
                        <span>Approved at: {request.betaApprovedAt || 'n/a'}</span>
                        <span>Expires at: {request.betaExpiresAt || 'default window'}</span>
                        <span>Migration target: {request.betaMigrationTargetPlanId || request.preferredUpgradePlanId || 'creator-monthly'}</span>
                      </div>
                    )}
                    {request.status !== 'pending' && (
                      <p style={bodyStyle}>
                        Reviewed: <strong>{request.reviewedAt || 'n/a'}</strong>
                        {request.reviewedBy ? (
                          <>
                            {' '}· by <strong>{request.reviewedBy}</strong>
                          </>
                        ) : null}
                      </p>
                    )}
                    {request.status === 'approved' && (
                      <p style={bodyStyle}>
                        Approved into <strong>{request.approvedWorkspaceId || 'workspace pending'}</strong> · role{' '}
                        <strong>{request.approvedRole || 'viewer'}</strong> · plan{' '}
                        <strong>{request.approvedPlanId || request.approvedTier || 'artist'}</strong>
                      </p>
                    )}
                    {(request.status === 'denied' || request.status === 'withdrawn') && (
                      <div style={buttonRowLayoutStyle}>
                        <button
                          style={approveButtonStyle}
                          onClick={() => void reopenRequest(request, accessRequestDraft(request).reviewNotes)}
                        >
                          Reopen Request
                        </button>
                      </div>
                    )}
                        </>
                      )
                    })()}
                  </article>
                ))}
              </div>
            )}
            {!!actionNotice && <p style={bodyStyle}>{actionNotice}</p>}
          </section>
        </>
      )}
    </div>
  )

  function updateDraft(requestId: string, patch: Partial<ApprovalDraft>) {
    setApprovalDrafts((current) => ({
      ...current,
      [requestId]: {
        ...accessRequestDraft(
          state.status === 'ready'
            ? state.data.accessRequests.recent.find((request) => request.requestId === requestId) || {
                requestId,
                uid: '',
                email: '',
                status: 'pending',
              }
            : { requestId, uid: '', email: '', status: 'pending' }
        ),
        ...current[requestId],
        ...patch,
      },
    }))
  }

  async function approveRequest(request: AccessRequest, draft: ApprovalDraft) {
    try {
      setActionNotice('')
      const response = await authFetch(`/api/admin/access-requests/${request.requestId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceMode: draft.workspaceMode,
          workspaceName: draft.workspaceName,
          workspaceId: draft.workspaceMode === 'requested' ? request.requestedWorkspaceId : '',
          role: draft.role,
          planId: draft.planId,
          betaExpiresAt: draft.betaExpiresAt,
          betaMigrationTargetPlanId: draft.migrationTargetPlanId,
          reviewNotes: draft.reviewNotes.trim(),
        }),
      })
      const payload = await response.json()
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || `HTTP ${response.status}`)
      }
      setActionNotice('Access request approved and membership created.')
      setState((current) => {
        if (current.status !== 'ready') return current
        return {
          status: 'ready',
          data: {
            ...current.data,
            accessRequests: {
              pendingCount: Math.max(0, current.data.accessRequests.pendingCount - 1),
              summary: {
                ...current.data.accessRequests.summary,
                pending: Math.max(0, current.data.accessRequests.summary.pending - 1),
                approved: current.data.accessRequests.summary.approved + 1,
              },
              recent: current.data.accessRequests.recent.map((item) =>
                item.requestId === request.requestId
                  ? {
                      ...item,
                      status: 'approved',
                      reviewNotes: draft.reviewNotes.trim(),
                      approvedWorkspaceId: payload.workspaceId || item.approvedWorkspaceId || '',
                      approvedRole: draft.role,
                      approvedPlanId: payload.planId || draft.planId,
                      approvedTier: item.requestedTier,
                      betaApprovedAt: payload.betaApprovedAt || item.betaApprovedAt || '',
                      betaExpiresAt: payload.betaExpiresAt || draft.betaExpiresAt || item.betaExpiresAt || '',
                      betaMigrationTargetPlanId:
                        payload.betaMigrationTargetPlanId || draft.migrationTargetPlanId || item.betaMigrationTargetPlanId || item.preferredUpgradePlanId || '',
                    }
                  : item
              ),
            },
          },
        }
      })
    } catch (error) {
      setActionNotice(error instanceof Error ? error.message : String(error))
    }
  }

  async function denyRequest(request: AccessRequest, reviewNotes: string) {
    try {
      setActionNotice('')
      const response = await authFetch(`/api/admin/access-requests/${request.requestId}/deny`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewNotes: reviewNotes.trim() }),
      })
      const payload = await response.json()
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || `HTTP ${response.status}`)
      }
      setActionNotice('Access request denied.')
      setState((current) => {
        if (current.status !== 'ready') return current
        return {
          status: 'ready',
          data: {
            ...current.data,
            accessRequests: {
              pendingCount: Math.max(0, current.data.accessRequests.pendingCount - 1),
              summary: {
                ...current.data.accessRequests.summary,
                pending: Math.max(0, current.data.accessRequests.summary.pending - 1),
                denied: current.data.accessRequests.summary.denied + 1,
              },
              recent: current.data.accessRequests.recent.map((item) =>
                item.requestId === request.requestId ? { ...item, status: 'denied', reviewNotes: reviewNotes.trim() } : item
              ),
            },
          },
        }
      })
    } catch (error) {
      setActionNotice(error instanceof Error ? error.message : String(error))
    }
  }

  async function reopenRequest(request: AccessRequest, reviewNotes: string) {
    try {
      setActionNotice('')
      const response = await authFetch(`/api/admin/access-requests/${request.requestId}/reopen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewNotes: reviewNotes.trim() }),
      })
      const payload = await response.json()
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || `HTTP ${response.status}`)
      }
      setActionNotice('Access request reopened.')
      setState((current) => {
        if (current.status !== 'ready') return current
        return {
          status: 'ready',
          data: {
            ...current.data,
            accessRequests: {
              pendingCount: current.data.accessRequests.pendingCount + 1,
              summary: {
                ...current.data.accessRequests.summary,
                pending: current.data.accessRequests.summary.pending + 1,
                denied:
                  request.status === 'denied'
                    ? Math.max(0, current.data.accessRequests.summary.denied - 1)
                    : current.data.accessRequests.summary.denied,
                withdrawn:
                  request.status === 'withdrawn'
                    ? Math.max(0, current.data.accessRequests.summary.withdrawn - 1)
                    : current.data.accessRequests.summary.withdrawn,
              },
              recent: current.data.accessRequests.recent.map((item) =>
                item.requestId === request.requestId
                  ? {
                      ...item,
                      status: 'pending',
                      reviewedAt: '',
                      reviewedBy: '',
                      reviewNotes: reviewNotes.trim(),
                      approvedWorkspaceId: '',
                      approvedRole: undefined,
                      approvedPlanId: '',
                      approvedTier: '',
                    }
                  : item
              ),
            },
          },
        }
      })
    } catch (error) {
      setActionNotice(error instanceof Error ? error.message : String(error))
    }
  }
}

function renderQueueCard(label: string, value: number) {
  return (
    <div key={label} style={queueCardStyle}>
      <div style={queueLabelStyle}>{label}</div>
      <div style={queueValueStyle}>{value}</div>
    </div>
  )
}

function toDateTimeLocalValue(iso?: string) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const offsetMs = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}

function fromDateTimeLocalValue(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

const pageStyle: CSSProperties = {
  minHeight: '100vh',
  width: '100%',
  padding: '28px clamp(18px, 2vw, 28px) 56px',
  color: '#e7e5e7',
  background:
    'radial-gradient(circle at top left, rgba(0, 227, 253, 0.08), transparent 26%), radial-gradient(circle at top right, rgba(205, 189, 255, 0.05), transparent 22%), linear-gradient(180deg, #050506 0%, #09090d 100%)',
}

const heroStyle: CSSProperties = {
  position: 'relative',
  overflow: 'hidden',
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
  gap: 20,
  padding: 34,
  marginBottom: 24,
  background: 'linear-gradient(180deg, rgba(15, 15, 19, 0.96) 0%, rgba(9, 9, 13, 0.98) 100%)',
  border: '1px solid rgba(255, 255, 255, 0.06)',
  borderRadius: 30,
  boxShadow: '0 28px 80px rgba(0, 0, 0, 0.36)',
}

const heroSignatureStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 10,
  marginTop: 18,
  color: 'rgba(231, 229, 231, 0.52)',
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: '0.12em',
  fontWeight: 700,
}

const heroCopyStyle: CSSProperties = {
  display: 'grid',
  alignContent: 'start',
  gap: 0,
}

const heroMetricsStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 14,
  alignContent: 'start',
}

const heroActionsStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 10,
  marginTop: 18,
}

const eyebrowStyle: CSSProperties = {
  margin: 0,
  color: '#6a7190',
  textTransform: 'uppercase',
  letterSpacing: '0.12em',
  fontSize: 12,
  fontWeight: 700,
}

const titleStyle: CSSProperties = {
  margin: '10px 0 12px',
  fontSize: 'clamp(2.4rem, 5vw, 4rem)',
  lineHeight: 0.92,
  color: '#ffffff',
  letterSpacing: '-0.04em',
  fontFamily: '"Newsreader", Georgia, serif',
  fontStyle: 'italic',
  fontWeight: 400,
}

const leadStyle: CSSProperties = {
  margin: 0,
  color: 'rgba(231, 229, 231, 0.72)',
  lineHeight: 1.72,
  fontSize: 18,
  maxWidth: 760,
}

const panelStyle: CSSProperties = {
  background: 'rgba(10, 10, 14, 0.92)',
  border: '1px solid rgba(255, 255, 255, 0.08)',
  borderRadius: 22,
  padding: 22,
  boxShadow: '0 14px 36px rgba(0, 0, 0, 0.28)',
}

const entryGateStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
  gap: 18,
  padding: 36,
  marginBottom: 24,
  background: 'linear-gradient(180deg, rgba(15, 15, 19, 0.97) 0%, rgba(9, 9, 13, 0.98) 100%)',
  border: '1px solid rgba(255, 255, 255, 0.06)',
  borderRadius: 32,
  boxShadow: '0 28px 72px rgba(0, 0, 0, 0.32)',
}

const entryCopyStyle: CSSProperties = {
  display: 'grid',
  alignContent: 'start',
  gap: 0,
}

const entryTitleStyle: CSSProperties = {
  margin: '10px 0 12px',
  color: '#ffffff',
  fontSize: 'clamp(2.8rem, 6vw, 4.8rem)',
  lineHeight: 0.92,
  letterSpacing: '-0.05em',
  fontFamily: '"Newsreader", Georgia, serif',
  fontStyle: 'italic',
  fontWeight: 400,
}

const entryLeadStyle: CSSProperties = {
  margin: 0,
  color: 'rgba(231, 229, 231, 0.72)',
  lineHeight: 1.72,
  fontSize: 18,
  maxWidth: 720,
}

const entrySignatureStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 10,
  marginTop: 18,
  color: 'rgba(231, 229, 231, 0.52)',
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: '0.12em',
  fontWeight: 700,
}

const entryStatusCardStyle: CSSProperties = {
  display: 'grid',
  alignContent: 'start',
  gap: 8,
  padding: 22,
  borderRadius: 22,
  border: '1px solid rgba(255, 255, 255, 0.08)',
  background: 'rgba(12, 12, 16, 0.92)',
  boxShadow: '0 14px 30px rgba(0, 0, 0, 0.26)',
}

const entryStatusValueStyle: CSSProperties = {
  color: '#ffffff',
  fontSize: 22,
  letterSpacing: '-0.01em',
}

const overviewRailStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  gap: 16,
  marginBottom: 18,
}

const summaryPanelStyle: CSSProperties = {
  background: 'rgba(10, 10, 14, 0.92)',
  border: '1px solid rgba(255, 255, 255, 0.08)',
  borderRadius: 22,
  padding: '18px 18px 17px',
  display: 'grid',
  gap: 6,
  alignContent: 'start',
  boxShadow: '0 14px 32px rgba(0, 0, 0, 0.26)',
}

const sectionBlockStyle: CSSProperties = {
  background: 'rgba(10, 10, 14, 0.92)',
  border: '1px solid rgba(255, 255, 255, 0.08)',
  borderRadius: 24,
  padding: 24,
  boxShadow: '0 14px 34px rgba(0, 0, 0, 0.24)',
}

const sectionTitleStyle: CSSProperties = {
  margin: '0 0 10px',
  fontSize: 17,
  letterSpacing: '-0.01em',
  color: '#ffffff',
}

const metricStyle: CSSProperties = {
  margin: '0 0 10px',
  fontSize: 15,
  lineHeight: 1.4,
  color: '#ffffff',
  fontWeight: 600,
}

const bodyStyle: CSSProperties = {
  margin: '0 0 8px',
  color: 'rgba(231, 229, 231, 0.72)',
  lineHeight: 1.6,
  fontSize: 14,
}

const warningStyle: CSSProperties = {
  margin: '0 0 8px',
  color: '#ffb1a9',
  lineHeight: 1.6,
  fontSize: 14,
}

const codeStyle: CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  fontSize: 12,
}

const inlineLinkStyle: CSSProperties = {
  color: '#81ecff',
  textDecoration: 'none',
  wordBreak: 'break-all',
}

const queueGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
  gap: 12,
}

const buttonLinkStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 42,
  padding: '0 18px',
  borderRadius: 999,
  background: 'linear-gradient(135deg, #81ecff 0%, #00e3fd 100%)',
  color: '#003840',
  fontWeight: 700,
  textDecoration: 'none',
  boxShadow: '0 16px 30px rgba(0, 227, 253, 0.12)',
}

const secondaryLinkStyle: CSSProperties = {
  ...buttonLinkStyle,
  background: 'rgba(255, 255, 255, 0.04)',
  color: '#e7e5e7',
  border: '1px solid rgba(255, 255, 255, 0.08)',
  boxShadow: 'none',
}

const queueCardStyle: CSSProperties = {
  borderRadius: 18,
  padding: '18px 16px',
  background: 'rgba(12, 12, 16, 0.9)',
  border: '1px solid rgba(255, 255, 255, 0.08)',
}

const queueLabelStyle: CSSProperties = {
  color: 'rgba(231, 229, 231, 0.54)',
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: '0.12em',
  marginBottom: 8,
  fontWeight: 700,
}

const queueValueStyle: CSSProperties = {
  color: '#ffffff',
  fontSize: 30,
  fontWeight: 700,
}

const requestListStyle: CSSProperties = {
  display: 'grid',
  gap: 12,
}

const requestCardStyle: CSSProperties = {
  borderRadius: 20,
  padding: '16px 18px',
  background: 'rgba(12, 12, 16, 0.92)',
  border: '1px solid rgba(255, 255, 255, 0.08)',
}

const requestTitleRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 12,
  marginBottom: 8,
}

const requestStatusStyle: CSSProperties = {
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  fontSize: 11,
  color: 'rgba(231, 229, 231, 0.54)',
  fontWeight: 700,
}

const detailCardStyle: CSSProperties = {
  display: 'grid',
  gap: 4,
  margin: '10px 0',
  padding: '12px 14px',
  borderRadius: 16,
  background: 'rgba(255, 255, 255, 0.04)',
  color: '#e7e5e7',
  fontSize: 13,
  lineHeight: 1.5,
}

const requestActionsStyle: CSSProperties = {
  marginTop: 10,
}

const approvalGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
  gap: 12,
  marginBottom: 12,
}

const fieldLabelStyle: CSSProperties = {
  display: 'grid',
  gap: 6,
  color: 'rgba(231, 229, 231, 0.7)',
  fontSize: 13,
}

const selectStyle: CSSProperties = {
  borderRadius: 14,
  border: '1px solid rgba(255, 255, 255, 0.1)',
  padding: '11px 12px',
  fontSize: 14,
  background: '#0b0b0f',
  color: '#ffffff',
}

const inputStyle: CSSProperties = {
  borderRadius: 14,
  border: '1px solid rgba(255, 255, 255, 0.1)',
  padding: '11px 12px',
  fontSize: 14,
  background: '#0b0b0f',
  color: '#ffffff',
}

const reviewNoteStyle: CSSProperties = {
  width: '100%',
  minHeight: 76,
  borderRadius: 16,
  border: '1px solid rgba(255, 255, 255, 0.1)',
  padding: '11px 12px',
  fontSize: 14,
  background: '#0b0b0f',
  color: '#ffffff',
  resize: 'vertical',
}

const tierPreviewCardStyle: CSSProperties = {
  display: 'grid',
  gap: 4,
  padding: '12px 14px',
  borderRadius: 16,
  background: 'rgba(255, 255, 255, 0.04)',
  color: '#e7e5e7',
  fontSize: 13,
  lineHeight: 1.5,
  marginBottom: 10,
}

const buttonRowStyle: CSSProperties = {
  display: 'flex',
  gap: 10,
  flexWrap: 'wrap',
  marginTop: 10,
}

const approveButtonStyle: CSSProperties = {
  border: 0,
  borderRadius: 999,
  padding: '10px 14px',
  background: 'linear-gradient(135deg, #81ecff 0%, #00e3fd 100%)',
  color: '#003840',
  fontWeight: 700,
  boxShadow: '0 12px 24px rgba(0, 227, 253, 0.12)',
  fontSize: 13,
  cursor: 'pointer',
}

const denyButtonStyle: CSSProperties = {
  border: 0,
  borderRadius: 999,
  padding: '10px 14px',
  background: 'rgba(255, 255, 255, 0.06)',
  color: '#e7e5e7',
  fontSize: 13,
  cursor: 'pointer',
}

const heroMetricCardStyle: CSSProperties = {
  background: 'rgba(12, 12, 16, 0.92)',
  border: '1px solid rgba(255, 255, 255, 0.08)',
  borderRadius: 20,
  padding: '18px 18px 17px',
  display: 'grid',
  gap: 6,
  alignContent: 'start',
  boxShadow: '0 14px 30px rgba(0, 0, 0, 0.24)',
}

const heroMetricLabelStyle: CSSProperties = {
  color: 'rgba(231, 229, 231, 0.54)',
  textTransform: 'uppercase',
  letterSpacing: '0.12em',
  fontSize: 11,
  fontWeight: 700,
}

const heroMetricValueStyle: CSSProperties = {
  color: '#ffffff',
  fontSize: 20,
  letterSpacing: '-0.01em',
}

const heroMetricDetailStyle: CSSProperties = {
  color: 'rgba(231, 229, 231, 0.68)',
  fontSize: 13,
  lineHeight: 1.45,
}
