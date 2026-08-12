import { companionWasmReady } from '../../nook-web-shared/src/extension/companion-ready'

await companionWasmReady
import { describe, expect, test } from 'bun:test'
import {
  is_nook_vault_app_url,
  is_sentinel_vault_hostname,
  is_simple_vault_hostname,
  nook_vault_app_exclude_match_patterns,
  sentinel_vault_match_patterns,
} from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { sentinelVaultBaseUrl } from '../src/lib/simple-vault-target'

describe('Sentinel deployment exclusions', () => {
  test('derives the isolated production and development Sentinel origins', () => {
    expect(sentinelVaultBaseUrl('https://simple.dev.nokey.sh/')).toBe(
      'https://sentinel.dev.nokey.sh/',
    )
    expect(sentinel_vault_match_patterns('https://simple.nokey.sh/')).toContain(
      'https://sentinel.nokey.sh/*',
    )
    expect(
      sentinel_vault_match_patterns('https://simple.dev.nokey.sh/'),
    ).toContain('https://sentinel.dev.nokey.sh/*')
  })

  test('derives the matching per-PR Sentinel origin', () => {
    expect(sentinelVaultBaseUrl('https://pr-408.nokey-simple.pages.dev/')).toBe(
      'https://pr-408.nokey-sentinel.pages.dev/',
    )
    expect(
      sentinel_vault_match_patterns('https://pr-408.nokey-simple.pages.dev/'),
    ).toContain('https://pr-408.nokey-sentinel.pages.dev/*')
  })

  test('preserves legacy shared-host path isolation', () => {
    expect(
      sentinel_vault_match_patterns(
        'https://pr-408.nook-1n8.pages.dev/simple/',
      ),
    ).toContain('https://pr-408.nook-1n8.pages.dev/sentinel/*')
  })
})

describe('channel-agnostic Nook vault app hosts', () => {
  test('classifies Simple and Sentinel hostnames across channels', () => {
    expect(is_simple_vault_hostname('simple.nokey.sh')).toBe(true)
    expect(is_simple_vault_hostname('simple.dev.nokey.sh')).toBe(true)
    expect(is_simple_vault_hostname('pr-466.nokey-simple.pages.dev')).toBe(true)
    expect(is_simple_vault_hostname('dev.nokey.sh')).toBe(false)
    expect(is_simple_vault_hostname('example.com')).toBe(false)

    expect(is_sentinel_vault_hostname('sentinel.nokey.sh')).toBe(true)
    expect(is_sentinel_vault_hostname('sentinel.dev.nokey.sh')).toBe(true)
    expect(is_sentinel_vault_hostname('pr-466.nokey-sentinel.pages.dev')).toBe(
      true,
    )
    expect(is_sentinel_vault_hostname('simple.dev.nokey.sh')).toBe(false)
  })

  test('excludes every vault channel from a production-built extension', () => {
    const exclusions = nook_vault_app_exclude_match_patterns(
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
    expect(
      is_nook_vault_app_url('https://simple.dev.nokey.sh/unlock', ''),
    ).toBe(true)
    expect(
      is_nook_vault_app_url(
        'https://simple.dev.nokey.sh/unlock',
        'https://simple.nokey.sh/',
      ),
    ).toBe(true)
    expect(
      is_nook_vault_app_url(
        'https://pr-466.nokey-simple.pages.dev/',
        'https://simple.dev.nokey.sh/',
      ),
    ).toBe(true)
    expect(
      is_nook_vault_app_url(
        'https://example.com/login',
        'https://simple.nokey.sh/',
      ),
    ).toBe(false)
  })

  test('keeps legacy shared-host path exclusions for the configured base', () => {
    const exclusions = nook_vault_app_exclude_match_patterns(
      'https://pr-408.nook-1n8.pages.dev/simple/',
    )
    expect(exclusions).toContain('https://pr-408.nook-1n8.pages.dev/simple/*')
    expect(exclusions).toContain('https://pr-408.nook-1n8.pages.dev/sentinel/*')
    expect(
      is_nook_vault_app_url(
        'https://pr-408.nook-1n8.pages.dev/simple/',
        'https://pr-408.nook-1n8.pages.dev/simple/',
      ),
    ).toBe(true)
  })
})
