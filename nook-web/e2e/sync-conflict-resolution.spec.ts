import { expect, test, type Page } from './fixtures'
import {
  authorizeDeviceProtection,
  connectGithubSyncProviderFromSettings,
  createLocalE2eGithubVaultStub,
  createLocalVaultOnLogin,
  disableVaultIdleLock,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  readLocalVaultYamlFromIdb,
  seedExtraGithubProviders,
  stubGithubVaultForLocalE2e,
  UI_TIMEOUT_MS,
  unlockVaultOnLogin,
  waitForLoadedSyncProviders,
} from './helpers'
import type { PendingSyncConflict } from '../src/lib/vault-sync'

function parseStoreId(yaml: string): string {
  const match = yaml.match(/^store_id:\s*(\S+)/m)
  if (!match) {
    throw new Error('store_id missing from vault yaml')
  }
  return match[1]
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

  test('resolves store_id conflict when second vault uses the same github repo', async ({
    page,
  }) => {
    const repoName = 'nook-e2e-shared-vault-file'
    const stub = createLocalE2eGithubVaultStub()
    await stub.install(page, { repoName })

    await page.goto('/')
    await createLocalVaultOnLogin(page, 'test')
    await disableVaultIdleLock(page)
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })

    const vaultAYaml = await readLocalVaultYamlFromIdb(page)
    const storeA = parseStoreId(vaultAYaml)

    await connectGithubSyncProviderFromSettings(page, repoName)
    await expect(page.getByTestId('settings-provider-github')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await waitForLoadedSyncProviders(page)
    await expect
      .poll(() => parseStoreId(stub.getVaultYaml()), {
        timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
      })
      .toEqual(storeA)

    await page.getByTestId('vault-secrets-tab').click()
    await expect(page.getByTestId('vault-panel')).toBeVisible()

    await page.getByTestId('header-lock-vault-btn').click()
    await authorizeDeviceProtection(page)
    await expect(page.getByTestId('login-local-unlock-step')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })

    await page.getByTestId('login-vault-name-input').fill('test-2')
    await page.getByTestId('login-create-additional-vault-btn').click()
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await disableVaultIdleLock(page)

    const vaultBYaml = await readLocalVaultYamlFromIdb(page)
    const storeB = parseStoreId(vaultBYaml)
    expect(storeB).not.toEqual(storeA)

    await connectGithubSyncProviderFromSettings(
      page,
      repoName,
      'ghp_test_token',
      {
        expectConflict: true,
      },
    )

    await expect(page.getByTestId('vault-sync-conflict-dialog')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(
      page.getByTestId('sync-conflict-import-new-vault-btn'),
    ).toBeVisible()

    await page.getByTestId('sync-conflict-keep-local-btn').click()
    await expect(
      page.getByTestId('vault-sync-conflict-dialog'),
    ).not.toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
    await expect(page.getByTestId('settings-provider-github')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    expect(parseStoreId(stub.getVaultYaml())).toEqual(storeB)

    await page.getByTestId('vault-secrets-tab').click()
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })

    await page.getByTestId('header-lock-vault-btn').click()
    await authorizeDeviceProtection(page)
    await unlockVaultOnLogin(page, { storeId: storeB })
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    expect(parseStoreId(await readLocalVaultYamlFromIdb(page))).toEqual(storeB)
  })
})
