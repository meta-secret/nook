import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  extensionConnectRequestFromLocation,
  isExtensionConnectPath,
  openInstalledExtension,
  requestPairedExtensionUnlock,
} from '$lib/extension-connect'
import {
  isBeginExtensionPairingMessage,
  isExtensionIdentityHandoffRequestMessage,
  isExtensionLocalEventLogUpdatedMessage,
  isOpenCompanionLauncherMessage,
  isExtensionPairedVaultIdentityDiscoveryMessage,
  isExtensionPairedVaultIdentityHandoffRequestMessage,
  isExtensionPairedVaultIdentityStatusMessage,
  isExtensionPairedVaultUnlockRequestMessage,
  isExtensionPairingApprovedMessage,
} from '../../../../nook-web-shared/src/extension/runtime-messages'
import {
  extensionPairingGrantStorageItems,
  isExtensionReadySetupState,
  pairingGrantStorageKey,
  setupStorageKey,
} from '../../../../nook-web-extension/src/background/pairing-grants'

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
    expect(isExtensionConnectPath('/extension-connect')).toBe(true)
    expect(isExtensionConnectPath('/extension-connect/')).toBe(true)
    expect(isExtensionConnectPath('/vault')).toBe(false)
  })

  test('parses complete pairing requests', () => {
    const request = extensionConnectRequestFromLocation(
      locationFromUrl(
        'https://nokey.sh/extension-connect?device_id=device-1&device_public_key=enc-pk&device_signing_public_key=sign-pk&extension_id=ext-123&device_label=Nook%20Extension&nonce=n-1&scopes=vault-access,password-filling,sync-provider-credentials',
      ),
    )

    expect(request).toEqual({
      source: 'extension-connect',
      deviceId: 'device-1',
      devicePublicKey: 'enc-pk',
      deviceSigningPublicKey: 'sign-pk',
      extensionRuntimeId: 'ext-123',
      deviceLabel: 'Nook Extension',
      nonce: 'n-1',
      scopes: ['vault-access', 'password-filling', 'sync-provider-credentials'],
    })
  })

  test('rejects requests that cannot deliver the grant to an extension', () => {
    const request = extensionConnectRequestFromLocation(
      locationFromUrl(
        'https://nokey.sh/extension-connect?device_id=device-1&device_public_key=enc-pk&device_signing_public_key=sign-pk&nonce=n-1&scopes=vault-access',
      ),
    )

    expect(request).toBeUndefined()
  })

  test('rejects the removed website-first setup link', () => {
    expect(
      extensionConnectRequestFromLocation(
        locationFromUrl(
          'https://simple.nokey.sh/extension-connect?extension_id=ext-123',
        ),
      ),
    ).toBeUndefined()
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
          payload: { intent: 'pair' },
        })
        callback({ ok: true })
      },
    )
    vi.stubGlobal('chrome', {
      runtime: { sendMessage },
    })

    await expect(openInstalledExtension()).resolves.toBe(true)
    expect(sendMessage).toHaveBeenCalledOnce()
  })

  test('does not attempt to launch an extension that is no longer detected', async () => {
    const sendMessage = vi.fn()
    vi.stubGlobal('chrome', {
      runtime: { sendMessage },
    })

    await expect(openInstalledExtension()).resolves.toBe(false)
    expect(sendMessage).not.toHaveBeenCalled()
  })

  test('accepts only the supported companion launcher intent', () => {
    expect(
      isOpenCompanionLauncherMessage({
        type: 'nook:open-companion-launcher',
        payload: { intent: 'pair' },
      }),
    ).toBe(true)
    expect(
      isOpenCompanionLauncherMessage({
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
      event: { schema_version: 1 },
    },
  ]

  test('accepts complete approved grants', () => {
    expect(
      isExtensionPairingApprovedMessage({
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
          scopes: ['vault-access'],
          providers: [{ id: 'local-1', type: 'local' }],
        },
        eventLogRecords,
      }),
    ).toBe(true)
  })

  test('rejects Sentinel grants before extension persistence', () => {
    expect(
      isExtensionPairingApprovedMessage({
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
          scopes: ['vault-access'],
          providers: [],
        },
        eventLogRecords,
      }),
    ).toBe(false)
  })

  test('accepts encrypted local event-log notifications and rejects empty snapshots', () => {
    expect(
      isExtensionLocalEventLogUpdatedMessage({
        type: 'nook:extension-local-event-log-updated',
        payload: {
          vaultStoreId: 'store-1',
          eventLogRecords,
        },
      }),
    ).toBe(true)
    expect(
      isExtensionLocalEventLogUpdatedMessage({
        type: 'nook:extension-local-event-log-updated',
        payload: {
          vaultStoreId: 'store-1',
          eventLogRecords: [],
        },
      }),
    ).toBe(false)
  })

  test('maps approved grants into extension-owned storage keys', () => {
    const items = extensionPairingGrantStorageItems(
      {
        vaultType: 'simple',
        deviceId: 'device-1',
        devicePublicKey: 'age1device',
        deviceSigningPublicKey: 'signing-key',
        deviceLabel: 'Nook Extension',
        vaultStoreId: 'store-1',
        vaultName: 'Personal',
        approvedAt: '2026-07-07T00:00:00.000Z',
        scopes: ['vault-access', 'sync-provider-credentials'],
        providers: [
          { id: 'local-1', type: 'local' },
          { id: 'gh-1', type: 'github' },
        ],
      },
      {
        vaultStoreId: 'store-1',
        eventCount: 3,
        heads: ['event-3'],
        accessGranted: true,
      },
    )

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
      selectedVaultName: 'Personal',
      syncProviderCount: 2,
      eventCount: 3,
      eventLogHeads: ['event-3'],
      lastLocalSyncAt: expect.any(String),
    })
    expect(isExtensionReadySetupState(items[setupStorageKey])).toBe(true)
  })

  test('does not present incomplete or revoked setup as connected', () => {
    expect(isExtensionReadySetupState(undefined)).toBe(false)
    expect(
      isExtensionReadySetupState({
        status: 'ready',
        deviceLabel: 'Nook Extension',
        pairedVaults: [],
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
        selectedVaultName: 'Personal',
        syncProviderCount: 0,
        eventCount: 1,
        eventLogHeads: ['event-1'],
        lastLocalSyncAt: '2026-07-07T00:00:00.000Z',
      }),
    ).toBe(false)
  })
})

