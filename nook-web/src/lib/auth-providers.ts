export type StorageProviderType = 'local' | 'github'

export interface StorageProvider {
  id: string
  type: StorageProviderType
  label: string
  githubPat?: string
  createdAt: string
}

export interface AuthProvidersSnapshot {
  providers: StorageProvider[]
  activeProviderId: string | null
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
    id: crypto.randomUUID(),
    type,
    label: type === 'github' ? 'GitHub sync' : 'This device',
    githubPat: type === 'github' ? pat : undefined,
    createdAt: new Date().toISOString(),
  }

  localStorage.removeItem('nook_storage_mode')
  localStorage.removeItem('nook_github_pat')

  return {
    providers: [provider],
    activeProviderId: provider.id,
  }
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
    const migrated = migrateFromLocalStorage(snapshot)
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
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      store.put(snapshot, STATE_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () =>
        reject(tx.error ?? new Error('Failed to save auth providers.'))
    })
  } finally {
    db.close()
  }
}

export function providerDefaultLabel(type: StorageProviderType): string {
  return type === 'github' ? 'GitHub sync' : 'This device'
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
