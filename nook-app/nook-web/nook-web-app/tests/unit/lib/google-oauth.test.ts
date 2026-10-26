import { describe, expect, it, vi } from 'vitest'
import {
  DRIVE_FILE_SCOPE,
  DRIVE_READONLY_SCOPE,
  GoogleOAuthPrompt,
  type GoogleSharedDriveAccessRequest,
  type GoogleOAuthConfigurationUpdate,
  type GoogleOAuthExpiryAssessment,
  type GoogleTokenPromptRequest,
  googleOAuthSession,
} from '$lib/auth/google/oauth'
import { OAuthFailure, OAuthFailureKind } from '$lib/auth/oauth-failure'
import {
  configuredOAuthFile,
  defaultOAuthFileConfig,
  oauth_access_token,
  oauthConfigurationNotApplicable,
  storedOAuthAccountEmail,
} from '$lib/auth/providers'

type TokenCallback = (response: {
  access_token: string
  expires_in: number
  error?: string
}) => void

/** A GIS stub recording one token client per requested scope string. */
function stubGoogleIdentityServices() {
  const callbacks = new Map<string, TokenCallback>()
  const requests = new Map<string, ReturnType<typeof vi.fn>>()
  Object.defineProperty(window, 'google', {
    configurable: true,
    value: {
      accounts: {
        oauth2: {
          initTokenClient: vi.fn(
            (config: { scope: string; callback: TokenCallback }) => {
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
  return { callbacks, requests }
}
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

  it('refreshes silently with drive.file alone, never asking for drive.readonly', async () => {
    const { callbacks, requests } = stubGoogleIdentityServices()
    const expiredUpdate: GoogleOAuthConfigurationUpdate = {
      tokens: {
        accessToken: 'expired-token',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      },
      existing: configuredOAuthFile({
        ...defaultOAuthFileConfig({
          preset: 'google-drive',
          fileName: 'vault',
        }),
        accountEmail: storedOAuthAccountEmail('owner@example.com'),
      }),
    }
    const expired = googleOAuthSession.oauthTokensToConfig(expiredUpdate)
    if (expired.isErr()) throw new Error('expected an expired Drive config')

    const refresh = googleOAuthSession.ensureValidOAuthFileConfig(expired.value)
    await vi.waitFor(() => {
      expect(requests.get(DRIVE_FILE_SCOPE)).toHaveBeenCalledOnce()
    })
    expect([...requests.keys()]).toEqual([DRIVE_FILE_SCOPE])
    const promptRequest: GoogleTokenPromptRequest = {
      prompt: GoogleOAuthPrompt.Default,
      login_hint: 'owner@example.com',
      include_granted_scopes: true,
    }
    expect(requests.get(DRIVE_FILE_SCOPE)).toHaveBeenCalledWith(promptRequest)
    const callback = callbacks.get(DRIVE_FILE_SCOPE)
    if (!callback) throw new Error('expected a Google token callback')
    callback({ access_token: 'fresh-token', expires_in: 3600 })

    const refreshed = await refresh
    expect(refreshed.isOk()).toBe(true)
    if (refreshed.isErr()) return
    expect(oauth_access_token(refreshed.value)).toEqual({
      kind: 'available',
      token: 'fresh-token',
    })
  })

  it('requests the shared Drive scope with the invited account preselected', async () => {
    const { callbacks, requests } = stubGoogleIdentityServices()

    const sharedScope = `${DRIVE_FILE_SCOPE} ${DRIVE_READONLY_SCOPE}`
    const sharedRequest: GoogleSharedDriveAccessRequest = {
      prompt: GoogleOAuthPrompt.Consent,
      accountHint: ' member@example.com ',
    }
    const token =
      googleOAuthSession.requestGoogleDriveSharedAccess(sharedRequest)

    await vi.waitFor(() => {
      expect(requests.get(sharedScope)).toHaveBeenCalledOnce()
    })
    // Only the cross-account read asks for drive.readonly.
    expect([...requests.keys()]).toEqual([sharedScope])
    const promptRequest: GoogleTokenPromptRequest = {
      prompt: GoogleOAuthPrompt.Consent,
      login_hint: 'member@example.com',
      include_granted_scopes: true,
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
