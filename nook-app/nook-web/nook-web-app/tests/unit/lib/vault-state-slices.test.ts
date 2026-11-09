import { describe, expect, test } from 'vitest'
import { NookBrowserLocale, NookVaultLastSyncState } from '$app-wasm'
import { VaultStateSlices } from '$lib/vault/state/index.svelte'
import { VaultRuntimeState } from '$lib/vault/state/runtime.svelte'
import {
  LoginSetupKind,
  type LoginSetup,
} from '$lib/vault/state/provider.svelte'
import { ProviderSetupKinds } from '$lib/vault/provider-setup-kinds'

describe('vault state slice transitions', () => {
  test('delegates transition methods to their owning slice', () => {
    const state = new VaultStateSlices(
      new VaultRuntimeState(NookBrowserLocale.from_tags(['en'])),
    )

    state.activateLoginSetup(ProviderSetupKinds.LOCAL_FOLDER)
    expect(state.loginSetup).toEqual({
      kind: LoginSetupKind.Active,
      providerKind: ProviderSetupKinds.LOCAL_FOLDER,
    } satisfies LoginSetup)

    state.clearLoginSetup()
    expect(state.loginSetup).toEqual({
      kind: LoginSetupKind.Inactive,
    } satisfies LoginSetup)

    state.beginManualProviderSync('provider-1')
    expect(state.manualProviderSyncRunning).toBe(true)
    state.clearSyncingProvider()
    expect(state.manualProviderSyncRunning).toBe(false)

    state.localVaultPresent = true
    state.clearIdentityProviderSession()
    expect(state.localVaultPresent).toBe(true)

    state.identityTransitionPending = true
    expect(state.identityTransitionPending).toBe(true)

    const syncedAt = Date.parse('2026-07-30T00:00:00.000Z')
    state.markSynced(syncedAt)
    expect(state.lastSync.state).toBe(NookVaultLastSyncState.Synced)
    expect(state.lastSync.syncedAtUnixMilliseconds).toBe(syncedAt)
  })
})
