import { describe, expect, mock, spyOn, test } from 'bun:test'
import { err, ok, type Result } from 'neverthrow'
import { Effect } from 'effect'
import {
  decode_extension_grant_authority_response,
  NookPairingVaultId,
  type ExtensionGrantAuthority,
} from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  ExtensionPairingApprovedGrantAdmission,
  ExtensionPairingApprovedMessageAdmissionFailure,
  ExtensionStorageProviderPayloadAdmission,
  RuntimeMessageDecodeFailureKind,
} from '../../nook-web-shared/src/extension/runtime-messages'
import { ExtensionSessionMessageType } from '../src/lib/extension-session-message-type'
import type { StoredExtensionPairingGrant } from '../src/background/pairing-grants'
import {
  ExtensionSessionTransportFailure,
  ExtensionSessionTransportFailureKind,
  type ExtensionSessionTransport,
  type ExtensionSessionTransportResult,
} from '../src/background/service-worker/session-document'
import type { ExtensionSessionResponse } from '../src/offscreen/session'
import type { ExtensionSessionTransportRequest } from '../src/offscreen/session-request-adapter'
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
const unusedSessionTransport: ExtensionSessionTransport = {
  sendMessage: async () => {
    throw new Error('pairing fixture session transport must not send directly')
  },
}

type PairingSessionTransportFixtureArgs = {
  deliver: (
    message: ExtensionSessionTransportRequest,
  ) => Promise<ExtensionSessionTransportResult<ExtensionSessionResponse>>
}

class PairingSessionTransportFixture implements ExtensionSessionTransport {
  deliveryCount = 0

  constructor(private readonly args: PairingSessionTransportFixtureArgs) {}

  sendMessage(
    message: ExtensionSessionTransportRequest,
  ): Promise<ExtensionSessionTransportResult<ExtensionSessionResponse>>
  sendMessage<Response, DecodeFailure>(
    message: ExtensionSessionTransportRequest,
    decodeResponse: (
      response: ExtensionSessionResponse,
    ) => Result<Response, DecodeFailure>,
  ): Promise<ExtensionSessionTransportResult<Response, DecodeFailure>>
  async sendMessage<Response = ExtensionSessionResponse, DecodeFailure = never>(
    message: ExtensionSessionTransportRequest,
    decodeResponse?: (
      response: ExtensionSessionResponse,
    ) => Result<Response, DecodeFailure>,
  ): Promise<
    | ExtensionSessionTransportResult<ExtensionSessionResponse>
    | ExtensionSessionTransportResult<Response, DecodeFailure>
  > {
    this.deliveryCount += 1
    const delivery = await this.args.deliver(message)
    if (delivery.isErr())
      return err<Response, ExtensionSessionTransportFailure | DecodeFailure>(
        delivery.error,
      )
    if (!decodeResponse) return delivery
    return decodeResponse(delivery.value)
  }
}

const storedGrant: StoredExtensionPairingGrant = {
  vaultType: 'simple',
  vaultStoreId: 'store_abcdefghijk',
  deviceId: 'device',
  devicePublicKey: 'public',
  deviceSigningPublicKey: 'signing',
  vaultName: 'Private vault',
  deviceLabel: 'Laptop',
  approvedAt: 1_786_320_000_000,
  scopes: ['password-filling'],
  syncProviderCount: 0,
  eventCount: 1,
  eventLogHeads: ['event-1'],
  lastLocalSyncAt: '2026-08-10T00:00:00Z',
}

