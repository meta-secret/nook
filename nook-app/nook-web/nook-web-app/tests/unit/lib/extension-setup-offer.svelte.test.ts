import { flushSync } from 'svelte'
import { afterEach, describe, expect, test } from 'vitest'
import { NookBrowserExtensionInstallation } from '$app-wasm'
import { extensionInstallationFor } from '$lib/app/extension-setup'
import { ExtensionSetupOfferModel } from '$lib/app/extension-setup-offer.svelte'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

afterEach(() => {
  document.documentElement.removeAttribute('data-nook-extension-runtime-id')
})

describe('following the extension from the app', () => {
  test('settles inside the effect that follows it, as the app runs it', () => {
    document.documentElement.setAttribute(
      'data-nook-extension-runtime-id',
      'abcdefghijklmnopabcdefghijklmnop',
    )
    const vault = VaultStateTestFixture.create()
    const offer = new ExtensionSetupOfferModel({ vault, supported: true })

    // The app follows the offer in an effect that re-runs when the vault
    // opens; the refresh must not read back what it writes.
    const stop = $effect.root(() => {
      $effect(() => {
        void vault.isAuthenticated
        return offer.follow()
      })
    })
    try {
      flushSync()
      vault.isAuthenticated = !vault.isAuthenticated
      flushSync()

      expect(extensionInstallationFor(offer.browser)).toBe(
        NookBrowserExtensionInstallation.Installed,
      )
    } finally {
      stop()
    }
  })
})
