import {
  getActiveVaultId,
  hasActiveLocalVault,
  hasLocalVault,
  importLocalVaultBlob,
  listLocalVaults,
  prepareNewLocalVaultSlot,
  setActiveVault,
  type NookLocalVaultEntry,
} from './nook-wasm/nook_wasm'

export type LocalVaultEntry = {
  storeId: string
  label?: string
  lastUnlockedAt?: string
}

function mapEntry(entry: NookLocalVaultEntry): LocalVaultEntry {
  return {
    storeId: entry.storeId,
    label: entry.label ?? undefined,
    lastUnlockedAt: entry.lastUnlockedAt ?? undefined,
  }
}

export async function listLocalVaultEntries(): Promise<LocalVaultEntry[]> {
  const entries = await listLocalVaults()
  return entries.map(mapEntry)
}

export async function readActiveVaultStoreId(): Promise<string | null> {
  return (await getActiveVaultId()) ?? null
}

export async function switchActiveVault(storeId: string): Promise<void> {
  await setActiveVault(storeId)
}

export async function prepareCreateNewVaultSlot(): Promise<void> {
  await prepareNewLocalVaultSlot()
}

export async function importVaultAsNewLocalCopy(
  yaml: string,
  label?: string,
): Promise<string> {
  return importLocalVaultBlob(yaml, label ?? null)
}

export { hasLocalVault, hasActiveLocalVault }
