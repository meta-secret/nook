import { err, ok, type Result } from 'neverthrow'
import { OAuthFailure, OAuthFailureKind } from '$lib/auth/oauth-failure'
/**
 * Google Identity Services (GIS) token client for Drive access.
 *
 * Browser-only — no server, no client secret, no redirect callback.
 * Access tokens are short-lived (~1h); silent refresh uses requestAccessToken
 * while the user's Google session is still active.
 *
 * Scopes:
 * - Private provider mode: `drive.appdata` (hidden application data folder).
 * - Shared provider mode: `drive.file` for writes plus `drive.readonly` so a
 *   collaborator can read the owner-created folder and immutable event files.
 */

import type {
  OAuthFileConfig,
  StoredOAuthFileConfiguration,
} from '$lib/auth/providers'
import { configuredOAuthFile } from '$lib/auth/providers'
import { google_oauth_tokens_to_config } from '$app-wasm'
import { GOOGLE_OAUTH_CLIENT_ID } from '$lib/auth/google/config'

const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client'

export const DRIVE_APPDATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata'

export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file'

export const DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'

export enum GoogleDriveOAuthScope {
  AppData = 'appdata',
  Shared = 'shared',
}

export enum GoogleOAuthPrompt {
  /** @public Google Identity Services contract value. */
  Default = '',
  /** @public Google Identity Services contract value. */
  None = 'none',
  /** @public Google Identity Services contract value. */
  Consent = 'consent',
  /** @public Google Identity Services contract value. */
  SelectAccount = 'select_account',
}

export type GoogleOAuthTokens = {
  accessToken: string
  expiresAt: string
}

export enum GoogleAccountIdentityKind {
  Unavailable = 'unavailable',
  Available = 'available',
}

export type GoogleAccountIdentity =
  | { kind: GoogleAccountIdentityKind.Unavailable }
  | { kind: GoogleAccountIdentityKind.Available; label: string }

type GoogleTokenResponse = {
  access_token: string
  expires_in: number
  error?: string
  error_description?: string
}

type GoogleTokenClientConfig = {
  client_id: string
  scope: string
  callback: (response: GoogleTokenResponse) => void
  error_callback: (failure: { type: string }) => void
}

export type GoogleTokenPromptRequest = {
  readonly prompt: string
}

type TokenClient = {
  requestAccessToken: (request: GoogleTokenPromptRequest) => void
}

export type GoogleAccessTokenRequest = {
  readonly prompt: GoogleOAuthPrompt
  readonly scope: GoogleDriveOAuthScope
}

export type GoogleSharedDriveAccessRequest = {
  readonly prompt: GoogleOAuthPrompt
}

export type GoogleOAuthConfigurationUpdate = {
  readonly tokens: GoogleOAuthTokens
  readonly existing: StoredOAuthFileConfiguration
}

export type GoogleOAuthExpiryAssessment = {
  readonly config: OAuthFileConfig
  readonly skewMs: number
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: GoogleTokenClientConfig) => TokenClient
        }
      }
    }
  }
}

enum TokenRequestKind {
  Idle = 'idle',
  AwaitingResponse = 'awaiting-response',
}

type TokenRequest =
  | { kind: TokenRequestKind.Idle }
  | {
      kind: TokenRequestKind.AwaitingResponse
      resolve: (response: Result<GoogleOAuthTokens, OAuthFailure>) => void
    }

enum GoogleIdentityServicesKind {
  NotLoaded = 'not-loaded',
  Loading = 'loading',
}

type GoogleIdentityServices =
  | { kind: GoogleIdentityServicesKind.NotLoaded }
  | {
      kind: GoogleIdentityServicesKind.Loading
      completion: Promise<Result<void, OAuthFailure>>
    }

type TokenClientSlot = {
  scopeKey: string
  client: TokenClient
  request: TokenRequest
}

/** Owns Google browser token clients and their single pending request. */
class GoogleOAuthSession {
  private tokenClients = new Map<string, TokenClientSlot>()
  private googleIdentityServices: GoogleIdentityServices = {
    kind: GoogleIdentityServicesKind.NotLoaded,
  }

  isGoogleOAuthConfigured(): boolean {
    return Boolean(GOOGLE_OAUTH_CLIENT_ID.trim())
  }

