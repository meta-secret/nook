import { describe, expect, it, vi } from 'vitest'
import {
  DRIVE_APPDATA_SCOPE,
  DRIVE_FILE_SCOPE,
  DRIVE_READONLY_SCOPE,
  GoogleDriveOAuthScope,
  GoogleOAuthPrompt,
  isGoogleOAuthConfigured,
  isOAuthAccessTokenExpired,
  oauthTokensToConfig,
  requestGoogleAccessToken,
  type GoogleAccessTokenRequest,
  type GoogleOAuthConfigurationUpdate,
  type GoogleOAuthExpiryAssessment,
  type GoogleTokenPromptRequest,
} from '$lib/auth/google/oauth'
import { oauthConfigurationNotApplicable } from '$lib/auth/providers'

describe('google-oauth', () => {
  it('is configured with the committed client id', () => {
    expect(isGoogleOAuthConfigured()).toBe(true)
  })

  it('detects expired oauth access tokens with skew', () => {
    const configurationUpdate: GoogleOAuthConfigurationUpdate = {
      tokens: {
        accessToken: 'token',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      },
      existing: oauthConfigurationNotApplicable(),
    }
    const expired = oauthTokensToConfig(configurationUpdate)
    const expiryAssessment: GoogleOAuthExpiryAssessment = {
      config: expired,
      skewMs: 60_000,
    }
    expect(isOAuthAccessTokenExpired(expiryAssessment)).toBe(true)
  })

  it('settles concurrent token requests independently by scope', async () => {
    const callbacks = new Map<
      string,
      (response: {
        access_token: string
        expires_in: number
        error?: string
      }) => void
    >()
    const requests = new Map<string, ReturnType<typeof vi.fn>>()
    Object.defineProperty(window, 'google', {
      configurable: true,
      value: {
        accounts: {
          oauth2: {
            initTokenClient: vi.fn(
              (config: {
                scope: string
                callback: (response: {
                  access_token: string
                  expires_in: number
                  error?: string
                }) => void
              }) => {
                callbacks.set(config.scope, config.callback)
                const requestAccessToken = vi.fn()
                requests.set(config.scope, requestAccessToken)
                return { requestAccessToken }
              },
            ),
          },
        },
      },
    })

    const appDataRequest: GoogleAccessTokenRequest = {
      scope: GoogleDriveOAuthScope.AppData,
      prompt: GoogleOAuthPrompt.Default,
    }
    const appdataToken = requestGoogleAccessToken(appDataRequest)
    const sharedScope = `${DRIVE_FILE_SCOPE} ${DRIVE_READONLY_SCOPE}`
    const sharedRequest: GoogleAccessTokenRequest = {
      scope: GoogleDriveOAuthScope.Shared,
      prompt: GoogleOAuthPrompt.Default,
    }
    const fileToken = requestGoogleAccessToken(sharedRequest)

    await vi.waitFor(() => {
      expect(requests.get(DRIVE_APPDATA_SCOPE)).toHaveBeenCalledOnce()
      expect(requests.get(sharedScope)).toHaveBeenCalledOnce()
    })
    const defaultPromptRequest: GoogleTokenPromptRequest = {
      prompt: GoogleOAuthPrompt.Default,
    }
    expect(requests.get(DRIVE_APPDATA_SCOPE)).toHaveBeenCalledWith(
      defaultPromptRequest,
    )
    expect(requests.get(sharedScope)).toHaveBeenCalledWith(defaultPromptRequest)
    callbacks.get(sharedScope)!({
      access_token: 'file-token',
      expires_in: 3600,
    })
    callbacks.get(DRIVE_APPDATA_SCOPE)!({
      access_token: 'appdata-token',
      expires_in: 3600,
    })

    await expect(fileToken).resolves.toMatchObject({
      accessToken: 'file-token',
    })
    await expect(appdataToken).resolves.toMatchObject({
      accessToken: 'appdata-token',
    })
  })
})
