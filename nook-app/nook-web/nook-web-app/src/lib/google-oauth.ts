/**
 * Google Identity Services (GIS) token client for Drive access.
 *
 * Browser-only — no server, no client secret, no redirect callback.
 * Access tokens are short-lived (~1h); silent refresh uses requestAccessToken
 * while the user's Google session is still active.
 *
 * Scopes:
 * - Personal vaults: `drive.appdata` (hidden application data folder).
 * - Shared vaults: `drive.file` (My Drive folder created/shared by Nook).
 */

import type { OAuthFileConfig } from '$lib/auth-providers'
import { GOOGLE_OAUTH_CLIENT_ID } from '$lib/google-oauth-config'

const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client'
export const DRIVE_APPDATA_SCOPE =
  'https://www.googleapis.com/auth/drive.appdata'
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file'

export type GoogleDriveOAuthScope = 'appdata' | 'file' | 'both'

export type GoogleOAuthTokens = {
  accessToken: string
  expiresAt: string
}

type GoogleTokenResponse = {
  access_token: string
  expires_in: number
  error?: string
  error_description?: string
}

type TokenClient = {
  requestAccessToken: (opts?: { prompt?: string }) => void
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string
            scope: string
            callback: (response: GoogleTokenResponse) => void
          }) => TokenClient
        }
      }
    }
  }
}

type TokenClientSlot = {
  scopeKey: string
  client: TokenClient
}

const tokenClients = new Map<string, TokenClientSlot>()
let pendingResolve: ((response: GoogleTokenResponse) => void) | undefined =
  undefined
let gisReadyPromise: Promise<void> | undefined = undefined

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(GOOGLE_OAUTH_CLIENT_ID.trim())
}

function googleClientId(): string {
  const clientId = GOOGLE_OAUTH_CLIENT_ID.trim()
  if (!clientId) {
    throw new Error('Google OAuth client id is not configured.')
  }
  return clientId
}

function scopeString(scope: GoogleDriveOAuthScope): string {
  switch (scope) {
    case 'file':
      return DRIVE_FILE_SCOPE
    case 'both':
      return `${DRIVE_APPDATA_SCOPE} ${DRIVE_FILE_SCOPE}`
    case 'appdata':
    default:
      return DRIVE_APPDATA_SCOPE
  }
}

function loadGisScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) {
      resolve()
      return
    }
    const existing = document.querySelector(`script[src="${GIS_SCRIPT_URL}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener(
        'error',
        () => reject(new Error('Failed to load Google Identity Services.')),
        { once: true },
      )
      return
    }
    const script = document.createElement('script')
    script.src = GIS_SCRIPT_URL
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () =>
      reject(new Error('Failed to load Google Identity Services.'))
    document.head.appendChild(script)
  })
}

async function ensureGisReady(): Promise<void> {
  if (gisReadyPromise) {
    return gisReadyPromise
  }
  gisReadyPromise = loadGisScript()
  return gisReadyPromise
}

async function tokenClientForScope(
  scope: GoogleDriveOAuthScope,
): Promise<TokenClient> {
  await ensureGisReady()
  const key = scopeString(scope)
  const existing = tokenClients.get(key)
  if (existing) {
    return existing.client
  }
  const client = window.google!.accounts.oauth2.initTokenClient({
    client_id: googleClientId(),
    scope: key,
    callback: (response) => {
      pendingResolve?.(response)
      pendingResolve = undefined
    },
  })
  tokenClients.set(key, { scopeKey: key, client })
  return client
}

/** Personal vaults: initialize the default `drive.appdata` token client. */
export async function initGoogleAuth(): Promise<void> {
  await tokenClientForScope('appdata')
}

/** Shared vaults: initialize a `drive.file` token client. */
export async function initGoogleSharedDriveAuth(): Promise<void> {
  await tokenClientForScope('file')
}

function tokensFromResponse(response: GoogleTokenResponse): GoogleOAuthTokens {
  if (response.error) {
    throw new Error(
      response.error_description ?? response.error ?? 'Google sign-in failed.',
    )
  }
  if (!response.access_token) {
    throw new Error('Google did not return an access token.')
  }
  const expiresIn = response.expires_in ?? 3600
  return {
    accessToken: response.access_token,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  }
}

export async function requestGoogleAccessToken(options?: {
  prompt?: '' | 'none' | 'consent' | 'select_account'
  scope?: GoogleDriveOAuthScope
}): Promise<GoogleOAuthTokens> {
  const scope = options?.scope ?? 'appdata'
  const client = await tokenClientForScope(scope)

  return new Promise((resolve, reject) => {
    pendingResolve = (response) => {
      try {
        resolve(tokensFromResponse(response))
      } catch (error) {
        reject(error)
      }
    }
    client.requestAccessToken(
      options?.prompt !== undefined ? { prompt: options.prompt } : undefined,
    )
  })
}

/** Request a token with `drive.file` for shared-replication vaults. */
export async function requestGoogleDriveSharedAccess(options?: {
  prompt?: '' | 'none' | 'consent' | 'select_account'
}): Promise<GoogleOAuthTokens> {
  return requestGoogleAccessToken({
    prompt: options?.prompt ?? 'consent',
    scope: 'file',
  })
}

export function oauthTokensToConfig(
  tokens: GoogleOAuthTokens,
  existing?: OAuthFileConfig,
): OAuthFileConfig {
  return {
    preset: 'google-drive',
    accessToken: tokens.accessToken,
    expiresAt: tokens.expiresAt,
    fileId: existing?.fileId,
    fileName: existing?.fileName,
    accountEmail: existing?.accountEmail,
    refreshToken: existing?.refreshToken,
    folderId: existing?.folderId,
  }
}

export function isOAuthAccessTokenExpired(
  config: OAuthFileConfig,
  skewMs = 60_000,
): boolean {
  if (!config.expiresAt) return false
  const expiresAt = Date.parse(config.expiresAt)
  if (Number.isNaN(expiresAt)) return false
  return Date.now() + skewMs >= expiresAt
}

export async function ensureValidOAuthFileConfig(
  config: OAuthFileConfig,
): Promise<OAuthFileConfig> {
  if (!isOAuthAccessTokenExpired(config)) {
    return config
  }
  const scope: GoogleDriveOAuthScope = config.folderId?.trim()
    ? 'file'
    : 'appdata'
  const refreshed = await requestGoogleAccessToken({ prompt: '', scope })
  return oauthTokensToConfig(refreshed, config)
}

export async function fetchGoogleAccountEmail(
  accessToken: string,
): Promise<string | undefined> {
  const response = await fetch(
    'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)',
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  )
  if (!response.ok) {
    return undefined
  }
  const payload = (await response.json()) as {
    user?: { emailAddress?: string; displayName?: string }
  }
  return payload.user?.emailAddress ?? payload.user?.displayName
}
