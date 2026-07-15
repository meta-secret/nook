import { describe, expect, test } from 'vitest'
import {
  isCloudflarePrPreviewHost,
  resolveOAuthOriginSupport,
} from '$lib/oauth-origin'

function loc(origin: string, hostname: string) {
  return { origin, hostname } as Location
}

describe('oauth origin support', () => {
  test('allows the configured Google stable, development, and local origins', () => {
    expect(
      resolveOAuthOriginSupport(
        'google-drive',
        loc('https://simple.nokey.sh', 'simple.nokey.sh'),
      ).supported,
    ).toBe(true)
    expect(
      resolveOAuthOriginSupport(
        'google-drive',
        loc('https://sentinel.dev.nokey.sh', 'sentinel.dev.nokey.sh'),
      ).supported,
    ).toBe(true)
    expect(
      resolveOAuthOriginSupport(
        'google-drive',
        loc('http://localhost:5173', 'localhost'),
      ).supported,
    ).toBe(true)
    expect(
      resolveOAuthOriginSupport(
        'google-drive',
        loc('http://127.0.0.1:5173', '127.0.0.1'),
      ).supported,
    ).toBe(true)
  })

  test('allows the configured iCloud stable and development origins', () => {
    expect(
      resolveOAuthOriginSupport(
        'icloud',
        loc('https://sentinel.nokey.sh', 'sentinel.nokey.sh'),
      ).supported,
    ).toBe(true)
    expect(
      resolveOAuthOriginSupport(
        'icloud',
        loc('https://simple.dev.nokey.sh', 'simple.dev.nokey.sh'),
      ).supported,
    ).toBe(true)
  })

  test('does not authorize landing-only origins', () => {
    for (const origin of ['https://nokey.sh', 'https://dev.nokey.sh']) {
      const hostname = new URL(origin).hostname
      expect(
        resolveOAuthOriginSupport('google-drive', loc(origin, hostname)),
      ).toMatchObject({ supported: false, reason: 'unregistered-origin' })
      expect(
        resolveOAuthOriginSupport('icloud', loc(origin, hostname)),
      ).toMatchObject({ supported: false, reason: 'unregistered-origin' })
    }
  })

  test('blocks Cloudflare PR preview origins with a preview reason', () => {
    const support = resolveOAuthOriginSupport(
      'google-drive',
      loc('https://pr-191.nook-1n8.pages.dev', 'pr-191.nook-1n8.pages.dev'),
    )

    expect(support).toEqual({
      supported: false,
      origin: 'https://pr-191.nook-1n8.pages.dev',
      reason: 'cloudflare-pr-preview',
    })
  })

  test('distinguishes non-preview unregistered origins', () => {
    expect(
      resolveOAuthOriginSupport(
        'icloud',
        loc('http://localhost:5173', 'localhost'),
      ),
    ).toEqual({
      supported: false,
      origin: 'http://localhost:5173',
      reason: 'unregistered-origin',
    })
  })

  test('matches only Nook PR preview hosts', () => {
    for (const hostname of [
      'pr-191.nook-1n8.pages.dev',
      'pr-191.nokey-sh.pages.dev',
      'pr-191.nokey-simple.pages.dev',
      'pr-191.nokey-sentinel.pages.dev',
    ]) {
      expect(isCloudflarePrPreviewHost(hostname)).toBe(true)
    }
    expect(isCloudflarePrPreviewHost('preview.nook-1n8.pages.dev')).toBe(false)
    expect(isCloudflarePrPreviewHost('pr-191-site.nokey-sh.pages.dev')).toBe(
      false,
    )
    expect(isCloudflarePrPreviewHost('pr-191.example.pages.dev')).toBe(false)
  })
})
