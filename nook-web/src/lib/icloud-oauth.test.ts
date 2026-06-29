import { describe, expect, it } from 'vitest'
import {
  isICloudOAuthConfigured,
  oauthTokensToICloudConfig,
} from './icloud-oauth'
import {
  ICLOUD_CONTAINER_ID,
  ICLOUD_E2E_STUB_WEB_AUTH_TOKEN,
  isICloudE2eStubMode,
} from './icloud-oauth-config'

describe('icloud-oauth', () => {
  it('is configured with the committed container and api token', () => {
    expect(isICloudOAuthConfigured()).toBe(true)
    expect(ICLOUD_CONTAINER_ID).toBe('iCloud.metasecret.project.com')
  })

  it('uses real CloudKit web auth when a production api token is committed', () => {
    expect(isICloudE2eStubMode()).toBe(false)
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
