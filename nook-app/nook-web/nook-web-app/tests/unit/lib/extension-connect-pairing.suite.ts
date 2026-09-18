import { describe, expect, test, vi } from 'vitest'
import { Effect } from 'effect'
import {
  ExtensionConnectScope,
  ExtensionIdentityRequestSource,
  pairingApprovalResponseDecoder,
  ExtensionPairingDeliveryKind,
  ExtensionPairingRejectionReason,
  extensionConnectionBrowser,
} from '$lib/extension/connect'
import {
  ExtensionLocalEventLogUpdatedMessage as ExtensionLocalEventLogUpdatedMessageGuard,
  RuntimeMessageDecodeFailureKind,
  ExtensionPairingApprovedMessageType,
  ExtensionPairingApprovedMessage as ExtensionPairingApprovedMessageSchema,
  type ExtensionPairingApprovedMessage,
} from '../../../../nook-web-shared/src/extension/runtime-messages'
import {
  extensionPairingGrantStorageItems,
  extensionStoredPairingGrantStorageItems,
  decodeStoredExtensionPairingGrant,
  decodeExtensionReadySetupState,
  migratedLegacyPairingStorageItems,
  pairingGrantStorageKey,
  selectedPairingGrant,
  selectedPairingGrantFirst,
  setupAfterPairingGrantRemoval,
  setupStorageKey,
  simplePairingVaultType,
  type LegacyPairingStorageObject,
} from './extension-connect-test-support'

