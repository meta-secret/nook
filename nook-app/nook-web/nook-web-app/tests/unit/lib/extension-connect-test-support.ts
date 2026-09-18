import { afterEach, vi } from 'vitest'
import { admit_extension_pairing_vault_type } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  extensionPairingGrantPolicyReady,
  setupStorageKey,
  type LegacyPairingStorageObject,
} from '../../../../nook-web-extension/src/background/pairing-grants'

export const {
  extensionPairingGrantStorageItems,
  extensionStoredPairingGrantStorageItems,
  decodeStoredExtensionPairingGrant,
  decodeExtensionReadySetupState,
  migratedLegacyPairingStorageItems,
  pairingGrantStorageKey,
  selectedPairingGrant,
  selectedPairingGrantFirst,
  setupAfterPairingGrantRemoval,
} = await extensionPairingGrantPolicyReady

export const simplePairingVaultType =
  admit_extension_pairing_vault_type('simple')

export { setupStorageKey }
export type { LegacyPairingStorageObject }

export function locationFromUrl(url: string): Location {
  const parsed = new URL(url)
  window.history.replaceState({}, '', `${parsed.pathname}${parsed.search}`)
  return window.location
}

afterEach(() => {
  document.documentElement.removeAttribute('data-nook-extension-runtime-id')
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