  private scopeString(scope: GoogleDriveOAuthScope): string {
    switch (scope) {
      case GoogleDriveOAuthScope.Shared:
        return `${DRIVE_FILE_SCOPE} ${DRIVE_READONLY_SCOPE}`
      case GoogleDriveOAuthScope.AppData:
        return DRIVE_APPDATA_SCOPE
    }
  }

  private loadGisScript(): Promise<Result<void, OAuthFailure>> {
    return new Promise((resolve) => {
      try {
        if (window.google?.accounts?.oauth2) {
          resolve(ok(undefined))
          return
        }
        const existing = document.querySelector(`script[src="${GIS_SCRIPT_URL}"]`)
        const loaded = () => resolve(ok(undefined))
        const failed = () =>
          resolve(err(new OAuthFailure(OAuthFailureKind.GoogleScript)))
        if (existing) {
          existing.addEventListener('load', loaded, { once: true })
          existing.addEventListener('error', failed, { once: true })
          return
        }
        const script = document.createElement('script')
        script.src = GIS_SCRIPT_URL
        script.async = true
        script.defer = true
        script.onload = loaded
        script.onerror = failed
        document.head.appendChild(script)
      } catch {
        resolve(err(new OAuthFailure(OAuthFailureKind.GoogleScript)))
      }
    })
  }

  private ensureGisReady(): Promise<Result<void, OAuthFailure>> {
    if (this.googleIdentityServices.kind === GoogleIdentityServicesKind.Loading)
      return this.googleIdentityServices.completion
    const completion = this.loadGisScript()
    this.googleIdentityServices = {
      kind: GoogleIdentityServicesKind.Loading,
      completion,
    }
    return completion
  }

  private async tokenClientForScope(
    scope: GoogleDriveOAuthScope,
  ): Promise<Result<TokenClientSlot, OAuthFailure>> {
    const clientId = GOOGLE_OAUTH_CLIENT_ID.trim()
    if (!clientId) return err(new OAuthFailure(OAuthFailureKind.GoogleConfiguration))
    const ready = await this.ensureGisReady()
    if (ready.isErr()) return err(ready.error)
    const key = this.scopeString(scope)
    const existing = this.tokenClients.get(key)
    if (existing) return ok(existing)
    const oauth = window.google?.accounts.oauth2
    if (!oauth) return err(new OAuthFailure(OAuthFailureKind.GoogleScript))
    const complete = (outcome: Result<GoogleOAuthTokens, OAuthFailure>) => {
      const current = this.tokenClients.get(key)
      if (current?.request.kind !== TokenRequestKind.AwaitingResponse) return
      const pending = current.request
      current.request = { kind: TokenRequestKind.Idle }
      pending.resolve(outcome)
    }
    const config: GoogleTokenClientConfig = {
      client_id: clientId,
      scope: key,
      callback: (response) => complete(this.tokensFromResponse(response)),
      error_callback: (failure) =>
        complete(
          err(
            new OAuthFailure(
              failure.type === 'popup_closed'
                ? OAuthFailureKind.Cancelled
                : failure.type === 'popup_failed_to_open'
                  ? OAuthFailureKind.PopupBlocked
                  : OAuthFailureKind.GoogleRequest,
            ),
          ),
        ),
    }
    try {
      const client = oauth.initTokenClient(config)
      const slot: TokenClientSlot = {
        scopeKey: key,
        client,
        request: { kind: TokenRequestKind.Idle },
      }
      this.tokenClients.set(key, slot)
      return ok(slot)
    } catch {
      return err(new OAuthFailure(OAuthFailureKind.GoogleRequest))
    }
  }

