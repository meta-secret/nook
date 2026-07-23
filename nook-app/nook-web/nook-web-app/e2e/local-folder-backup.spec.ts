import { test, expect, type Page } from './fixtures'
import {
  addSecret,
  addVaultPassword,
  assertVaultReady,
  clearBrowserVault,
  connectLocalVault,
  expandSettingsSection,
  expectEmptyLocalFolderRejected,
  installPasskeyMock,
  openStorageSettings,
  uniqueSecretKey,
  waitForVaultOperationsIdle,
} from './helpers'
import {
  installLocalFolderPickerMock,
  localFolderSnapshot,
  setLocalFolderSnapshot,
  type LocalFolderRecord,
} from './local-folder-mock'

async function installInterceptedLocalFolderPickerMock(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: async () => {
        throw new DOMException(
          "Failed to execute 'showDirectoryPicker' on 'Window': Intercepted by Page.setInterceptFileChooserDialog().",
          'InvalidStateError',
        )
      },
    })
  })
}

async function installUnsupportedLocalFolderPickerMock(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: undefined,
    })
  })
}

function eventLogRecords(records: LocalFolderRecord[]): LocalFolderRecord[] {
  return records.filter((record) =>
    /^nook-log\/v1\/events\/[A-Za-z0-9_-]{43}\.yaml$/.test(record.path),
  )
}

async function waitForLocalFolderEventRecords(
  page: Page,
): Promise<LocalFolderRecord[]> {
  await expect
    .poll(async () => eventLogRecords(await localFolderSnapshot(page)).length, {
      timeout: 30_000,
    })
    .toBeGreaterThan(0)
  return eventLogRecords(await localFolderSnapshot(page))
}

async function connectLocalFolderProviderFromSettings(page: Page) {
  await openStorageSettings(page)
  await expandSettingsSection(page, 'storage')
  await page.getByTestId('add-provider-btn').first().click()
  await page.getByTestId('provider-option-local-folder').click()
  await expect(page.getByTestId('local-folder-setup')).toBeVisible()
  await page.getByTestId('settings-choose-local-folder-btn').click()
  await expect(page.getByTestId('settings-local-folder-selected')).toHaveText(
    'Nook Backup',
  )
  await page.getByTestId('settings-connect-local-folder-btn').click()
  await waitForVaultOperationsIdle(page)
}

async function prepareVaultForFolderSettings(
  page: Page,
  installPicker: (page: Page) => Promise<void>,
): Promise<void> {
  await installPasskeyMock(page)
  await installPicker(page)
  await page.goto('/app/')
  await clearBrowserVault(page)
  await page.reload()
  await connectLocalVault(page)
  await openStorageSettings(page)
  await expandSettingsSection(page, 'storage')
  await page.getByTestId('add-provider-btn').first().click()
}

