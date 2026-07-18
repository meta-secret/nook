import { expect, test, type Page } from './fixtures'
import {
  addVaultPassword,
  authorizeDeviceProtection,
  createLocalVaultOnLogin,
  disableVaultIdleLock,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  installGoogleOAuthMock,
  openOnboardDevicePanel,
  readLocalVaultYamlFromIdb,
  seedOauthFileSyncProvidersWhileUnlocked,
  triggerVaultSyncRefresh,
  UI_TIMEOUT_MS,
  waitForVaultOperationsIdle,
  waitForLoadedSyncProviders,
  waitForSyncRemoteVaultState,
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
            events: string[]
            reasons: string[]
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
            events: ['sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo'],
            reasons: ['key epoch rotation'],
          },
        ]
      : []
  }, present)
}

test.describe('sync conflict resolution', () => {
  test('blocks secret edits while an event-log security conflict is present', async ({
    page,
  }) => {
    await page.goto('/app/')
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

  test('opens the vault-choice dialog when onboarding connects a provider for another vault', async ({
    page,
  }) => {
    const fileName = 'nook-e2e-shared-vault-file.yaml'
    const stub = createLocalE2eFileSyncVaultStub('', fileName)
    await stub.install(page, { fileName })

    await page.goto('/app/')
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
    await page.evaluate(async () => {
      const vault = (
        window as Window & {
          __nookVault?: {
            runFanOutSyncAfterLocalSave?: () => Promise<void>
          }
        }
      ).__nookVault
      await vault?.runFanOutSyncAfterLocalSave?.()
    })
    await waitForSyncRemoteVaultState(
      stub,
      (snapshot) =>
        snapshot.authPkIds.length >= 1 && snapshot.memberPkIds.length >= 1,
    )
    await expect
      .poll(() => parseStoreId(stub.getVaultYaml()), {
        timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
      })
      .toEqual(storeA)
    const remoteEventsBeforeConflict = stub.getEventFileContents()

    await page.getByTestId('vault-secrets-tab').click()
    await expect(page.getByTestId('vault-panel')).toBeVisible()

    await page.getByTestId('header-lock-vault-btn').click()
    await expect(page.getByTestId('login-local-unlock-step')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })

    await page.getByTestId('login-vault-workflow-import').click()
    await page.getByTestId('login-import-vault-btn').click()
    await expect(page.getByTestId('provider-picker-list')).toBeVisible()
    await page.getByTestId('login-back-to-get-started').click()
    await expect(page.getByTestId('login-local-unlock-step')).toBeVisible()

    await page.getByTestId('login-vault-workflow-create').click()
    await expect(page.getByTestId('login-unlock-section')).toBeHidden()
    await page.getByTestId('login-vault-name-input').fill('test-2')
    await page.getByTestId('login-create-additional-vault-btn').click()
    await authorizeDeviceProtection(page)
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await disableVaultIdleLock(page)

    const vaultBYaml = await readLocalVaultYamlFromIdb(page)
    const storeB = parseStoreId(vaultBYaml)
    expect(storeB).not.toEqual(storeA)

    stub.setVaultYaml(vaultAYaml)
    await addVaultPassword(page, 'onboard', 'onboard-pass-1')
    await openOnboardDevicePanel(page)
    await page
      .getByTestId('onboard-password-entry-list')
      .getByRole('radio')
      .first()
      .click()

    await installGoogleOAuthMock(page, 'ya29.e2e_file_sync_token')
    await page.getByTestId('add-provider-btn').click()
    await page.getByTestId('provider-option-oauth-file').click()
    await page.getByTestId('drive-file-input').fill(fileName)
    await page.getByTestId('google-sign-in-btn').click()
    await expect(
      page
        .getByTestId('google-account-status')
        .or(page.getByTestId('connect-provider-btn')),
    ).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
    await page.getByTestId('connect-provider-btn').click()
    await waitForVaultOperationsIdle(page, ENROLLMENT_UNLOCK_TIMEOUT_MS)

    await expect(page.getByTestId('vault-sync-conflict-dialog')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(page.getByTestId('vault-sync-conflict-dialog')).toContainText(
      'Different vault on sync provider',
    )
    await expect(
      page.getByTestId('sync-conflict-import-new-vault-btn'),
    ).toBeVisible()
    await expect(page.getByTestId('sync-conflict-cancel-btn')).toBeVisible()
    await expect(page.getByTestId('vault-error')).toHaveCount(0)
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as Window & {
                __nookVault?: { manager?: { storage_mode: string } }
              }
            ).__nookVault?.manager?.storage_mode,
        ),
      )
      .toBe('local')
    expect(parseStoreId(stub.getVaultYaml())).toEqual(storeA)
    expect(stub.getEventFileContents()).toEqual(remoteEventsBeforeConflict)
    expect(parseStoreId(await readLocalVaultYamlFromIdb(page))).toEqual(storeB)

    await page.getByTestId('sync-conflict-cancel-btn').click()
    await expect(
      page.getByTestId('vault-sync-conflict-dialog'),
    ).not.toBeVisible()
    expect(stub.getEventFileContents()).toEqual(remoteEventsBeforeConflict)
  })
})
