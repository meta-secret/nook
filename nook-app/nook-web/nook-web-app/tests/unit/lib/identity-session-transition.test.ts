import { describe, expect, test, vi } from 'vitest'

/** The session lock mark lives in browser session storage, which the WASM
 * build cannot reach here. */
vi.mock('$app-wasm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$app-wasm')>()),
  set_vault_session_locked: vi.fn(),
}))

import { IdentitySessionTransition } from '$lib/components/devices-access/identity-session-transition'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

describe('leaving an identity', () => {
  test('closes the vault panel left open beside its card', () => {
    const vault = VaultStateTestFixture.create()
    vault.clearUnlockedSession = vi.fn()
    vault.clearIdentityProviderSession = vi.fn()
    vault.vaultPanelStoreId = 'store-qwe'

    // Creating a new identity, or using another, leaves the prior one: its
    // card must not keep a panel that now belongs to nobody in use.
    new IdentitySessionTransition(vault).clearPriorIdentity()

    expect(vault.vaultPanelStoreId).toBe('')
  })
})
