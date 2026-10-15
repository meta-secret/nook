import { expect, test, type Page } from './fixtures'
import {
  authorizeDeviceProtection,
  createLocalVaultOnLogin,
  disableVaultIdleLock,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  readLocalVaultYamlFromIdb,
  seedOauthFileSyncProvidersWhileUnlocked,
  triggerVaultSyncRefresh,
  UI_TIMEOUT_MS,
  waitForLoadedSyncProviders,
  openIdentitiesPage,
} from './helpers'
import { createLocalE2eFileSyncVaultStub } from './file-sync-stub'

function parseStoreId(yaml: string): string {
  const storeId = yaml.match(/^store_id:\s*(\S+)/m)?.[1]
  if (!storeId) {
    throw new Error('store_id missing from vault yaml')
  }
  return storeId
}

async function runFanOutSync(page: Page) {
  await page.evaluate(async () => {
    const vault = window.__nookVault
    await vault?.runFanOutSyncAfterLocalSave?.()
  })
}

async function setSecurityConflict(page: Page, present: boolean) {
  await page.evaluate((enabled) => {
    const vault = (
      window as Window & {
        __nookVault?: {
          clearProjectionConflicts(): void
          stageSecurityConflictForTesting(args: {
            readonly events: string[]
            readonly reasons: string[]
          }): void
        }
      }
    ).__nookVault
    if (!vault) {
      throw new Error('__nookVault is not exposed (dev build required).')
    }
    if (enabled) {
      const securityConflictArgs: Parameters<
        typeof vault.stageSecurityConflictForTesting
      >[0] = {
        events: ['sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo'],
        reasons: ['key epoch rotation'],
      }
      vault.stageSecurityConflictForTesting(securityConflictArgs)
    } else {
      vault.clearProjectionConflicts()
    }
  }, present)
}

async function setContentSyncConflict(page: Page) {
  await page.evaluate(() => {
    const vault = window.__nookVault
    if (
      !vault ||
      !('stageContentSyncConflictForTesting' in vault) ||
      typeof vault.stageContentSyncConflictForTesting !== 'function'
    ) {
      throw new Error('__nookVault conflict harness is unavailable.')
    }
    const contentConflictArgs = {
      providerLabel: 'Remote provider',
      localVersion: 1,
      remoteVersion: 2,
    }
    vault.stageContentSyncConflictForTesting(contentConflictArgs)
  })
}

test.describe('sync conflict resolution', () => {
  test('shows retired whole-vault resolution guidance in the selected locale', async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.setItem('nook_locale', 'ru'))
    await page.goto('/app/')
    await createLocalVaultOnLogin(page)
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })

    await setContentSyncConflict(page)
    await expect(page.getByTestId('vault-sync-conflict-dialog')).toBeVisible()

    await page.getByTestId('sync-conflict-keep-local-btn').click()
    await expect(page.getByTestId('vault-error')).toContainText(
      'Разрешение конфликтов всего сейфа больше не поддерживается.',
    )

    await page.getByTestId('sync-conflict-keep-remote-btn').click()
    await expect(page.getByTestId('vault-error')).toContainText(
      'Синхронизируйте журнал событий со всеми провайдерами и повторите попытку.',
    )
  })

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

  test('a second vault of the identity syncs beside the first through its provider', async ({
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
    const storeA = parseStoreId(await readLocalVaultYamlFromIdb(page))

    await seedOauthFileSyncProvidersWhileUnlocked(
      page,
      [
        {
          id: 'e2e-shared-sync-a',
          label: 'Shared File A',
          fileName,
          accessToken: 'ya29.e2e_file_sync_token',
          accountEmail: 'shared-a@example.test',
        },
      ],
      stub,
    )
    await triggerVaultSyncRefresh(page)
    await waitForLoadedSyncProviders(page)
    await runFanOutSync(page)
    await expect
      .poll(() => stub.getVaultNamespaceIds(), {
        timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
      })
      .toEqual([storeA])
    const vaultAEvents = stub.getEventFileContents()

    await page.getByTestId('header-lock-vault-btn').click()
    await expect(page.getByTestId('identity-vault-row').first()).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })

    await page.getByTestId('identity-new-vault').click()
    await page.getByTestId('login-import-vault-btn').click()
    await expect(page.getByTestId('provider-picker-list')).toBeVisible()
    await page.getByTestId('login-back-to-get-started').click()
    await expect(page.getByTestId('identity-vault-row').first()).toBeVisible()

    await page.getByTestId('identity-new-vault').click()
    await page.getByTestId('login-vault-name-input').fill('test-2')
    await page.getByTestId('login-create-additional-vault-btn').click()
    // Creating a vault on a locked identity asks for its passkey first.
    await expect(
      page
        .getByTestId('passkey-auth-overlay')
        .or(page.getByTestId('vault-panel'))
        .first(),
    ).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
    await authorizeDeviceProtection(page)
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await disableVaultIdleLock(page)
    const storeB = parseStoreId(await readLocalVaultYamlFromIdb(page))
    expect(storeB).not.toEqual(storeA)

    // The provider mounts the identity: the new vault gets its own folder
    // there, and the first vault's events stay as they were.
    await waitForLoadedSyncProviders(page)
    await runFanOutSync(page)
    await expect
      .poll(() => stub.getVaultNamespaceIds(), {
        timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
      })
      .toEqual([storeA, storeB].sort())
    for (const event of vaultAEvents)
      expect(stub.getEventFileContents()).toContain(event)
    await expect(page.getByTestId('vault-sync-conflict-dialog')).toHaveCount(0)

    await openIdentitiesPage(page)
    await expect(page.getByTestId('identity-vault-row')).toHaveCount(2)
    for (const storeId of [storeA, storeB])
      await expect(
        page.locator(
          `[data-testid="identity-vault-row"][data-store-id="${storeId}"]`,
        ),
      ).toBeVisible()
  })
})