describe('extension pairing grant transport', () => {
  test('rejects a non-string vault type at the browser wire boundary', () => {
    const admission = ExtensionPairingApprovedGrantAdmission.parse({
      vaultType: 7,
    })

    expect(admission).toEqual(
      err(ExtensionPairingApprovedMessageAdmissionFailure.VaultType),
    )
  })

  test('admits only complete structured-cloneable provider payloads', () => {
    const complete = {
      id: 'github',
      type: 'github',
      label: 'Personal GitHub',
      githubPat: { state: 'missing' },
      githubRepo: { state: 'defaultRepository' },
      oauthFile: { state: 'notApplicable' },
      localFolder: { state: 'notApplicable' },
      storeId: { state: 'unscoped' },
      createdAt: '2026-08-10T00:00:00Z',
    }

    expect(
      new ExtensionStorageProviderPayloadAdmission(complete).parse().isOk(),
    ).toBe(true)
    const missingCreatedAt = Object.fromEntries(
      Object.entries(complete).filter(([key]) => key !== 'createdAt'),
    )
    expect(
      new ExtensionStorageProviderPayloadAdmission(missingCreatedAt)
        .parse()
        .isErr(),
    ).toBe(true)
    expect(
      new ExtensionStorageProviderPayloadAdmission({
        ...complete,
        githubPat: () => 'not cloneable',
      })
        .parse()
        .isErr(),
    ).toBe(true)
  })

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
      expect(admission.reason).toHaveProperty(
        'kind',
        RuntimeMessageDecodeFailureKind.ExtensionPairingApprovedMessage,
      )
    }
  })

  test.each(['created', 'failed'] as const)(
    'ensures a closed receiver before classification: %s',
    async (receiver) => {
      const policy = await extensionPairingGrantPolicyReady
      const key = policy.pairingGrantStorageKey(storedGrant.vaultStoreId)
      const events: string[] = []
      const freePairingVaultId = spyOn(NookPairingVaultId.prototype, 'free')
      const session = new PairingSessionTransportFixture({
        deliver: async (message) => {
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
      const response = await importLocalEventLogUpdateWithDependencies({
        vaultStoreId: storedGrant.vaultStoreId,
        eventLogRecords: [],
        loadPairingStorage: async () => ({ [key]: storedGrant }),
        pairingPolicyReady: extensionPairingGrantPolicyReady,
        ensureSession: async () => {
          events.push('ensure')
          if (receiver === 'failed') throw new Error('receiver unavailable')
          return ok(unusedSessionTransport)
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
        sendSession: session.sendMessage.bind(session),
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
      expect(freePairingVaultId).toHaveBeenCalledTimes(
        receiver === 'created' ? 1 : 0,
      )
      freePairingVaultId.mockRestore()
    },
  )
  test.each(['result-error', 'promise-rejection'] as const)(
    'reports a failed local session update transport: %s',
    async (scenario) => {
      const policy = await extensionPairingGrantPolicyReady
      const key = policy.pairingGrantStorageKey(storedGrant.vaultStoreId)
      const session = new PairingSessionTransportFixture({
        deliver: async (message) => {
          if (
            message.type === ExtensionSessionMessageType.ClassifyGrantAuthority
          ) {
            return ok({ kind: 'Authorized' as const, grant: storedGrant })
          }
          expect(message.type).toBe(ExtensionSessionMessageType.UpdateVault)
          if (scenario === 'promise-rejection') {
            throw new Error('session update rejected')
          }
          return err(
            new ExtensionSessionTransportFailure(
              ExtensionSessionTransportFailureKind.DeliveryFailed,
            ),
          )
        },
      })
      const freePairingVaultId = spyOn(NookPairingVaultId.prototype, 'free')
      const response = await importLocalEventLogUpdateWithDependencies({
        vaultStoreId: storedGrant.vaultStoreId,
        eventLogRecords: [],
        loadPairingStorage: async () => ({ [key]: storedGrant }),
        pairingPolicyReady: extensionPairingGrantPolicyReady,
        ensureSession: async () => ok(unusedSessionTransport),
        importEventLog: async () => ({
          vaultStoreId: storedGrant.vaultStoreId,
          accessGranted: true,
          eventCount: 1,
          heads: ['event-1'],
        }),
        persistPairingStorage: async () => {},
        sendSession: session.sendMessage.bind(session),
      })

      expect(response).toEqual({
        ok: false,
        reason: LocalEventLogUpdateFailure.EventLogImportFailed,
      })
      expect(session.deliveryCount).toBe(2)
      expect(freePairingVaultId).toHaveBeenCalledTimes(1)
      freePairingVaultId.mockRestore()
    },
  )
  test('frees the validated wrapper when generated decoding throws', async () => {
    const policy = await extensionPairingGrantPolicyReady
    const key = policy.pairingGrantStorageKey(storedGrant.vaultStoreId)
    const freePairingVaultId = spyOn(NookPairingVaultId.prototype, 'free')
    const session = new PairingSessionTransportFixture({
      deliver: async (message) => {
        expect(message.type).toBe(
          ExtensionSessionMessageType.ClassifyGrantAuthority,
        )
        return ok({
          kind: 'Authorized',
          grant: {
            ...storedGrant,
            vaultStoreId: 'store_otherid0001',
          },
        })
      },
    })
    const response = await importLocalEventLogUpdateWithDependencies({
      vaultStoreId: storedGrant.vaultStoreId,
      eventLogRecords: [],
      loadPairingStorage: async () => ({ [key]: storedGrant }),
      pairingPolicyReady: extensionPairingGrantPolicyReady,
      ensureSession: async () => ok(unusedSessionTransport),
      importEventLog: async () => {
        throw new Error('decoder must reject before import')
      },
      persistPairingStorage: async () => {},
      sendSession: session.sendMessage.bind(session),
    })

    expect(response).toEqual({
      ok: false,
      reason: LocalEventLogUpdateFailure.EventLogImportFailed,
    })
    expect(freePairingVaultId).toHaveBeenCalledTimes(1)
    freePairingVaultId.mockRestore()
  })
  test('rejects an invalid wire vault ID before allocating a wrapper', async () => {
    await extensionPairingGrantPolicyReady
    const freePairingVaultId = spyOn(NookPairingVaultId.prototype, 'free')
    const session = new PairingSessionTransportFixture({
      deliver: async (message) => {
        expect(message.type).toBe(
          ExtensionSessionMessageType.ClassifyGrantAuthority,
        )
        return ok({ kind: 'Authorized', grant: storedGrant })
      },
    })
    const response = await importLocalEventLogUpdateWithDependencies({
      vaultStoreId: 'vault',
      eventLogRecords: [],
      loadPairingStorage: async () => ({}),
      pairingPolicyReady: extensionPairingGrantPolicyReady,
      ensureSession: async () => ok(unusedSessionTransport),
      importEventLog: async () => ({
        vaultStoreId: storedGrant.vaultStoreId,
        accessGranted: true,
        eventCount: 1,
        heads: ['event-1'],
      }),
      persistPairingStorage: async () => {},
      sendSession: session.sendMessage.bind(session),
    })

    expect(response).toEqual({
      ok: false,
      reason: LocalEventLogUpdateFailure.EventLogImportFailed,
    })
    expect(freePairingVaultId).not.toHaveBeenCalled()
    freePairingVaultId.mockRestore()
  })
  test('rejects malformed and wrong-target manager responses', async () => {
    await extensionPairingGrantPolicyReady
    for (const response of [
      {},
      {
        kind: 'Authorized',
        grant: { ...storedGrant, vaultStoreId: 'store_otherid0001' },
      },
    ]) {
      const requested = new NookPairingVaultId(storedGrant.vaultStoreId)
      try {
        expect(() =>
          decode_extension_grant_authority_response(
            JSON.stringify(response),
            requested,
          ),
        ).toThrow()
      } finally {
        requested.free()
      }
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
          vault_store_id: storedGrant.vaultStoreId,
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
          vault_store_id: storedGrant.vaultStoreId,
          queue: { kind: 'message-default' },
        },
      })
      expect(classify).toHaveBeenCalledWith('{}', storedGrant.vaultStoreId)
      const requested = new NookPairingVaultId(storedGrant.vaultStoreId)
      try {
        expect(
          decode_extension_grant_authority_response(
            JSON.stringify(result),
            requested,
          ),
        ).toEqual(authority)
      } finally {
        requested.free()
      }
    },
  )
  test.each([
    'absent',
    'malformed',
    'policy-unavailable',
    'missing-active',
    'transport-failed',
    'serialization-failed',
  ] as const)(
    'rejects %s before importing or updating a session',
    async (scenario) => {
      const policy = await extensionPairingGrantPolicyReady
      const unpairedVaultStoreId = 'store_unpaired001'
      const key = policy.pairingGrantStorageKey(unpairedVaultStoreId)
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
          : Promise.resolve(scenario === 'malformed' ? { [key]: {} } : {}),
      )
      const unusedOperation = mock(() =>
        Promise.reject(new Error('must not run')),
      )
      const session = new PairingSessionTransportFixture({
        deliver: async (message) => {
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
          if (!('payload' in message)) {
            throw new Error('expected a session request payload')
          }
          expect(message.payload).toEqual({
            stored_json: JSON.stringify(await loadPairingStorage()),
            vault_store_id: unpairedVaultStoreId,
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
      })
      const response = await importLocalEventLogUpdateWithDependencies({
        ensureSession: async () => ok(unusedSessionTransport),
        persistPairingStorage: unusedOperation,
        vaultStoreId: unpairedVaultStoreId,
        eventLogRecords: [],
        loadPairingStorage,
        pairingPolicyReady:
          scenario === 'policy-unavailable'
            ? Promise.reject(new Error('policy unavailable'))
            : extensionPairingGrantPolicyReady,
        importEventLog: unusedOperation,
        sendSession: session.sendMessage.bind(session),
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

    const decoded = await Effect.runPromise(
      Effect.either(
        policy.decodeStoredExtensionPairingGrant(storageSnapshot.grant),
      ),
    )
    expect(decoded._tag).toBe('Left')
  })

  test('projects only session identity fields from stored grants', () => {
    expect(extensionSessionGrantIdentity(storedGrant)).toEqual({
      vaultStoreId: 'store_abcdefghijk',
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
