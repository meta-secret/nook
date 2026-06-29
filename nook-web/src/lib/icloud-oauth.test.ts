import { describe, expect, it } from 'vitest'
import {
  isICloudOAuthConfigured,
  oauthTokensToICloudConfig,
} from './icloud-oauth'
import {
  ICLOUD_E2E_STUB_WEB_AUTH_TOKEN,
  isICloudE2eStubMode,
} from './icloud-oauth-config'

describe('icloud-oauth', () => {
  it('is configured with the committed container and api token', () => {
    expect(isICloudOAuthConfigured()).toBe(true)
  })

  it('detects e2e stub mode from the committed api token', () => {
    expect(isICloudE2eStubMode()).toBe(true)
    expect(ICLOUD_E2E_STUB_WEB_AUTH_TOKEN).toBe('ck-web-auth-e2e-stub-token')
  })

  it('maps tokens to oauth-file icloud config', () => {
    expect(
      oauthTokensToICloudConfig({
        accessToken: 'ck-web-auth-token',
      }),
    ).toEqual({
      preset: 'icloud',
      accessToken: 'ck-web-auth-token',
      fileId: undefined,
      fileName: undefined,
      accountEmail: undefined,
      refreshToken: undefined,
      expiresAt: undefined,
    })
  })
})
