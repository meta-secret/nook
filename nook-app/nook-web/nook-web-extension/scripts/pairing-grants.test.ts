import { describe, expect, mock, test } from 'bun:test'
import type { StoredExtensionPairingGrant } from '../src/background/pairing-grants'
import {
  extensionPairingGrantPolicyReady,
  extensionSessionGrantIdentity,
} from '../src/background/pairing-grants'

Object.assign(globalThis, {
  __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
})
const {
  importLocalEventLogUpdateWithDependencies,
  LocalEventLogUpdateFailure,
} = await import('../src/background/service-worker/pairing-import')

const storedGrant: StoredExtensionPairingGrant = {
  vaultType: 'simple',
  vaultStoreId: 'vault',
  deviceId: 'device',
  devicePublicKey: 'public',
  deviceSigningPublicKey: 'signing',
  vaultName: 'Private vault',
  deviceLabel: 'Laptop',
  approvedAt: '2026-08-10T00:00:00Z',
  scopes: ['password-filling'],
  syncProviderCount: 0,
  eventCount: 1,
  eventLogHeads: ['event-1'],
  lastLocalSyncAt: '2026-08-10T00:00:00Z',
}

describe('extension pairing grant transport', () => {
  test('transports every Rust authority variant and the authorized grant', async () => {
    const policy = await extensionPairingGrantPolicyReady
    const key = policy.pairingGrantStorageKey(storedGrant.vaultStoreId)
    expect(
      policy.classifyGrantAuthority({ stored: {}, vaultStoreId: 'vault' }),
    ).toEqual({ kind: 'NoMatchingAuthority' })
    expect(
      policy.classifyGrantAuthority({
        stored: { [key]: { ...storedGrant, vaultStoreId: 'other-vault' } },
        vaultStoreId: 'vault',
      }),
    ).toEqual({ kind: 'InvalidStoredAuthority' })
    expect(
      policy.classifyGrantAuthority({
        stored: { [key]: storedGrant },
        vaultStoreId: 'vault',
      }),
    ).toEqual({ kind: 'Authorized', grant: storedGrant })
  })
  test.each(['absent', 'malformed', 'policy-unavailable'] as const)(
    'rejects %s before importing or updating a session',
    async (scenario) => {
      const policy = await extensionPairingGrantPolicyReady
      const key = policy.pairingGrantStorageKey('unpaired-vault')
      const loadPairingStorage = mock(() =>
        Promise.resolve(
          scenario === 'malformed'
            ? { [key]: {} as StoredExtensionPairingGrant }
            : {},
        ),
      )
      const unusedOperation = mock(() =>
        Promise.reject(new Error('must not run')),
      )
      const response = await importLocalEventLogUpdateWithDependencies({
        vaultStoreId: 'unpaired-vault',
        eventLogRecords: [],
        loadPairingStorage,
        pairingPolicyReady:
          scenario === 'policy-unavailable'
            ? Promise.reject(new Error('policy unavailable'))
            : extensionPairingGrantPolicyReady,
        importEventLog: unusedOperation,
        sendSession: unusedOperation,
      })
      expect(response).toEqual({
        ok: false,
        reason:
          scenario === 'absent'
            ? LocalEventLogUpdateFailure.VaultNotPaired
            : LocalEventLogUpdateFailure.EventLogImportFailed,
      })
      expect(unusedOperation).not.toHaveBeenCalled()
    },
  )
  test('rejects an absent grant before invoking a WASM string guard', async () => {
    const policy = await extensionPairingGrantPolicyReady
    const storageSnapshot: Partial<{
      grant: StoredExtensionPairingGrant
    }> = {}

    expect(policy.isStoredExtensionPairingGrant(storageSnapshot.grant)).toBe(
      false,
    )
  })

  test('projects only session identity fields from stored grants', () => {
    expect(extensionSessionGrantIdentity(storedGrant)).toEqual({
      vaultStoreId: 'vault',
      deviceId: 'device',
      devicePublicKey: 'public',
      deviceSigningPublicKey: 'signing',
    })
  })
})
