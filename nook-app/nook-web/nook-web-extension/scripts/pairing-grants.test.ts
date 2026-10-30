import { describe, expect, mock, spyOn, test } from 'bun:test'
import { err, ok } from 'neverthrow'
import { Effect } from 'effect'
import {
  decode_extension_grant_authority_response,
  NookPairingVaultId,
  type ExtensionActiveVaultScope,
  type ExtensionGrantAuthority,
} from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  ExtensionKeyringApprovalAdmission,
  ExtensionPairingApprovedMessageAdmissionFailure,
  ExtensionStorageProviderPayloadAdmission,
  RuntimeMessageDecodeFailureKind,
} from '../../nook-web-shared/src/extension/runtime-messages'
import type { ExtensionEventLogRecord } from '../../nook-web-shared/src/extension/lifecycle-runtime-messages'
import { companionWasmReady } from '../../nook-web-shared/src/extension/companion-ready'
import { ExtensionConnectScope } from '../../nook-web-shared/src/extension/extension-connect-scope'
import { ExtensionSessionMessageType } from '../src/lib/extension-session-message-type'
import type {
  StoredExtensionKeyring,
  StoredExtensionPairingGrant,
} from '../src/background/pairing-grants'
import {
  type DecodedExtensionSessionTransportDelivery,
  type ExtensionSessionTransportDelivery,
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
    delivery: ExtensionSessionTransportDelivery,
  ): Promise<ExtensionSessionTransportResult<ExtensionSessionResponse>>
  sendMessage<Response, DecodeFailure>(
    delivery: DecodedExtensionSessionTransportDelivery<Response, DecodeFailure>,
  ): Promise<ExtensionSessionTransportResult<Response, DecodeFailure>>
  async sendMessage<Response = ExtensionSessionResponse, DecodeFailure = never>(
    delivery:
      | ExtensionSessionTransportDelivery
      | DecodedExtensionSessionTransportDelivery<Response, DecodeFailure>,
  ): Promise<
    | ExtensionSessionTransportResult<ExtensionSessionResponse>
    | ExtensionSessionTransportResult<Response, DecodeFailure>
  > {
    this.deliveryCount += 1
    const queuedDelivery = await this.args.deliver(delivery.message)
    if (queuedDelivery.isErr())
      return err<Response, ExtensionSessionTransportFailure | DecodeFailure>(
        queuedDelivery.error,
      )
    if (!('decodeResponse' in delivery)) return queuedDelivery
    const decoded = delivery.decodeResponse(queuedDelivery.value)
    return decoded.match(
      (value) =>
        ok<Response, ExtensionSessionTransportFailure | DecodeFailure>(value),
      (failure) =>
        err<Response, ExtensionSessionTransportFailure | DecodeFailure>(
          failure,
        ),
    )
  }
}

const storedGrant: StoredExtensionPairingGrant = {
  vaultType: 'simple',
  vaultStoreId: 'store_abcdefghijk',
  deviceId: 'device',
  devicePublicKey: 'public',
  deviceSigningPublicKey: 'signing',
  vaultName: 'Private vault',
  identityLabel: '',
  deviceLabel: 'Laptop',
  approvedAt: 1_786_320_000_000,
  scopes: ['password-filling'],
  syncProviderCount: 0,
  eventCount: 1,
  eventLogHeads: ['event-1'],
  lastLocalSyncAt: '2026-08-10T00:00:00Z',
}

const keyringRecord: ExtensionEventLogRecord = {
  eventId: 'sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo',
  event: {
    schema_version: 2,
    store_id: 'store_abcdefghijk',
    actor_id: `key_${'0'.repeat(64)}`,
    actor_signing_public_key: '0'.repeat(64),
    parents: [],
    created_at: '2026-10-16T00:00:00Z',
    key_epoch: 'sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo',
    operations: [],
    signature: `ed25519:${'0'.repeat(128)}`,
  },
}

/** A keyring approval as the web app sends it, but its scopes: no vault
 * yet. */
const keyringApprovalFields = {
  deviceId: 'device',
  devicePublicKey: 'public',
  deviceSigningPublicKey: 'signing',
  deviceLabel: 'Laptop',
  approvedAt: 1_786_320_000_000,
  identityId: 'identity-personal',
  identityLabel: 'Personal',
  identityEvents: ['identity-event-1'],
  vaults: [],
  providers: { apps: [{ appId: 'device', providers: [] }] },
}
const keyringApprovalWire = {
  ...keyringApprovalFields,
  scopes: ['vault-access', 'password-filling'],
}

const joinedKeyring: StoredExtensionKeyring = {
  identityId: 'identity-personal',
  identityLabel: 'Personal',
  deviceId: 'device',
  devicePublicKey: 'public',
  deviceSigningPublicKey: 'signing',
  deviceLabel: 'Laptop',
  approvedAt: 1_786_320_000_000,
  scopes: ['vault-access', 'password-filling'],
}

