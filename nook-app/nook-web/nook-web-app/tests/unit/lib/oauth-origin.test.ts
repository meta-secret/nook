import { describe, expect, test } from 'vitest'
import {
  BrowserOAuthProvider,
  is_cloudflare_pr_preview_host,
  OAuthOriginUnsupportedReason,
  resolveOAuthOriginSupport,
} from '$lib/auth/oauth-origin'

type OAuthLocationFixtureRequest = {
  origin: string
  hostname: string
}

class OAuthLocationFixture {
  private readonly browserLocation = window.location

  create(request: OAuthLocationFixtureRequest): Location {
    return new Proxy(this.browserLocation, {
      get: (target, property, receiver) => {
        if (property === 'origin') return request.origin
        if (property === 'hostname') return request.hostname
        return Reflect.get(target, property, receiver)
      },
    })
  }
}

const oauthLocationFixture = new OAuthLocationFixture()

describe('oauth origin support', () => {
  test('allows the configured Google stable, development, and local origins', () => {
    expect(
      resolveOAuthOriginSupport({
        provider: BrowserOAuthProvider.GoogleDrive,
        location: oauthLocationFixture.create({
          origin: 'https://simple.nokey.sh',
          hostname: 'simple.nokey.sh',
        }),
      }).supported,
    ).toBe(true)
    expect(
      resolveOAuthOriginSupport({
        provider: BrowserOAuthProvider.GoogleDrive,
        location: oauthLocationFixture.create({
          origin: 'https://sentinel.dev.nokey.sh',
          hostname: 'sentinel.dev.nokey.sh',
        }),
      }).supported,
    ).toBe(true)
    expect(
      resolveOAuthOriginSupport({
        provider: BrowserOAuthProvider.GoogleDrive,
        location: oauthLocationFixture.create({
          origin: 'https://localhost:5173',
          hostname: 'localhost',
        }),
      }).supported,
    ).toBe(true)
    expect(
      resolveOAuthOriginSupport({
        provider: BrowserOAuthProvider.GoogleDrive,
        location: oauthLocationFixture.create({
          origin: 'http://localhost:5173',
          hostname: 'localhost',
        }),
      }).supported,
    ).toBe(true)
    expect(
      resolveOAuthOriginSupport({
        provider: BrowserOAuthProvider.GoogleDrive,
        location: oauthLocationFixture.create({
          origin: 'http://127.0.0.1:5173',
          hostname: '127.0.0.1',
        }),
      }).supported,
    ).toBe(true)
  })

  test('allows the configured iCloud stable, development, and local HTTPS origins', () => {
    expect(
      resolveOAuthOriginSupport({
        provider: BrowserOAuthProvider.ICloud,
        location: oauthLocationFixture.create({
          origin: 'https://sentinel.nokey.sh',
          hostname: 'sentinel.nokey.sh',
        }),
      }).supported,
    ).toBe(true)
    expect(
      resolveOAuthOriginSupport({
        provider: BrowserOAuthProvider.ICloud,
        location: oauthLocationFixture.create({
          origin: 'https://simple.dev.nokey.sh',
          hostname: 'simple.dev.nokey.sh',
        }),
      }).supported,
    ).toBe(true)
    expect(
      resolveOAuthOriginSupport({
        provider: BrowserOAuthProvider.ICloud,
        location: oauthLocationFixture.create({
          origin: 'https://localhost:5173',
          hostname: 'localhost',
        }),
      }).supported,
    ).toBe(true)
    expect(
      resolveOAuthOriginSupport({
        provider: BrowserOAuthProvider.ICloud,
        location: oauthLocationFixture.create({
          origin: 'https://localhost:5175',
          hostname: 'localhost',
        }),
      }).supported,
    ).toBe(true)
  })

  test('does not authorize landing-only origins', () => {
    for (const origin of ['https://nokey.sh', 'https://dev.nokey.sh']) {
      const hostname = new URL(origin).hostname
      expect(
        resolveOAuthOriginSupport({
          provider: BrowserOAuthProvider.GoogleDrive,
          location: oauthLocationFixture.create({ origin, hostname }),
        }),
      ).toMatchObject({
        supported: false,
        reason: OAuthOriginUnsupportedReason.UnregisteredOrigin,
      })
      expect(
        resolveOAuthOriginSupport({
          provider: BrowserOAuthProvider.ICloud,
          location: oauthLocationFixture.create({ origin, hostname }),
        }),
      ).toMatchObject({
        supported: false,
        reason: OAuthOriginUnsupportedReason.UnregisteredOrigin,
      })
    }
  })

  test('blocks Cloudflare PR preview origins with a preview reason', () => {
    const support = resolveOAuthOriginSupport({
      provider: BrowserOAuthProvider.GoogleDrive,
      location: oauthLocationFixture.create({
        origin: 'https://pr-191.nook-1n8.pages.dev',
        hostname: 'pr-191.nook-1n8.pages.dev',
      }),
    })

    expect(support).toEqual({
      supported: false,
      origin: 'https://pr-191.nook-1n8.pages.dev',
      reason: OAuthOriginUnsupportedReason.CloudflarePrPreview,
    })
  })

  test('distinguishes non-preview unregistered origins', () => {
    expect(
      resolveOAuthOriginSupport({
        provider: BrowserOAuthProvider.ICloud,
        location: oauthLocationFixture.create({
          origin: 'http://localhost:5173',
          hostname: 'localhost',
        }),
      }),
    ).toEqual({
      supported: false,
      origin: 'http://localhost:5173',
      reason: OAuthOriginUnsupportedReason.UnregisteredOrigin,
    })
  })

  test('matches only Nook PR preview hosts', () => {
    for (const hostname of [
      'pr-191.nook-1n8.pages.dev',
      'pr-191.nokey-sh.pages.dev',
      'pr-191.nokey-simple.pages.dev',
      'pr-191.nokey-sentinel.pages.dev',
    ]) {
      expect(is_cloudflare_pr_preview_host(hostname)).toBe(true)
    }
    expect(is_cloudflare_pr_preview_host('preview.nook-1n8.pages.dev')).toBe(
      false,
    )
    expect(
      is_cloudflare_pr_preview_host('pr-191-site.nokey-sh.pages.dev'),
    ).toBe(false)
    expect(is_cloudflare_pr_preview_host('pr-191.example.pages.dev')).toBe(
      false,
    )
  })
})
