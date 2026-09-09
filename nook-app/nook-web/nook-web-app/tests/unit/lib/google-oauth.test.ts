import { describe, expect, it, vi } from 'vitest'
import {
  DRIVE_APPDATA_SCOPE,
  DRIVE_FILE_SCOPE,
  DRIVE_READONLY_SCOPE,
  GoogleDriveOAuthScope,
  GoogleOAuthPrompt,
  type GoogleAccessTokenRequest,
  type GoogleOAuthConfigurationUpdate,
  type GoogleOAuthExpiryAssessment,
  type GoogleTokenPromptRequest,
  googleOAuthSession,
} from '$lib/auth/google/oauth'
import { oauthConfigurationNotApplicable } from '$lib/auth/providers'

describe('google-oauth', () => {
  it('is configured with the committed client id', () => {
    expect(googleOAuthSession.isGoogleOAuthConfigured()).toBe(true)
  })

  it('detects expired oauth access tokens with skew', () => {
    const configurationUpdate: GoogleOAuthConfigurationUpdate = {
      tokens: {
        accessToken: 'token',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      },
      existing: oauthConfigurationNotApplicable(),
    }
    const expired = googleOAuthSession.oauthTokensToConfig(configurationUpdate)
    expect(expired.isOk()).toBe(true)
    if (expired.isErr()) return
    const expiryAssessment: GoogleOAuthExpiryAssessment = {
      config: expired.value,
      skewMs: 60_000,
    }
    expect(googleOAuthSession.isOAuthAccessTokenExpired(expiryAssessment)).toBe(true)
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
    const appdataToken = googleOAuthSession.requestGoogleAccessToken(appDataRequest)
    const sharedScope = `${DRIVE_FILE_SCOPE} ${DRIVE_READONLY_SCOPE}`
    const sharedRequest: GoogleAccessTokenRequest = {
      scope: GoogleDriveOAuthScope.Shared,
      prompt: GoogleOAuthPrompt.Default,
    }
    const fileToken = googleOAuthSession.requestGoogleAccessToken(sharedRequest)

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

    const file = await fileToken
    const appData = await appdataToken
    expect(file.isOk()).toBe(true)
    expect(appData.isOk()).toBe(true)
    if (file.isErr() || appData.isErr()) return
    expect(file.value.accessToken).toBe('file-token')
    expect(appData.value.accessToken).toBe('appdata-token')
  })
})
