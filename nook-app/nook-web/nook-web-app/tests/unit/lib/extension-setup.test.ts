import { afterEach, describe, expect, test, vi } from 'vitest'
import { err } from 'neverthrow'
import {
  extensionSetupBrowser,
  type ExtensionPairingStatusRequest,
} from '$lib/app/extension-setup'
import {
  extensionConnectionBrowser,
  PairedExtensionDiscoveryFailure,
  PairedExtensionDiscoveryFailureKind,
} from '$lib/extension/connect'
import {
  LoginVaultExtensionPairingStatusKind,
  LoginVaultExtensionPairingStatusLookup,
  type LoginVaultExtensionPairingStatus,
  type LoginVaultExtensionPairingStatusEntry,
} from '$lib/components/login/login-vault-extension-pairing-status'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

afterEach(() => {
  document.documentElement.removeAttribute('data-nook-extension-runtime-id')
  vi.restoreAllMocks()
})

describe('extension pairing presentation during browser authorization', () => {
  test('hides pairing status without an installed provider and preserves the authorization state', async () => {
    const vault = VaultStateTestFixture.create()
    vault.errorMsg = 'existing authorization error'
    const errorRevision = vault.errorMsgRevision
    const discovery = vi.spyOn(
      extensionConnectionBrowser,
      'discoverAdmittedPairedExtensionIdentity',
    )

    const pairingRequest: ExtensionPairingStatusRequest = {
      storeId: 'browser-vault',
      vault,
    }
    const status =
      await extensionSetupBrowser.discoverPairingStatus(pairingRequest)
    const expectedStatus: LoginVaultExtensionPairingStatus = {
      kind: LoginVaultExtensionPairingStatusKind.NotShown,
    }

    expect(discovery).not.toHaveBeenCalled()
    expect(
      new LoginVaultExtensionPairingStatusLookup([status]).statusForStore(
        'browser-vault',
      ),
    ).toEqual(expectedStatus)
    expect(vault.errorMsg).toBe('existing authorization error')
    expect(vault.errorMsgRevision).toBe(errorRevision)
    expect(vault.isAuthenticated).toBe(false)
  })

  test.each([
    PairedExtensionDiscoveryFailureKind.Delivery,
    PairedExtensionDiscoveryFailureKind.Decode,
    PairedExtensionDiscoveryFailureKind.Admission,
  ])(
    'keeps installed-provider %s failures visible and authorization closed',
    async (kind) => {
      document.documentElement.setAttribute(
        'data-nook-extension-runtime-id',
        'installed-extension',
      )
      const vault = VaultStateTestFixture.create()
      const failure = new PairedExtensionDiscoveryFailure(kind)
      const discovery = vi
        .spyOn(
          extensionConnectionBrowser,
          'discoverAdmittedPairedExtensionIdentity',
        )
        .mockResolvedValue(err(failure))

      const pairingRequest: ExtensionPairingStatusRequest = {
        storeId: 'browser-vault',
        vault,
      }
      const status =
        await extensionSetupBrowser.discoverPairingStatus(pairingRequest)
      const expectedStatus: LoginVaultExtensionPairingStatusEntry = {
        storeId: 'browser-vault',
        kind: LoginVaultExtensionPairingStatusKind.Checking,
      }

      expect(discovery).toHaveBeenCalledWith('browser-vault')
      expect(status).toEqual(expectedStatus)
      expect(vault.errorMsg).toBe(vault.t(failure.translationKey))
      expect(vault.isAuthenticated).toBe(false)
    },
  )
})
