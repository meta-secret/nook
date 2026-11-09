import { ok } from 'neverthrow'
import { describe, expect, test, vi } from 'vitest'

/** The session lock mark lives in browser session storage, which the WASM
 * build cannot reach here. */
vi.mock('$app-wasm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$app-wasm')>()),
  set_vault_session_locked: vi.fn(),
}))

import { IdentitySessionTransition } from '$lib/components/devices-access/identity-session-transition'
import {
  IdentitySwitch,
  IdentitySwitchOutcome,
} from '$lib/components/identities/identity-switch'
import {
  IdentityActionOutcome,
  IdentityControlViewKind,
} from '$lib/vault/identity-control.svelte'
import type { IdentityControlSnapshot } from '$app-wasm'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

function leavingVault() {
  const vault = VaultStateTestFixture.create()
  vault.clearUnlockedSession = vi.fn()
  vault.clearIdentityProviderSession = vi.fn()
  return vault
}

describe('leaving an identity', () => {
  test('closes the vault panel left open beside its card', () => {
    const vault = leavingVault()
    vault.vaultPanelStoreId = 'store-qwe'

    // Creating a new identity, or using another, leaves the prior one: its
    // card must not keep a panel that now belongs to nobody in use.
    new IdentitySessionTransition(vault).clearPriorIdentity()

    expect(vault.vaultPanelStoreId).toBe('')
  })

  test('forgets its keyring log, so its vaults show on no other card', () => {
    const vault = leavingVault()
    vault.identityControl.view = {
      kind: IdentityControlViewKind.Ready,
      snapshot: { vaults: [] } as unknown as IdentityControlSnapshot,
    }

    new IdentitySessionTransition(vault).clearPriorIdentity()

    expect(vault.identityControl.view.kind).toBe(
      IdentityControlViewKind.Loading,
    )
    expect(vault.identityControl.snapshot).toBe(false)
  })
})

describe('using another identity', () => {
  test('reads its own keyring log once its providers load, with a passkey as with a PIN', async () => {
    const vault = VaultStateTestFixture.create()
    vault.loadProviders = vi.fn(async () =>
      ok({ providers: [], activeVaultStoreId: '' }),
    ) as unknown as typeof vault.loadProviders
    vault.applyActiveProviderCredentials = vi.fn()
    const loadSnapshot = vi
      .spyOn(vault.identityControl, 'loadSnapshot')
      .mockResolvedValue(ok(IdentityActionOutcome.Completed))

    const outcome = await new IdentitySwitch(vault).loadProviders()

    expect(outcome).toBe(IdentitySwitchOutcome.Unlocked)
    expect(loadSnapshot).toHaveBeenCalledOnce()
  })
})
