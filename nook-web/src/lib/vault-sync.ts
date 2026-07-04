import {
  readLocalVaultYaml,
  readVaultVersion,
  vaultContentHash,
  writeLocalVaultYaml,
} from './nook-wasm/nook_wasm'

export type VaultSyncAction =
  | 'unchanged'
  | 'adopt_remote'
  | 'push_local'
  | 'conflict'

/** Pending user choice when local and remote vaults diverge. */
export type PendingSyncConflict = {
  providerId: string
  providerLabel: string
  localYaml: string
  remoteYaml: string
  localVersion: number
  remoteVersion: number
  mode: string
  pat: string
  repo: string
  remoteRevision: string | null
  /** Same version but different ciphertext, or different vault store_id values. */
  kind?: 'content' | 'store_id'
  localStoreId?: string
  remoteStoreId?: string
}

export async function readLocalVaultBlob(): Promise<string> {
  return readLocalVaultYaml()
}

export function vaultBlobContentHash(yaml: string): string {
  return vaultContentHash(yaml)
}

export async function writeLocalVaultBlob(content: string): Promise<void> {
  await writeLocalVaultYaml(content)
}

export async function readVaultVersionFromBlob(yaml: string): Promise<number> {
  return Number(readVaultVersion(yaml))
}

const DEFAULT_VAULT_SYNC_INTERVAL_MS = 60_000

/** Background pull interval — production always uses 60s; fast sync is dev/e2e only. */
export function resolveVaultSyncIntervalMs(env: {
  DEV?: boolean
  VITE_E2E_EXPOSE_VAULT?: string
  VITE_VAULT_SYNC_INTERVAL_MS?: string
}): number {
  const allowFastSync = env.DEV === true || env.VITE_E2E_EXPOSE_VAULT === 'true'
  if (!allowFastSync) {
    return DEFAULT_VAULT_SYNC_INTERVAL_MS
  }
  const raw = env.VITE_VAULT_SYNC_INTERVAL_MS
  const parsed = raw === undefined || raw === '' ? NaN : Number(raw)
  if (Number.isFinite(parsed) && parsed >= 250) {
    return parsed
  }
  return DEFAULT_VAULT_SYNC_INTERVAL_MS
}
