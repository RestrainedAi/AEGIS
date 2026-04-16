import branding from '../../branding.config.json'

export const BRANDING = branding
export const SUNDROP_CLOUD_NAME = branding.productNames.cloud
export const SUNDROP_VAULT_NAME = branding.productNames.vault
export const SUNDROP_MUSIC_NAME = branding.productNames.music
export const LEGACY_WORKSPACE_NAME = branding.productNames.legacyWorkspace
export const SUNDROP_CLOUD_ORIGIN = branding.domains.cloudOrigin
export const SUNDROP_MUSIC_ORIGIN = branding.domains.musicOrigin
export const EMAIL_LINK_STORAGE_KEY = branding.keys.emailLinkStorage
export const ACTIVE_PLAYER_EVENT = branding.keys.activePlayerEvent
export const LEGACY_WORKSPACE_ID = branding.legacy.workspaceId

function normalizePath(path = '/') {
  return path.startsWith('/') ? path : `/${path}`
}

export function buildCloudUrl(path = '/') {
  return `${SUNDROP_CLOUD_ORIGIN}${normalizePath(path)}`
}

export function buildMusicUrl(path = '/') {
  return `${SUNDROP_MUSIC_ORIGIN}${normalizePath(path)}`
}

export function getActiveCloudOrigin() {
  if (typeof window === 'undefined') {
    return SUNDROP_CLOUD_ORIGIN
  }

  const { origin, hostname } = window.location
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return origin
  }

  return origin || SUNDROP_CLOUD_ORIGIN
}

export function buildActiveCloudUrl(path = '/') {
  return `${getActiveCloudOrigin()}${normalizePath(path)}`
}
