import { describe, expect, test } from 'vitest'
import type { PairedExtensionIdentityDiscovery } from '../../../../nook-web-shared/src/vault-app/lib/extension/connect'
import { ExtensionPairedVaultIdentityStatusMessageStatus } from '../../../../nook-web-shared/src/extension/paired-vault-identity-status'
import { ExtensionIdentityRequestSource } from '../../../../nook-web-shared/src/extension/extension-connect-types'
import {
  LoginVaultExtensionPairingStatusKind,
  LoginVaultExtensionPairingStatusLookup,
  LoginVaultExtensionPairingStatusProjection,
} from '../../../../nook-web-shared/src/vault-app/lib/components/login/login-vault-extension-pairing-status'

describe('LoginVaultExtensionPairingStatusProjection', () => {
  test('marks locked and unlocked local vaults as paired', () => {
    const locked: PairedExtensionIdentityDiscovery = {
      status: ExtensionPairedVaultIdentityStatusMessageStatus.Locked,
    }
    const unlocked: PairedExtensionIdentityDiscovery = {
      status: ExtensionPairedVaultIdentityStatusMessageStatus.Unlocked,
      request: {
        source: ExtensionIdentityRequestSource.ExtensionConnect,
        deviceId: 'device-id',
        devicePublicKey: 'public-key',
        deviceSigningPublicKey: 'signing-public-key',
        extensionRuntimeId: 'runtime-id',
        deviceLabel: 'Browser extension',
        nonce: 'nonce',
        scopes: [],
      },
    }

    expect(new LoginVaultExtensionPairingStatusProjection(locked).status).toEqual({
      kind: LoginVaultExtensionPairingStatusKind.Paired,
    })
    expect(new LoginVaultExtensionPairingStatusProjection(unlocked).status).toEqual({
      kind: LoginVaultExtensionPairingStatusKind.Paired,
    })
  })

  test('marks a different vault as not paired and preserves its typed identity', () => {
    const discovery: PairedExtensionIdentityDiscovery = {
      status: ExtensionPairedVaultIdentityStatusMessageStatus.DifferentVault,
      connectedVaultStoreId: 'paired-store-id',
      connectedVaultName: 'Personal vault',
    }

    expect(new LoginVaultExtensionPairingStatusProjection(discovery).status).toEqual({
      kind: LoginVaultExtensionPairingStatusKind.NotPaired,
      connectedVault: {
        storeId: 'paired-store-id',
        name: 'Personal vault',
      },
    })
  })

  test('keeps unavailable as unknown and does not attach a connected identity', () => {
    const discovery: PairedExtensionIdentityDiscovery = {
      status: ExtensionPairedVaultIdentityStatusMessageStatus.Unavailable,
    }

    expect(new LoginVaultExtensionPairingStatusProjection(discovery).status).toEqual({
      kind: LoginVaultExtensionPairingStatusKind.Unavailable,
    })
  })
})

describe('LoginVaultExtensionPairingStatusLookup', () => {
  test('returns status only for the matching local vault store', () => {
    const lookup = new LoginVaultExtensionPairingStatusLookup({
      entries: [
        {
          storeId: 'paired-store',
          kind: LoginVaultExtensionPairingStatusKind.Paired,
        },
        {
          storeId: 'other-store',
          kind: LoginVaultExtensionPairingStatusKind.NotPaired,
          connectedVault: {
            storeId: 'paired-store',
            name: 'Personal vault',
          },
        },
      ],
    })

    expect(lookup.statusForStore('paired-store')).toEqual({
      kind: LoginVaultExtensionPairingStatusKind.Paired,
    })
    expect(lookup.statusForStore('other-store')).toEqual({
      kind: LoginVaultExtensionPairingStatusKind.NotPaired,
      connectedVault: {
        storeId: 'paired-store',
        name: 'Personal vault',
      },
    })
    expect(lookup.statusForStore('unknown-store')).toEqual({
      kind: LoginVaultExtensionPairingStatusKind.NotShown,
    })
  })
})
