import { describe, expect, test } from 'vitest'
import {
  parseVaultStoreIdMismatch,
  resolveVaultSyncIntervalMs,
} from './vault-sync'

describe('vault-sync store_id mismatch', () => {
  test('parseVaultStoreIdMismatch extracts store ids from core error text', () => {
    expect(
      parseVaultStoreIdMismatch(
        new Error(
          'Vault store_id mismatch: local store_EtQJDMbyQIM, remote store_1apFkCpgvTQ',
        ),
      ),
    ).toEqual({
      localStoreId: 'store_EtQJDMbyQIM',
      remoteStoreId: 'store_1apFkCpgvTQ',
    })
  })

  test('parseVaultStoreIdMismatch returns null for unrelated errors', () => {
    expect(parseVaultStoreIdMismatch(new Error('other'))).toBeNull()
  })
})

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
