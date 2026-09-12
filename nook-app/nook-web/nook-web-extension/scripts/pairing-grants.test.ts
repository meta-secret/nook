import { describe, expect, mock, test } from 'bun:test'
import { err, ok } from 'neverthrow'
import {
  decode_extension_grant_authority_response,
  type ExtensionGrantAuthority,
} from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { ExtensionPairingApprovedMessageAdmissionFailure } from '../../nook-web-shared/src/extension/runtime-messages'
import { ExtensionSessionMessageType } from '../src/lib/extension-session-message-type'
import type { StoredExtensionPairingGrant } from '../src/background/pairing-grants'
import {
  ExtensionSessionTransportFailure,
  ExtensionSessionTransportFailureKind,
} from '../src/background/service-worker/session-document'
import {
  extensionPairingGrantPolicyReady,
  extensionSessionGrantIdentity,
} from '../src/background/pairing-grants'

Object.assign(globalThis, {
  __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
})
const {
  ExtensionPairingIngress,
  importLocalEventLogUpdateWithDependencies,
  LocalEventLogUpdateFailure,
  PairingIngressFailure,
} = await import('../src/background/service-worker/pairing-import')
const { classifySessionGrantAuthority } =
  await import('../src/offscreen/session-operations')
type ImportDependencies = Parameters<
  typeof importLocalEventLogUpdateWithDependencies
