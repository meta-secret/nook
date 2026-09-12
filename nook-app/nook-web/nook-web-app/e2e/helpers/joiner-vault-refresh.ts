import type { ProviderSyncFreshness } from '$app-wasm'
import type { VaultDebugWindow } from '$lib/app/browser-lifecycle'

/** Force the approved joiner's browser-owned vault to read its provider. */
export type RefreshJoinerVaultOnLoginGateArgs = {
  freshness: ProviderSyncFreshness
  authStorageSyncFailedKey: string
}

export async function refreshJoinerVaultOnLoginGate(
  args: RefreshJoinerVaultOnLoginGateArgs,
): Promise<void> {
  const { freshness, authStorageSyncFailedKey } = args
  const vault = (window as VaultDebugWindow).__nookVault
  if (!vault) throw new Error('joiner-vault-runtime-unavailable')
  const refreshed = await vault.syncFromStorage(freshness)
  if (refreshed.isErr()) {
    if (refreshed.error.translationKey === authStorageSyncFailedKey) return
    throw new Error(
      `joiner-vault-refresh-rejected:${refreshed.error.translationKey}`,
    )
  }
}
