import type { LocalVaultEntry } from '$lib/local-vault'

type VaultTranslate = (
  key: string,
  params?: Record<string, string>,
) => string

/** Human-readable label for a local vault registry entry. */
export function vaultDisplayLabel(
  entry: LocalVaultEntry,
  t: VaultTranslate,
): string {
  if (entry.label?.trim()) {
    return entry.label.trim()
  }
  return t('login.vault_picker_unnamed')
}
