import { ProviderSyncFreshness } from '$app-wasm'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import { NativeVaultStorageFailure } from '$lib/runtime/storage-failure'
import { ProviderSyncOutcome } from '$lib/vault/provider-sync.svelte'
import type { VaultState } from '$lib/vault.svelte'
import { err, ok } from 'neverthrow'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { refreshJoinerVaultOnLoginGate } from '../../../e2e/helpers/joiner-vault-refresh'

const installVault = (syncFromStorage: VaultState['syncFromStorage']) => {
  Object.defineProperty(window, '__nookVault', {
    configurable: true,
    value: { syncFromStorage },
  })
}

afterEach(() => {
  Reflect.deleteProperty(window, '__nookVault')
})

describe('joiner vault refresh', () => {
  test('uses the typed forced-refresh boundary', async () => {
    const syncFromStorage: VaultState['syncFromStorage'] = vi.fn(async () =>
      ok(ProviderSyncOutcome.Synced),
    )
    installVault(syncFromStorage)

    await refreshJoinerVaultOnLoginGate(ProviderSyncFreshness.Forced)

    expect(syncFromStorage).toHaveBeenCalledOnce()
    expect(syncFromStorage).toHaveBeenCalledWith(ProviderSyncFreshness.Forced)
  })

  test('fails promptly when the typed refresh is rejected', async () => {
    const syncFromStorage: VaultState['syncFromStorage'] = vi.fn(async () =>
      err(new NativeVaultStorageFailure(new Error('provider unavailable'))),
    )
    installVault(syncFromStorage)

    await expect(
      refreshJoinerVaultOnLoginGate(ProviderSyncFreshness.Forced),
    ).rejects.toThrow(
      `joiner-vault-refresh-rejected:${I18N_KEYS.AuthStorageSyncFailed}`,
    )
  })

  test('fails promptly when the browser vault runtime is unavailable', async () => {
    await expect(
      refreshJoinerVaultOnLoginGate(ProviderSyncFreshness.Forced),
    ).rejects.toThrow('joiner-vault-runtime-unavailable')
  })
})
