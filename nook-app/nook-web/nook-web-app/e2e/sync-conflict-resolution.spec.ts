import { expect, test, type Page } from './fixtures'
import {
  authorizeDeviceProtection,
  connectGoogleDriveSyncProviderFromSettings,
  createLocalVaultOnLogin,
  disableVaultIdleLock,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  readLocalVaultYamlFromIdb,
  seedOauthFileSyncProvidersWhileUnlocked,
  triggerVaultSyncRefresh,
  UI_TIMEOUT_MS,
  waitForLoadedSyncProviders,
} from './helpers'
import { createLocalE2eFileSyncVaultStub } from './file-sync-stub'

function parseStoreId(yaml: string): string {
  const match = yaml.match(/^store_id:\s*(\S+)/m)
  if (!match) {
    throw new Error('store_id missing from vault yaml')
  }
  return match[1]
}

async function setSecurityConflict(page: Page, present: boolean) {
  await page.evaluate((enabled) => {
    const vault = (
      window as Window & {
        __nookVault?: {
          securityConflicts: Array<{
            eventsJson: string
            reasonsJson: string
          }>
        }
      }
    ).__nookVault
    if (!vault) {
      throw new Error('__nookVault is not exposed (dev build required).')
    }
    vault.securityConflicts = enabled
      ? [
          {
            eventsJson: JSON.stringify([
              'sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo',
            ]),
            reasonsJson: JSON.stringify(['key epoch rotation']),
          },
        ]
      : []
  }, present)
}

test.describe('sync conflict resolution', () => {
  test('blocks secret edits while an event-log security conflict is present', async ({
    page,
  }) => {
    await page.goto('/')
    await createLocalVaultOnLogin(page)
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })

    await setSecurityConflict(page, true)

    await expect(
      page.getByText('Security conflict detected', { exact: true }),
    ).toBeVisible()
    await expect(page.getByText('key epoch rotation')).toBeVisible()
    await expect(page.getByTestId('add-secret-btn')).toBeDisabled()

    await setSecurityConflict(page, false)
    await expect(
      page.getByText('Security conflict detected', { exact: true }),
    ).toHaveCount(0)
    await expect(page.getByTestId('add-secret-btn')).toBeEnabled({
      timeout: UI_TIMEOUT_MS,
    })
  })

  test('ignores a stale legacy vault blob when connecting an event-log provider to a second vault', async ({
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

    await expect(
      page.getByTestId('vault-sync-conflict-dialog'),
    ).not.toBeVisible({ timeout: UI_TIMEOUT_MS })
    await expect(page.getByTestId('settings-provider-oauth-file')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    expect(parseStoreId(stub.getVaultYaml())).toEqual(storeA)
    expect(parseStoreId(await readLocalVaultYamlFromIdb(page))).toEqual(storeB)
  })
})
