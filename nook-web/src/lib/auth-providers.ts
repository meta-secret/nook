import { migrateLegacyVaultToLocal } from '$lib/vault-migration'
import {
  deleteAuthProvidersDb as deleteAuthProvidersDbWasm,
  default as initNookWasm,
  defaultDriveVaultFile,
  defaultGithubRepo,
  findDuplicateSyncProvider as findDuplicateSyncProviderWasm,
  formatDriveStorageRef as formatDriveStorageRefCore,
  loadAuthProviders as loadAuthProvidersWasm,
  maskGithubPatHint as maskGithubPatHintCore,
  NookSyncProviderTarget,
  providerDefaultLabel as providerDefaultLabelCore,
  saveAuthProviders as saveAuthProvidersWasm,
  syncProviderTargetKey as syncProviderTargetKeyCore,
  wasmStorageModeForProvider as wasmStorageModeForProviderCore,
} from './nook-wasm/nook_wasm'

await initNookWasm()

export type StorageProviderType = 'local' | 'github' | 'oauth-file'

export type OAuthFilePreset = 'google-drive' | 'icloud'

export interface OAuthFileConfig {
  preset: OAuthFilePreset
  accessToken: string
  refreshToken?: string
  expiresAt?: string
  fileId?: string
  /** Vault file name in Drive app data or CloudKit record name (default `nook-vault.yaml`). */
  fileName?: string
  accountEmail?: string
}

export interface StorageProvider {
  id: string
  type: StorageProviderType
  label: string
  githubPat?: string
  /** GitHub repository name (not owner/name). Defaults to `nook`. */
  githubRepo?: string
  oauthFile?: OAuthFileConfig
  /** Logical secret-store id — same across provider replicas of one vault. */
  storeId?: string
  /** Monotonic vault_version after last successful sync to this provider. */
  lastSyncedVersion?: number
  /** ISO timestamp of last successful sync. */
  lastSyncedAt?: string
  /** Remote revision token (GitHub sha, Drive revisionId) for the next write. */
  lastSyncRevision?: string
  createdAt: string
}

export interface AuthProvidersSnapshot {
  providers: StorageProvider[]
  /** Active vault store_id — providers are scoped to this vault. */
  activeVaultStoreId?: string
}

/** Shape returned by the wasm `loadAuthProviders` pipeline. */
interface LoadedAuthProviders {
  snapshot: AuthProvidersSnapshot
  legacyActiveProviderId: string | null
  changed: boolean
}

export const DEFAULT_GITHUB_REPO = defaultGithubRepo()
export const DEFAULT_DRIVE_VAULT_FILE = defaultDriveVaultFile()

/** Plain snapshot safe for the wasm boundary (no reactive proxies / undefined). */
function toPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** Canonical identity for a sync target — two providers with the same key are duplicates. */
export function syncProviderTargetKey(
  provider: StorageProvider,
): string | null {
  const target =
    provider.type === 'local'
      ? NookSyncProviderTarget.local()
      : provider.type === 'github'
        ? NookSyncProviderTarget.github(
            provider.githubRepo ?? null,
            provider.githubPat ?? null,
          )
        : provider.oauthFile
          ? NookSyncProviderTarget.oauthFile(
              provider.oauthFile.preset,
              provider.oauthFile.fileId ?? null,
              provider.oauthFile.fileName ?? null,
              provider.oauthFile.accountEmail ?? null,
              provider.oauthFile.accessToken ?? null,
            )
          : NookSyncProviderTarget.missingOauthFileConfig()
  try {
    return syncProviderTargetKeyCore(target) ?? null
  } finally {
    target.free()
  }
}

export function findDuplicateSyncProvider(
  providers: StorageProvider[],
  candidate: StorageProvider,
  options?: { excludeId?: string },
): StorageProvider | undefined {
  return findDuplicateSyncProviderWasm(
    toPlain(providers),
    toPlain(candidate),
    options?.excludeId ?? undefined,
  ) as StorageProvider | undefined
}

export function formatDriveStorageRef(
  fileId: string | undefined,
  fileName: string,
): string {
  return formatDriveStorageRefCore(fileId ?? null, fileName)
}

export async function loadAuthProviders(): Promise<AuthProvidersSnapshot> {
  const loaded = (await loadAuthProvidersWasm()) as LoadedAuthProviders
  return loaded.snapshot
}

