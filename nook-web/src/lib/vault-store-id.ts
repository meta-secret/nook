import type { NookVaultManager } from '$lib/nook-wasm/nook_wasm'
import type { VaultState } from '$lib/vault.svelte'

/** Every connected vault must have a non-empty `store_id` in its YAML session. */
export function requireManagerVaultStoreId(manager: NookVaultManager): string {
  const storeId = manager.vaultStoreId.trim()
  if (!storeId) {
    throw new Error('Vault is missing store_id after connect.')
  }
  return storeId
}

/** Store id for persisting a sync provider row before or after wasm connect. */
export function vaultStoreIdForProviderSave(state: VaultState): string | undefined {
  const fromManager = state.manager?.vaultStoreId.trim()
  if (fromManager) {
    return fromManager
  }
  return (
    state.activeVaultStoreId?.trim() ||
    state.selectedLoginVaultStoreId?.trim() ||
    undefined
  )
}
