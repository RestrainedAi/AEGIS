export interface SunoSong {
  songKey: string
  account_sourceId: string
  account_handle: string
  account_label: string
  title: string
  // Suno metadata fields (new — populated by delta sync + firestore_upsert)
  tags?: string            // comma-separated tag string
  prompt?: string          // Suno generation prompt
  lyrics?: string
  lyricsStatus?: string
  gcsLyricsTxt?: string
  gcsLyricsJson?: string
  gcsLyricsVtt?: string
  modelName?: string       // e.g. "chirp-v3-5"
  modelMajorVersion?: string
  isInstrumental?: string  // "true" | "false"
  displayTags?: string
  styles?: string
  styleText?: string
  description?: string
  caption?: string
  negativePrompt?: string
  explicit?: string
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
  rawClipJsonGcs?: string
  status?: string
  removedAt?: string
  runId: string
  lastSeenAt?: string
  ytStatus?: string
  ytVideoId?: string
  ytCanonicalUrl?: string
  ytPublishedAt?: string
  ytError?: string
  ytErrorAt?: string
}

export type WorkspaceRole = 'owner' | 'admin' | 'editor' | 'viewer'

export type MembershipStatus = 'active' | 'invited' | 'revoked'

export type WorkspaceStatus = 'active' | 'trialing' | 'past_due' | 'suspended'

export type UserStatus = 'active' | 'invited' | 'suspended'

export type AccessRequestKind = 'beta' | 'free' | 'paid'

export type BetaAccessStatus = 'pending' | 'active' | 'expired' | 'upgraded'

export interface UserProfile {
  uid: string
  email: string
  displayName?: string
  photoURL?: string
  authProviders: string[]
  status: UserStatus
  createdAt?: string
  lastLoginAt?: string
  defaultWorkspaceId?: string
  audience?: 'beta' | 'customer' | 'internal'
}

export interface BetaAccessState {
  audience?: 'beta' | 'customer' | 'internal'
  status?: BetaAccessStatus
  approvedAt?: string
  expiresAt?: string
  migrationTargetPlanId?: string
}

export interface WorkspaceSummary {
  workspaceId: string
  name: string
  slug: string
  ownerUid?: string
  role?: WorkspaceRole
  membershipStatus?: MembershipStatus
  status: WorkspaceStatus
  planId?: string
  sourceLimit?: number
  storageLimitGb?: number
  seatLimit?: number
  domains?: string[]
  features?: Record<string, unknown>
  entitlements?: Record<string, boolean | number | string>
  limits?: {
    sourcesMax: number
    storageGbIncluded: number
    membersMax: number
    youtubePublishMonthlyLimit: number
  }
  isLegacy?: boolean
}

export interface WorkspaceMembership {
  uid: string
  workspaceId: string
  role: WorkspaceRole
  status: MembershipStatus
  createdAt?: string
  updatedAt?: string
  invitedBy?: string
}

export interface AuthSession {
  authEnabled: boolean
  legacyMode: boolean
  isAuthenticated: boolean
  user: UserProfile | null
  activeWorkspace: WorkspaceSummary | null
  workspaces: WorkspaceSummary[]
  platformAdmin: boolean
  adminMode: boolean
  entitlements?: Record<string, boolean | number | string>
  currentDomain?: string | null
  domainAccess?: {
    current: string | null
    activeWorkspaceAllowed: boolean
    activeWorkspaceDomains: string[]
  }
  accessRequest: AccessRequest | null
  needsApproval: boolean
  betaAccess?: BetaAccessState | null
  authInitError?: string
}

export type AccessRequestStatus = 'pending' | 'approved' | 'denied' | 'withdrawn'

export interface AccessRequest {
  requestId: string
  uid: string
  email: string
  displayName?: string
  requestedWorkspaceId?: string
  requestedWorkspaceName?: string
  requestKind?: AccessRequestKind
  requestedTier?: string
  status: AccessRequestStatus
  note?: string
  sunoHandle?: string
  sunoProfileUrl?: string
  youtubeChannelUrl?: string
  intendedUse?: string
  preferredUpgradePlanId?: string
  createdAt?: string
  updatedAt?: string
  reviewedAt?: string
  reviewedBy?: string
  reviewNotes?: string
  approvedWorkspaceId?: string
  approvedRole?: WorkspaceRole
  approvedTier?: string
  approvedPlanId?: string
  betaApprovedAt?: string
  betaExpiresAt?: string
  betaMigrationTargetPlanId?: string
}

export interface SignupTierOption {
  id: string
  label: string
  lane: AccessRequestKind
  domains?: string[]
  publicBetaVisible?: boolean
  adminOnly?: boolean
  priceLabel: string
  cadence: string
  summary: string
  highlights: string[]
  defaultRole: WorkspaceRole
  defaultPlanId: string
  trialDays?: number
  billingCadences?: string[]
  entitlements: Record<string, boolean | number | string>
  limits: {
    sourcesMax: number
    storageGbIncluded: number
    membersMax: number
    youtubePublishMonthlyLimit: number
  }
}

export interface AdminOverview {
  session: AuthSession
  queue: {
    new: number
    queued: number
    uploading: number
    done: number
    error: number
    total: number
  }
  exportArtifact: {
    bucket: string
    object: string
    metaObject: string
    generatedAt?: string
    rowCount?: number
    generator?: string
    artifact?: string
  }
  exportFreshness: {
    status: 'healthy' | 'stale' | 'mismatch' | 'unavailable' | 'source_ahead' | 'source_idle' | 'partial_source'
    label: string
    detail: string
    generatedAt?: string
    hoursSinceGeneratedAt: number | null
    staleHours: number
    servingSource: 'gcs' | 'fallback' | 'unavailable'
    exportRowCount: number
    servedRowCount: number
    newestServedCreatedAt?: string
    latestSourceCreatedAt?: string
    sourceContentAgeHours: number | null
    sourceLeadHours: number | null
  }
  latestSourceSong?: {
    songKey: string
    title: string
    createdAt: string
    status: string
    accountHandle: string
  } | null
  catalogHealth: {
    requiredColumns: string[]
    servingSource: 'gcs' | 'fallback' | 'unavailable'
    gcs: {
      source: 'gcs'
      available: boolean
      healthy: boolean
      columnCount: number
      missingRequired: string[]
      error?: string
    }
    fallback: {
      source: 'fallback'
      available: boolean
      healthy: boolean
      columnCount: number
      missingRequired: string[]
      error?: string
    }
  }
  accessRequests: {
    pendingCount: number
    summary: {
      total: number
      pending: number
      approved: number
      denied: number
      withdrawn: number
      beta: number
      free: number
      paid: number
    }
    recent: AccessRequest[]
  }
}

export interface YouTubePublishState {
  status: string
  ytVideoId?: string
  ytCanonicalUrl?: string
  ytPublishedAt?: string
  error?: string
  ytErrorAt?: string
}

export interface SongInteractionRecord {
  songKey: string
  platform: string
  destinationId?: string
  publishedTo?: string[]
  viewCount?: number
  playCount?: number
  uniqueListeners?: number
  commentCount?: number
  likeCount?: number
  shareCount?: number
  lastEngagementSyncAt?: string
}
