import { describe, expect, it, vi } from 'vitest'
import {
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
import { OAuthFailure, OAuthFailureKind } from '$lib/auth/oauth-failure'
import { oauthConfigurationNotApplicable } from '$lib/auth/providers'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'

describe('google-oauth', () => {
  it('maps Google account lookup failures to Google sign-in guidance', () => {
    expect(
      new OAuthFailure(OAuthFailureKind.GoogleAccountLookup).translationKey,
    ).toBe(I18N_KEYS.ErrorsGoogleSignInRequired)
  })

  it('maps invalid Google configuration to Google sign-in guidance', () => {
    expect(
      new OAuthFailure(OAuthFailureKind.GoogleInvalidConfiguration)
        .translationKey,
    ).toBe(I18N_KEYS.ErrorsGoogleSignInRequired)
  })

  it('keeps Google popup outcomes mapped to Google guidance', () => {
    expect(
      new OAuthFailure(OAuthFailureKind.GoogleCancelled).translationKey,
    ).toBe(I18N_KEYS.ErrorsGoogleSignInRequired)
    expect(
      new OAuthFailure(OAuthFailureKind.GooglePopupBlocked).translationKey,
    ).toBe(I18N_KEYS.ErrorsGoogleSignInRequired)
  })

  it('keeps shared invalid configuration mapped to iCloud guidance', () => {
    expect(
      new OAuthFailure(OAuthFailureKind.InvalidConfiguration).translationKey,
    ).toBe(I18N_KEYS.ProviderSetupIcloudSignInFailed)
  })

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
    expect(googleOAuthSession.isOAuthAccessTokenExpired(expiryAssessment)).toBe(
      true,
    )
  })

  it('requests the shared Drive scope with the invited account preselected', async () => {
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

    const sharedScope = `${DRIVE_FILE_SCOPE} ${DRIVE_READONLY_SCOPE}`
    const sharedRequest: GoogleAccessTokenRequest = {
      scope: GoogleDriveOAuthScope.Shared,
      prompt: GoogleOAuthPrompt.Consent,
      accountHint: ' member@example.com ',
    }
    const token = googleOAuthSession.requestGoogleAccessToken(sharedRequest)

    await vi.waitFor(() => {
      expect(requests.get(sharedScope)).toHaveBeenCalledOnce()
    })
    // Every Drive provider is shared: no app-data token client exists.
    expect([...requests.keys()]).toEqual([sharedScope])
    const promptRequest: GoogleTokenPromptRequest = {
      prompt: GoogleOAuthPrompt.Consent,
      login_hint: 'member@example.com',
    }
    expect(requests.get(sharedScope)).toHaveBeenCalledWith(promptRequest)
    const callback = callbacks.get(sharedScope)
    if (!callback) throw new Error('expected a Google token callback')
    callback({ access_token: 'shared-token', expires_in: 3600 })

    const shared = await token
    expect(shared.isOk()).toBe(true)
    if (shared.isErr()) return
    expect(shared.value.accessToken).toBe('shared-token')
  })
})
