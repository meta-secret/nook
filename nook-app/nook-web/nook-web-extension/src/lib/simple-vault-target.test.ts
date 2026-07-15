import { describe, expect, test } from 'bun:test'
import {
  matchingSentinelVaultBaseUrl,
  sentinelVaultMatchPatterns,
} from './simple-vault-target'

describe('Sentinel deployment exclusions', () => {
  test('derives the isolated production and development Sentinel origins', () => {
    expect(matchingSentinelVaultBaseUrl('https://simple.dev.nokey.sh/')).toBe(
      'https://sentinel.dev.nokey.sh/',
    )
    expect(sentinelVaultMatchPatterns('https://simple.nokey.sh/')).toContain(
      'https://sentinel.nokey.sh/*',
    )
    expect(
      sentinelVaultMatchPatterns('https://simple.dev.nokey.sh/'),
    ).toContain('https://sentinel.dev.nokey.sh/*')
  })

  test('derives the matching per-PR Sentinel origin', () => {
    expect(
      sentinelVaultMatchPatterns('https://pr-408.nokey-simple.pages.dev/'),
    ).toContain('https://pr-408.nokey-sentinel.pages.dev/*')
  })

  test('preserves legacy shared-host path isolation', () => {
    expect(
      sentinelVaultMatchPatterns('https://pr-408.nook-1n8.pages.dev/simple/'),
    ).toContain('https://pr-408.nook-1n8.pages.dev/sentinel/*')
  })
})
