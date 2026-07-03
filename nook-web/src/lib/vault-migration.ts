import {
  DEFAULT_DRIVE_VAULT_FILE,
  formatDriveStorageRef,
  providerDefaultLabel,
  type AuthProvidersSnapshot,
  type StorageProvider,
  wasmStorageModeForProvider,
} from '$lib/auth-providers'
import { generateId } from '$lib/nook'
import { hasLocalVault } from '$lib/local-vault'
import { fetchRemoteVaultBlob, writeLocalVaultBlob } from '$lib/vault-sync'

type LegacyAuthSnapshot = AuthProvidersSnapshot & {
  activeProviderId?: string | null
}

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
  const value = (raw ?? {}) as LegacyAuthSnapshot
  const providers = Array.isArray(value.providers) ? value.providers : []
  const legacyActiveProviderId =
    typeof value.activeProviderId === 'string' ? value.activeProviderId : null
  const hadActiveId =
    raw !== null &&
    raw !== undefined &&
    typeof raw === 'object' &&
    'activeProviderId' in raw
  const activeVaultStoreId =
    typeof value.activeVaultStoreId === 'string'
      ? value.activeVaultStoreId
      : undefined
  return {
    snapshot: { providers, activeVaultStoreId },
    legacyActiveProviderId,
    changed: hadActiveId,
  }
}

/** Ensure a local provider row exists for the active vault. */
export function ensureLocalProviderRow(
  snapshot: AuthProvidersSnapshot,
  activeStoreId?: string,
): AuthProvidersSnapshot {
  const storeId = activeStoreId ?? snapshot.activeVaultStoreId
  const hasLocalForVault = snapshot.providers.some(
    (provider) =>
      provider.type === 'local' &&
      (!storeId || !provider.storeId || provider.storeId === storeId),
  )
  if (hasLocalForVault) {
    return snapshot
  }
  const local: StorageProvider = {
    id: generateId(),
    type: 'local',
    label: providerDefaultLabel('local'),
    storeId,
    createdAt: new Date().toISOString(),
  }
  return { ...snapshot, providers: [local, ...snapshot.providers] }
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
    (provider) => provider.type !== 'local',
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
