import { expect, test, type Page } from './fixtures'
import {
  connectGithubGenesisDevice,
  createLocalE2eGithubVaultStub,
  createLocalVaultOnLogin,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  readLocalVaultYamlFromIdb,
  seedExtraGithubProviders,
  stubGithubVaultForLocalE2e,
  UI_TIMEOUT_MS,
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

  test('resolves store_id conflict during login by keeping local copy', async ({
    page,
    browser,
  }) => {
    const repoName = 'nook-e2e-store-id-conflict'
    const stub = createLocalE2eGithubVaultStub()

    const genesisContext = await browser.newContext()
    const genesisPage = await genesisContext.newPage()
    await connectGithubGenesisDevice(
      genesisPage,
      'ghp_test_token',
      repoName,
      stub,
    )
    const remoteYaml = stub.getVaultYaml()
    const remoteStoreId = parseStoreId(remoteYaml)
    await genesisContext.close()

    await page.goto('/')
    await createLocalVaultOnLogin(page)
    const localYaml = await readLocalVaultYamlFromIdb(page)
    const localStoreId = parseStoreId(localYaml)
    expect(localStoreId).not.toEqual(remoteStoreId)

    await page.getByTestId('header-lock-vault-btn').click()
    await expect(page.getByTestId('login-local-unlock-step')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })

    await stubGithubVaultForLocalE2e(
      page,
      { repoName, vaultYaml: remoteYaml },
      stub,
    )

    await page.evaluate(() => {
      const vault = (
        window as Window & {
          __nookVault?: { beginProviderSetup: (type: 'github') => void }
        }
      ).__nookVault
      if (!vault) {
        throw new Error('__nookVault is not exposed (dev build required).')
      }
      vault.beginProviderSetup('github')
    })
    await expect(page.getByTestId('github-repo-input')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await page.getByTestId('github-repo-input').fill(repoName)
    await page.getByTestId('github-pat-input').fill('ghp_test_token')
    await page.getByTestId('connect-provider-btn').click()

    await expect(page.getByTestId('vault-sync-conflict-dialog')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(page.getByTestId('sync-conflict-import-new-vault-btn')).toBeVisible()

    await page.getByTestId('sync-conflict-keep-local-btn').click()
    await expect(
      page.getByTestId('vault-sync-conflict-dialog'),
    ).not.toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(page.getByTestId('login-gate')).not.toBeVisible()
    expect(parseStoreId(stub.getVaultYaml())).toEqual(localStoreId)
  })
})
