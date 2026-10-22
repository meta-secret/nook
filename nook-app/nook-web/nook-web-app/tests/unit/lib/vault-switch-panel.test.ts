import { err, ok } from 'neverthrow'
import { describe, expect, test, vi } from 'vitest'

/** The session lock mark lives in browser session storage, which the WASM
 * build cannot reach here; the switch policy deciding the target is real. */
vi.mock('$app-wasm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$app-wasm')>()),
  set_vault_session_locked: vi.fn(),
}))

import { DeviceProtectionLockOutcome } from '$lib/vault/device-protection.svelte'
import { VaultLoginActions } from '$lib/vault/local-login'
import {
  VaultStorageFailure,
  VaultStorageFailureKind,
} from '$lib/runtime/storage-failure'
import type { VaultState } from '$lib/vault.svelte'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

/** A page with vault A open, switching to vault B; selecting B succeeds or
 * fails as the test says. */
function switchingToB(selectable: boolean): VaultState {
  const state = VaultStateTestFixture.create()
  state.openActiveVault('store-a')
  state.isVerifying = false
  state.errorMsg = ''
  state.t = (request: Parameters<VaultState['t']>[0]) =>
    typeof request === 'string' ? request : request.key
  state.waitForStorageChain = vi.fn(async () => {})
  state.clearUnlockedSession = vi.fn()
  state.selectVaultForUnlock = vi.fn(async () =>
    selectable
      ? ok('store-b')
      : err(
          new VaultStorageFailure(VaultStorageFailureKind.ManagerUnavailable),
        ),
  )
  state.lockDeviceProtection = vi.fn(async () => {
    // Locking folds the card: it closes whichever panel was open.
    state.vaultPanelStoreId = ''
    return ok(DeviceProtectionLockOutcome.Locked)
  })
  return state
}

describe('switching to another vault from its row', () => {
  test('lands on the target vault panel, which offers its unlock', async () => {
    const state = switchingToB(true)

    await new VaultLoginActions(state).switchToVault({ storeId: 'store-b' })

    expect(state.lockDeviceProtection).toHaveBeenCalledOnce()
    expect(state.vaultPanelStoreId).toBe('store-b')
    expect(state.errorMsg).toBe('')
  })

  test('keeps the selection error and opens no panel when B cannot be selected', async () => {
    const state = switchingToB(false)

    await new VaultLoginActions(state).switchToVault({ storeId: 'store-b' })

    expect(state.vaultPanelStoreId).toBe('')
    expect(state.errorMsg).toBe(
      new VaultStorageFailure(VaultStorageFailureKind.ManagerUnavailable)
        .translationKey,
    )
  })
})
