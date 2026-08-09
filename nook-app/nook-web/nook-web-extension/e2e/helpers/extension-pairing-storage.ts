import type { Page, Worker } from '@playwright/test'

type ExtensionExecutionScope = Page | Worker

export type ExtensionPersistenceSnapshot = {
  pairingState: string
  eventLogState: string
  providerState: string
}

type IndexedDbSnapshotArgs = {
  databaseName: string
  storeNames: string[]
}

export async function readExtensionPersistenceSnapshot(
  scope: ExtensionExecutionScope,
): Promise<ExtensionPersistenceSnapshot> {
  return scope.evaluate(async () => {
    const readDatabaseSnapshot = async (
      args: IndexedDbSnapshotArgs,
    ): Promise<string> => {
      const databases = await indexedDB.databases()
      if (!databases.some((database) => database.name === args.databaseName)) {
        return 'database:absent'
      }
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(args.databaseName)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      try {
        const existingStores = args.storeNames.filter((storeName) =>
          database.objectStoreNames.contains(storeName),
        )
        if (existingStores.length === 0) return 'stores:absent'
        const transaction = database.transaction(existingStores, 'readonly')
        const stores = await Promise.all(
          existingStores.map(async (storeName) => {
            const store = transaction.objectStore(storeName)
            const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
              const request = store.getAllKeys()
              request.onsuccess = () => resolve(request.result)
              request.onerror = () => reject(request.error)
            })
            const values = await new Promise<object[]>((resolve, reject) => {
              const request = store.getAll()
              request.onsuccess = () => resolve(request.result)
              request.onerror = () => reject(request.error)
            })
            return { storeName, keys, values }
          }),
        )
        return JSON.stringify(stores)
      } finally {
        database.close()
      }
    }

    const pairingArgs: IndexedDbSnapshotArgs = {
      databaseName: 'nook_extension',
      storeNames: ['pairing'],
    }
    const eventLogArgs: IndexedDbSnapshotArgs = {
      databaseName: 'nook_db',
      storeNames: [
        'vault',
        'events',
        'projections',
        'provider_receipts',
        'outbox',
      ],
    }
    const providerArgs: IndexedDbSnapshotArgs = {
      databaseName: 'nook_auth',
      storeNames: ['auth'],
    }
    const [pairingState, eventLogState, providerState] = await Promise.all([
      readDatabaseSnapshot(pairingArgs),
      readDatabaseSnapshot(eventLogArgs),
      readDatabaseSnapshot(providerArgs),
    ])
    return { pairingState, eventLogState, providerState }
  })
}

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
