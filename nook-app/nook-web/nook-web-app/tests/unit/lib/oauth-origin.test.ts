import { describe, expect, test } from 'vitest'
import {
  isCloudflarePrPreviewHost,
  resolveOAuthOriginSupport,
} from '$lib/oauth-origin'

function loc(origin: string, hostname: string) {
  return { origin, hostname } as Location
}

describe('oauth origin support', () => {
  test('allows the configured Google production and local origins', () => {
    expect(
      resolveOAuthOriginSupport(
        'google-drive',
        loc('https://nokey.sh', 'nokey.sh'),
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
    expect(isCloudflarePrPreviewHost('pr-191.nook-1n8.pages.dev')).toBe(true)
    expect(isCloudflarePrPreviewHost('preview.nook-1n8.pages.dev')).toBe(false)
    expect(isCloudflarePrPreviewHost('pr-191.example.pages.dev')).toBe(false)
  })
})
