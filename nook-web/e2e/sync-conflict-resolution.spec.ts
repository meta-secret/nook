import { expect, test, type Page } from './fixtures'
import {
  createLocalVaultOnLogin,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  seedExtraGithubProviders,
  stubGithubVaultForLocalE2e,
  UI_TIMEOUT_MS,
} from './helpers'
import type { PendingSyncConflict } from '../src/lib/vault-sync'

async function readLocalVaultYamlFromIdb(page: Page): Promise<string> {
  return page.evaluate(() => {
    return new Promise<string>((resolve, reject) => {
      const request = indexedDB.open('nook_db', 1)
      request.onerror = () =>
        reject(request.error ?? new Error('idb open failed'))
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('vault', 'readonly')
        const store = tx.objectStore('vault')
        const getReq = store.get('encrypted_db')
        getReq.onerror = () =>
          reject(getReq.error ?? new Error('idb read failed'))
        getReq.onsuccess = () => {
          resolve(String(getReq.result ?? ''))
        }
        tx.oncomplete = () => db.close()
      }
    })
  })
}

async function stageVaultSyncConflict(
  page: Page,
  conflict: PendingSyncConflict,
) {
  await page.evaluate((payload) => {
    const vault = (
      window as Window & {
        __nookVault?: { stageSyncConflict: (c: PendingSyncConflict) => void }
      }
    ).__nookVault
    if (!vault) {
      throw new Error('__nookVault is not exposed (dev build required).')
    }
    vault.stageSyncConflict(payload)
  }, conflict)
}

test.describe('sync conflict resolution', () => {
  test('blocks secret edits and resolves by keeping remote copy', async ({
    page,
  }) => {
    await page.goto('/')
    await createLocalVaultOnLogin(page)
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })

    const localYaml = await readLocalVaultYamlFromIdb(page)
    expect(localYaml.trim().length).toBeGreaterThan(0)

    await stubGithubVaultForLocalE2e(page, {
      repoName: 'nook-e2e-conflict',
      vaultYaml: localYaml,
    })
    await seedExtraGithubProviders(page, [
      {
        id: 'e2e-conflict-github',
        label: 'GitHub (e2e)',
        githubRepo: 'nook-e2e-conflict',
        githubPat: 'ghp_test_token',
      },
    ])

    await stageVaultSyncConflict(page, {
      providerId: 'e2e-conflict-github',
      providerLabel: 'GitHub (e2e)',
      localYaml,
      remoteYaml: `${localYaml.trimEnd()}\n`,
      localVersion: 1,
      remoteVersion: 1,
      mode: 'github',
      pat: 'ghp_test_token',
      repo: 'nook-e2e-conflict',
      remoteRevision: 'abc123',
    })

    await expect(page.getByTestId('vault-sync-conflict-dialog')).toBeVisible()
    await expect(page.getByTestId('vault-sync-conflict-banner')).toBeVisible()
    await expect(page.getByTestId('add-secret-btn')).toBeDisabled()

    await page.getByTestId('sync-conflict-keep-remote-btn').click()
    await expect(
      page.getByTestId('vault-sync-conflict-dialog'),
    ).not.toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
    await expect(page.getByTestId('add-secret-btn')).toBeEnabled({
      timeout: UI_TIMEOUT_MS,
    })
    await expect(page.getByTestId('app-success')).toContainText(
      'Vault updated from GitHub (e2e)',
    )
  })
})