/** Load providers, then copy a legacy remote vault into local storage once. */
export async function loadAuthProvidersWithVaultMigration(): Promise<AuthProvidersSnapshot> {
  const loaded = (await loadAuthProvidersWasm()) as LoadedAuthProviders
  const { snapshot: migratedSnapshot, migrated } =
    await migrateLegacyVaultToLocal(
      loaded.snapshot,
      loaded.legacyActiveProviderId,
    )
  if (
    migrated ||
    migratedSnapshot.providers.length !== loaded.snapshot.providers.length
  ) {
    await saveAuthProviders(migratedSnapshot)
  }
  return migratedSnapshot
}

export async function saveAuthProviders(
  snapshot: AuthProvidersSnapshot,
): Promise<void> {
  await saveAuthProvidersWasm(toPlain(snapshot))
}

export function wasmStorageModeForProvider(
  type: StorageProviderType,
  oauthPreset?: OAuthFilePreset,
): string {
  return wasmStorageModeForProviderCore(type, oauthPreset ?? null)
}

export function providerDefaultLabel(
  type: StorageProviderType,
  detail?: string,
  oauthPreset: OAuthFilePreset = 'google-drive',
): string {
  return providerDefaultLabelCore(type, detail ?? null, oauthPreset)
}

export function localizeProviderLabel(
  label: string,
  t: (key: string) => string,
): string {
  if (label === 'This device') {
    return t('provider_picker.this_device')
  }
  if (label === 'GitHub') {
    return t('provider_picker.github')
  }
  if (label.startsWith('Google Drive · ')) {
    const file = label.slice('Google Drive · '.length)
    return `${t('provider_picker.google_drive')} · ${file}`
  }
  if (label === 'Google Drive') {
    return t('provider_picker.google_drive')
  }
  if (label.startsWith('iCloud · ')) {
    const file = label.slice('iCloud · '.length)
    return `${t('provider_picker.icloud')} · ${file}`
  }
  if (label === 'iCloud') {
    return t('provider_picker.icloud')
  }
  if (label.startsWith('GitHub · ')) {
    const repo = label.slice('GitHub · '.length)
    return `${t('provider_picker.github')} · ${repo}`
  }
  return label
}

/** Safe PAT hint for provider lists — never shows the full token. */
export function maskGithubPat(
  pat: string | undefined,
  t?: (key: string) => string,
): string {
  const hint = maskGithubPatHintCore(pat ?? null)
  if (hint == null) {
    return t ? t('auth_storage.no_token_saved') : 'No token saved'
  }
  return hint
}

export function maskOAuthAccount(
  oauth: OAuthFileConfig | undefined,
  t?: (key: string) => string,
): string {
  const email = oauth?.accountEmail?.trim()
  if (email) return email
  if (oauth?.accessToken?.trim()) {
    if (oauth.preset === 'icloud') {
      return t ? t('auth_storage.icloud_signed_in') : 'Signed in with iCloud'
    }
    return t ? t('auth_storage.google_signed_in') : 'Signed in with Google'
  }
  if (oauth?.preset === 'icloud') {
    return t
      ? t('auth_storage.icloud_not_signed_in')
      : 'Not signed in with iCloud'
  }
  return t ? t('auth_storage.google_not_signed_in') : 'Not signed in'
}

/** Secondary line for provider rows in management / picker UIs. */
export function providerStorageDetail(
  provider: StorageProvider,
  t?: (key: string) => string,
): string {
  if (provider.type === 'local') {
    return t
      ? t('provider_picker.this_device_desc')
      : 'Vault in browser storage on this device'
  }
  if (provider.type === 'oauth-file') {
    const file =
      provider.oauthFile?.fileName?.trim() || DEFAULT_DRIVE_VAULT_FILE
    const account = maskOAuthAccount(provider.oauthFile, t)
    return `${file} · ${account}`
  }
  const repo = provider.githubRepo?.trim() || DEFAULT_GITHUB_REPO
  return `${repo}/nook-vault.yaml · ${maskGithubPat(provider.githubPat, t)}`
}

export async function deleteAuthProvidersDb(): Promise<void> {
  await deleteAuthProvidersDbWasm()
}
