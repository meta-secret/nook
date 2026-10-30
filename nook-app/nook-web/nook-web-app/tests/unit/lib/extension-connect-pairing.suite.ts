import { describe, expect, test, vi } from 'vitest'
import { ExtensionConnectFollowKind } from '$web-shared/extension/extension-connect-progress'
import { Effect } from 'effect'
import {
  ExtensionConnectScope,
  pairingApprovalResponseDecoder,
  ExtensionPairingDeliveryKind,
  ExtensionPairingRejectionReason,
  extensionConnectionBrowser,
} from '$lib/extension/connect'
import {
  ExtensionLocalEventLogUpdatedMessage as ExtensionLocalEventLogUpdatedMessageGuard,
  ExtensionPairingApprovedMessageAdmissionFailure,
  RuntimeMessageDecodeFailureKind,
  ExtensionPairingApprovedMessageType,
  ExtensionPairingApprovedMessage as ExtensionPairingApprovedMessageSchema,
  type ExtensionPairingApprovedMessage,
} from '../../../../nook-web-shared/src/extension/runtime-messages'
import { RuntimeMessageDecodeCauseKind } from '../../../../nook-web-shared/src/extension/runtime-message-decode-failure'
import type { ExtensionKeyringVault } from '../../../../nook-web-shared/src/extension/keyring-grant-wire'
import {
  extensionPairingGrantStorageItems,
  extensionStoredPairingGrantStorageItems,
  decodeStoredExtensionPairingGrant,
  decodeExtensionReadySetupState,
  pairingGrantStorageKey,
  selectedPairingGrant,
  selectedPairingGrantFirst,
  setupAfterPairingGrantRemoval,
  setupStorageKey,
  simplePairingVaultType,
} from './extension-connect-test-support'