describe('extension-owned pairing start', () => {
  test('requires the complete extension device request', () => {
    expect(
      isBeginExtensionPairingMessage({
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
      isBeginExtensionPairingMessage({
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
    expect(isExtensionIdentityHandoffRequestMessage(message)).toBe(true)
    expect(
      isExtensionIdentityHandoffRequestMessage({
        ...message,
        payload: { ...message.payload, nonce: '' },
      }),
    ).toBe(false)
  })

  test('validates paired-vault discovery and nonce-bound handoff messages', () => {
    expect(
      isExtensionPairedVaultIdentityDiscoveryMessage({
        type: 'nook:extension-paired-vault-identity-discovery',
        payload: {
          requestId: 'request-1',
          vaultStoreId: 'store-1',
          expiresAt: Date.now() + 5_000,
        },
      }),
    ).toBe(true)
    expect(
      isExtensionPairedVaultIdentityDiscoveryMessage({
        type: 'nook:extension-paired-vault-identity-discovery',
        payload: {
          requestId: 'request-1',
          vaultStoreId: 'store-1',
          expiresAt: Date.now() - 1,
        },
      }),
    ).toBe(false)
    expect(
      isExtensionPairedVaultUnlockRequestMessage({
        type: 'nook:extension-paired-vault-unlock-request',
        payload: {
          requestId: 'request-1',
          vaultStoreId: 'store-1',
        },
      }),
    ).toBe(true)
    expect(
      isExtensionPairedVaultUnlockRequestMessage({
        type: 'nook:extension-paired-vault-unlock-request',
        payload: {
          requestId: 'request-1',
          vaultStoreId: '',
        },
      }),
    ).toBe(false)
    expect(
      isExtensionPairedVaultIdentityStatusMessage({
        type: 'nook:extension-paired-vault-identity-status',
        payload: {
          requestId: 'request-1',
          vaultStoreId: 'store-1',
          status: 'unlocked',
          extensionRuntimeId: 'extension-1',
          deviceId: 'device-1',
          devicePublicKey: 'age1device',
          deviceSigningPublicKey: 'signing-key',
          deviceLabel: 'Nook Extension',
          nonce: 'nonce-1',
          scopes: ['vault-access'],
        },
      }),
    ).toBe(true)
    expect(
      isExtensionPairedVaultIdentityHandoffRequestMessage({
        type: 'nook:extension-paired-vault-identity-handoff-request',
        payload: {
          vaultStoreId: 'store-1',
          recipientPublicKey: 'age1recipient',
          nonce: 'nonce-1',
          expectedDeviceId: 'device-1',
          expectedDevicePublicKey: 'age1device',
          expectedDeviceSigningPublicKey: 'signing-key',
        },
      }),
    ).toBe(true)
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

    await expect(requestPairedExtensionUnlock('store-1')).resolves.toBe(true)
  })

  test('stops waiting when extension messaging does not answer', async () => {
    vi.useFakeTimers()
    document.documentElement.setAttribute(
      'data-nook-extension-runtime-id',
      'extension-1',
    )
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: () => undefined,
      },
    })

    const result = requestPairedExtensionUnlock('store-1')
    await vi.advanceTimersByTimeAsync(5_000)
    await expect(result).resolves.toBe(false)
  })
})
