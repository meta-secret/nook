import type { Page, Worker } from '@playwright/test'

type ExtensionExecutionScope = Page | Worker

export async function readExtensionPairingStorage(
  scope: ExtensionExecutionScope,
): Promise<Record<string, unknown>> {
  return scope.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('nook_extension', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      const transaction = database.transaction('pairing', 'readonly')
      const store = transaction.objectStore('pairing')
      const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
        const request = store.getAllKeys()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const values = await new Promise<unknown[]>((resolve, reject) => {
        const request = store.getAll()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      return Object.fromEntries(
        keys.map((key, index) => [String(key), values[index]]),
      )
    } finally {
      database.close()
    }
  })
}

export async function writeExtensionPairingStorage(
  scope: ExtensionExecutionScope,
  entries: Record<string, unknown>,
): Promise<void> {
  await scope.evaluate(async (storageEntries) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('nook_extension', 1)
      request.onupgradeneeded = () => {
        request.result.createObjectStore('pairing')
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      const transaction = database.transaction('pairing', 'readwrite')
      const store = transaction.objectStore('pairing')
      for (const [key, value] of Object.entries(storageEntries)) {
        store.put(value, key)
      }
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
      })
    } finally {
      database.close()
    }
  }, entries)
}

export async function removeExtensionPairingStorageKeys(
  scope: ExtensionExecutionScope,
  keys: string[],
): Promise<void> {
  await scope.evaluate(async (storageKeys) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('nook_extension', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      const transaction = database.transaction('pairing', 'readwrite')
      const store = transaction.objectStore('pairing')
      for (const key of storageKeys) {
        store.delete(key)
      }
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
      })
    } finally {
      database.close()
    }
  }, keys)
}
