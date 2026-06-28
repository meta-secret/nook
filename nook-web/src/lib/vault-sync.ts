import {
  compareVaultSync,
  fetchRemoteVaultYaml,
  readLocalVaultYaml,
  readVaultVersion,
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

export async function readLocalVaultBlob(): Promise<string> {
  return readLocalVaultYaml()
}

export async function fetchRemoteVaultBlob(
  storageMode: string,
  githubPat: string,
  githubRepo: string,
): Promise<RemoteVaultFetch> {
  const raw = (await fetchRemoteVaultYaml(
    storageMode,
    githubPat,
    githubRepo,
  )) as RemoteVaultFetch
  return {
    content: raw.content ?? '',
    revision: raw.revision ?? null,
    missing: Boolean(raw.missing),
  }
}

export async function compareVaultBlobs(
  local: string,
  remote: string,
): Promise<VaultSyncAction> {
  return compareVaultSync(local, remote) as VaultSyncAction
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
