import { describe, expect, test } from 'vitest'
import { VaultStateSlices } from '$lib/vault/state/index.svelte'
import {
  LoginSetupKind,
  type LoginSetup,
} from '$lib/vault/state/provider.svelte'
import { LOCAL_FOLDER_PROVIDER_TYPE } from '$lib/auth-providers'

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

    state.syncingProviderId = 'provider-1'
    expect(state.manualProviderSyncRunning).toBe(true)
    state.clearSyncingProvider()
    expect(state.manualProviderSyncRunning).toBe(false)
  })
})
