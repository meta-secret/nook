import type { NookLocalVaultEntry } from '$lib/nook-wasm/nook_wasm'

type VaultTranslate = (key: string, params?: Record<string, string>) => string

/** Human-readable label for a local vault registry entry. */
export function vaultDisplayLabel(
  entry: NookLocalVaultEntry,
  t: VaultTranslate,
): string {
  if (entry.label?.trim()) {
    return entry.label.trim()
  }
  return t('login.vault_picker_unnamed')
}
