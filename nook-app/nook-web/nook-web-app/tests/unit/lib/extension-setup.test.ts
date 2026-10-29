import { afterEach, describe, expect, test, vi } from 'vitest'
import { extensionSetupBrowser } from '$lib/app/extension-setup'
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
