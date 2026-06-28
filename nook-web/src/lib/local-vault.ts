const DB_NAME = 'nook_db'
const DB_VERSION = 1
const STORE = 'vault'
const ENCRYPTED_DB_KEY = 'encrypted_db'

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
      reject(request.error ?? new Error('Failed to open nook_db.'))
  })
}

/** True when the browser has a non-empty local vault blob in IndexedDB. */
export async function hasLocalVault(): Promise<boolean> {
  const db = await openDb()
  try {
    return await new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const store = tx.objectStore(STORE)
      const request = store.get(ENCRYPTED_DB_KEY)
      request.onsuccess = () => {
        const value = request.result
        resolve(typeof value === 'string' && value.trim().length > 0)
      }
      request.onerror = () =>
        reject(request.error ?? new Error('Failed to read local vault.'))
    })
  } finally {
    db.close()
  }
}
