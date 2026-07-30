// @vitest-environment jsdom

import { describe, expect, test } from 'vitest'
import { SvelteDate } from 'svelte/reactivity'
import { VaultStateSlices } from '$lib/vault/state/index.svelte'
import {
  LoginSetupKind,
  type LoginSetup,
} from '$lib/vault/state/provider.svelte'
import { LOCAL_FOLDER_PROVIDER_TYPE } from '$lib/auth-providers'
import {
  LastSyncKind,
  LocalFolderHealthKind,
} from '$lib/vault/state/sync.svelte'

describe('vault state slice transitions', () => {
  test('delegates transition methods to their owning slice', () => {
    const state = new VaultStateSlices()

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

    const syncedAt = new SvelteDate('2026-07-30T00:00:00.000Z')
    state.markSynced(syncedAt)
    expect(state.lastSync).toEqual({
      kind: LastSyncKind.Synced,
      at: syncedAt,
    })

    const localFolderIssue = {
      providerId: 'provider-1',
      providerLabel: 'Local folder',
      storeIds: ['store-1', 'store-2'],
      message: 'Folder contains multiple vaults.',
    }
    state.reportLocalFolderMultipleVaults(localFolderIssue)
    expect(state.localFolderHealth).toEqual({
      kind: LocalFolderHealthKind.MultipleVaults,
      issue: localFolderIssue,
    })
  })
})
