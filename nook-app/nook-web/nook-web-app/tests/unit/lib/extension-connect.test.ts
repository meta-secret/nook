import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  ExtensionConnectIntentKind,
  ExtensionConnectionIntentProjection,
} from '$lib/app/route-state'
import {
  ExtensionConnectScope,
  ExtensionIdentityRequestSource,
  ExtensionConnectRequestStateKind,
  ExtensionPairingDeliveryKind,
  ExtensionPairingRejectionReason,
  extensionConnectionBrowser,
} from '$lib/extension/connect'
import {
  BeginExtensionPairingMessage as BeginExtensionPairingMessageGuard,
  ExtensionLocalEventLogUpdatedMessage as ExtensionLocalEventLogUpdatedMessageGuard,
  OpenCompanionLauncherMessage as OpenCompanionLauncherMessageGuard,
  OpenCompanionLauncherIntent,
  ExtensionPairingApprovedMessageAdmissionFailure,
  ExtensionPairingApprovedMessageType,
  ExtensionIdentityHandoffRequestMessage as ExtensionIdentityHandoffRequestMessageSchema,
  ExtensionPairingApprovedMessage as ExtensionPairingApprovedMessageSchema,
} from '../../../../nook-web-shared/src/extension/runtime-messages'
import {
  extensionPairingGrantPolicyReady,
  setupStorageKey,
} from '../../../../nook-web-extension/src/background/pairing-grants'

const {
  extensionPairingGrantStorageItems,
  extensionStoredPairingGrantStorageItems,
  isStoredExtensionPairingGrant,
  isExtensionReadySetupState,
  migratedLegacyPairingStorageItems,
  pairingGrantStorageKey,
  selectedPairingGrant,
  selectedPairingGrantFirst,
  setupAfterPairingGrantRemoval,
} = await extensionPairingGrantPolicyReady

function locationFromUrl(url: string): Location {
  return new URL(url) as unknown as Location
}