>[0]

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
  test('reports companion runtime startup failure before grant admission', async () => {
    const ingress = new ExtensionPairingIngress(
      Promise.reject(new Error('runtime unavailable')),
    )

    const admission = await ingress.admit({})
    expect('reason' in admission).toBe(true)
    if ('reason' in admission) {
      expect(admission.reason).toBe(PairingIngressFailure.RuntimeUnavailable)
    }
  })

  test('rejects malformed grants after companion runtime startup', async () => {
    const ingress = new ExtensionPairingIngress(Promise.resolve())

    const admission = await ingress.admit({})
    expect('reason' in admission).toBe(true)
    if ('reason' in admission) {
      expect(admission.reason).toBe(
        ExtensionPairingApprovedMessageAdmissionFailure.MessageEnvelope,
      )
    }
  })

  test.each(['created', 'failed'] as const)(
    'ensures a closed receiver before classification: %s',
    async (receiver) => {
      const policy = await extensionPairingGrantPolicyReady
      const key = policy.pairingGrantStorageKey(storedGrant.vaultStoreId)
      const events: string[] = []
      const response = await importLocalEventLogUpdateWithDependencies({
        vaultStoreId: storedGrant.vaultStoreId,
        eventLogRecords: [],
        loadPairingStorage: async () => ({ [key]: storedGrant }),
        pairingPolicyReady: extensionPairingGrantPolicyReady,
        ensureSession: async () => {
          events.push('ensure')
          if (receiver === 'failed') throw new Error('receiver unavailable')
          return ok()
        },
        importEventLog: async () => {
          events.push('import')
          return {
            vaultStoreId: storedGrant.vaultStoreId,
            accessGranted: true,
            eventCount: 1,
            heads: ['event-1'],
          }
        },
        persistPairingStorage: async () => {
          events.push('persist')
        },
        sendSession: async (message) => {
          if (!message || typeof message !== 'object' || !('type' in message)) {
            throw new Error('expected a typed session request')
          }
          if (
            message.type === ExtensionSessionMessageType.ClassifyGrantAuthority
          ) {
            expect(events).toEqual(['ensure'])
            events.push('classify')
            return ok({ kind: 'Authorized', grant: storedGrant })
          }
          expect(message.type).toBe(ExtensionSessionMessageType.UpdateVault)
          events.push('update')
          return ok({ ok: true })
        },
      })
      expect(events).toEqual(
        receiver === 'created'
          ? ['ensure', 'classify', 'import', 'persist', 'update']
          : ['ensure'],
      )
      expect(response).toEqual(
        receiver === 'created'
          ? { ok: true, eventCount: 1 }
          : {
              ok: false,
              reason: LocalEventLogUpdateFailure.EventLogImportFailed,
            },
      )
    },
  )
  test('reports a failed local session update transport', async () => {
    const policy = await extensionPairingGrantPolicyReady
    const key = policy.pairingGrantStorageKey(storedGrant.vaultStoreId)
    const sendSession = mock(
      async (message: Parameters<ImportDependencies['sendSession']>[0]) => {
        if (!message || typeof message !== 'object' || !('type' in message)) {
          throw new Error('expected a typed session request')
        }
        if (
          message.type === ExtensionSessionMessageType.ClassifyGrantAuthority
        ) {
          return ok({ kind: 'Authorized' as const, grant: storedGrant })
        }
        expect(message.type).toBe(ExtensionSessionMessageType.UpdateVault)
        return err(
          new ExtensionSessionTransportFailure(
            ExtensionSessionTransportFailureKind.DeliveryFailed,
          ),
        )
      },
    )
    const response = await importLocalEventLogUpdateWithDependencies({
      vaultStoreId: storedGrant.vaultStoreId,
      eventLogRecords: [],
      loadPairingStorage: async () => ({ [key]: storedGrant }),
      pairingPolicyReady: extensionPairingGrantPolicyReady,
      ensureSession: async () => ok(),
      importEventLog: async () => ({
        vaultStoreId: storedGrant.vaultStoreId,
        accessGranted: true,
        eventCount: 1,
        heads: ['event-1'],
      }),
      persistPairingStorage: async () => {},
      sendSession,
    })

    expect(response).toEqual({
      ok: false,
      reason: LocalEventLogUpdateFailure.EventLogImportFailed,
    })
    expect(sendSession).toHaveBeenCalledTimes(2)
  })
  test('rejects malformed and wrong-target manager responses', async () => {
    await extensionPairingGrantPolicyReady
    for (const response of [
      {},
      { kind: 'Authorized', grant: { ...storedGrant, vaultStoreId: 'other' } },
    ]) {
      expect(() =>
        decode_extension_grant_authority_response(
          JSON.stringify(response),
          'vault',
        ),
      ).toThrow()
    }
  })

  test('propagates manager projection failure without substituting no active vault', () => {
    const manager = {
      classify_extension_grant_authority: () => {
        throw new Error('projection unavailable')
      },
    }
    expect(() =>
      classifySessionGrantAuthority({
        manager,
        payload: {
          stored_json: '{}',
          vault_store_id: 'vault',
          queue: { kind: 'message-default' },
        },
      }),
    ).toThrow('projection unavailable')
  })
  test.each([
    { kind: 'NoMatchingAuthority' },
    { kind: 'MissingActiveAuthority' },
    { kind: 'InvalidStoredAuthority' },
    { kind: 'Authorized', grant: storedGrant },
  ] satisfies ExtensionGrantAuthority[])(
    'transports manager authority %j',
    async (authority) => {
      await extensionPairingGrantPolicyReady
      const classify = mock(() => authority)
      const manager = {
        classify_extension_grant_authority: classify,
      }
      const result = classifySessionGrantAuthority({
        manager,
        payload: {
          stored_json: '{}',
          vault_store_id: 'vault',
          queue: { kind: 'message-default' },
        },
      })
      expect(classify).toHaveBeenCalledWith('{}', 'vault')
      expect(
        decode_extension_grant_authority_response(
          JSON.stringify(result),
          'vault',
        ),
      ).toEqual(authority)
    },
  )
  test.each([
    'absent',
    'malformed',
    'policy-unavailable',
    'missing-active',
    'transport-failed',
    'malformed-response',
    'serialization-failed',
  ] as const)(
    'rejects %s before importing or updating a session',
    async (scenario) => {
      const policy = await extensionPairingGrantPolicyReady
      const key = policy.pairingGrantStorageKey('unpaired-vault')
      const loadPairingStorage = mock(() =>
        scenario === 'serialization-failed'
          ? Promise.resolve(
              new Proxy(
                {},
                {
                  ownKeys: () => {
                    throw new Error('serialization unavailable')
                  },
                },
              ),
            )
          : Promise.resolve(
              scenario === 'malformed'
                ? { [key]: {} as StoredExtensionPairingGrant }
                : {},
            ),
      )
      const unusedOperation = mock(() =>
        Promise.reject(new Error('must not run')),
      )
      const sendSession = mock(
        async (message: Parameters<ImportDependencies['sendSession']>[0]) => {
          if (!message || typeof message !== 'object' || !('type' in message)) {
            throw new Error('expected a typed session request')
          }
          expect(message.type).toBe(
            ExtensionSessionMessageType.ClassifyGrantAuthority,
          )
          if (
            message.type !== ExtensionSessionMessageType.ClassifyGrantAuthority
          )
            throw new Error('unexpected session update')
          if (scenario === 'transport-failed') {
            return err(
              new ExtensionSessionTransportFailure(
                ExtensionSessionTransportFailureKind.DeliveryFailed,
              ),
            )
          }
          if (scenario === 'malformed-response') return ok({})
          if (!('payload' in message)) {
            throw new Error('expected a session request payload')
          }
          expect(message.payload).toEqual({
            stored_json: JSON.stringify(await loadPairingStorage()),
            vault_store_id: 'unpaired-vault',
            queue: { kind: 'message-default' },
          })
          return ok({
            kind:
              scenario === 'missing-active'
                ? 'MissingActiveAuthority'
                : scenario === 'malformed'
                  ? 'InvalidStoredAuthority'
                  : 'NoMatchingAuthority',
          })
        },
      )
      const response = await importLocalEventLogUpdateWithDependencies({
        ensureSession: async () => ok(),
        persistPairingStorage: unusedOperation,
        vaultStoreId: 'unpaired-vault',
        eventLogRecords: [],
        loadPairingStorage,
        pairingPolicyReady:
          scenario === 'policy-unavailable'
            ? Promise.reject(new Error('policy unavailable'))
            : extensionPairingGrantPolicyReady,
        importEventLog: unusedOperation,
        sendSession,
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
  test('compares migration records through the typed Rust policy', async () => {
    const policy = await extensionPairingGrantPolicyReady
    const { vaultName, ...otherFields } = storedGrant
    expect(
      policy.compare_extension_pairing_records({
        current: storedGrant,
        migrated: { ...otherFields, vaultName },
      }),
    ).toBe('Equivalent')
    expect(
      policy.compare_extension_pairing_records({
        current: storedGrant,
        migrated: { ...storedGrant, vaultName: 'Changed' },
      }),
    ).toBe('Different')
  })
})
