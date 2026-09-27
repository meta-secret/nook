import { describe, expect, it } from 'vitest'
import { OAuthFailure, OAuthFailureKind } from '$lib/auth/oauth-failure'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'

describe('OAuthFailure.translationKey', () => {
  it('maps iCloud timeouts to existing Apple window guidance', () => {
    expect(
      new OAuthFailure(OAuthFailureKind.TimedOut).translationKey,
    ).toBe(I18N_KEYS.ProviderSetupIcloudSignInTimeout)
  })

  it('keeps unrelated iCloud failures on generic sign-in guidance', () => {
    expect(
      new OAuthFailure(OAuthFailureKind.CloudKitAuthentication).translationKey,
    ).toBe(I18N_KEYS.ProviderSetupIcloudSignInFailed)
  })
})
