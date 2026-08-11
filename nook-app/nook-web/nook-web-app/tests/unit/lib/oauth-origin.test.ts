import { describe, expect, test } from 'vitest'
import {
  BrowserOAuthProvider,
  is_cloudflare_pr_preview_host,
  OAuthOriginUnsupportedReason,
  resolveOAuthOriginSupport,
} from '$lib/auth/oauth-origin'

function loc(origin: string, hostname: string) {
  return { origin, hostname } as Location
}

describe('oauth origin support', () => {
  test('allows the configured Google stable, development, and local origins', () => {
    expect(
      resolveOAuthOriginSupport({
        provider: BrowserOAuthProvider.GoogleDrive,
        location: loc('https://simple.nokey.sh', 'simple.nokey.sh'),
      }).supported,
    ).toBe(true)
    expect(
      resolveOAuthOriginSupport({
        provider: BrowserOAuthProvider.GoogleDrive,
        location: loc('https://sentinel.dev.nokey.sh', 'sentinel.dev.nokey.sh'),
      }).supported,
    ).toBe(true)
    expect(
      resolveOAuthOriginSupport({
        provider: BrowserOAuthProvider.GoogleDrive,
        location: loc('https://localhost:5173', 'localhost'),
      }).supported,
    ).toBe(true)
    expect(
      resolveOAuthOriginSupport({
        provider: BrowserOAuthProvider.GoogleDrive,
        location: loc('http://localhost:5173', 'localhost'),
      }).supported,
    ).toBe(true)
    expect(
      resolveOAuthOriginSupport({
        provider: BrowserOAuthProvider.GoogleDrive,
        location: loc('http://127.0.0.1:5173', '127.0.0.1'),
      }).supported,
    ).toBe(true)
  })

  test('allows the configured iCloud stable, development, and local HTTPS origins', () => {
    expect(
      resolveOAuthOriginSupport({
        provider: BrowserOAuthProvider.ICloud,
        location: loc('https://sentinel.nokey.sh', 'sentinel.nokey.sh'),
      }).supported,
    ).toBe(true)
    expect(
      resolveOAuthOriginSupport({
        provider: BrowserOAuthProvider.ICloud,
        location: loc('https://simple.dev.nokey.sh', 'simple.dev.nokey.sh'),
      }).supported,
    ).toBe(true)
    expect(
      resolveOAuthOriginSupport({
        provider: BrowserOAuthProvider.ICloud,
        location: loc('https://localhost:5173', 'localhost'),
      }).supported,
    ).toBe(true)
    expect(
      resolveOAuthOriginSupport({
        provider: BrowserOAuthProvider.ICloud,
        location: loc('https://localhost:5175', 'localhost'),
      }).supported,
    ).toBe(true)
  })

  test('does not authorize landing-only origins', () => {
    for (const origin of ['https://nokey.sh', 'https://dev.nokey.sh']) {
      const hostname = new URL(origin).hostname
      expect(
        resolveOAuthOriginSupport({
          provider: BrowserOAuthProvider.GoogleDrive,
          location: loc(origin, hostname),
        }),
      ).toMatchObject({
        supported: false,
        reason: OAuthOriginUnsupportedReason.UnregisteredOrigin,
      })
      expect(
        resolveOAuthOriginSupport({
          provider: BrowserOAuthProvider.ICloud,
          location: loc(origin, hostname),
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
      location: loc(
        'https://pr-191.nook-1n8.pages.dev',
        'pr-191.nook-1n8.pages.dev',
      ),
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
        location: loc('http://localhost:5173', 'localhost'),
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