describe('extension pairing approved message', () => {
  const eventLogRecords: ExtensionKeyringVault['eventLogRecords'] = [
    {
      eventId: 'event-1',
      event: {
        schema_version: 2,
        store_id: 'store_abcdefghijk',
        actor_id: `key_${'0'.repeat(64)}`,
        actor_signing_public_key: '0'.repeat(64),
        parents: [],
        created_at: '2026-07-07T00:00:00.000Z',
        key_epoch: 'sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo',
        operations: [{ type: 'vault-cleared' as const }],
        signature: `ed25519:${'0'.repeat(128)}`,
      },
    },
  ]

  /** The web app added the extension to a keyring holding one vault here. */
  function approvedMessage(): ExtensionPairingApprovedMessage {
    return {
      type: ExtensionPairingApprovedMessageType.NookExtensionPairingApproved,
      payload: {
        deviceId: 'device-1',
        devicePublicKey: 'age1device',
        deviceSigningPublicKey: 'signing-key',
        deviceLabel: 'Nook Extension',
        approvedAt: 1_783_373_640_000,
        scopes: [ExtensionConnectScope.VaultAccess],
        identityId: 'identity-1',
        identityLabel: 'Personal',
        identityEvents: ['identity-event-1'],
        vaults: [{ storeId: 'store_abcdefghijk', eventLogRecords }],
        providers: { apps: [] },
      },
    }
  }

  function approvalDeliveryArgs(): Parameters<
    typeof extensionConnectionBrowser.deliverExtensionPairingApproval
  >[0] {
    return {
      request: {
        follow: { kind: ExtensionConnectFollowKind.Unnamed },
        deviceId: 'device-1',
        devicePublicKey: 'age1device',
        deviceSigningPublicKey: 'signing-key',
        extensionRuntimeId: 'extension-123',
        deviceLabel: 'Nook Extension',
        scopes: [ExtensionConnectScope.VaultAccess],
      },
      message: approvedMessage(),
    }
  }

  function admit(payload: unknown) {
    return Effect.runSync(
      Effect.result(
        ExtensionPairingApprovedMessageSchema.decode({
          type: ExtensionPairingApprovedMessageType.NookExtensionPairingApproved,
          payload,
        }),
      ),
    )
  }

  test('delivers an approved grant through the extension callback', async () => {
    const sendMessage = vi.fn(
      (...args: [string, unknown, (response?: unknown) => void]) => {
        args[2]({ ok: true, eventCount: 1 })
      },
    )
    vi.stubGlobal('chrome', { runtime: { sendMessage } })
    const delivery = approvalDeliveryArgs()

    await expect(
      extensionConnectionBrowser.deliverExtensionPairingApproval(delivery),
    ).resolves.toEqual({
      kind: ExtensionPairingDeliveryKind.Delivered,
      eventCount: 1,
    })
    expect(sendMessage).toHaveBeenCalledOnce()
    expect(sendMessage).toHaveBeenCalledWith(
      delivery.request.extensionRuntimeId,
      delivery.message,
      expect.any(Function),
    )
  })

  test('reports a callback that supplies no response argument once', async () => {
    const sendMessage = vi.fn(
      (...args: [string, unknown, (response?: unknown) => void]) => {
        args[2]()
      },
    )
    vi.stubGlobal('chrome', { runtime: { sendMessage } })

    await expect(
      extensionConnectionBrowser.deliverExtensionPairingApproval(
        approvalDeliveryArgs(),
      ),
    ).resolves.toEqual({
      kind: ExtensionPairingDeliveryKind.MessagingUnavailable,
    })
    expect(sendMessage).toHaveBeenCalledOnce()
  })

  test('reports a runtime error once', async () => {
    const runtimeErrorSend = vi.fn(
      (...args: [string, unknown, (response?: unknown) => void]) => {
        args[2]({ ok: true, eventCount: 1 })
      },
    )
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: runtimeErrorSend,
        lastError: { message: 'gone' },
      },
    })
    await expect(
      extensionConnectionBrowser.deliverExtensionPairingApproval(
        approvalDeliveryArgs(),
      ),
    ).resolves.toEqual({
      kind: ExtensionPairingDeliveryKind.MessagingUnavailable,
    })
    expect(runtimeErrorSend).toHaveBeenCalledOnce()
  })

  test('waits for one slow pairing import acknowledgement', async () => {
    vi.useFakeTimers()
    const sendMessage = vi.fn(
      (...args: [string, unknown, (response?: unknown) => void]) => {
        window.setTimeout(() => args[2]({ ok: true, eventCount: 1 }), 6_000)
      },
    )
    vi.stubGlobal('chrome', { runtime: { sendMessage } })

    const delivery = extensionConnectionBrowser.deliverExtensionPairingApproval(
      approvalDeliveryArgs(),
    )
    await vi.advanceTimersByTimeAsync(6_000)

    await expect(delivery).resolves.toEqual({
      kind: ExtensionPairingDeliveryKind.Delivered,
      eventCount: 1,
    })
    expect(sendMessage).toHaveBeenCalledOnce()
  })

  test('preserves companion runtime startup rejection', async () => {
    const sendMessage = vi.fn(
      (...args: [string, unknown, (response?: unknown) => void]) => {
        args[2]({
          ok: false,
          reason: ExtensionPairingRejectionReason.ExtensionRuntimeUnavailable,
        })
      },
    )
    vi.stubGlobal('chrome', { runtime: { sendMessage } })

    await expect(
      extensionConnectionBrowser.deliverExtensionPairingApproval(
        approvalDeliveryArgs(),
      ),
    ).resolves.toEqual({
      kind: ExtensionPairingDeliveryKind.Rejected,
      reason: ExtensionPairingRejectionReason.ExtensionRuntimeUnavailable,
    })
  })

  test('preserves event-log rejection returned in the error field', async () => {
    const sendMessage = vi.fn(
      (...args: [string, unknown, (response?: unknown) => void]) => {
        args[2]({
          ok: false,
          error: ExtensionPairingRejectionReason.EventLogAccessNotGranted,
        })
      },
    )
    vi.stubGlobal('chrome', { runtime: { sendMessage } })

    await expect(
      extensionConnectionBrowser.deliverExtensionPairingApproval(
        approvalDeliveryArgs(),
      ),
    ).resolves.toEqual({
      kind: ExtensionPairingDeliveryKind.Rejected,
      reason: ExtensionPairingRejectionReason.EventLogAccessNotGranted,
    })
  })

  test('preserves the extension refusing the keyring it was handed', async () => {
    const sendMessage = vi.fn(
      (...args: [string, unknown, (response?: unknown) => void]) => {
        args[2]({
          ok: false,
          reason: ExtensionPairingRejectionReason.InvalidPairingGrantKeyring,
        })
      },
    )
    vi.stubGlobal('chrome', { runtime: { sendMessage } })

    await expect(
      extensionConnectionBrowser.deliverExtensionPairingApproval(
        approvalDeliveryArgs(),
      ),
    ).resolves.toEqual({
      kind: ExtensionPairingDeliveryKind.Rejected,
      reason: ExtensionPairingRejectionReason.InvalidPairingGrantKeyring,
    })
  })

  test('rejects a malformed successful acknowledgement instead of trusting its ok flag', () => {
    const decoded = Effect.runSync(
      Effect.result(
        pairingApprovalResponseDecoder.decode({
          ok: true,
          reason: ExtensionPairingRejectionReason.EventLogAccessNotGranted,
        }),
      ),
    )

    expect(decoded._tag).toBe('Failure')
  })

  test('rejects conflicting reason and error responses instead of choosing one field', () => {
    const decoded = Effect.runSync(
      Effect.result(
        pairingApprovalResponseDecoder.decode({
          ok: false,
          reason: ExtensionPairingRejectionReason.ExtensionRuntimeUnavailable,
          error: ExtensionPairingRejectionReason.EventLogAccessNotGranted,
        }),
      ),
    )

    expect(decoded._tag).toBe('Failure')
  })

  test.each([
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    Number.POSITIVE_INFINITY,
    Number.NaN,
  ])('rejects invalid imported event count %s', (eventCount) => {
    const decoded = Effect.runSync(
      Effect.result(
        pairingApprovalResponseDecoder.decode({ ok: true, eventCount }),
      ),
    )

    expect(decoded._tag).toBe('Failure')
  })

  test('admits the keyring approval the web app sends, with its log and held vaults', () => {
    const message = approvedMessage()

    const admission = Effect.runSync(
      Effect.result(ExtensionPairingApprovedMessageSchema.decode(message)),
    )

    expect(admission._tag).toBe('Success')
    if (admission._tag === 'Failure') return
    expect(admission.success.type).toBe(message.type)
    // Every field but the vaults arrives as it was sent; the held vaults'
    // records are decoded by the extension's Rust.
    expect({ ...admission.success.payload, vaults: [] }).toEqual({
      ...message.payload,
      vaults: [],
    })
    expect(
      admission.success.payload.vaults.map((vault) => [
        vault.storeId,
        vault.eventLogRecords.map((record) => record.eventId),
      ]),
    ).toEqual([['store_abcdefghijk', ['event-1']]])
  })

  test('admits a keyring with no vault yet', () => {
    const admission = admit({ ...approvedMessage().payload, vaults: [] })

    expect(admission._tag).toBe('Success')
    if (admission._tag === 'Failure') return
    expect(admission.success.payload.vaults).toEqual([])
    expect(admission.success.payload.identityId).toBe('identity-1')
  })

  test('passes the sealed providers through for the extension to take in Rust', () => {
    const providers = {
      apps: [
        {
          appId: 'app-extension',
          providers: [
            {
              id: 'github-1',
              type: 'github',
              label: 'Personal GitHub',
              githubPat: {
                state: 'token',
                value: '-----BEGIN AGE ENCRYPTED FILE-----\\nfixture',
              },
              githubRepo: { state: 'defaultRepository' },
              oauthFile: { state: 'notApplicable' },
              localFolder: { state: 'notApplicable' },
              storeId: { state: 'unscoped' },
              syncCheckpoint: { state: 'neverSynced' },
              createdAt: '2026-07-07T00:00:00.000Z',
            },
          ],
        },
      ],
    }

    const admission = admit({ ...approvedMessage().payload, providers })

    expect(admission._tag).toBe('Success')
    if (admission._tag === 'Failure') return
    expect(admission.success.payload.providers).toEqual(providers)
  })

  type ApprovalPayload = ExtensionPairingApprovedMessage['payload']

  function without(
    payload: ApprovalPayload,
    field: keyof ApprovalPayload,
  ): Partial<ApprovalPayload> {
    const partial: Partial<ApprovalPayload> = { ...payload }
    delete partial[field]
    return partial
  }

  test.each<{
    readonly name: string
    readonly payload: (approved: ApprovalPayload) => unknown
    readonly cause: ExtensionPairingApprovedMessageAdmissionFailure
  }>([
    {
      name: 'without the keyring it joins',
      payload: (approved) => without(approved, 'identityId'),
      cause: ExtensionPairingApprovedMessageAdmissionFailure.Keyring,
    },
    {
      name: 'with a blank keyring id',
      payload: (approved) => ({ ...approved, identityId: '  ' }),
      cause: ExtensionPairingApprovedMessageAdmissionFailure.Keyring,
    },
    {
      name: 'with an empty keyring log',
      payload: (approved) => ({ ...approved, identityEvents: [] }),
      cause: ExtensionPairingApprovedMessageAdmissionFailure.Keyring,
    },
    {
      name: 'with a held vault that carries no records',
      payload: (approved) => ({
        ...approved,
        vaults: [{ storeId: 'store_abcdefghijk', eventLogRecords: [] }],
      }),
      cause: ExtensionPairingApprovedMessageAdmissionFailure.Keyring,
    },
    {
      name: 'with a held vault whose records are malformed',
      payload: (approved) => ({
        ...approved,
        vaults: [
          {
            storeId: 'store_abcdefghijk',
            eventLogRecords: [{ eventId: 'one', event: {} }],
          },
        ],
      }),
      cause: ExtensionPairingApprovedMessageAdmissionFailure.Keyring,
    },
    {
      name: 'without providers',
      payload: (approved) => without(approved, 'providers'),
      cause: ExtensionPairingApprovedMessageAdmissionFailure.Providers,
    },
    {
      name: 'with an ISO approval timestamp',
      payload: (approved) => ({
        ...approved,
        approvedAt: '2026-07-07T00:00:00.000Z',
      }),
      cause: ExtensionPairingApprovedMessageAdmissionFailure.ApprovedAt,
    },
    {
      name: 'that is not an object',
      payload: () => false,
      cause: ExtensionPairingApprovedMessageAdmissionFailure.Payload,
    },
  ])('refuses an approval $name', ({ payload, cause }) => {
    const admission = admit(payload(approvedMessage().payload))

    if (admission._tag === 'Success') {
      expect.fail('a refused approval must not be admitted')
    }
    expect(admission.failure.kind).toBe(
      RuntimeMessageDecodeFailureKind.ExtensionPairingApprovedGrant,
    )
    expect(admission.failure.cause).toEqual({
      kind: RuntimeMessageDecodeCauseKind.ThrownValue,
      detail: cause,
    })
  })

  test('refuses a message that is not a pairing approval', () => {
    const admission = Effect.runSync(
      Effect.result(
        ExtensionPairingApprovedMessageSchema.decode({
          type: 'nook:extension-local-event-log-updated',
          payload: approvedMessage().payload,
        }),
      ),
    )

    if (admission._tag === 'Success') {
      expect.fail('another message must not be admitted as an approval')
    }
    expect(admission.failure.kind).toBe(
      RuntimeMessageDecodeFailureKind.ExtensionPairingApprovedMessage,
    )
  })

  test('accepts encrypted local event-log notifications and rejects empty snapshots', () => {
    expect(
      Effect.runSync(
        Effect.result(
          ExtensionLocalEventLogUpdatedMessageGuard.decode({
            type: 'nook:extension-local-event-log-updated',
            payload: {
              vaultStoreId: 'store_abcdefghijk',
              eventLogRecords,
            },
          }),
        ),
      )._tag,
    ).toBe('Success')
    expect(
      Effect.runSync(
        Effect.result(
          ExtensionLocalEventLogUpdatedMessageGuard.decode({
            type: 'nook:extension-local-event-log-updated',
            payload: {
              vaultStoreId: 'store_abcdefghijk',
              eventLogRecords: [],
            },
          }),
        ),
      )._tag,
    ).toBe('Failure')
  })

  test('maps approved grants into extension-owned storage keys', () => {
    const storageItemsArgs: Parameters<
      typeof extensionPairingGrantStorageItems
    >[0] = {
      grant: {
        vaultType: simplePairingVaultType,
        deviceId: 'device-1',
        devicePublicKey: 'age1device',
        deviceSigningPublicKey: 'signing-key',
        deviceLabel: 'Nook Extension',
        vaultStoreId: 'store_abcdefghijk',
        vaultName: 'Personal',
        approvedAt: 1_783_373_640_000,
        scopes: [
          ExtensionConnectScope.VaultAccess,
          ExtensionConnectScope.SyncProviderCredentials,
        ],
        syncProviderCount: 2,
      },
      imported: {
        vaultStoreId: 'store_abcdefghijk',
        eventCount: 3,
        heads: ['event-3'],
        accessGranted: true,
      },
    }
    const items = extensionPairingGrantStorageItems(storageItemsArgs)

    expect(items[pairingGrantStorageKey('store_abcdefghijk')]).toMatchObject({
      deviceId: 'device-1',
      vaultStoreId: 'store_abcdefghijk',
      syncProviderCount: 2,
    })
    expect(
      items[pairingGrantStorageKey('store_abcdefghijk')],
    ).not.toHaveProperty('providers')
    const setup = items[setupStorageKey]
    const admittedSetup = Effect.runSync(
      Effect.result(decodeExtensionReadySetupState(setup)),
    )
    if (admittedSetup._tag === 'Failure') {
      throw new Error('expected a ready extension setup')
    }
    const readySetup = admittedSetup.success
    expect(readySetup.deviceLabel).toBe('Nook Extension')
    expect(readySetup.pairedVaults).toEqual(['Personal'])
    expect(readySetup.selectedVaultStoreId).toBe('store_abcdefghijk')
    expect(readySetup.selectedVaultName).toBe('Personal')
    expect(readySetup.syncProviderCount).toBe(2)
    expect(readySetup.eventCount).toBe(3)
    expect(readySetup.eventLogHeads).toEqual(['event-3'])
    expect(typeof readySetup.lastLocalSyncAt).toBe('string')
  })

  test('does not present incomplete or revoked setup as connected', () => {
    expect(
      Effect.runSync(Effect.result(decodeExtensionReadySetupState({})))._tag,
    ).toBe('Failure')
    expect(
      Effect.runSync(
        Effect.result(
          decodeExtensionReadySetupState({
            status: 'ready',
            deviceLabel: 'Nook Extension',
            pairedVaults: [],
            selectedVaultStoreId: '',
            selectedVaultName: '',
            syncProviderCount: 0,
            eventCount: 0,
            eventLogHeads: [],
            lastLocalSyncAt: '',
          }),
        ),
      )._tag,
    ).toBe('Failure')
    expect(
      Effect.runSync(
        Effect.result(
          decodeExtensionReadySetupState({
            status: 'revoked',
            deviceLabel: 'Nook Extension',
            pairedVaults: ['Personal'],
            selectedVaultStoreId: 'store_abcdefghijk',
            selectedVaultName: 'Personal',
            syncProviderCount: 0,
            eventCount: 1,
            eventLogHeads: ['event-1'],
            lastLocalSyncAt: '2026-07-07T00:00:00.000Z',
          }),
        ),
      )._tag,
    ).toBe('Failure')
  })

  test('keeps passive updates from selecting another paired vault', () => {
    const approvedStorageItemsArgs: Parameters<
      typeof extensionPairingGrantStorageItems
    >[0] = {
      grant: {
        vaultType: simplePairingVaultType,
        deviceId: 'device-1',
        devicePublicKey: 'age1device',
        deviceSigningPublicKey: 'signing-key',
        deviceLabel: 'Nook Extension',
        vaultStoreId: 'store_abcdefghijk',
        vaultName: 'Personal',
        approvedAt: 1_783_929_600_000,
        scopes: [ExtensionConnectScope.VaultAccess],
        syncProviderCount: 0,
      },
      imported: {
        vaultStoreId: 'store_abcdefghijk',
        eventCount: 2,
        heads: ['event-2'],
        accessGranted: true,
      },
    }
    const approved = extensionPairingGrantStorageItems(approvedStorageItemsArgs)
    const decodedGrant = Effect.runSync(
      Effect.result(
        decodeStoredExtensionPairingGrant(
          approved[pairingGrantStorageKey('store_abcdefghijk')],
        ),
      ),
    )
    if (decodedGrant._tag === 'Failure') {
      throw new Error('expected the approved pairing grant')
    }
    const grant = decodedGrant.success

    const passiveStorageItemsArgs: Parameters<
      typeof extensionStoredPairingGrantStorageItems
    >[0] = {
      grant,
      imported: {
        vaultStoreId: 'store_abcdefghijk',
        eventCount: 3,
        heads: ['event-3'],
        accessGranted: true,
      },
      select: false,
    }
    const passive = extensionStoredPairingGrantStorageItems(
      passiveStorageItemsArgs,
    )

    expect(passive[pairingGrantStorageKey('store_abcdefghijk')]).toMatchObject({
      eventCount: 3,
      eventLogHeads: ['event-3'],
    })
    expect(Object.hasOwn(passive, setupStorageKey)).toBe(false)
  })

  test('restores the newest surviving grant when the selected vault is removed', () => {
    const firstStorageItemsArgs: Parameters<
      typeof extensionPairingGrantStorageItems
    >[0] = {
      grant: {
        vaultType: simplePairingVaultType,
        deviceId: 'device-1',
        devicePublicKey: 'age1device',
        deviceSigningPublicKey: 'signing-key',
        deviceLabel: 'Nook Extension',
        vaultStoreId: 'store_abcdefghijk',
        vaultName: 'Personal',
        approvedAt: 1_783_843_200_000,
        scopes: [ExtensionConnectScope.VaultAccess],
        syncProviderCount: 0,
      },
      imported: {
        vaultStoreId: 'store_abcdefghijk',
        eventCount: 2,
        heads: ['event-2'],
        accessGranted: true,
      },
    }
    const first = extensionPairingGrantStorageItems(firstStorageItemsArgs)
    const secondStorageItemsArgs: Parameters<
      typeof extensionPairingGrantStorageItems
    >[0] = {
      grant: {
        vaultType: simplePairingVaultType,
        deviceId: 'device-1',
        devicePublicKey: 'age1device',
        deviceSigningPublicKey: 'signing-key',
        deviceLabel: 'Nook Extension',
        vaultStoreId: 'store_otherid0001',
        vaultName: 'Work',
        approvedAt: 1_783_929_600_000,
        scopes: [ExtensionConnectScope.VaultAccess],
        syncProviderCount: 0,
      },
      imported: {
        vaultStoreId: 'store_otherid0001',
        eventCount: 4,
        heads: ['event-4'],
        accessGranted: true,
      },
    }
    const second = extensionPairingGrantStorageItems(secondStorageItemsArgs)
    const stored = { ...first, ...second }

    const removalArgs: Parameters<typeof setupAfterPairingGrantRemoval>[0] = {
      stored,
      removedVaultStoreId: 'store_otherid0001',
    }
    const restored = setupAfterPairingGrantRemoval(removalArgs)
    if (restored.kind !== 'ready') {
      throw new Error('expected a surviving paired vault')
    }
    expect(restored.setup.selectedVaultStoreId).toBe('store_abcdefghijk')
    expect(restored.setup.selectedVaultName).toBe('Personal')
    expect(restored.setup.eventCount).toBe(2)
    expect(selectedPairingGrantFirst(stored)[0]?.vaultStoreId).toBe(
      'store_otherid0001',
    )
    const selected = selectedPairingGrant(stored)
    if (selected.kind !== 'selected') {
      throw new Error('expected the newest paired vault to be selected')
    }
    expect(selected.grant.vaultStoreId).toBe('store_otherid0001')
  })
})
