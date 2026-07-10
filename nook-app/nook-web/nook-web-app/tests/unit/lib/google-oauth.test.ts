import { describe, expect, it, vi } from 'vitest'
import {
  DRIVE_APPDATA_SCOPE,
  DRIVE_FILE_SCOPE,
  isGoogleOAuthConfigured,
  isOAuthAccessTokenExpired,
  oauthTokensToConfig,
  requestGoogleAccessToken,
} from '$lib/google-oauth'

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

    const appdataToken = requestGoogleAccessToken({ scope: 'appdata' })
    const fileToken = requestGoogleAccessToken({ scope: 'file' })

    await vi.waitFor(() => {
      expect(requests.get(DRIVE_APPDATA_SCOPE)).toHaveBeenCalledOnce()
      expect(requests.get(DRIVE_FILE_SCOPE)).toHaveBeenCalledOnce()
    })
    callbacks.get(DRIVE_FILE_SCOPE)!({
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
