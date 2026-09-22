import { err } from 'neverthrow'
import { describe, expect, test, vi } from 'vitest'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import {
  VaultStorageFailure,
  VaultStorageFailureKind,
} from '$lib/runtime/storage-failure'
import { VaultLoginActions } from '$lib/vault/local-login'
import { LocalLoginPreparationState } from '$lib/vault/state/provider.svelte'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

describe('local login preparation', () => {
  test('identifies an unlock metadata failure instead of reporting provider sync', async () => {
    const state = VaultStateTestFixture.create()
    state.localVaultPresent = true
    state.localLoginPreparation = LocalLoginPreparationState.Idle
    state.refreshPasswordEntriesList = vi.fn(async () =>
      err(new VaultStorageFailure(VaultStorageFailureKind.OperationFailed)),
    )

    await new VaultLoginActions(state).prepareLocalLogin()

    expect(state.errorMsg).toBe(
      state.t(I18N_KEYS.ErrorsVaultUnlockMetadataUnavailable),
    )
    expect(state.errorMsg).not.toBe(state.t(I18N_KEYS.AuthStorageSyncFailed))
    expect(state.localLoginPreparation).toBe(LocalLoginPreparationState.Idle)
  })
})
