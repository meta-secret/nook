import {
  DEFAULT_DRIVE_VAULT_FILE,
  formatDriveStorageRef,
  type AuthProvidersSnapshot,
  type StorageProvider,
  wasmStorageModeForProvider,
} from '$lib/auth-providers'
import { hasLocalVault } from '$lib/local-vault'
import {
  ensureLocalProviderRow as ensureLocalProviderRowWasm,
  normalizeAuthSnapshot as normalizeAuthSnapshotWasm,
} from '$lib/nook-wasm/nook_wasm'
import { fetchRemoteVaultBlob, writeLocalVaultBlob } from '$lib/vault-sync'

function providerRemoteArgs(
  provider: StorageProvider,
): [mode: string, pat: string, repo: string] {
  const mode = wasmStorageModeForProvider(
    provider.type,
    provider.oauthFile?.preset,
  )
  if (provider.type === 'oauth-file') {
    const fileName =
      provider.oauthFile?.fileName?.trim() || DEFAULT_DRIVE_VAULT_FILE
    return [
      mode,
      provider.oauthFile?.accessToken?.trim() ?? '',
      formatDriveStorageRef(provider.oauthFile?.fileId, fileName),
    ]
  }
  if (provider.type === 'github') {
    return [
      mode,
      provider.githubPat?.trim() ?? '',
      provider.githubRepo?.trim() || 'nook',
    ]
  }
  return ['local', '', '']
}

/** Drop deprecated `activeProviderId` from persisted auth snapshots. */
export function normalizeAuthSnapshot(raw: unknown): {
  snapshot: AuthProvidersSnapshot
  legacyActiveProviderId: string | null
  changed: boolean
} {
  return normalizeAuthSnapshotWasm(raw) as {
    snapshot: AuthProvidersSnapshot
    legacyActiveProviderId: string | null
    changed: boolean
  }
}

/** Ensure a local provider row exists for the active vault. */
export function ensureLocalProviderRow(
  snapshot: AuthProvidersSnapshot,
  activeStoreId?: string,
): AuthProvidersSnapshot {
  return ensureLocalProviderRowWasm(
    JSON.parse(JSON.stringify(snapshot)),
    activeStoreId ?? undefined,
  ) as AuthProvidersSnapshot
}

/**
 * One-time migration: copy the legacy active remote vault into `encrypted_db`
 * and keep remote rows as sync providers only.
 */
export async function migrateLegacyVaultToLocal(
  snapshot: AuthProvidersSnapshot,
  legacyActiveProviderId: string | null = null,
): Promise<{ snapshot: AuthProvidersSnapshot; migrated: boolean }> {
  if (await hasLocalVault()) {
    return {
      snapshot: ensureLocalProviderRow(snapshot),
      migrated: false,
    }
  }

  const remoteProviders = snapshot.providers.filter(
    (provider) => provider.type === 'github' || provider.type === 'oauth-file',
  )
  if (remoteProviders.length === 0) {
    return { snapshot, migrated: false }
  }

  const source =
    remoteProviders.find(
      (provider) => provider.id === legacyActiveProviderId,
    ) ?? remoteProviders[0]!

  try {
    const [mode, pat, repo] = providerRemoteArgs(source)
    const remote = await fetchRemoteVaultBlob(mode, pat, repo)
    if (!remote.content.trim()) {
      return {
        snapshot: ensureLocalProviderRow(snapshot),
        migrated: false,
      }
    }
    await writeLocalVaultBlob(remote.content)
    return {
      snapshot: ensureLocalProviderRow(snapshot),
      migrated: true,
    }
  } catch {
    return {
      snapshot: ensureLocalProviderRow(snapshot),
      migrated: false,
    }
  }
}
