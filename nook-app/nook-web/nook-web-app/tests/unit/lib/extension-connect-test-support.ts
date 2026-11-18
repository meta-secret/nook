import { afterEach, vi } from 'vitest'
import type { EventLogStorageRecord } from '$app-wasm'
import { admit_extension_pairing_vault_type } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  extensionPairingGrantPolicyReady,
  setupStorageKey,
} from '../../../../nook-web-extension/src/background/pairing-grants'

export const extensionEventLogFixtureStoreId = 'store_abcdefghijk'
export const extensionEventLogRecordsFixture: EventLogStorageRecord[] = [
  {
    eventId: 'event-1',
    event: {
      schema_version: 2,
      store_id: extensionEventLogFixtureStoreId,
      actor_id: `key_${'0'.repeat(64)}`,
      actor_signing_public_key: '0'.repeat(64),
      parents: [],
      created_at: '2026-07-07T00:00:00.000Z',
      key_epoch: 'sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo',
      operations: [{ type: 'vault-cleared' }],
      signature: `ed25519:${'0'.repeat(128)}`,
    },
  },
]

export const {
  extensionPairingGrantStorageItems,
  extensionStoredPairingGrantStorageItems,
  decodeStoredExtensionPairingGrant,
  decodeExtensionReadySetupState,
  pairingGrantStorageKey,
  selectedPairingGrant,
  selectedPairingGrantFirst,
  setupAfterPairingGrantRemoval,
} = await extensionPairingGrantPolicyReady

export const simplePairingVaultType =
  admit_extension_pairing_vault_type('simple')

export { setupStorageKey }

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
