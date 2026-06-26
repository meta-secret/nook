import { describe, expect, it } from 'vitest'
import {
  isGoogleOAuthConfigured,
  isOAuthAccessTokenExpired,
  oauthTokensToConfig,
} from './google-oauth'

describe('google-oauth', () => {
  it('is configured with the committed client id', () => {
    expect(isGoogleOAuthConfigured()).toBe(true)
  })

  it('detects expired oauth access tokens with skew', () => {
    const expired = oauthTokensToConfig({
      accessToken: 'token',
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    })
    expect(isOAuthAccessTokenExpired(expired)).toBe(true)
  })
})
