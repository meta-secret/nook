import { describe, expect, test } from 'bun:test'
import type { StoredExtensionPairingGrant } from '../src/background/pairing-grants'
import { extensionPairingGrantPolicyReady } from '../src/background/pairing-grants'

describe('extension pairing grant transport', () => {
  test('rejects an absent grant before invoking a WASM string guard', async () => {
    const policy = await extensionPairingGrantPolicyReady
    const storageSnapshot: Partial<{
      grant: StoredExtensionPairingGrant
    }> = {}

    expect(policy.isStoredExtensionPairingGrant(storageSnapshot.grant)).toBe(
      false,
    )
  })
})
