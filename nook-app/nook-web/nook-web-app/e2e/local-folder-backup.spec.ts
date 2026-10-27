import { test, expect, type Page } from './fixtures'
import {
  beginAddSyncProvider,
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
  openVaultPage,
} from './helpers'
import {
  installLocalFolderPickerMock,
  localFolderPickerInvocationCount,
  localFolderSnapshot,
  waitForLocalFolderEventRecords,
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
    Reflect.deleteProperty(window, 'showDirectoryPicker')
  })
}

async function connectLocalFolderProviderFromSettings(page: Page) {
  await openStorageSettings(page)
  await expandSettingsSection(page, 'storage')
  await beginAddSyncProvider(page)
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
  await beginAddSyncProvider(page)
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

  test('keeps the chosen folder staged through passkey authorization', async ({
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
    await openVaultPage(page)
    await assertVaultReady(page)
    const sourceSecretKey = uniqueSecretKey('existing-folder-source')
    await addSecret(page, sourceSecretKey, 'existing-folder-value')
    await waitForLocalFolderEventRecords(page)
    const passkeyLabel = await page.evaluate(() =>
      ((v) => (v ? v : ''))(localStorage.getItem('nook_e2e_passkey_label')),
    )
    const passkeyDeviceHint = passkeyLabel.split(' - device ')[1]
    expect(passkeyDeviceHint).toBeTruthy()

    await clearBrowserVault(page)
    await page.reload()
    await page.getByTestId('login-connect-storage-btn').click()
    await page.getByTestId('provider-option-local-folder').click()
    await page.getByTestId('login-choose-local-folder-btn').click()
    await expect.poll(() => localFolderPickerInvocationCount(page)).toBe(1)
    await page.getByTestId('login-connect-local-folder-btn').click()

    await expect(page.getByTestId('passkey-auth-overlay')).toBeVisible()
    await expect(page.getByTestId('device-protection-gate')).toBeVisible()
    const recoverySummary = page.getByTestId('existing-vault-recovery-summary')
    await expect(recoverySummary).toBeVisible()
    await expect(page.getByTestId('existing-vault-passkey-hints')).toBeVisible()
    await expect(recoverySummary).toContainText(`device ${passkeyDeviceHint}`)
    await expect(
      page.getByTestId('existing-vault-password-status'),
    ).toContainText('Passphrase available')
    await expect(
      page.getByTestId('existing-vault-password-status'),
    ).toContainText('Emergency recovery')
    await expect(page.locator('body')).not.toContainText(
      "Authorize before using this browser's device key.",
    )

    await page.getByTestId('device-protection-use-existing-choice').click()
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByTestId('local-folder-setup')).toHaveCount(0)
    await expect.poll(() => localFolderPickerInvocationCount(page)).toBe(1)
    await expect(
      page.getByTestId('secret-row').filter({ hasText: sourceSecretKey }),
    ).toBeVisible()
    await expect(recoverySummary).toHaveCount(0)
  })

  test('explains the automated browser directory-picker boundary', async ({
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
    await beginAddSyncProvider(page)
    await page.getByTestId('provider-option-local-folder').click()
    await page.getByTestId('settings-choose-local-folder-btn').click()
    await expect(page.getByTestId('settings-local-folder-error')).toContainText(
      'automated browser',
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
    await openVaultPage(page)
    await assertVaultReady(page)

    const key = uniqueSecretKey('folder-backup')
    await addSecret(page, key, 'folder-backup-value')

    await expect
      .poll(
        async () => {
          const records = await page.evaluate(() =>
            ((v) => (v ? v : []))(
              (
                window as Window & {
                  __nookE2eLocalFolderSnapshot?: () => Array<{
                    path: string
                    content: string
                  }>
                }
              ).__nookE2eLocalFolderSnapshot?.(),
            ),
          )
          return records.filter(
            (record) =>
              /^nook-log\/v1\/vaults\/[^/]+\/events\/[A-Za-z0-9_-]{43}\.yaml$/.test(
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

  test('keeps a second vault beside the first in a shared folder', async ({
    page,
  }) => {
    await installPasskeyMock(page)
    await installLocalFolderPickerMock(page)
    await page.goto('/app/')
    const { sharedFolder } = await backUpTwoVaultsToOneFolder(page)

    await expect(page.getByTestId('vault-sync-conflict-dialog')).toHaveCount(0)
    expect(vaultFolders(sharedFolder)).toHaveLength(2)
  })

  test('offers a vault choice when a folder holds several vaults', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem('nook_e2e_manual_passkey', 'true')
    })
    await installPasskeyMock(page)
    await installLocalFolderPickerMock(page)
    await page.goto('/app/')
    const { sharedFolder, latestStoreId } =
      await backUpTwoVaultsToOneFolder(page)

    await clearBrowserVault(page)
    await page.reload()
    await page.getByTestId('login-connect-storage-btn').click()
    await page.getByTestId('provider-option-local-folder').click()
    await page.getByTestId('login-choose-local-folder-btn').click()
    await page.getByTestId('login-connect-local-folder-btn').click()

    await expect(page.getByTestId('remote-vault-choice')).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByTestId('remote-vault-choice-item')).toHaveCount(2)
    expect(await localFolderSnapshot(page)).toEqual(sharedFolder)

    // This browser's passkey belongs to the identity that wrote last.
    await page
      .locator(
        `[data-testid="provider-vault-row"][data-store-id="${latestStoreId}"]`,
      )
      .getByTestId('remote-vault-choice-item')
      .click()
    await expect(page.getByTestId('remote-vault-choice')).toHaveCount(0)
    await expect(page.getByTestId('device-protection-gate')).toBeVisible({
      timeout: 30_000,
    })
    await page.getByTestId('device-protection-use-existing-choice').click()
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByTestId('secret-row')).toHaveCount(1)
  })
})

function vaultFolders(records: LocalFolderRecord[]): string[] {
  const folders = new Set<string>()
  for (const record of records) {
    const match = /^nook-log\/v1\/vaults\/([^/]+)\/events\//.exec(record.path)
    const [, storeId = ''] = match ? match : []
    if (storeId) folders.add(storeId)
  }
  return [...folders]
}

/** Two vaults back up into the same folder; neither touches the other's events. */
async function backUpTwoVaultsToOneFolder(
  page: Page,
): Promise<{ sharedFolder: LocalFolderRecord[]; latestStoreId: string }> {
  await clearBrowserVault(page)
  await page.reload()
  await connectLocalVault(page)
  await connectLocalFolderProviderFromSettings(page)
  await openVaultPage(page)
  await assertVaultReady(page)
  await addSecret(
    page,
    uniqueSecretKey('folder-shared-first'),
    'folder-shared-first-value',
  )
  const firstVault = await waitForLocalFolderEventRecords(page)

  await clearBrowserVault(page)
  await page.reload()
  await connectLocalVault(page)
  await connectLocalFolderProviderFromSettings(page)
  await openVaultPage(page)
  await assertVaultReady(page)
  await addSecret(
    page,
    uniqueSecretKey('folder-shared-second'),
    'folder-shared-second-value',
  )
  await expect
    .poll(async () => vaultFolders(await localFolderSnapshot(page)).length, {
      timeout: 30_000,
    })
    .toBe(2)
  const sharedFolder = await localFolderSnapshot(page)
  for (const record of firstVault) expect(sharedFolder).toContainEqual(record)
  const [firstStoreId] = vaultFolders(firstVault)
  const [latestStoreId = ''] = vaultFolders(sharedFolder).filter(
    (storeId) => storeId !== firstStoreId,
  )
  return { sharedFolder, latestStoreId }
}
