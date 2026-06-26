import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  generatePkceVerifier,
  googleOAuthRedirectUri,
  isOAuthAccessTokenExpired,
  oauthTokensToConfig,
} from './google-oauth'

describe('google-oauth', () => {
  beforeEach(() => {
    vi.stubEnv(
      'VITE_GOOGLE_CLIENT_ID',
      'test-client-id.apps.googleusercontent.com',
    )
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    sessionStorage.clear()
  })

  it('builds a callback redirect uri under the app base', () => {
    expect(googleOAuthRedirectUri()).toMatch(/oauth\/google\/callback$/)
  })

  it('generates pkce verifiers with url-safe characters', () => {
    const verifier = generatePkceVerifier()
    expect(verifier.length).toBeGreaterThan(40)
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('detects expired oauth access tokens with skew', () => {
    const expired = oauthTokensToConfig({
      accessToken: 'token',
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    })
    expect(isOAuthAccessTokenExpired(expired)).toBe(true)
  })
})
