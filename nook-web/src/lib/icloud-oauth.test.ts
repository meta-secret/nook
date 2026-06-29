import { describe, expect, it } from 'vitest'
import {
  isICloudOAuthConfigured,
  oauthTokensToICloudConfig,
} from './icloud-oauth'
import { ICLOUD_CONTAINER_ID, ICLOUD_ENVIRONMENT } from './icloud-oauth-config'

describe('icloud-oauth', () => {
  it('is configured for production CloudKit on nokey.sh', () => {
    expect(isICloudOAuthConfigured()).toBe(true)
    expect(ICLOUD_CONTAINER_ID).toBe('iCloud.metasecret.project.com')
    expect(ICLOUD_ENVIRONMENT).toBe('production')
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
