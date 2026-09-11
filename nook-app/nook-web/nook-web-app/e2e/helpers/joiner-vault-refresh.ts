import type { ProviderSyncFreshness } from '$app-wasm'
import type { VaultDebugWindow } from '$lib/app/browser-lifecycle'

/** Force the approved joiner's browser-owned vault to read its provider. */
export async function refreshJoinerVaultOnLoginGate(
  freshness: ProviderSyncFreshness,
): Promise<void> {
  const vault = (window as VaultDebugWindow).__nookVault
  if (!vault) throw new Error('joiner-vault-runtime-unavailable')
  const refreshed = await vault.syncFromStorage(freshness)
  if (refreshed.isErr()) {
    throw new Error(
      `joiner-vault-refresh-rejected:${refreshed.error.translationKey}`,
    )
  }
}
