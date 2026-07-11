import { expect, test, type Page } from './fixtures'
import {
  authorizeDeviceProtection,
  createLocalVaultOnLogin,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  readLocalVaultYamlFromIdb,
  unlockVaultOnLogin,
} from './helpers'

async function readIdbKey(
  page: Page,
  storeName: string,
  key: string,
): Promise<string | undefined> {
  return page.evaluate(
    ({ storeName, idbKey }) => {
      return new Promise<string | undefined>((resolve, reject) => {
        const request = indexedDB.open('nook_db')
        request.onerror = () =>
          reject(request.error ?? new Error('idb open failed'))
        request.onsuccess = () => {
          const db = request.result
          if (!db.objectStoreNames.contains(storeName)) {
            db.close()
            resolve(undefined)
            return
          }
          const tx = db.transaction(storeName, 'readonly')
          const store = tx.objectStore(storeName)
          const getReq = store.get(idbKey)
          getReq.onerror = () =>
            reject(getReq.error ?? new Error('idb read failed'))
          getReq.onsuccess = () => {
            const value = getReq.result
            resolve(value == undefined ? undefined : String(value))
          }
          tx.oncomplete = () => db.close()
        }
      })
    },
    { storeName, idbKey: key },
  )
}

async function clearEventLogState(page: Page, storeId: string) {
  await page.evaluate((sid) => {
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('nook_db')
      request.onerror = () =>
        reject(request.error ?? new Error('idb open failed'))
      request.onsuccess = () => {
        const db = request.result
        const stores = ['vault', 'events', 'projections', 'outbox'].filter(
          (name) => db.objectStoreNames.contains(name),
        )
        if (stores.length === 0) {
          db.close()
          resolve()
          return
        }
        const staticKeysByStore: Record<string, string[]> = {
          vault: ['event_log:mode'],
          events: [`event_index:${sid}`],
          projections: [
            `event_heads:${sid}`,
            `event_epoch:${sid}`,
            `source_backup:${sid}`,
          ],
          outbox: [],
        }
        const tx = db.transaction(stores, 'readwrite')
        for (const storeName of stores) {
          const store = tx.objectStore(storeName)
          for (const key of staticKeysByStore[storeName] ?? []) {
            store.delete(key)
          }
          if (storeName === 'outbox') {
            store.clear()
          }
          if (storeName === 'events') {
            const all = store.getAllKeys()
            all.onerror = () =>
              reject(all.error ?? new Error('idb key scan failed'))
            all.onsuccess = () => {
              for (const key of all.result) {
                const name = String(key)
                if (name.startsWith(`event:${sid}:`)) {
                  store.delete(key)
                }
              }
            }
          }
        }
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error ?? new Error('idb tx failed'))
      }
    })
  }, storeId)
}

function parseStoreId(yaml: string): string {
  const match = yaml.match(/^store_id:\s*(\S+)/m)
  if (!match?.[1]) {
    throw new Error('local vault yaml missing store_id')
  }
  return match[1]
}

test.describe('source vault import to event log', () => {
  test('re-import on unlock preserves backup and activates event log', async ({
    page,
  }) => {
    await page.goto('/app/')
    await createLocalVaultOnLogin(page)

    const yaml = await readLocalVaultYamlFromIdb(page)
    const storeId = parseStoreId(yaml)

    await page.getByTestId('header-lock-vault-btn').click()
    await clearEventLogState(page, storeId)
    expect(await readIdbKey(page, 'vault', 'event_log:mode')).toBeUndefined()

    await authorizeDeviceProtection(page)
    await unlockVaultOnLogin(page)
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })

    expect(await readIdbKey(page, 'vault', 'event_log:mode')).toBe('event_log')
    const backup = await readIdbKey(
      page,
      'projections',
      `source_backup:${storeId}`,
    )
    expect(backup?.trim().length ?? 0).toBeGreaterThan(0)

    const migratedYaml = await readLocalVaultYamlFromIdb(page)
    expect(migratedYaml).toContain('schema_version: 1')
  })
})
