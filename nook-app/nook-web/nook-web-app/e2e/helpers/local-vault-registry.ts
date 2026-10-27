import type { Page } from '@playwright/test'

/** One vault in this browser's local vault list, as IndexedDB stores it. */
export type LocalVaultRegistryEntry = {
  store_id?: string
  label?: string
}

/** Read this browser's local vault list straight from IndexedDB. */
export async function listLocalVaultEntries(page: Page) {
  return page.evaluate(() => {
    return new Promise<LocalVaultRegistryEntry[]>((resolve, reject) => {
      const request = indexedDB.open('nook_db')
      request.onerror = () =>
        reject(((v) => (v ? v : new Error('idb open failed')))(request.error))
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('vault', 'readonly')
        const store = tx.objectStore('vault')
        const getReq = store.get('vault_registry')
        getReq.onerror = () =>
          reject(((v) => (v ? v : new Error('idb read failed')))(getReq.error))
        getReq.onsuccess = () => {
          try {
            const raw: unknown = getReq.result
            const parsed: unknown =
              typeof raw === 'string' ? JSON.parse(raw) : {}
            if (typeof parsed !== 'object' || Object(parsed) !== parsed) {
              resolve([])
              return
            }
            const vaultsValue: unknown = Object.getOwnPropertyDescriptor(
              parsed,
              'vaults',
            )?.value
            if (!Array.isArray(vaultsValue)) {
              resolve([])
              return
            }
            const entries: LocalVaultRegistryEntry[] = []
            for (const value of vaultsValue) {
              if (typeof value !== 'object' || Object(value) !== value) continue
              const storeId: unknown = Object.getOwnPropertyDescriptor(
                value,
                'store_id',
              )?.value
              const label: unknown = Object.getOwnPropertyDescriptor(
                value,
                'label',
              )?.value
              entries.push({
                ...(typeof storeId === 'string' ? { store_id: storeId } : {}),
                ...(typeof label === 'string' ? { label } : {}),
              })
            }
            resolve(entries)
          } catch (error) {
            reject(error)
          }
        }
        tx.oncomplete = () => db.close()
      }
    })
  })
}
