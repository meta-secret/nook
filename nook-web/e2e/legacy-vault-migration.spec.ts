import { expect, test, type Page } from './fixtures'
import {
  authorizeDeviceProtection,
  createLocalVaultOnLogin,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  readLocalVaultYamlFromIdb,
  unlockVaultOnLogin,
} from './helpers'

async function readVaultIdbKey(
  page: Page,
  key: string,
): Promise<string | null> {
  return page.evaluate((idbKey) => {
    return new Promise<string | null>((resolve, reject) => {
      const request = indexedDB.open('nook_db', 1)
      request.onerror = () =>
        reject(request.error ?? new Error('idb open failed'))
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('vault', 'readonly')
        const store = tx.objectStore('vault')
        const getReq = store.get(idbKey)
        getReq.onerror = () =>
          reject(getReq.error ?? new Error('idb read failed'))
        getReq.onsuccess = () => {
          const value = getReq.result
          resolve(value == null ? null : String(value))
        }
        tx.oncomplete = () => db.close()
      }
    })
  }, key)
}

async function clearEventLogState(page: Page, storeId: string) {
  await page.evaluate((sid) => {
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('nook_db', 1)
      request.onerror = () =>
        reject(request.error ?? new Error('idb open failed'))
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('vault', 'readwrite')
        const store = tx.objectStore('vault')
        const keysToDelete = [
          'event_log:mode',
          `event_heads:${sid}`,
          `event_epoch:${sid}`,
          `event_index:${sid}`,
        ]
        for (const key of keysToDelete) {
          store.delete(key)
        }
        const all = store.getAllKeys()
        all.onsuccess = () => {
          for (const key of all.result) {
            const name = String(key)
            if (name.startsWith(`event:${sid}:`)) {
              store.delete(key)
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

test.describe('legacy vault migration to event log', () => {
  test('re-import on unlock preserves backup and activates event log', async ({
    page,
  }) => {
    await page.goto('/')
    await createLocalVaultOnLogin(page)

    const yaml = await readLocalVaultYamlFromIdb(page)
    const storeId = parseStoreId(yaml)

    await page.getByTestId('header-lock-vault-btn').click()
    await clearEventLogState(page, storeId)
    expect(await readVaultIdbKey(page, 'event_log:mode')).toBeNull()

    await authorizeDeviceProtection(page)
    await unlockVaultOnLogin(page)
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })

    expect(await readVaultIdbKey(page, 'event_log:mode')).toBe('event_log')
    const backup = await readVaultIdbKey(page, `legacy_backup:${storeId}`)
    expect(backup?.trim().length ?? 0).toBeGreaterThan(0)

    const migratedYaml = await readLocalVaultYamlFromIdb(page)
    expect(migratedYaml).toContain('schema_version: 1')
  })
})
