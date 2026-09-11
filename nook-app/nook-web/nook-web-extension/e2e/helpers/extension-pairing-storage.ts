import type { Page, Worker } from '@playwright/test'
import { companionWasmReady } from '../../../nook-web-shared/src/extension/companion-ready'
import {
  classify_extension_persistence_databases,
  ExtensionPersistenceArea,
  ExtensionPersistenceDatabaseState,
  type ExtensionPersistenceObservation,
  extension_persistence_database_name,
  matching_extension_persistence_stores,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

type ExtensionExecutionScope = Page | Worker
type ExtensionPageFunctionWithoutArgument<Result> = () =>
  Result | Promise<Result>

function isPage(scope: ExtensionExecutionScope): scope is Page {
  return 'context' in scope
}

async function evaluateExtensionScopeWithoutArgument<Result>([
  scope,
  pageFunction,
]: readonly [
  ExtensionExecutionScope,
  ExtensionPageFunctionWithoutArgument<Result>,
]): Promise<Result> {
  return isPage(scope)
    ? scope.evaluate(pageFunction)
    : scope.evaluate(pageFunction)
}

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
  return evaluateExtensionScopeWithoutArgument([
    scope,
    async () => {
      const names: string[] = []
      for (const database of await indexedDB.databases()) {
        if (typeof database.name === 'string') names.push(database.name)
      }
      return names
    },
  ])
}

async function observedStoreNames(
  args: IndexedDbSnapshotArgs,
): Promise<string[]> {
  const databaseName = extension_persistence_database_name(args.area)
  const readStoreNames = async (name: string) => {
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
  }
  return isPage(args.scope)
    ? args.scope.evaluate(readStoreNames, databaseName)
    : args.scope.evaluate(readStoreNames, databaseName)
}

async function readDatabaseSnapshot(
  args: IndexedDbSnapshotArgs,
): Promise<string> {
  await companionWasmReady
  const databaseNames = await observedDatabaseNames(args.scope)
  const databaseObservation: ExtensionPersistenceObservation = {
    area: args.area,
    observedNames: databaseNames,
  }
  const databaseState =
    classify_extension_persistence_databases(databaseObservation)
  if (databaseState === ExtensionPersistenceDatabaseState.Absent) {
    return 'database:absent'
  }

  const stores = await observedStoreNames(args)
  const storeObservation: ExtensionPersistenceObservation = {
    area: args.area,
    observedNames: stores,
  }
  const storeNames = matching_extension_persistence_stores(storeObservation)
  if (storeNames.length === 0) return 'stores:absent'

  const readArgs: IndexedDbReadArgs = {
    databaseName: extension_persistence_database_name(args.area),
    storeNames,
  }
  const readSnapshot = async (input: IndexedDbReadArgs) => {
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
          const values = await new Promise<unknown[]>((resolve, reject) => {
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
  }
  return isPage(args.scope)
    ? args.scope.evaluate(readSnapshot, readArgs)
    : args.scope.evaluate(readSnapshot, readArgs)
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
  return evaluateExtensionScopeWithoutArgument([
    scope,
    async () => {
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
    },
  ])
}

export async function writeExtensionPairingStorage(
  scope: ExtensionExecutionScope,
  entries: Record<string, unknown>,
): Promise<void> {
  const writeStorage = async (storageEntries: Record<string, unknown>) => {
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
  }
  await (isPage(scope)
    ? scope.evaluate(writeStorage, entries)
    : scope.evaluate(writeStorage, entries))
}

export async function removeExtensionPairingStorageKeys(
  scope: ExtensionExecutionScope,
  keys: string[],
): Promise<void> {
  const removeStorageKeys = async (storageKeys: string[]) => {
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
  }
  await (isPage(scope)
    ? scope.evaluate(removeStorageKeys, keys)
    : scope.evaluate(removeStorageKeys, keys))
}
