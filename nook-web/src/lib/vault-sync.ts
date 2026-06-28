import {
  compareVaultSync,
  fetchRemoteVaultYaml,
  readLocalVaultYaml,
  readVaultVersion,
  reconcileVaultBlobs,
  resolveVaultConflictKeepLocal,
  resolveVaultConflictKeepRemote,
  writeLocalVaultYaml,
  writeRemoteVaultYaml,
} from './nook-wasm/nook_wasm'

export type VaultSyncAction =
  | 'unchanged'
  | 'adopt_remote'
  | 'push_local'
  | 'conflict'

export type RemoteVaultFetch = {
  content: string
  revision: string | null
  missing: boolean
}

/** Result of in-memory reconcile — post-action blob contents from nook-core. */
export type ReconcileVaultResult = {
  action: VaultSyncAction
  localYaml: string
  remoteYaml: string
  remoteRevision: string | null
}

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

const STORE_ID_MISMATCH_RE =
  /Vault store_id mismatch: local (\S+), remote (\S+)/

export function parseVaultStoreIdMismatch(
  error: unknown,
): { localStoreId: string; remoteStoreId: string } | null {
  const message = error instanceof Error ? error.message : String(error)
  const match = message.match(STORE_ID_MISMATCH_RE)
  if (!match) {
    return null
  }
  return { localStoreId: match[1], remoteStoreId: match[2] }
}

export type ReconcileVaultAttempt =
  | { status: 'ok'; result: ReconcileVaultResult }
  | {
      status: 'store_id_mismatch'
      localStoreId: string
      remoteStoreId: string
    }

/** Run reconcile; map store_id mismatch to a structured outcome instead of throwing. */
export function attemptReconcileVaultSyncBlobs(
  localYaml: string,
  remoteYaml: string,
  remoteRevision: string | null,
): ReconcileVaultAttempt {
  try {
    return {
      status: 'ok',
      result: reconcileVaultSyncBlobs(localYaml, remoteYaml, remoteRevision),
    }
  } catch (error: unknown) {
    const mismatch = parseVaultStoreIdMismatch(error)
    if (mismatch) {
      return { status: 'store_id_mismatch', ...mismatch }
    }
    throw error
  }
}

export async function readLocalVaultBlob(): Promise<string> {
  return readLocalVaultYaml()
}

export async function fetchRemoteVaultBlob(
  storageMode: string,
  githubPat: string,
  githubRepo: string,
): Promise<RemoteVaultFetch> {
  const raw = await fetchRemoteVaultYaml(storageMode, githubPat, githubRepo)
  return {
    content: raw.content ?? '',
    revision: raw.revision ?? null,
    missing: Boolean(raw.missing),
  }
}

/** @deprecated Prefer `reconcileVaultSyncBlobs` — compare-only without apply. */
export async function compareVaultBlobs(
  local: string,
  remote: string,
): Promise<VaultSyncAction> {
  return compareVaultSync(local, remote) as VaultSyncAction
}

/** Compare and apply sync rules in WASM; returns blobs to persist via I/O helpers. */
export function reconcileVaultSyncBlobs(
  localYaml: string,
  remoteYaml: string,
  remoteRevision: string | null,
): ReconcileVaultResult {
  const raw = reconcileVaultBlobs(localYaml, remoteYaml, remoteRevision)
  return {
    action: raw.action as VaultSyncAction,
    localYaml: raw.localYaml,
    remoteYaml: raw.remoteYaml,
    remoteRevision: raw.remoteRevision ?? null,
  }
}

export function resolveVaultSyncConflictKeepLocal(
  localYaml: string,
  remoteYaml: string,
  remoteRevision: string | null,
): string {
  return resolveVaultConflictKeepLocal(localYaml, remoteYaml, remoteRevision)
    .remoteYaml
}

export function resolveVaultSyncConflictKeepRemote(
  localYaml: string,
  remoteYaml: string,
  remoteRevision: string | null,
): string {
  return resolveVaultConflictKeepRemote(localYaml, remoteYaml, remoteRevision)
    .localYaml
}

export async function writeLocalVaultBlob(content: string): Promise<void> {
  await writeLocalVaultYaml(content)
}

export async function readVaultVersionFromBlob(yaml: string): Promise<number> {
  return Number(readVaultVersion(yaml))
}

export async function writeRemoteVaultBlob(
  storageMode: string,
  githubPat: string,
  githubRepo: string,
  content: string,
  revision: string | null,
): Promise<string> {
  return writeRemoteVaultYaml(
    storageMode,
    githubPat,
    githubRepo,
    content,
    revision,
  )
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