  async initGoogleAuth(): Promise<Result<void, OAuthFailure>> {
    return (await this.tokenClientForScope(GoogleDriveOAuthScope.AppData)).map(
      () => undefined,
    )
  }
  async initGoogleSharedDriveAuth(): Promise<Result<void, OAuthFailure>> {
    return (await this.tokenClientForScope(GoogleDriveOAuthScope.Shared)).map(
      () => undefined,
    )
  }
  private tokensFromResponse(
    response: GoogleTokenResponse,
  ): Result<GoogleOAuthTokens, OAuthFailure> {
    if (response.error)
      return err(
        new OAuthFailure(
          response.error === 'access_denied'
            ? OAuthFailureKind.Cancelled
            : OAuthFailureKind.GoogleRequest,
        ),
      )
    if (!response.access_token)
      return err(new OAuthFailure(OAuthFailureKind.GoogleResponse))
    // Date construction parses external GIS protocol data at this boundary.
    try {
      const expiresIn = response.expires_in ?? 3600
      return ok({
        accessToken: response.access_token,
        expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      })
    } catch {
      return err(new OAuthFailure(OAuthFailureKind.GoogleResponse))
    }
  }
  async requestGoogleAccessToken(
    request: GoogleAccessTokenRequest,
  ): Promise<Result<GoogleOAuthTokens, OAuthFailure>> {
    const admitted = await this.tokenClientForScope(request.scope)
    if (admitted.isErr()) return err(admitted.error)
    const slot = admitted.value
    if (slot.request.kind === TokenRequestKind.AwaitingResponse)
      return err(new OAuthFailure(OAuthFailureKind.RequestInProgress))
    return new Promise((resolve) => {
      slot.request = { kind: TokenRequestKind.AwaitingResponse, resolve }
      try {
        slot.client.requestAccessToken({ prompt: request.prompt })
      } catch {
        slot.request = { kind: TokenRequestKind.Idle }
        resolve(err(new OAuthFailure(OAuthFailureKind.GoogleRequest)))
      }
    })
  }
  requestGoogleDriveSharedAccess(
    request: GoogleSharedDriveAccessRequest,
  ): Promise<Result<GoogleOAuthTokens, OAuthFailure>> {
    return this.requestGoogleAccessToken({
      prompt: request.prompt,
      scope: GoogleDriveOAuthScope.Shared,
    })
  }
  oauthTokensToConfig({
    tokens,
    existing,
  }: GoogleOAuthConfigurationUpdate): Result<OAuthFileConfig, OAuthFailure> {
    try {
      return ok(
        google_oauth_tokens_to_config(
          tokens.accessToken,
          tokens.expiresAt,
          existing,
        ),
      )
    } catch {
      return err(new OAuthFailure(OAuthFailureKind.InvalidConfiguration))
    }
  }
  isOAuthAccessTokenExpired({
    config,
    skewMs,
  }: GoogleOAuthExpiryAssessment): boolean {
    if (config.expiresAt.state === 'unknown') return false
    const expiresAt = Date.parse(config.expiresAt.value)
    if (Number.isNaN(expiresAt)) return false
    return Date.now() + skewMs >= expiresAt
  }
  async ensureValidOAuthFileConfig(
    config: OAuthFileConfig,
  ): Promise<Result<OAuthFileConfig, OAuthFailure>> {
    if (!this.isOAuthAccessTokenExpired({ config, skewMs: 60_000 }))
      return ok(config)
    const refreshed = await this.requestGoogleAccessToken({
      prompt: GoogleOAuthPrompt.Default,
      scope:
        config.driveMode === 'shared' || config.folderId.state === 'folderId'
          ? GoogleDriveOAuthScope.Shared
          : GoogleDriveOAuthScope.AppData,
    })
    return refreshed.andThen((tokens) =>
      this.oauthTokensToConfig({ tokens, existing: configuredOAuthFile(config) }),
    )
  }
  async fetchGoogleAccountEmail(
    accessToken: string,
  ): Promise<Result<GoogleAccountIdentity, OAuthFailure>> {
    let payload: unknown
    try {
      const response = await fetch(
        'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)',
        { headers: { Authorization: `Bearer ${accessToken}` } },
      )
      if (!response.ok) return err(new OAuthFailure(OAuthFailureKind.AccountLookup))
      payload = await response.json()
    } catch {
      return err(new OAuthFailure(OAuthFailureKind.AccountLookup))
    }
    if (!payload || typeof payload !== 'object' || !('user' in payload))
      return ok({ kind: GoogleAccountIdentityKind.Unavailable })
    const user = payload.user
    if (!user || typeof user !== 'object')
      return ok({ kind: GoogleAccountIdentityKind.Unavailable })
    if (
      'emailAddress' in user &&
      typeof user.emailAddress === 'string' &&
      user.emailAddress.trim()
    )
      return ok({
        kind: GoogleAccountIdentityKind.Available,
        label: user.emailAddress,
      })
    if (
      'displayName' in user &&
      typeof user.displayName === 'string' &&
      user.displayName.trim()
    )
      return ok({
        kind: GoogleAccountIdentityKind.Available,
        label: user.displayName,
      })
    return ok({ kind: GoogleAccountIdentityKind.Unavailable })
  }
}

export const googleOAuthSession = new GoogleOAuthSession()
