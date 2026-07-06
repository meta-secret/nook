import { describe, expect, test } from 'vitest'
import { resolveVaultSyncIntervalMs } from '$lib/vault-sync'

describe('resolveVaultSyncIntervalMs', () => {
  test('production build ignores fast-sync env and uses 60s', () => {
    expect(
      resolveVaultSyncIntervalMs({
        VITE_VAULT_SYNC_INTERVAL_MS: '1000',
      }),
    ).toBe(60_000)
  })

  test('e2e build honors VITE_VAULT_SYNC_INTERVAL_MS', () => {
    expect(
      resolveVaultSyncIntervalMs({
        VITE_E2E_EXPOSE_VAULT: 'true',
        VITE_VAULT_SYNC_INTERVAL_MS: '1000',
      }),
    ).toBe(1000)
  })

  test('dev mode honors VITE_VAULT_SYNC_INTERVAL_MS', () => {
    expect(
      resolveVaultSyncIntervalMs({
        DEV: true,
        VITE_VAULT_SYNC_INTERVAL_MS: '500',
      }),
    ).toBe(500)
  })
})