afterEach(() => {
  document.documentElement.removeAttribute('data-nook-extension-runtime-id')
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('extension connect route parsing', () => {
  test('accepts the canonical extension-connect path', () => {
    expect(
      extensionConnectionBrowser.isExtensionConnectPath('/extension-connect'),
    ).toBe(true)
    expect(
      extensionConnectionBrowser.isExtensionConnectPath('/extension-connect/'),
    ).toBe(true)
    expect(extensionConnectionBrowser.isExtensionConnectPath('/vault')).toBe(
      false,
    )
  })

  test('parses complete pairing requests', () => {
    const request =
      extensionConnectionBrowser.extensionConnectRequestFromLocation(
        locationFromUrl(
          'https://nokey.sh/extension-connect?device_id=device-1&device_public_key=enc-pk&device_signing_public_key=sign-pk&extension_id=ext-123&device_label=Nook%20Extension&nonce=n-1&scopes=vault-access,password-filling,sync-provider-credentials',
        ),
      )

    expect(request).toEqual({
      kind: ExtensionConnectRequestStateKind.Requested,
      request: {
        source: ExtensionIdentityRequestSource.ExtensionConnect,
        deviceId: 'device-1',
        devicePublicKey: 'enc-pk',
        deviceSigningPublicKey: 'sign-pk',
        extensionRuntimeId: 'ext-123',
        deviceLabel: 'Nook Extension',
        nonce: 'n-1',
        scopes: [
          ExtensionConnectScope.VaultAccess,
          ExtensionConnectScope.PasswordFilling,
          ExtensionConnectScope.SyncProviderCredentials,
        ],
      },
    })
  })

  test('rejects requests that cannot deliver the grant to an extension', () => {
    const request =
      extensionConnectionBrowser.extensionConnectRequestFromLocation(
        locationFromUrl(
          'https://nokey.sh/extension-connect?device_id=device-1&device_public_key=enc-pk&device_signing_public_key=sign-pk&nonce=n-1&scopes=vault-access',
        ),
      )

    expect(new ExtensionConnectionIntentProjection(request).intent).toEqual({
      kind: ExtensionConnectIntentKind.Absent,
    })
  })

  test('rejects the removed website-first setup link', () => {
    expect(
      new ExtensionConnectionIntentProjection(
        extensionConnectionBrowser.extensionConnectRequestFromLocation(
          locationFromUrl(
            'https://simple.nokey.sh/extension-connect?extension_id=ext-123',
          ),
        ),
      ).intent,
    ).toEqual({ kind: ExtensionConnectIntentKind.Absent })
  })
})

describe('installed extension launcher', () => {
  test('asks the detected extension to open its authenticated pairing UI', async () => {
    document.documentElement.setAttribute(
      'data-nook-extension-runtime-id',
      'extension-123',
    )
    const sendMessage = vi.fn(
      (
        extensionId: string,
        message: unknown,
        callback: (response: unknown) => void,
      ) => {
        expect(extensionId).toBe('extension-123')
        expect(message).toEqual({
          type: 'nook:open-companion-launcher',
          payload: { intent: OpenCompanionLauncherIntent.Pair },
        })
        callback({ ok: true })
      },
    )
    vi.stubGlobal('chrome', {
      runtime: { sendMessage },
    })

    await expect(
      extensionConnectionBrowser.openInstalledExtension(),
    ).resolves.toBe(true)
    expect(sendMessage).toHaveBeenCalledOnce()
  })

  test('does not attempt to launch an extension that is no longer detected', async () => {
    const sendMessage = vi.fn()
    vi.stubGlobal('chrome', {
      runtime: { sendMessage },
    })

    await expect(
      extensionConnectionBrowser.openInstalledExtension(),
    ).resolves.toBe(false)
    expect(sendMessage).not.toHaveBeenCalled()
  })

  test('accepts only the supported companion launcher intent', () => {
    expect(
      OpenCompanionLauncherMessageGuard.is({
        type: 'nook:open-companion-launcher',
        payload: { intent: OpenCompanionLauncherIntent.Pair },
      }),
    ).toBe(true)
    expect(
      OpenCompanionLauncherMessageGuard.is({
        type: 'nook:open-companion-launcher',
        payload: { intent: 'forget-vault' },
      }),
    ).toBe(false)
  })
})

describe('extension pairing approved message', () => {
  const eventLogRecords = [
    {
      eventId: 'event-1',
      path: 'events/event-1.yaml',
      event: {
        schema_version: 2,
        store_id: 'store-1',
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
          vaultType: 'simple',
          deviceId: 'device-1',
          devicePublicKey: 'age1device',
          deviceSigningPublicKey: 'signing-key',
          deviceLabel: 'Nook Extension',
          vaultStoreId: 'store-1',
          vaultName: 'Personal',
          approvedAt: '2026-07-07T00:00:00.000Z',
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
        args[2]({ ok: true })
      },
    )
    vi.stubGlobal('chrome', { runtime: { sendMessage } })

    await expect(
      extensionConnectionBrowser.deliverExtensionPairingApproval(
        approvalDeliveryArgs(),
      ),
    ).resolves.toEqual({ kind: ExtensionPairingDeliveryKind.Delivered })
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
        args[2]({ ok: true })
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
        window.setTimeout(() => args[2]({ ok: true }), 6_000)
      },
    )
    vi.stubGlobal('chrome', { runtime: { sendMessage } })

    const delivery = extensionConnectionBrowser.deliverExtensionPairingApproval(
      approvalDeliveryArgs(),
    )
    await vi.advanceTimersByTimeAsync(6_000)

    await expect(delivery).resolves.toEqual({
      kind: ExtensionPairingDeliveryKind.Delivered,
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

  test('accepts complete approved grants', () => {
    expect(
      ExtensionPairingApprovedMessageSchema.is({
        type: 'nook:extension-pairing-approved',
        payload: {
          vaultType: 'simple',
          deviceId: 'device-1',
          devicePublicKey: 'age1device',
          deviceSigningPublicKey: 'signing-key',
          deviceLabel: 'Nook Extension',
          vaultStoreId: 'store-1',
          vaultName: 'Personal',
          approvedAt: '2026-07-07T00:00:00.000Z',
          scopes: [ExtensionConnectScope.VaultAccess],
          providers: [{ id: 'local-1', type: 'local' }],
        },
        eventLogRecords,
      }),
    ).toBe(true)
  })

  test('classifies invalid approved grant clauses without payload values', () => {
    const message = approvalDeliveryArgs().message
    const admission = ExtensionPairingApprovedMessageSchema.parse({
      ...message,
      eventLogRecords: [],
    })

    expect(admission.isErr() ? admission.error : 'admitted').toBe(
      ExtensionPairingApprovedMessageAdmissionFailure.EventLogRecords,
    )
  })

  test('rejects Sentinel grants before extension persistence', () => {
    expect(
      ExtensionPairingApprovedMessageSchema.is({
        type: 'nook:extension-pairing-approved',
        payload: {
          vaultType: 'sentinel',
          deviceId: 'device-1',
          devicePublicKey: 'age1device',
          deviceSigningPublicKey: 'signing-key',
          deviceLabel: 'Forged Sentinel device',
          vaultStoreId: 'store-1',
          vaultName: 'Sentinel',
          approvedAt: '2026-07-07T00:00:00.000Z',
          scopes: [ExtensionConnectScope.VaultAccess],
          providers: [],
        },
        eventLogRecords,
      }),
    ).toBe(false)
  })

  test('accepts encrypted local event-log notifications and rejects empty snapshots', () => {
    expect(
      ExtensionLocalEventLogUpdatedMessageGuard.is({
        type: 'nook:extension-local-event-log-updated',
        payload: {
          vaultStoreId: 'store-1',
          eventLogRecords,
        },
      }),
    ).toBe(true)
    expect(
      ExtensionLocalEventLogUpdatedMessageGuard.is({
        type: 'nook:extension-local-event-log-updated',
        payload: {
          vaultStoreId: 'store-1',
          eventLogRecords: [],
        },
      }),
    ).toBe(false)
  })

  test('maps approved grants into extension-owned storage keys', () => {
    const storageItemsArgs: Parameters<
      typeof extensionPairingGrantStorageItems
    >[0] = {
      grant: {
        vaultType: 'simple',
        deviceId: 'device-1',
        devicePublicKey: 'age1device',
        deviceSigningPublicKey: 'signing-key',
        deviceLabel: 'Nook Extension',
        vaultStoreId: 'store-1',
        vaultName: 'Personal',
        approvedAt: '2026-07-07T00:00:00.000Z',
        scopes: [
          ExtensionConnectScope.VaultAccess,
          ExtensionConnectScope.SyncProviderCredentials,
        ],
        syncProviderCount: 2,
      },
      imported: {
        vaultStoreId: 'store-1',
        eventCount: 3,
        heads: ['event-3'],
        accessGranted: true,
      },
    }
    const items = extensionPairingGrantStorageItems(storageItemsArgs)

    expect(items[pairingGrantStorageKey('store-1')]).toMatchObject({
      deviceId: 'device-1',
      vaultStoreId: 'store-1',
      syncProviderCount: 2,
    })
    expect(items[pairingGrantStorageKey('store-1')]).not.toHaveProperty(
      'providers',
    )
    expect(items[setupStorageKey]).toEqual({
      status: 'ready',
      deviceLabel: 'Nook Extension',
      pairedVaults: ['Personal'],
      selectedVaultStoreId: 'store-1',
      selectedVaultName: 'Personal',
      syncProviderCount: 2,
      eventCount: 3,
      eventLogHeads: ['event-3'],
      lastLocalSyncAt: expect.any(String),
    })
    expect(isExtensionReadySetupState(items[setupStorageKey])).toBe(true)
  })

  test('does not present incomplete or revoked setup as connected', () => {
    expect(isExtensionReadySetupState({})).toBe(false)
    expect(
      isExtensionReadySetupState({
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
    ).toBe(false)
    expect(
      isExtensionReadySetupState({
        status: 'revoked',
        deviceLabel: 'Nook Extension',
        pairedVaults: ['Personal'],
        selectedVaultStoreId: 'store-1',
        selectedVaultName: 'Personal',
        syncProviderCount: 0,
        eventCount: 1,
        eventLogHeads: ['event-1'],
        lastLocalSyncAt: '2026-07-07T00:00:00.000Z',
      }),
    ).toBe(false)
  })

  test('keeps passive updates from selecting another paired vault', () => {
    const approvedStorageItemsArgs: Parameters<
      typeof extensionPairingGrantStorageItems
    >[0] = {
      grant: {
        vaultType: 'simple',
        deviceId: 'device-1',
        devicePublicKey: 'age1device',
        deviceSigningPublicKey: 'signing-key',
        deviceLabel: 'Nook Extension',
        vaultStoreId: 'store-1',
        vaultName: 'Personal',
        approvedAt: '2026-07-25T00:00:00.000Z',
        scopes: [ExtensionConnectScope.VaultAccess],
        syncProviderCount: 0,
      },
      imported: {
        vaultStoreId: 'store-1',
        eventCount: 2,
        heads: ['event-2'],
        accessGranted: true,
      },
    }
    const approved = extensionPairingGrantStorageItems(approvedStorageItemsArgs)
    const grant = approved[pairingGrantStorageKey('store-1')]
    if (!isStoredExtensionPairingGrant(grant)) {
      throw new Error('expected the approved pairing grant')
    }

    const passiveStorageItemsArgs: Parameters<
      typeof extensionStoredPairingGrantStorageItems
    >[0] = {
      grant,
      imported: {
        vaultStoreId: 'store-1',
        eventCount: 3,
        heads: ['event-3'],
        accessGranted: true,
      },
      select: false,
    }
    const passive = extensionStoredPairingGrantStorageItems(
      passiveStorageItemsArgs,
    )

    expect(passive[pairingGrantStorageKey('store-1')]).toMatchObject({
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
        vaultType: 'simple',
        deviceId: 'device-1',
        devicePublicKey: 'age1device',
        deviceSigningPublicKey: 'signing-key',
        deviceLabel: 'Nook Extension',
        vaultStoreId: 'store-1',
        vaultName: 'Personal',
        approvedAt: '2026-07-24T00:00:00.000Z',
        scopes: [ExtensionConnectScope.VaultAccess],
        syncProviderCount: 0,
      },
      imported: {
        vaultStoreId: 'store-1',
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
        vaultType: 'simple',
        deviceId: 'device-1',
        devicePublicKey: 'age1device',
        deviceSigningPublicKey: 'signing-key',
        deviceLabel: 'Nook Extension',
        vaultStoreId: 'store-2',
        vaultName: 'Work',
        approvedAt: '2026-07-25T00:00:00.000Z',
        scopes: [ExtensionConnectScope.VaultAccess],
        syncProviderCount: 0,
      },
      imported: {
        vaultStoreId: 'store-2',
        eventCount: 4,
        heads: ['event-4'],
        accessGranted: true,
      },
    }
    const second = extensionPairingGrantStorageItems(secondStorageItemsArgs)
    const stored = { ...first, ...second }

    const removalArgs: Parameters<typeof setupAfterPairingGrantRemoval>[0] = {
      stored,
      removedVaultStoreId: 'store-2',
    }
    expect(setupAfterPairingGrantRemoval(removalArgs)).toEqual({
      kind: 'ready',
      setup: expect.objectContaining({
        selectedVaultStoreId: 'store-1',
        selectedVaultName: 'Personal',
        eventCount: 2,
      }),
    })
    expect(selectedPairingGrantFirst(stored)[0]?.vaultStoreId).toBe('store-2')
    expect(selectedPairingGrant(stored)).toEqual({
      kind: 'selected',
      grant: expect.objectContaining({ vaultStoreId: 'store-2' }),
    })
  })

  test('migrates the uniquely selected valid legacy grant into Rexie shape', () => {
    const currentStorageItemsArgs: Parameters<
      typeof extensionPairingGrantStorageItems
    >[0] = {
      grant: {
        vaultType: 'simple',
        deviceId: 'device-1',
        devicePublicKey: 'age1device',
        deviceSigningPublicKey: 'signing-key',
        deviceLabel: 'Nook Extension',
        vaultStoreId: 'store-1',
        vaultName: 'Personal',
        approvedAt: '2026-07-25T00:00:00.000Z',
        scopes: [ExtensionConnectScope.VaultAccess],
        syncProviderCount: 0,
      },
      imported: {
        vaultStoreId: 'store-1',
        eventCount: 3,
        heads: ['event-3'],
        accessGranted: true,
      },
    }
    const current = extensionPairingGrantStorageItems(currentStorageItemsArgs)
    const key = pairingGrantStorageKey('store-1')
    const currentGrant = current[key]
    if (!isStoredExtensionPairingGrant(currentGrant)) {
      throw new Error('expected a stored extension pairing grant')
    }
    const { eventCount, eventLogHeads, lastLocalSyncAt, ...legacyGrant } =
      currentGrant
    const currentSetup = current[setupStorageKey]
    if (!isExtensionReadySetupState(currentSetup)) {
      throw new Error('expected a ready extension setup')
    }
    const { selectedVaultStoreId: _selectedVaultStoreId, ...legacySetup } =
      currentSetup
    void _selectedVaultStoreId
    const migrated = migratedLegacyPairingStorageItems({
      [key]: legacyGrant,
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
        [pairingGrantStorageKey('store-2')]: {
          ...legacyGrant,
          vaultStoreId: 'store-2',
        },
        [setupStorageKey]: legacySetup,
      }),
    ).toEqual({})
  })
})

describe('extension-owned pairing start', () => {
  test('requires the complete extension device request', () => {
    expect(
      BeginExtensionPairingMessageGuard.is({
        type: 'nook:begin-extension-pairing',
        payload: {
          deviceId: 'device-1',
          devicePublicKey: 'age1device',
          deviceSigningPublicKey: 'signing-key',
          deviceLabel: 'Nook Extension',
        },
      }),
    ).toBe(true)
    expect(
      BeginExtensionPairingMessageGuard.is({
        type: 'nook:begin-extension-pairing',
        payload: {
          deviceId: 'device-1',
          devicePublicKey: '',
          deviceSigningPublicKey: 'signing-key',
          deviceLabel: 'Nook Extension',
        },
      }),
    ).toBe(false)
  })

  test('requires complete nonce-bound identity handoff requests', () => {
    const message = {
      type: 'nook:extension-identity-handoff-request',
      payload: {
        recipientPublicKey: 'age1recipient',
        nonce: 'nonce-1',
        expectedDeviceId: 'device-1',
        expectedDevicePublicKey: 'age1device',
        expectedDeviceSigningPublicKey: 'signing-key',
      },
    }
    expect(ExtensionIdentityHandoffRequestMessageSchema.is(message)).toBe(true)
    expect(
      ExtensionIdentityHandoffRequestMessageSchema.is({
        ...message,
        payload: { ...message.payload, nonce: '' },
      }),
    ).toBe(false)
  })
})

describe('paired extension unlock request', () => {
  test('accepts only the response bound to its request and vault', async () => {
    document.documentElement.setAttribute(
      'data-nook-extension-runtime-id',
      'extension-1',
    )
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: (
          extensionId: string,
          message: {
            payload: { requestId: string; vaultStoreId: string }
          },
          callback: (response: unknown) => void,
        ) => {
          expect(extensionId).toBe('extension-1')
          callback({
            ok: true,
            requestId: message.payload.requestId,
            vaultStoreId: message.payload.vaultStoreId,
          })
        },
      },
    })

    await expect(
      extensionConnectionBrowser.requestPairedExtensionUnlock('store-1'),
    ).resolves.toBe(true)
  })

  test('stops waiting when extension messaging does not answer', async () => {
    vi.useFakeTimers()
    document.documentElement.setAttribute(
      'data-nook-extension-runtime-id',
      'extension-1',
    )
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: () => {},
      },
    })

    const result =
      extensionConnectionBrowser.requestPairedExtensionUnlock('store-1')
    await vi.advanceTimersByTimeAsync(5_000)
    await expect(result).resolves.toBe(false)
  })
})
