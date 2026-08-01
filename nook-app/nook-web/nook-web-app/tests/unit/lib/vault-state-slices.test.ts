import { describe, expect, test } from 'vitest'
import {
  NookBrowserLocale,
  NookLocalFolderHealth,
  NookLocalFolderHealthState,
  NookVaultLastSyncState,
} from '$app-wasm'
import { VaultStateSlices } from '$lib/vault/state/index.svelte'
import { VaultRuntimeState } from '$lib/vault/state/runtime.svelte'
import {
  LoginSetupKind,
  type LoginSetup,
} from '$lib/vault/state/provider.svelte'
import { LOCAL_FOLDER_PROVIDER_TYPE } from '$lib/auth/providers'

describe('vault state slice transitions', () => {
  test('delegates transition methods to their owning slice', () => {
    const state = new VaultStateSlices(
      new VaultRuntimeState(NookBrowserLocale.fromTags(['en'])),
    )

    state.activateLoginSetup(LOCAL_FOLDER_PROVIDER_TYPE)
    expect(state.loginSetup).toEqual({
      kind: LoginSetupKind.Active,
      providerType: LOCAL_FOLDER_PROVIDER_TYPE,
    } satisfies LoginSetup)

    state.clearLoginSetup()
    expect(state.loginSetup).toEqual({
      kind: LoginSetupKind.Inactive,
    } satisfies LoginSetup)

    state.beginManualProviderSync('provider-1')
    expect(state.manualProviderSyncRunning).toBe(true)
    state.clearSyncingProvider()
    expect(state.manualProviderSyncRunning).toBe(false)

    const syncedAt = Date.parse('2026-07-30T00:00:00.000Z')
    state.markSynced(syncedAt)
    expect(state.lastSync.state).toBe(NookVaultLastSyncState.Synced)
    expect(state.lastSync.syncedAtUnixMilliseconds).toBe(syncedAt)

    const localFolderIssue = NookLocalFolderHealth.multipleVaults(
      'provider-1',
      'Local folder',
      ['store-1', 'store-2'],
      'Folder contains multiple vaults.',
    )
    state.reportLocalFolderMultipleVaults(localFolderIssue)
    expect(state.localFolderHealth.state).toBe(
      NookLocalFolderHealthState.MultipleVaults,
    )
    expect(state.localFolderHealth.providerId).toBe('provider-1')
    expect(state.localFolderHealth.storeIds).toEqual(['store-1', 'store-2'])
  })
})
