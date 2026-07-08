import { describe, expect, test } from 'vitest'
import {
  extensionConnectRequestFromLocation,
  isExtensionConnectPath,
} from '$lib/extension-connect'
import { isExtensionPairingApprovedMessage } from '../../../../nook-web-shared/src/extension/runtime-messages'
import {
  extensionPairingGrantStorageItems,
  pairingGrantStorageKey,
  setupStorageKey,
} from '../../../../nook-web-extension/src/background/pairing-grants'

function locationFromUrl(url: string): Location {
  return new URL(url) as unknown as Location
}

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
})

describe('extension pairing approved message', () => {
  test('accepts complete approved grants', () => {
    expect(
      isExtensionPairingApprovedMessage({
        type: 'nook:extension-pairing-approved',
        payload: {
          deviceId: 'device-1',
          deviceLabel: 'Nook Extension',
          vaultStoreId: 'store-1',
          vaultName: 'Personal',
          approvedAt: '2026-07-07T00:00:00.000Z',
          scopes: ['vault-access'],
          providers: [{ id: 'local-1', type: 'local' }],
        },
      }),
    ).toBe(true)
  })

  test('maps approved grants into extension-owned storage keys', () => {
    const items = extensionPairingGrantStorageItems({
      deviceId: 'device-1',
      deviceLabel: 'Nook Extension',
      vaultStoreId: 'store-1',
      vaultName: 'Personal',
      approvedAt: '2026-07-07T00:00:00.000Z',
      scopes: ['vault-access', 'sync-provider-credentials'],
      providers: [
        { id: 'local-1', type: 'local' },
        { id: 'gh-1', type: 'github' },
      ],
    })

    expect(items[pairingGrantStorageKey('store-1')]).toMatchObject({
      deviceId: 'device-1',
      vaultStoreId: 'store-1',
    })
    expect(items[setupStorageKey]).toEqual({
      status: 'ready',
      deviceLabel: 'Nook Extension',
      pairedVaults: ['Personal'],
      selectedVaultName: 'Personal',
      syncStatus: '2 sync providers granted',
    })
  })
})
