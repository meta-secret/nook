import { describe, expect, test } from 'bun:test'
import {
  isNookVaultAppUrl,
  isSentinelVaultHostname,
  isSimpleVaultHostname,
  matchingSentinelVaultBaseUrl,
  nookVaultAppExcludeMatchPatterns,
  sentinelVaultMatchPatterns,
} from '../src/lib/simple-vault-target'

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

describe('channel-agnostic Nook vault app hosts', () => {
  test('classifies Simple and Sentinel hostnames across channels', () => {
    expect(isSimpleVaultHostname('simple.nokey.sh')).toBe(true)
    expect(isSimpleVaultHostname('simple.dev.nokey.sh')).toBe(true)
    expect(isSimpleVaultHostname('pr-466.nokey-simple.pages.dev')).toBe(true)
    expect(isSimpleVaultHostname('dev.nokey.sh')).toBe(false)
    expect(isSimpleVaultHostname('example.com')).toBe(false)

    expect(isSentinelVaultHostname('sentinel.nokey.sh')).toBe(true)
    expect(isSentinelVaultHostname('sentinel.dev.nokey.sh')).toBe(true)
    expect(isSentinelVaultHostname('pr-466.nokey-sentinel.pages.dev')).toBe(
      true,
    )
    expect(isSentinelVaultHostname('simple.dev.nokey.sh')).toBe(false)
  })

  test('excludes every vault channel from a production-built extension', () => {
    const exclusions = nookVaultAppExcludeMatchPatterns(
      'https://simple.nokey.sh/',
    )
    expect(exclusions).toContain('https://simple.nokey.sh/*')
    expect(exclusions).toContain('https://simple.dev.nokey.sh/*')
    expect(exclusions).toContain('https://sentinel.nokey.sh/*')
    expect(exclusions).toContain('https://sentinel.dev.nokey.sh/*')
    expect(exclusions).toContain('https://*.nokey-simple.pages.dev/*')
    expect(exclusions).toContain('https://*.nokey-sentinel.pages.dev/*')
  })

  test('runtime URL check ignores build channel mismatch', () => {
    expect(isNookVaultAppUrl('https://simple.dev.nokey.sh/unlock')).toBe(true)
    expect(
      isNookVaultAppUrl(
        'https://simple.dev.nokey.sh/unlock',
        'https://simple.nokey.sh/',
      ),
    ).toBe(true)
    expect(
      isNookVaultAppUrl(
        'https://pr-466.nokey-simple.pages.dev/',
        'https://simple.dev.nokey.sh/',
      ),
    ).toBe(true)
    expect(
      isNookVaultAppUrl('https://example.com/login', 'https://simple.nokey.sh/'),
    ).toBe(false)
  })

  test('keeps legacy shared-host path exclusions for the configured base', () => {
    const exclusions = nookVaultAppExcludeMatchPatterns(
      'https://pr-408.nook-1n8.pages.dev/simple/',
    )
    expect(exclusions).toContain('https://pr-408.nook-1n8.pages.dev/simple/*')
    expect(exclusions).toContain('https://pr-408.nook-1n8.pages.dev/sentinel/*')
    expect(
      isNookVaultAppUrl(
        'https://pr-408.nook-1n8.pages.dev/simple/',
        'https://pr-408.nook-1n8.pages.dev/simple/',
      ),
    ).toBe(true)
  })
})
