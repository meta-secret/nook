/**
 * Google OAuth 2 (PKCE) for Drive app-data access.
 *
 * Nook is a static SPA — no backend token exchange. The maintainer registers
 * one OAuth Web client; end users only approve consent in Google's UI.
 */

import type { OAuthFileConfig } from '$lib/auth-providers'

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const DRIVE_APPDATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata'
const PKCE_STORAGE_KEY = 'nook_google_oauth_pkce'
const OAUTH_RETURN_KEY = 'nook_google_oauth_return'

export type GoogleOAuthTokens = {
  accessToken: string
  refreshToken?: string
  expiresAt: string
}

type PkceSession = {
  verifier: string
  state: string
  returnTo: string
}

type GoogleTokenResponse = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim())
}

export function googleOAuthRedirectUri(): string {
  const base = import.meta.env.BASE_URL ?? '/'
  const normalizedBase = base.endsWith('/') ? base : `${base}/`
  return new URL(
    'oauth/google/callback',
    window.location.origin + normalizedBase,
  ).href
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(input),
  )
  return toBase64Url(new Uint8Array(digest))
}

function randomState(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(24)))
}

export function generatePkceVerifier(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)))
}

export async function buildGoogleAuthUrl(
  returnTo = '/',
): Promise<{ url: string; state: string }> {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim()
  if (!clientId) {
    throw new Error('Google OAuth is not configured for this build.')
  }
  const verifier = generatePkceVerifier()
  const challenge = await sha256Base64Url(verifier)
  const state = randomState()
  const session: PkceSession = { verifier, state, returnTo }
  sessionStorage.setItem(PKCE_STORAGE_KEY, JSON.stringify(session))

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: googleOAuthRedirectUri(),
    response_type: 'code',
    scope: DRIVE_APPDATA_SCOPE,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
  })
  return {
    url: `${GOOGLE_AUTH_URL}?${params.toString()}`,
    state,
  }
}

export async function startGoogleOAuthSignIn(returnTo = '/'): Promise<void> {
  const { url } = await buildGoogleAuthUrl(returnTo)
  const popup = window.open(
    url,
    'nook-google-oauth',
    'popup,width=520,height=720,noopener,noreferrer',
  )
  if (!popup) {
    sessionStorage.setItem(OAUTH_RETURN_KEY, returnTo)
    window.location.assign(url)
  }
}

export function readOAuthCallbackParams(search: string): {
  code: string | null
  state: string | null
  error: string | null
} {
  const params = new URLSearchParams(search)
  return {
    code: params.get('code'),
    state: params.get('state'),
    error: params.get('error'),
  }
}

export function isGoogleOAuthCallbackPath(pathname: string): boolean {
  const base = import.meta.env.BASE_URL ?? '/'
  const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base
  const callbackPath = `${normalizedBase}/oauth/google/callback`.replace(
    /\/+/g,
    '/',
  )
  return (
    pathname === callbackPath || pathname.endsWith('/oauth/google/callback')
  )
}

async function postTokenRequest(
  body: URLSearchParams,
): Promise<GoogleTokenResponse> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const payload = (await response.json()) as GoogleTokenResponse
  if (!response.ok || payload.error) {
    throw new Error(
      payload.error_description ??
        payload.error ??
        `Google token exchange failed (${response.status})`,
    )
  }
  return payload
}

export async function exchangeGoogleAuthCode(
  code: string,
  state: string,
): Promise<GoogleOAuthTokens> {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim()
  if (!clientId) {
    throw new Error('Google OAuth is not configured for this build.')
  }
  const raw = sessionStorage.getItem(PKCE_STORAGE_KEY)
  if (!raw) {
    throw new Error('OAuth session expired. Try signing in again.')
  }
  const session = JSON.parse(raw) as PkceSession
  if (session.state !== state) {
    throw new Error('OAuth state mismatch. Try signing in again.')
  }
  sessionStorage.removeItem(PKCE_STORAGE_KEY)

  const body = new URLSearchParams({
    client_id: clientId,
    code,
    code_verifier: session.verifier,
    grant_type: 'authorization_code',
    redirect_uri: googleOAuthRedirectUri(),
  })
  const payload = await postTokenRequest(body)
  if (!payload.access_token) {
    throw new Error('Google did not return an access token.')
  }
  const expiresIn = payload.expires_in ?? 3600
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  }
}

export async function refreshGoogleAccessToken(
  refreshToken: string,
): Promise<GoogleOAuthTokens> {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim()
  if (!clientId) {
    throw new Error('Google OAuth is not configured for this build.')
  }
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  })
  const payload = await postTokenRequest(body)
  if (!payload.access_token) {
    throw new Error('Google did not return a refreshed access token.')
  }
  const expiresIn = payload.expires_in ?? 3600
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? refreshToken,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  }
}

export function oauthTokensToConfig(
  tokens: GoogleOAuthTokens,
  existing?: OAuthFileConfig,
): OAuthFileConfig {
  return {
    preset: 'google-drive',
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken ?? existing?.refreshToken,
    expiresAt: tokens.expiresAt,
    fileId: existing?.fileId,
    accountEmail: existing?.accountEmail,
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
  const refreshToken = config.refreshToken?.trim()
  if (!refreshToken) {
    throw new Error('Google session expired. Sign in again.')
  }
  const refreshed = await refreshGoogleAccessToken(refreshToken)
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

export function consumeOAuthReturnPath(): string {
  const value = sessionStorage.getItem(OAUTH_RETURN_KEY) ?? '/'
  sessionStorage.removeItem(OAUTH_RETURN_KEY)
  return value
}

export function readPkceReturnPath(state: string): string {
  const raw = sessionStorage.getItem(PKCE_STORAGE_KEY)
  if (!raw) return '/'
  try {
    const session = JSON.parse(raw) as PkceSession
    return session.state === state ? session.returnTo : '/'
  } catch {
    return '/'
  }
}