describe('keyring approval admission', () => {
  test('admits a keyring with no vault, its providers left for Rust', async () => {
    await companionWasmReady

    const admission =
      ExtensionKeyringApprovalAdmission.parse(keyringApprovalWire)

    expect(admission.isOk()).toBe(true)
    if (admission.isErr()) return
    const { scopes, ...approved } = admission.value
    expect(approved).toEqual(keyringApprovalFields)
    expect(scopes).toEqual([
      ExtensionConnectScope.VaultAccess,
      ExtensionConnectScope.PasswordFilling,
    ])
    // The sealed provider copies pass through as sent; Rust decodes them.
    expect(approved.providers).toBe(keyringApprovalFields.providers)
  })

  test('admits the vaults this browser holds with their records', async () => {
    await companionWasmReady

    const admission = ExtensionKeyringApprovalAdmission.parse({
      ...keyringApprovalWire,
      vaults: [
        { storeId: 'store_abcdefghijk', eventLogRecords: [keyringRecord] },
      ],
    })

    expect(admission.isOk()).toBe(true)
    if (admission.isErr()) return
    expect(
      admission.value.vaults.map((vault) => [
        vault.storeId,
        vault.eventLogRecords.map((each) => each.eventId),
      ]),
    ).toEqual([['store_abcdefghijk', [keyringRecord.eventId]]])
  })

  test.each([
    {
      name: 'a payload that is not an object',
      payload: 'approved',
      failure: ExtensionPairingApprovedMessageAdmissionFailure.Payload,
    },
    {
      name: 'a missing app key',
      payload: { ...keyringApprovalWire, deviceId: 7 },
      failure: ExtensionPairingApprovedMessageAdmissionFailure.DeviceId,
    },
    {
      name: 'an approval time that is not a number',
      payload: { ...keyringApprovalWire, approvedAt: '2026-08-10' },
      failure: ExtensionPairingApprovedMessageAdmissionFailure.ApprovedAt,
    },
    {
      name: 'an unknown scope',
      payload: { ...keyringApprovalWire, scopes: ['vault-admin'] },
      failure: ExtensionPairingApprovedMessageAdmissionFailure.Scopes,
    },
    {
      name: 'no providers',
      payload: Object.fromEntries(
        Object.entries(keyringApprovalWire).filter(
          ([field]) => field !== 'providers',
        ),
      ),
      failure: ExtensionPairingApprovedMessageAdmissionFailure.Providers,
    },
    {
      name: 'a blank identity',
      payload: { ...keyringApprovalWire, identityId: ' ' },
      failure: ExtensionPairingApprovedMessageAdmissionFailure.Keyring,
    },
    {
      name: 'an empty keyring log',
      payload: { ...keyringApprovalWire, identityEvents: [] },
      failure: ExtensionPairingApprovedMessageAdmissionFailure.Keyring,
    },
    {
      name: 'a vault with no records',
      payload: {
        ...keyringApprovalWire,
        vaults: [{ storeId: 'store_abcdefghijk', eventLogRecords: [] }],
      },
      failure: ExtensionPairingApprovedMessageAdmissionFailure.Keyring,
    },
    {
      name: 'a vault with a malformed record',
      payload: {
        ...keyringApprovalWire,
        vaults: [
          {
            storeId: 'store_abcdefghijk',
            eventLogRecords: [{ eventId: 'event-1', event: {} }],
          },
        ],
      },
      failure: ExtensionPairingApprovedMessageAdmissionFailure.Keyring,
    },
  ])('refuses $name', async ({ payload, failure }) => {
    await companionWasmReady

    expect(ExtensionKeyringApprovalAdmission.parse(payload)).toEqual(
      err(failure),
    )
  })
})

describe('joined keyring storage', () => {
  test('a keyring with no vault is stored under its identity', async () => {
    const policy = await extensionPairingGrantPolicyReady

    expect(policy.keyringStorageItems(joinedKeyring)).toEqual({
      'nook:extension-keyring:identity-personal': joinedKeyring,
    })
  })

  test('joined keyrings read back latest approval first, beside vault grants', async () => {
    const policy = await extensionPairingGrantPolicyReady
    const later: StoredExtensionKeyring = {
      ...joinedKeyring,
      identityId: 'identity-work',
      identityLabel: 'Work',
      approvedAt: joinedKeyring.approvedAt + 60_000,
    }
    const stored = {
      ...policy.keyringStorageItems(joinedKeyring),
      [policy.pairingGrantStorageKey(storedGrant.vaultStoreId)]: storedGrant,
      ...policy.keyringStorageItems(later),
    }

    expect(policy.joinedKeyrings(stored)).toEqual([later, joinedKeyring])
    expect(policy.selectedPairingGrantFirst(stored)).toEqual([storedGrant])
  })

  test('no keyring is read back before the extension joins one', async () => {
    const policy = await extensionPairingGrantPolicyReady
    const key = policy.pairingGrantStorageKey(storedGrant.vaultStoreId)

    expect(policy.joinedKeyrings({ [key]: storedGrant })).toEqual([])
  })

  test('refuses to store a keyring without its app key or scopes', async () => {
    const policy = await extensionPairingGrantPolicyReady

    expect(() =>
      policy.keyringStorageItems({ ...joinedKeyring, devicePublicKey: ' ' }),
    ).toThrow()
    expect(() =>
      policy.keyringStorageItems({ ...joinedKeyring, scopes: [] }),
    ).toThrow()
  })
})

