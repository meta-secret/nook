import { generateId } from '$lib/nook'
import {
  migrateLegacyVaultToLocal,
  normalizeAuthSnapshot,
} from '$lib/vault-migration'

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

export const DEFAULT_GITHUB_REPO = 'nook'
export const DEFAULT_DRIVE_VAULT_FILE = 'nook-vault.yaml'
const DRIVE_STORAGE_REF_SEP = '\t'

export function formatDriveStorageRef(
  fileId: string | undefined,
  fileName: string,
): string {
  const id = fileId?.trim() ?? ''
  const name = fileName.trim() || DEFAULT_DRIVE_VAULT_FILE
  return id ? `${id}${DRIVE_STORAGE_REF_SEP}${name}` : name
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
}

/** Plain snapshot safe for IndexedDB structured clone (no reactive proxies). */
function toStorableSnapshot(
  snapshot: AuthProvidersSnapshot,
): AuthProvidersSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as AuthProvidersSnapshot
}

const DB_NAME = 'nook_auth'
const DB_VERSION = 1
const STORE = 'auth'
const STATE_KEY = 'providers'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error('Failed to open auth IndexedDB.'))
  })
}

function migrateFromLocalStorage(
  snapshot: AuthProvidersSnapshot,
): AuthProvidersSnapshot {
  if (snapshot.providers.length > 0) {
    return snapshot
  }

  const mode = localStorage.getItem('nook_storage_mode')
  const pat = localStorage.getItem('nook_github_pat')?.trim() ?? ''
  if (!mode && !pat) {
    return snapshot
  }

  const type: StorageProviderType = mode === 'github' ? 'github' : 'local'
  const provider: StorageProvider = {
    id: generateId(),
    type,
    label: providerDefaultLabel(type),
    githubPat: type === 'github' ? pat : undefined,
    githubRepo: type === 'github' ? DEFAULT_GITHUB_REPO : undefined,
    createdAt: new Date().toISOString(),
  }

  localStorage.removeItem('nook_storage_mode')
  localStorage.removeItem('nook_github_pat')

  return {
    providers: [provider],
  }
}

function migrateProviderFields(
  snapshot: AuthProvidersSnapshot,
): AuthProvidersSnapshot {
  let changed = false
  const providers = snapshot.providers.map((provider) => {
    if (provider.type === 'github') {
      if (provider.githubRepo?.trim()) {
        return provider
      }
      changed = true
      return { ...provider, githubRepo: DEFAULT_GITHUB_REPO }
    }
    if (provider.type === 'oauth-file') {
      if (provider.oauthFile?.fileName?.trim()) {
        return provider
      }
      changed = true
      const existing = provider.oauthFile
      return {
        ...provider,
        oauthFile: {
          preset: existing?.preset ?? ('google-drive' as const),
          accessToken: existing?.accessToken ?? '',
          refreshToken: existing?.refreshToken,
          expiresAt: existing?.expiresAt,
          fileId: existing?.fileId,
          accountEmail: existing?.accountEmail,
          fileName: DEFAULT_DRIVE_VAULT_FILE,
        },
      }
    }
    return provider
  })
  if (!changed) {
    return snapshot
  }
  return { ...snapshot, providers }
}

export async function loadAuthProviders(): Promise<AuthProvidersSnapshot> {
  const db = await openDb()
  try {
    const loaded = await new Promise<{
      snapshot: AuthProvidersSnapshot
      legacyActiveProviderId: string | null
      changed: boolean
    }>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const store = tx.objectStore(STORE)
      const request = store.get(STATE_KEY)
      request.onsuccess = () => {
        resolve(normalizeAuthSnapshot(request.result))
      }
      request.onerror = () =>
        reject(request.error ?? new Error('Failed to read auth providers.'))
    })
    let snapshot = migrateFromLocalStorage(loaded.snapshot)
    snapshot = migrateProviderFields(snapshot)
    if (loaded.changed || snapshot !== loaded.snapshot) {
      await saveAuthProviders(snapshot)
    }
    return snapshot
  } finally {
    db.close()
  }
}

/** Load providers, strip legacy fields, and copy a remote vault into local storage once. */
export async function loadAuthProvidersWithVaultMigration(): Promise<AuthProvidersSnapshot> {
  const db = await openDb()
  try {
    const loaded = await new Promise<{
      snapshot: AuthProvidersSnapshot
      legacyActiveProviderId: string | null
      changed: boolean
    }>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const store = tx.objectStore(STORE)
      const request = store.get(STATE_KEY)
      request.onsuccess = () => {
        resolve(normalizeAuthSnapshot(request.result))
      }
      request.onerror = () =>
        reject(request.error ?? new Error('Failed to read auth providers.'))
    })
    let snapshot = migrateFromLocalStorage(loaded.snapshot)
    snapshot = migrateProviderFields(snapshot)
    const { snapshot: migratedSnapshot, migrated: copiedVault } =
      await migrateLegacyVaultToLocal(snapshot, loaded.legacyActiveProviderId)
    const shouldSave =
      loaded.changed ||
      copiedVault ||
      migratedSnapshot.providers.length !== snapshot.providers.length
    if (shouldSave) {
      await saveAuthProviders(migratedSnapshot)
    }
    return migratedSnapshot
  } finally {
    db.close()
  }
}

export async function saveAuthProviders(
  snapshot: AuthProvidersSnapshot,
): Promise<void> {
  const storable = toStorableSnapshot(snapshot)
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      store.put(storable, STATE_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () =>
        reject(tx.error ?? new Error('Failed to save auth providers.'))
    })
  } finally {
    db.close()
  }
}

export function wasmStorageModeForProvider(
  type: StorageProviderType,
  oauthPreset?: OAuthFilePreset,
): string {
  if (type === 'oauth-file' && oauthPreset === 'google-drive') {
    return 'google-drive'
  }
  if (type === 'oauth-file' && oauthPreset === 'icloud') {
    return 'icloud'
  }
  return type
}

export function providerDefaultLabel(
  type: StorageProviderType,
  detail?: string,
  oauthPreset: OAuthFilePreset = 'google-drive',
): string {
  if (type === 'github') {
    const repo = detail?.trim() || DEFAULT_GITHUB_REPO
    return repo === DEFAULT_GITHUB_REPO ? 'GitHub' : `GitHub · ${repo}`
  }
  if (type === 'oauth-file') {
    const file = detail?.trim() || DEFAULT_DRIVE_VAULT_FILE
    if (oauthPreset === 'icloud') {
      return file === DEFAULT_DRIVE_VAULT_FILE ? 'iCloud' : `iCloud · ${file}`
    }
    return file === DEFAULT_DRIVE_VAULT_FILE
      ? 'Google Drive'
      : `Google Drive · ${file}`
  }
  return 'This device'
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
  const trimmed = pat?.trim() ?? ''
  if (!trimmed) return t ? t('auth_storage.no_token_saved') : 'No token saved'
  const prefixLen = trimmed.startsWith('github_pat_') ? 14 : 10
  if (trimmed.length <= prefixLen) return '••••'
  return `${trimmed.slice(0, prefixLen)}…`
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
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () =>
      reject(request.error ?? new Error('Failed to delete auth IndexedDB.'))
    request.onblocked = () => resolve()
  })
}
