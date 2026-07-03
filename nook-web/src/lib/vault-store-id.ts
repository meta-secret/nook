import type { NookVaultManager } from '$lib/nook-wasm/nook_wasm'

/** Every connected vault must have a non-empty `store_id` in its YAML session. */
export function requireManagerVaultStoreId(manager: NookVaultManager): string {
  const storeId = manager.vaultStoreId.trim()
  if (!storeId) {
    throw new Error('Vault is missing store_id after connect.')
  }
  return storeId
}
