import { generateId } from '$lib/nook'

export type StorageProviderType = 'local' | 'github'

export const DEFAULT_GITHUB_REPO = 'nook'

export interface StorageProvider {
  id: string
  type: StorageProviderType
  label: string
  githubPat?: string
  /** GitHub repository name (not owner/name). Defaults to `nook`. */
  githubRepo?: string
  createdAt: string
}

export interface AuthProvidersSnapshot {
  providers: StorageProvider[]
  activeProviderId: string | null
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
    activeProviderId: provider.id,
  }
}

function migrateProviderFields(
  snapshot: AuthProvidersSnapshot,
): AuthProvidersSnapshot {
  let changed = false
  const providers = snapshot.providers.map((provider) => {
    if (provider.type !== 'github') {
      return provider
    }
    if (provider.githubRepo?.trim()) {
      return provider
    }
    changed = true
    return { ...provider, githubRepo: DEFAULT_GITHUB_REPO }
  })
  if (!changed) {
    return snapshot
  }
  return { ...snapshot, providers }
}

export async function loadAuthProviders(): Promise<AuthProvidersSnapshot> {
  const db = await openDb()
  try {
    const snapshot = await new Promise<AuthProvidersSnapshot>(
      (resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly')
        const store = tx.objectStore(STORE)
        const request = store.get(STATE_KEY)
        request.onsuccess = () => {
          const value = request.result as AuthProvidersSnapshot | undefined
          resolve(
            value ?? {
              providers: [],
              activeProviderId: null,
            },
          )
        }
        request.onerror = () =>
          reject(request.error ?? new Error('Failed to read auth providers.'))
      },
    )
    const fromLocalStorage = migrateFromLocalStorage(snapshot)
    const migrated = migrateProviderFields(fromLocalStorage)
    if (migrated !== snapshot) {
      await saveAuthProviders(migrated)
    }
    return migrated
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

export function providerDefaultLabel(
  type: StorageProviderType,
  githubRepo?: string,
): string {
  if (type === 'github') {
    const repo = githubRepo?.trim() || DEFAULT_GITHUB_REPO
    return repo === DEFAULT_GITHUB_REPO ? 'GitHub sync' : `GitHub · ${repo}`
  }
  return 'This device'
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
