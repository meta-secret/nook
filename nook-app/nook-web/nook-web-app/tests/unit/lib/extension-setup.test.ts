import { afterEach, describe, expect, test, vi } from 'vitest'
import { NookBrowserExtensionInstallation } from '$app-wasm'
import {
  ExtensionSetupOfferKind,
  extensionInstallationFor,
  extensionSetupBrowser,
} from '$lib/app/extension-setup'
import { ExtensionSetupOfferModel } from '$lib/app/extension-setup-offer.svelte'
import { I18N_KEYS } from '$web-shared/generated/i18n-keys'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

afterEach(() => {
  document.documentElement.removeAttribute('data-nook-extension-runtime-id')
  vi.restoreAllMocks()
})

describe('connected extension tile', () => {
  test('says so when the extension panel did not open, and stays quiet when it did', async () => {
    const vault = VaultStateTestFixture.create()
    const open = vi.spyOn(extensionSetupBrowser, 'openExtensionSidePanel')
    const offer = new ExtensionSetupOfferModel({ vault, supported: true })

    open.mockResolvedValueOnce(true)
    await offer.openSidePanel()
    expect(vault.errorMsg).toBe('')

    open.mockResolvedValueOnce(false)
    await offer.openSidePanel()
    expect(vault.errorMsg).toBe(
      vault.t(I18N_KEYS.ExtensionSetupVaultPanelFailed),
    )
  })
})

describe('extension in this browser', () => {
  test('is known to the keyring checklist before any vault opens', () => {
    const vault = VaultStateTestFixture.create()
    vault.isAuthenticated = false
    document.documentElement.setAttribute(
      'data-nook-extension-runtime-id',
      'abcdefghijklmnopabcdefghijklmnop',
    )
    const offer = new ExtensionSetupOfferModel({ vault, supported: true })

    offer.refresh()

    expect(extensionInstallationFor(offer.browser)).toBe(
      NookBrowserExtensionInstallation.Installed,
    )
    // The open vault's own offer waits for a vault.
    expect(offer.offer.kind).toBe(ExtensionSetupOfferKind.Hidden)
  })

  test('is not offered where the application ships no extension', () => {
    const vault = VaultStateTestFixture.create()
    const offer = new ExtensionSetupOfferModel({ vault, supported: false })

    offer.refresh()

    expect(extensionInstallationFor(offer.browser)).toBe(
      NookBrowserExtensionInstallation.NotOffered,
    )
  })
})