describe('extension pairing grant transport', () => {
  test('admits only provider identities from richer transport payloads', () => {
    const complete = {
      id: 'github',
      type: 'github',
      label: 'Personal GitHub',
      githubPat: { state: 'missing' },
      githubRepo: { state: 'defaultRepository' },
      oauthFile: { state: 'notApplicable' },
      localFolder: { state: 'notApplicable' },
      storeId: { state: 'unscoped' },
      syncCheckpoint: { state: 'neverSynced' },
      createdAt: '2026-08-10T00:00:00Z',
    }

    expect(
      new ExtensionStorageProviderPayloadAdmission(complete).parse().isOk(),
    ).toBe(true)
    const missingIdentity = Object.fromEntries(
      Object.entries(complete).filter(([key]) => key !== 'id'),
    )
    expect(
      new ExtensionStorageProviderPayloadAdmission(missingIdentity)
        .parse()
        .isErr(),
    ).toBe(true)
    expect(
      new ExtensionStorageProviderPayloadAdmission({ ...complete, type: 'ftp' })
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
        sendSession: (message: ExtensionSessionTransportRequest) =>
          session.sendMessage({ message }),
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
        sendSession: (message: ExtensionSessionTransportRequest) =>
          session.sendMessage({ message }),
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
      sendSession: (message: ExtensionSessionTransportRequest) =>
        session.sendMessage({ message }),
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
      sendSession: (message: ExtensionSessionTransportRequest) =>
        session.sendMessage({ message }),
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
      active_extension_vault_scope: () => {
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
  test('classifies each authority from the typed manager scope projection', async () => {
    const policy = await extensionPairingGrantPolicyReady
    const grantKey = policy.pairingGrantStorageKey(storedGrant.vaultStoreId)
    const scenarios = [
      {
        storedJson: '{}',
        scope: { kind: 'NoActiveVault' as const },
        authority: { kind: 'NoMatchingAuthority' as const },
      },
      {
        storedJson: '{}',
        scope: {
          kind: 'Active' as const,
          vault_store_id: storedGrant.vaultStoreId,
        },
        authority: { kind: 'MissingActiveAuthority' as const },
      },
      {
        storedJson: 'invalid',
        scope: { kind: 'NoActiveVault' as const },
        authority: { kind: 'InvalidStoredAuthority' as const },
      },
      {
        storedJson: JSON.stringify({ [grantKey]: storedGrant }),
        scope: { kind: 'NoActiveVault' as const },
        authority: { kind: 'Authorized' as const, grant: storedGrant },
      },
    ] satisfies Array<{
      storedJson: string
      scope: ExtensionActiveVaultScope
      authority: ExtensionGrantAuthority
    }>

    for (const scenario of scenarios) {
      const manager = {
        active_extension_vault_scope: () => scenario.scope,
      }
      const result = classifySessionGrantAuthority({
        manager,
        payload: {
          stored_json: scenario.storedJson,
          vault_store_id: storedGrant.vaultStoreId,
          queue: { kind: 'message-default' },
        },
      })
      const requested = new NookPairingVaultId(storedGrant.vaultStoreId)
      try {
        expect(
          decode_extension_grant_authority_response(
            JSON.stringify(result),
            requested,
          ),
        ).toEqual(scenario.authority)
      } finally {
        requested.free()
      }
    }
  })
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
        sendSession: (message: ExtensionSessionTransportRequest) =>
          session.sendMessage({ message }),
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
      Effect.result(
        policy.decodeStoredExtensionPairingGrant(storageSnapshot.grant),
      ),
    )
    expect(decoded._tag).toBe('Failure')
  })

  test('projects only session identity fields from stored grants', () => {
    expect(extensionSessionGrantIdentity(storedGrant)).toEqual({
      vaultStoreId: 'store_abcdefghijk',
      deviceId: 'device',
      devicePublicKey: 'public',
      deviceSigningPublicKey: 'signing',
    })
  })
})
