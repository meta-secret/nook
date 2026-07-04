import { expect, test, type Page } from './fixtures'
import {
  authorizeDeviceProtection,
  connectGoogleDriveSyncProviderFromSettings,
  createLocalVaultOnLogin,
  disableVaultIdleLock,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  readLocalVaultYamlFromIdb,
  seedExtraOauthFileProviders,
  seedOauthFileSyncProvidersWhileUnlocked,
  stubGoogleDriveVaultForLocalE2e,
  triggerVaultSyncRefresh,
  UI_TIMEOUT_MS,
  unlockVaultOnLogin,
  waitForLoadedSyncProviders,
} from './helpers'
import { createLocalE2eFileSyncVaultStub } from './file-sync-stub'
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

    await stubGoogleDriveVaultForLocalE2e(page, {
      fileName: 'nook-e2e-conflict.yaml',
      vaultYaml: localYaml,
    })
    await seedExtraOauthFileProviders(page, [
      {
        id: 'e2e-conflict-sync',
        label: 'File (e2e)',
        fileName: 'nook-e2e-conflict.yaml',
        accessToken: 'ya29.e2e_file_sync_token',
      },
    ])

    await stageVaultSyncConflict(page, {
      providerId: 'e2e-conflict-sync',
      providerLabel: 'File (e2e)',
      localYaml,
      remoteYaml: `${localYaml.trimEnd()}\n`,
      localVersion: 1,
      remoteVersion: 1,
      mode: 'oauth-file',
      pat: 'ya29.e2e_file_sync_token',
      repo: 'nook-e2e-conflict.yaml',
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
      'Vault updated from File (e2e)',
    )
  })

  test('resolves store_id conflict when second vault uses the same drive file', async ({
    page,
  }) => {
    const fileName = 'nook-e2e-shared-vault-file.yaml'
    const stub = createLocalE2eFileSyncVaultStub('', fileName)
    await stub.install(page, { fileName })

    await page.goto('/')
    await createLocalVaultOnLogin(page, 'test')
    await disableVaultIdleLock(page)
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })

    const vaultAYaml = await readLocalVaultYamlFromIdb(page)
    const storeA = parseStoreId(vaultAYaml)

    await seedOauthFileSyncProvidersWhileUnlocked(
      page,
      [
        {
          id: 'e2e-shared-sync-a',
          label: 'Shared File A',
          fileName,
          accessToken: 'ya29.e2e_file_sync_token',
        },
      ],
      stub,
    )
    await triggerVaultSyncRefresh(page)
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

    stub.setVaultYaml(vaultAYaml)
    await connectGoogleDriveSyncProviderFromSettings(
      page,
      fileName,
      'ya29.e2e_file_sync_token',
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
    await expect(page.getByTestId('settings-provider-oauth-file')).toBeVisible({
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