test.describe('local folder backup provider', () => {
  test('rejects an empty folder before requesting device identity', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem('nook_e2e_manual_passkey', 'true')
    })
    await installPasskeyMock(page)
    await installLocalFolderPickerMock(page)
    await page.goto('/app/')

    await expectEmptyLocalFolderRejected(page)
  })

  test('shows recovery choices and imports an existing folder on the first attempt', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem('nook_e2e_manual_passkey', 'true')
    })
    await installPasskeyMock(page)
    await installLocalFolderPickerMock(page)
    await page.goto('/app/')
    await clearBrowserVault(page)
    await page.reload()
    await connectLocalVault(page)
    await openStorageSettings(page)
    await expandSettingsSection(page, 'unlock')
    await addVaultPassword(
      page,
      'Emergency recovery',
      'existing-folder-backup-password',
    )
    await connectLocalFolderProviderFromSettings(page)
    await page.getByTestId('vault-secrets-tab').click()
    await assertVaultReady(page)
    const sourceSecretKey = uniqueSecretKey('existing-folder-source')
    await addSecret(page, sourceSecretKey, 'existing-folder-value')
    await waitForLocalFolderEventRecords(page)
    const passkeyLabel = await page.evaluate(
      () => localStorage.getItem('nook_e2e_passkey_label') ?? '',
    )
    const passkeyDeviceHint = passkeyLabel.split(' - device ')[1]
    expect(passkeyDeviceHint).toBeTruthy()

    await clearBrowserVault(page)
    await page.reload()
    await page.getByTestId('login-connect-storage-btn').click()
    await page.getByTestId('provider-option-local-folder').click()
    await page.getByTestId('login-choose-local-folder-btn').click()
    await page.getByTestId('login-connect-local-folder-btn').click()

    await expect(page.getByTestId('passkey-auth-overlay')).toBeVisible()
    await expect(page.getByTestId('device-protection-gate')).toBeVisible()
    const recoverySummary = page.getByTestId('existing-vault-recovery-summary')
    await expect(recoverySummary).toBeVisible()
    await expect(recoverySummary).toContainText(`device ${passkeyDeviceHint}`)
    await expect(
      page.getByTestId('existing-vault-password-status'),
    ).toContainText('Backup password available')
    await expect(
      page.getByTestId('existing-vault-password-status'),
    ).toContainText('Emergency recovery')
    await expect(page.locator('body')).not.toContainText(
      "Authorize before using this browser's device key.",
    )

    await page.evaluate(() => {
      const useExistingChoice = document.querySelector<HTMLElement>(
        '[data-testid="device-protection-use-existing-choice"]',
      )
      const vault = (
        window as Window & {
          __nookVault?: {
            isAuthenticated: boolean
            activeVaultStoreId?: string
          }
        }
      ).__nookVault
      if (!useExistingChoice) throw new Error('Expected passkey choice')
      if (!vault) throw new Error('Expected test vault state')
      vault.isAuthenticated = true
      vault.activeVaultStoreId = 'store_stalevault01'
      useExistingChoice.click()
    })
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByTestId('local-folder-setup')).toHaveCount(0)
    await expect(
      page.getByTestId('secret-row').filter({ hasText: sourceSecretKey }),
    ).toBeVisible()
  })

  test('explains the AI-debug browser directory-picker boundary', async ({
    page,
  }) => {
    await installPasskeyMock(page)
    await installInterceptedLocalFolderPickerMock(page)
    await page.goto('/app/')
    await clearBrowserVault(page)
    await page.reload()
    await connectLocalVault(page)

    await openStorageSettings(page)
    await expandSettingsSection(page, 'storage')
    await page.getByTestId('add-provider-btn').first().click()
    await page.getByTestId('provider-option-local-folder').click()
    await page.getByTestId('settings-choose-local-folder-btn').click()
    await expect(page.getByTestId('settings-local-folder-error')).toContainText(
      'automated AI-debug browser',
    )
    await expect(page.getByTestId('settings-local-folder-error')).toContainText(
      'regular browser',
    )
  })

  test('disables local folder backup when writable folders are unavailable', async ({
    page,
  }) => {
    await prepareVaultForFolderSettings(
      page,
      installUnsupportedLocalFolderPickerMock,
    )
    const localFolderOption = page.getByTestId('provider-option-local-folder')
    await expect(localFolderOption).toBeDisabled()
    await expect(localFolderOption).toContainText(
      'Requires a browser with writable folder access',
    )
    await expect(page.getByTestId('local-folder-setup')).toHaveCount(0)
  })

  test('connects from settings and writes flat YAML event files', async ({
    page,
  }) => {
    await prepareVaultForFolderSettings(page, installLocalFolderPickerMock)
    await page.getByTestId('provider-option-local-folder').click()
    await expect(page.getByTestId('local-folder-setup')).toBeVisible()
    await page.getByTestId('settings-choose-local-folder-btn').click()
    await expect(page.getByTestId('settings-local-folder-selected')).toHaveText(
      'Nook Backup',
    )
    await page.getByTestId('settings-connect-local-folder-btn').click()
    await waitForVaultOperationsIdle(page)
    await assertVaultReady(page)
    await expandSettingsSection(page, 'storage')
    await expect(page.getByTestId('settings-providers-list')).toContainText(
      'Local backup',
    )
    await page.getByTestId('vault-secrets-tab').click()
    await assertVaultReady(page)

    const key = uniqueSecretKey('folder-backup')
    await addSecret(page, key, 'folder-backup-value')

    await expect
      .poll(
        async () => {
          const records = await page.evaluate(
            () =>
              (
                window as Window & {
                  __nookE2eLocalFolderSnapshot?: () => Array<{
                    path: string
                    content: string
                  }>
                }
              ).__nookE2eLocalFolderSnapshot?.() ?? [],
          )
          return records.filter(
            (record) =>
              /^nook-log\/v1\/events\/[A-Za-z0-9_-]{43}\.yaml$/.test(
                record.path,
              ) &&
              record.content.includes('schema_version:') &&
              record.content.includes('operations:'),
          ).length
        },
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0)
  })

  test('blocks a second local vault before writing to a folder with another store id', async ({
    page,
  }) => {
    await prepareVaultForFolderSettings(page, installLocalFolderPickerMock)
    await page.getByTestId('provider-option-local-folder').click()
    await page.getByTestId('settings-choose-local-folder-btn').click()
    await expect(page.getByTestId('settings-local-folder-selected')).toHaveText(
      'Nook Backup',
    )
    await page.getByTestId('settings-connect-local-folder-btn').click()
    await waitForVaultOperationsIdle(page)
    await assertVaultReady(page)
    await page.getByTestId('vault-secrets-tab').click()
    await assertVaultReady(page)

    const firstVaultKey = uniqueSecretKey('folder-guard-source')
    await addSecret(page, firstVaultKey, 'folder-guard-source-value')
    await expect
      .poll(
        async () => {
          const records = await page.evaluate(
            () =>
              (
                window as Window & {
                  __nookE2eLocalFolderSnapshot?: () => Array<{
                    path: string
                    content: string
                  }>
                }
              ).__nookE2eLocalFolderSnapshot?.() ?? [],
          )
          return records.filter((record) =>
            /^nook-log\/v1\/events\/[A-Za-z0-9_-]{43}\.yaml$/.test(record.path),
          ).length
        },
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0)

    const eventsBeforeSecondConnect = await page.evaluate(
      () =>
        (
          window as Window & {
            __nookE2eLocalFolderSnapshot?: () => Array<{
              path: string
              content: string
            }>
          }
        ).__nookE2eLocalFolderSnapshot?.() ?? [],
    )

    await clearBrowserVault(page)
    await page.reload()
    await connectLocalVault(page)
    await openStorageSettings(page)
    await expandSettingsSection(page, 'storage')
    await page.getByTestId('add-provider-btn').first().click()
    await page.getByTestId('provider-option-local-folder').click()
    await page.getByTestId('settings-choose-local-folder-btn').click()
    await page.getByTestId('settings-connect-local-folder-btn').click()
    await waitForVaultOperationsIdle(page)

    await expect(page.getByTestId('vault-sync-conflict-dialog')).toBeVisible()
    await expect(page.getByTestId('vault-sync-conflict-dialog')).toContainText(
      'Different vault on sync provider',
    )
    await expect(
      page.getByTestId('sync-conflict-import-new-vault-btn'),
    ).toBeVisible()
    await expect(page.getByTestId('sync-conflict-cancel-btn')).toBeVisible()
    const eventsAfterSecondConnect = await page.evaluate(
      () =>
        (
          window as Window & {
            __nookE2eLocalFolderSnapshot?: () => Array<{
              path: string
              content: string
            }>
          }
        ).__nookE2eLocalFolderSnapshot?.() ?? [],
    )
    expect(eventsAfterSecondConnect).toEqual(eventsBeforeSecondConnect)
  })

  test('shows a resolution path when a folder contains multiple vault logs', async ({
    page,
  }) => {
    await installPasskeyMock(page)
    await installLocalFolderPickerMock(page)
    await page.goto('/app/')
    await clearBrowserVault(page)
    await page.reload()
    await connectLocalVault(page)

    await connectLocalFolderProviderFromSettings(page)
    await assertVaultReady(page)
    await page.getByTestId('vault-secrets-tab').click()
    await addSecret(
      page,
      uniqueSecretKey('folder-multi-first'),
      'folder-multi-first-value',
    )
    const firstBackup = await waitForLocalFolderEventRecords(page)

    await setLocalFolderSnapshot(page, [])
    await clearBrowserVault(page)
    await page.reload()
    await connectLocalVault(page)
    await connectLocalFolderProviderFromSettings(page)
    await assertVaultReady(page)
    await page.getByTestId('vault-secrets-tab').click()
    await addSecret(
      page,
      uniqueSecretKey('folder-multi-second'),
      'folder-multi-second-value',
    )
    const secondBackup = await waitForLocalFolderEventRecords(page)
    const mixedFolder = [...firstBackup, ...secondBackup].sort((left, right) =>
      left.path.localeCompare(right.path),
    )

    await setLocalFolderSnapshot(page, mixedFolder)
    await clearBrowserVault(page)
    await page.reload()
    await connectLocalVault(page)
    await connectLocalFolderProviderFromSettings(page)

    const dialog = page.getByTestId('local-folder-multiple-vaults-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Folder has multiple vaults')
    await expect(
      page.getByTestId('local-folder-multiple-vaults-store-id'),
    ).toHaveCount(2)
    await expect(page.getByTestId('vault-error')).toContainText(
      'Choose a folder with one vault backup before syncing.',
    )
    expect(await localFolderSnapshot(page)).toEqual(mixedFolder)

    await page
      .getByTestId('local-folder-multiple-vaults-choose-folder-btn')
      .click()
    await expect(page.getByTestId('local-folder-setup')).toBeVisible()
    await expect(
      page.getByTestId('settings-choose-local-folder-btn'),
    ).toBeVisible()
  })
})