describe('extension pairing approved message', () => {
  const eventLogRecords: ExtensionPairingApprovedMessage['eventLogRecords'] = [
    {
      eventId: 'event-1',
      path: 'events/event-1.yaml',
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

  function approvalDeliveryArgs(): Parameters<
    typeof extensionConnectionBrowser.deliverExtensionPairingApproval
  >[0] {
    return {
      request: {
        source: ExtensionIdentityRequestSource.ExtensionConnect,
        deviceId: 'device-1',
        devicePublicKey: 'age1device',
        deviceSigningPublicKey: 'signing-key',
        extensionRuntimeId: 'extension-123',
        deviceLabel: 'Nook Extension',
        nonce: 'nonce-1',
        scopes: [ExtensionConnectScope.VaultAccess],
      },
      message: {
        type: ExtensionPairingApprovedMessageType.NookExtensionPairingApproved,
        payload: {
          vaultType: simplePairingVaultType,
          deviceId: 'device-1',
          devicePublicKey: 'age1device',
          deviceSigningPublicKey: 'signing-key',
          deviceLabel: 'Nook Extension',
          vaultStoreId: 'store_abcdefghijk',
          vaultName: 'Personal',
          approvedAt: 1_783_373_640_000,
          scopes: [ExtensionConnectScope.VaultAccess],
          providers: [],
        },
        eventLogRecords,
      },
    }
  }

  test('delivers an approved grant through the extension callback', async () => {
    const sendMessage = vi.fn(
      (...args: [string, unknown, (response?: unknown) => void]) => {
        args[2]({ ok: true, eventCount: 1 })
      },
    )
    vi.stubGlobal('chrome', { runtime: { sendMessage } })

    await expect(
      extensionConnectionBrowser.deliverExtensionPairingApproval(
        approvalDeliveryArgs(),
      ),
    ).resolves.toEqual({
      kind: ExtensionPairingDeliveryKind.Delivered,
      eventCount: 1,
    })
    expect(sendMessage).toHaveBeenCalledOnce()
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

  test('classifies plaintext provider migration rejection', async () => {
    vi.useFakeTimers()
    const sendMessage = vi.fn(
      (...args: [string, unknown, (response?: unknown) => void]) => {
        args[2]({ reason: 'auth-provider-plaintext-migration-required' })
      },
    )
    vi.stubGlobal('chrome', { runtime: { sendMessage } })

    const delivery = extensionConnectionBrowser.deliverExtensionPairingApproval(
      approvalDeliveryArgs(),
    )
    await vi.runAllTimersAsync()
    await expect(delivery).resolves.toEqual({
      kind: ExtensionPairingDeliveryKind.PlaintextProviderMigrationRequired,
    })
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

  test('rejects a malformed successful acknowledgement instead of trusting its ok flag', () => {
    const decoded = Effect.runSync(
      Effect.either(
        pairingApprovalResponseDecoder.decode({
          ok: true,
          reason: ExtensionPairingRejectionReason.EventLogAccessNotGranted,
        }),
      ),
    )

    expect(decoded._tag).toBe('Left')
  })

  test('rejects conflicting reason and error responses instead of choosing one field', () => {
    const decoded = Effect.runSync(
      Effect.either(
        pairingApprovalResponseDecoder.decode({
          ok: false,
          reason: ExtensionPairingRejectionReason.ExtensionRuntimeUnavailable,
          error: ExtensionPairingRejectionReason.EventLogAccessNotGranted,
        }),
      ),
    )

    expect(decoded._tag).toBe('Left')
  })

  test.each([-1, 1.5, Number.POSITIVE_INFINITY, Number.NaN])(
    'rejects invalid imported event count %s',
    (eventCount) => {
      const decoded = Effect.runSync(
        Effect.either(
          pairingApprovalResponseDecoder.decode({ ok: true, eventCount }),
        ),
      )

      expect(decoded._tag).toBe('Left')
    },
  )

  test('accepts complete approved grants', () => {
    expect(
      Effect.runSync(
        Effect.either(
          ExtensionPairingApprovedMessageSchema.decode({
            type: 'nook:extension-pairing-approved',
            payload: {
              vaultType: simplePairingVaultType,
              deviceId: 'device-1',
              devicePublicKey: 'age1device',
              deviceSigningPublicKey: 'signing-key',
              deviceLabel: 'Nook Extension',
              vaultStoreId: 'store_abcdefghijk',
              vaultName: 'Personal',
              approvedAt: 1_783_373_640_000,
              scopes: [ExtensionConnectScope.VaultAccess],
              providers: [],
            },
            eventLogRecords,
          }),
        ),
      )._tag,
    ).toBe('Right')
  })

  test('rejects ISO approval timestamps at the new-grant browser boundary', () => {
    const message = approvalDeliveryArgs().message
    const admission = Effect.runSync(
      Effect.either(
        ExtensionPairingApprovedMessageSchema.decode({
          ...message,
          payload: {
            ...message.payload,
            approvedAt: '2026-07-07T00:00:00.000Z',
          },
        }),
      ),
    )
    expect(admission._tag).toBe('Left')
  })

  test('preserves complete provider payloads for extension import', () => {
    const provider = {
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
    }
    const message = approvalDeliveryArgs().message
    const admission = Effect.runSync(
      Effect.either(
        ExtensionPairingApprovedMessageSchema.decode({
          ...message,
          payload: { ...message.payload, providers: [provider] },
        }),
      ),
    )

    expect(admission._tag).toBe('Right')
    if (admission._tag === 'Left') return
    expect(admission.right.payload.providers).toEqual([provider])
  })

  test('rejects identity-only provider rows at pairing admission', () => {
    const message = approvalDeliveryArgs().message
    const admission = Effect.runSync(
      Effect.either(
        ExtensionPairingApprovedMessageSchema.decode({
          ...message,
          payload: {
            ...message.payload,
            providers: [{ id: 'github-1', type: 'github' }],
          },
        }),
      ),
    )
    expect(admission._tag).toBe('Left')
  })

  test('classifies empty approved grant event records without payload values', () => {
    const message = approvalDeliveryArgs().message
    const admission = Effect.runSync(
      Effect.either(
        ExtensionPairingApprovedMessageSchema.decode({
          ...message,
          eventLogRecords: [],
        }),
      ),
    )
    expect(admission._tag).toBe('Left')
  })

  test.each([
    [false, RuntimeMessageDecodeFailureKind.ExtensionPairingApprovedMessage],
    [
      [{ path: 'events/one', event: { schema_version: 3 } }],
      RuntimeMessageDecodeFailureKind.ExtensionEventLogRecord,
    ],
    [
      [{ eventId: 'one', event: { schema_version: 3 } }],
      RuntimeMessageDecodeFailureKind.ExtensionEventLogRecord,
    ],
    [
      [{ eventId: 'one', path: 'events/one', event: false }],
      RuntimeMessageDecodeFailureKind.ExtensionEventLogRecord,
    ],
    [
      [{ eventId: 'one', path: 'events/one', event: {} }],
      RuntimeMessageDecodeFailureKind.ExtensionEventLogRecord,
    ],
  ] as const)(
    'classifies event record clause %#',
    (eventLogRecords, expectedFailureKind) => {
      const message = approvalDeliveryArgs().message
      const admission = Effect.runSync(
        Effect.either(
          ExtensionPairingApprovedMessageSchema.decode({
            ...message,
            eventLogRecords,
          }),
        ),
      )

      if (admission._tag === 'Right') {
        expect.fail('invalid event-log records must not be admitted')
      }
      expect(admission.left.kind).toBe(expectedFailureKind)
    },
  )

  test('rejects Sentinel grants before extension persistence', () => {
    expect(
      Effect.runSync(
        Effect.either(
          ExtensionPairingApprovedMessageSchema.decode({
            type: 'nook:extension-pairing-approved',
            payload: {
              vaultType: 'sentinel',
              deviceId: 'device-1',
              devicePublicKey: 'age1device',
              deviceSigningPublicKey: 'signing-key',
              deviceLabel: 'Forged Sentinel device',
              vaultStoreId: 'store_abcdefghijk',
              vaultName: 'Sentinel',
              approvedAt: 1_783_373_640_000,
              scopes: [ExtensionConnectScope.VaultAccess],
              providers: [],
            },
            eventLogRecords,
          }),
        ),
      )._tag,
    ).toBe('Left')
  })

  test('accepts encrypted local event-log notifications and rejects empty snapshots', () => {
    expect(
      Effect.runSync(
        Effect.either(
          ExtensionLocalEventLogUpdatedMessageGuard.decode({
            type: 'nook:extension-local-event-log-updated',
            payload: {
              vaultStoreId: 'store_abcdefghijk',
              eventLogRecords,
            },
          }),
        ),
      )._tag,
    ).toBe('Right')
    expect(
      Effect.runSync(
        Effect.either(
          ExtensionLocalEventLogUpdatedMessageGuard.decode({
            type: 'nook:extension-local-event-log-updated',
            payload: {
              vaultStoreId: 'store_abcdefghijk',
              eventLogRecords: [],
            },
          }),
        ),
      )._tag,
    ).toBe('Left')
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
      Effect.either(decodeExtensionReadySetupState(setup)),
    )
    if (admittedSetup._tag === 'Left') {
      throw new Error('expected a ready extension setup')
    }
    const readySetup = admittedSetup.right
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
      Effect.runSync(Effect.either(decodeExtensionReadySetupState({})))._tag,
    ).toBe('Left')
    expect(
      Effect.runSync(
        Effect.either(
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
    ).toBe('Left')
    expect(
      Effect.runSync(
        Effect.either(
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
    ).toBe('Left')
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
      Effect.either(
        decodeStoredExtensionPairingGrant(
          approved[pairingGrantStorageKey('store_abcdefghijk')],
        ),
      ),
    )
    if (decodedGrant._tag === 'Left') {
      throw new Error('expected the approved pairing grant')
    }
    const grant = decodedGrant.right

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

  test('migrates the uniquely selected valid legacy grant into Rexie shape', () => {
    const currentStorageItemsArgs: Parameters<
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
        eventCount: 3,
        heads: ['event-3'],
        accessGranted: true,
      },
    }
    const current = extensionPairingGrantStorageItems(currentStorageItemsArgs)
    const key = pairingGrantStorageKey('store_abcdefghijk')
    const decodedCurrentGrant = Effect.runSync(
      Effect.either(decodeStoredExtensionPairingGrant(current[key])),
    )
    if (decodedCurrentGrant._tag === 'Left') {
      throw new Error('expected a stored extension pairing grant')
    }
    const currentGrant = decodedCurrentGrant.right
    const { eventCount, eventLogHeads, lastLocalSyncAt, ...legacyGrant } =
      currentGrant
    const decodedCurrentSetup = Effect.runSync(
      Effect.either(decodeExtensionReadySetupState(current[setupStorageKey])),
    )
    if (decodedCurrentSetup._tag === 'Left') {
      throw new Error('expected a ready extension setup')
    }
    const currentSetup = decodedCurrentSetup.right
    const { selectedVaultStoreId: _selectedVaultStoreId, ...legacySetup } =
      currentSetup
    void _selectedVaultStoreId
    const legacyStoredGrant: LegacyPairingStorageObject = {
      ...legacyGrant,
      approvedAt: '2026-07-25T00:00:00.000Z',
    }
    const migrated = migratedLegacyPairingStorageItems({
      [key]: legacyStoredGrant,
      [setupStorageKey]: legacySetup,
    })

    expect(eventCount).toBe(3)
    expect(eventLogHeads).toEqual(['event-3'])
    expect(lastLocalSyncAt).toEqual(expect.any(String))
    expect(migrated[key]).toMatchObject({
      eventCount: 3,
      eventLogHeads: ['event-3'],
      lastLocalSyncAt,
    })

    expect(
      migratedLegacyPairingStorageItems({
        [key]: legacyGrant,
        [pairingGrantStorageKey('store_otherid0001')]: {
          ...legacyGrant,
          vaultStoreId: 'store_otherid0001',
        },
        [setupStorageKey]: legacySetup,
      }),
    ).toEqual({})
  })
})
