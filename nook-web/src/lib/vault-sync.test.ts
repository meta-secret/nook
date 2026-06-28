import { describe, expect, test } from 'vitest'
import { parseVaultStoreIdMismatch } from './vault-sync'

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
