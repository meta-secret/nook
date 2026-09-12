import type { ProviderSyncFreshness } from '$app-wasm'
import { I18N_KEYS } from '../../../nook-web-shared/src/generated/i18n-keys'
import type { VaultDebugWindow } from '$lib/app/browser-lifecycle'

/** Force the approved joiner's browser-owned vault to read its provider. */
export async function refreshJoinerVaultOnLoginGate(
  freshness: ProviderSyncFreshness,
): Promise<void> {
  const vault = (window as VaultDebugWindow).__nookVault
  if (!vault) throw new Error('joiner-vault-runtime-unavailable')
  const refreshed = await vault.syncFromStorage(freshness)
  if (refreshed.isErr()) {
    if (refreshed.error.translationKey === I18N_KEYS.AuthStorageSyncFailed)
      return
    throw new Error(
      `joiner-vault-refresh-rejected:${refreshed.error.translationKey}`,
    )
  }
}
