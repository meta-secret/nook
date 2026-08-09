import type { Page, Worker } from '@playwright/test'
import { companionWasmReady } from '../../../nook-web-shared/src/extension/companion-ready'
import {
  classifyExtensionPersistenceDatabases,
  ExtensionPersistenceArea,
  ExtensionPersistenceDatabaseState,
  extensionPersistenceDatabaseName,
  matchingExtensionPersistenceStores,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

type ExtensionExecutionScope = Page | Worker

export type ExtensionPersistenceSnapshot = {
  pairingState: string
  eventLogState: string
  providerState: string
}

type IndexedDbSnapshotArgs = {
  scope: ExtensionExecutionScope
  area: ExtensionPersistenceArea
}

type IndexedDbReadArgs = {
  databaseName: string
  storeNames: string[]
}

async function observedDatabaseNames(
  scope: ExtensionExecutionScope,
): Promise<string[]> {
  return scope.evaluate(async () => {
    const names: string[] = []
    for (const database of await indexedDB.databases()) {
      if (typeof database.name === 'string') names.push(database.name)
    }
    return names
  })
}

async function observedStoreNames(
  args: IndexedDbSnapshotArgs,
): Promise<string[]> {
  const databaseName = extensionPersistenceDatabaseName(args.area)
  return args.scope.evaluate(async (name) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return Array.from(database.objectStoreNames)
    } finally {
      database.close()
    }
  }, databaseName)
}

async function readDatabaseSnapshot(
  args: IndexedDbSnapshotArgs,
): Promise<string> {
  await companionWasmReady
  const databaseNames = await observedDatabaseNames(args.scope)
  const databaseState = classifyExtensionPersistenceDatabases(
    args.area,
    databaseNames,
  )
  if (databaseState === ExtensionPersistenceDatabaseState.Absent) {
    return 'database:absent'
  }

  const stores = await observedStoreNames(args)
  const storeNames = matchingExtensionPersistenceStores(args.area, stores)
  if (storeNames.length === 0) return 'stores:absent'

  const readArgs: IndexedDbReadArgs = {
    databaseName: extensionPersistenceDatabaseName(args.area),
    storeNames,
  }
  return args.scope.evaluate(async (input) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(input.databaseName)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      const transaction = database.transaction(input.storeNames, 'readonly')
      const snapshots = await Promise.all(
        input.storeNames.map(async (storeName) => {
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
      return JSON.stringify(snapshots)
    } finally {
      database.close()
    }
  }, readArgs)
}

export async function readExtensionPersistenceSnapshot(
  scope: ExtensionExecutionScope,
): Promise<ExtensionPersistenceSnapshot> {
  const pairingArgs: IndexedDbSnapshotArgs = {
    scope,
    area: ExtensionPersistenceArea.Pairing,
  }
  const eventLogArgs: IndexedDbSnapshotArgs = {
    scope,
    area: ExtensionPersistenceArea.EventLog,
  }
  const providerArgs: IndexedDbSnapshotArgs = {
    scope,
    area: ExtensionPersistenceArea.Provider,
  }
  const [pairingState, eventLogState, providerState] = await Promise.all([
    readDatabaseSnapshot(pairingArgs),
    readDatabaseSnapshot(eventLogArgs),
    readDatabaseSnapshot(providerArgs),
  ])
  return { pairingState, eventLogState, providerState }
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
