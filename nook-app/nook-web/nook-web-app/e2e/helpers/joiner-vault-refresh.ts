import type { ProviderSyncFreshness } from '$app-wasm'
import type { VaultState } from '$lib/vault.svelte'

type JoinerVaultDebugHooks = Window & {
  __nookVault?: Pick<VaultState, 'syncFromStorage'>
}

/** Force the approved joiner's browser-owned vault to read its provider. */
export async function refreshJoinerVaultOnLoginGate(
  freshness: ProviderSyncFreshness,
): Promise<void> {
  const vault = (window as JoinerVaultDebugHooks).__nookVault
  if (!vault) throw new Error('joiner-vault-runtime-unavailable')
  const refreshed = await vault.syncFromStorage(freshness)
  if (refreshed.isErr()) {
    throw new Error(
      `joiner-vault-refresh-rejected:${refreshed.error.translationKey}`,
    )
  }
}
