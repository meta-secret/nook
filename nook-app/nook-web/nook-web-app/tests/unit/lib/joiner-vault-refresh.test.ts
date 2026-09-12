import { ProviderSyncFreshness } from '$app-wasm'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import {
  NativeVaultStorageFailure,
  VaultStorageFailure,
  VaultStorageFailureKind,
} from '$lib/runtime/storage-failure'
import { ProviderSyncOutcome } from '$lib/vault/provider-sync.svelte'
import type { VaultState } from '$lib/vault.svelte'
import { err, ok } from 'neverthrow'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  refreshJoinerVaultOnLoginGate,
  refreshJoinerVaultOnLoginGateIfIdle,
  RefreshJoinerVaultOnLoginGateOutcome,
} from '../../../e2e/helpers/joiner-vault-refresh'

const installVault = (
  syncFromStorage: VaultState['syncFromStorage'],
  isVerifying = false,
) => {
  Object.defineProperty(window, '__nookVault', {
    configurable: true,
    value: { syncFromStorage, isVerifying },
  })
}

afterEach(() => {
  Reflect.deleteProperty(window, '__nookVault')
})

describe('joiner vault refresh', () => {
  test('skips a forced refresh while auto-connect is verifying', async () => {
    const syncFromStorage: VaultState['syncFromStorage'] = vi.fn(async () =>
      ok(ProviderSyncOutcome.Synced),
    )
    installVault(syncFromStorage, true)

    const outcome = await refreshJoinerVaultOnLoginGateIfIdle({
      freshness: ProviderSyncFreshness.Forced,
      authStorageSyncFailedKey: I18N_KEYS.AuthStorageSyncFailed,
      busyOutcome: RefreshJoinerVaultOnLoginGateOutcome.Busy,
      refreshedOutcome: RefreshJoinerVaultOnLoginGateOutcome.Refreshed,
    })

    expect(outcome).toBe(RefreshJoinerVaultOnLoginGateOutcome.Busy)
    expect(syncFromStorage).not.toHaveBeenCalled()
  })

  test('uses the typed forced-refresh boundary', async () => {
    const syncFromStorage: VaultState['syncFromStorage'] = vi.fn(async () =>
      ok(ProviderSyncOutcome.Synced),
    )
    installVault(syncFromStorage)

    await refreshJoinerVaultOnLoginGate({
      freshness: ProviderSyncFreshness.Forced,
      authStorageSyncFailedKey: I18N_KEYS.AuthStorageSyncFailed,
    })

    expect(syncFromStorage).toHaveBeenCalledOnce()
    expect(syncFromStorage).toHaveBeenCalledWith(ProviderSyncFreshness.Forced)
  })

  test('does not abort login-gate polling when a provider read is unavailable', async () => {
    const syncFromStorage: VaultState['syncFromStorage'] = vi.fn(async () =>
      err(new NativeVaultStorageFailure(new Error('provider unavailable'))),
    )
    installVault(syncFromStorage)

    await refreshJoinerVaultOnLoginGate({
      freshness: ProviderSyncFreshness.Forced,
      authStorageSyncFailedKey: I18N_KEYS.AuthStorageSyncFailed,
    })
    expect(syncFromStorage).toHaveBeenCalledWith(ProviderSyncFreshness.Forced)
  })

  test('still reports non-provider refresh failures', async () => {
    const syncFromStorage: VaultState['syncFromStorage'] = vi.fn(async () =>
      err(new VaultStorageFailure(VaultStorageFailureKind.ManagerUnavailable)),
    )
    installVault(syncFromStorage)

    await expect(
      refreshJoinerVaultOnLoginGate({
        freshness: ProviderSyncFreshness.Forced,
        authStorageSyncFailedKey: I18N_KEYS.AuthStorageSyncFailed,
      }),
    ).rejects.toThrow(
      `joiner-vault-refresh-rejected:${I18N_KEYS.ErrorsEngineUnavailable}`,
    )
  })

  test('fails promptly when the browser vault runtime is unavailable', async () => {
    await expect(
      refreshJoinerVaultOnLoginGate({
        freshness: ProviderSyncFreshness.Forced,
        authStorageSyncFailedKey: I18N_KEYS.AuthStorageSyncFailed,
      }),
    ).rejects.toThrow('joiner-vault-runtime-unavailable')
  })
})
