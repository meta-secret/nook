import { expect, test } from './fixtures'
import {
  createLocalVaultOnLogin,
  disableLoginAutoUnlock,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  readLocalVaultYamlFromIdb,
  UI_TIMEOUT_MS,
  unlockVaultOnLogin,
} from './helpers'

async function listLocalVaultStoreIds(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    return new Promise<string[]>((resolve, reject) => {
      const request = indexedDB.open('nook_db', 1)
      request.onerror = () =>
        reject(request.error ?? new Error('idb open failed'))
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('vault', 'readonly')
        const store = tx.objectStore('vault')
        const getReq = store.get('vault_registry')
        getReq.onerror = () =>
          reject(getReq.error ?? new Error('idb read failed'))
        getReq.onsuccess = () => {
          try {
            const raw = getReq.result
            const parsed =
              typeof raw === 'string'
                ? (JSON.parse(raw) as { vaults?: Array<{ store_id?: string }> })
                : { vaults: [] }
            resolve(
              (parsed.vaults ?? [])
                .map((entry) => entry.store_id ?? '')
                .filter(Boolean),
            )
          } catch (error) {
            reject(error)
          }
        }
        tx.oncomplete = () => db.close()
      }
    })
  })
}

function parseStoreId(yaml: string): string {
  const match = yaml.match(/^store_id:\s*(\S+)/m)
  if (!match) {
    throw new Error('store_id missing from vault yaml')
  }
  return match[1]
}

async function seedScopedGithubProviders(
  page: import('@playwright/test').Page,
  storeA: string,
  storeB: string,
) {
  await page.evaluate(
    ({ storeA, storeB }) => {
      return new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('nook_auth', 1)
        request.onerror = () =>
          reject(request.error ?? new Error('idb open failed'))
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction('auth', 'readwrite')
          const store = tx.objectStore('auth')
          const snapshot = {
            activeVaultStoreId: storeA,
            providers: [
              {
                id: 'provider-a',
                type: 'github',
                label: 'GitHub · nook-multi-vault-a',
                githubRepo: 'nook-multi-vault-a',
                githubPat: 'ghp_test_token',
                storeId: storeA,
                createdAt: new Date().toISOString(),
              },
              {
                id: 'provider-b',
                type: 'github',
                label: 'GitHub · nook-multi-vault-b',
                githubRepo: 'nook-multi-vault-b',
                githubPat: 'ghp_test_token',
                storeId: storeB,
                createdAt: new Date().toISOString(),
              },
            ],
          }
          const putReq = store.put(snapshot, 'providers')
          putReq.onerror = () =>
            reject(putReq.error ?? new Error('idb write failed'))
          putReq.onsuccess = () => undefined
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error ?? new Error('idb tx failed'))
        }
      })
    },
    { storeA, storeB },
  )
  await disableLoginAutoUnlock(page)
  await page.reload()
  await expect(page.getByTestId('login-gate')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await unlockVaultOnLogin(page, { storeId: storeA })
  await expect(page.getByTestId('vault-panel')).toBeVisible()
}

test.describe('multi-vault on one browser profile', () => {
  test('creates two vaults, switches between them, and keeps sync providers scoped', async ({
    page,
  }) => {
    await page.goto('/')
    await createLocalVaultOnLogin(page)
    await expect(page.getByTestId('vault-panel')).toBeVisible()

    const vaultAYaml = await readLocalVaultYamlFromIdb(page)
    const storeA = parseStoreId(vaultAYaml)

    await page.getByTestId('header-lock-vault-btn').click()
    await expect(page.getByTestId('login-local-unlock-step')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })

    await page.getByTestId('login-vault-name-input').fill('Vault B')
    await page.getByTestId('login-create-additional-vault-btn').click()
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })

    const vaultBYaml = await readLocalVaultYamlFromIdb(page)
    const storeB = parseStoreId(vaultBYaml)
    expect(storeB).not.toEqual(storeA)

    const registry = await listLocalVaultStoreIds(page)
    expect(registry).toEqual(expect.arrayContaining([storeA, storeB]))
    expect(registry).toHaveLength(2)

    await expect(page.getByTestId('vault-switcher-trigger')).toBeVisible()

    await page.getByTestId('vault-switcher-trigger').click()
    await expect(page.getByTestId('vault-switcher-menu')).toBeVisible()
    await expect(page.getByTestId('vault-switcher-count')).toBeVisible()

    await page
      .locator(
        '[data-testid="vault-switcher-option"][data-store-id="' + storeA + '"]',
      )
      .click()
    await expect(page.getByTestId('login-local-unlock-step')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await unlockVaultOnLogin(page)
    await expect(page.getByTestId('vault-panel')).toBeVisible()

    let activeYaml = await readLocalVaultYamlFromIdb(page)
    expect(parseStoreId(activeYaml)).toEqual(storeA)

    await page.getByTestId('vault-switcher-trigger').click()
    await expect(page.getByTestId('vault-switcher-menu')).toBeVisible()
    await page
      .locator(
        '[data-testid="vault-switcher-option"][data-store-id="' + storeB + '"]',
      )
      .click()
    await expect(page.getByTestId('login-local-unlock-step')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await unlockVaultOnLogin(page)
    activeYaml = await readLocalVaultYamlFromIdb(page)
    expect(parseStoreId(activeYaml)).toEqual(storeB)

    await seedScopedGithubProviders(page, storeA, storeB)
    await page.getByTestId('vault-settings-tab').click()
    await expect(page.getByTestId('settings-provider-github')).toBeVisible()
    await expect(page.getByTestId('settings-providers-list')).toContainText(
      'nook-multi-vault-a',
    )
    await expect(page.getByTestId('settings-providers-list')).not.toContainText(
      'nook-multi-vault-b',
    )
  })
})
