import { test, expect, type Page } from './fixtures'
import {
  beginAddSyncProvider,
  addSecret,
  assertVaultReady,
  clearBrowserVault,
  connectLocalVault,
  expandSettingsSection,
  expectEmptyLocalFolderRejected,
  installPasskeyMock,
  openStorageSettings,
  openStoreId,
  readSecretOfVault,
  uniqueSecretKey,
  waitForVaultOperationsIdle,
  openVaultPage,
} from './helpers'
import type { KeptVault } from './helpers'
import {
  installLocalFolderPickerMock,
  localFolderPickerInvocationCount,
  localFolderSnapshot,
  waitForLocalFolderEventRecords,
} from './local-folder-mock'
import {
  backUpTwoVaultsToOneFolder,
  connectLocalFolderProviderFromSettings,
  filedVaults,
} from './local-folder-vaults'

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

  test('lists the keyring of a folder holding one vault, which then opens from its card', async ({
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
    await connectLocalFolderProviderFromSettings(page)
    await openVaultPage(page)
    await assertVaultReady(page)
    const kept: KeptVault = {
      storeId: await openStoreId(page),
      key: uniqueSecretKey('existing-folder-source'),
      value: 'existing-folder-value',
    }
    await addSecret(page, kept.key, kept.value)
    await waitForLocalFolderEventRecords(page)

    await clearBrowserVault(page)
    await page.reload()
    await page.getByTestId('login-connect-storage-btn').click()
    await page.getByTestId('provider-option-local-folder').click()
    await page.getByTestId('login-choose-local-folder-btn').click()
    await expect.poll(() => localFolderPickerInvocationCount(page)).toBe(1)
    await page.getByTestId('login-connect-local-folder-btn').click()

    // The folder keeps a keyring, not a vault: its one vault does not open
    // on its own, and its keyring is listed with its ways in.
    await expect(page.getByTestId('remote-vault-choice')).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByTestId('vault-panel')).toHaveCount(0)
    const card = page.locator(
      `[data-testid="provider-identity"][data-store-ids~="${kept.storeId}"]`,
    )
    await card
      .locator(
        '[data-testid="provider-identity-decision"][data-decision="addToBrowser"]',
      )
      .click()

    // The keyring is recovered with its vault, which stays on its card.
    await expect(
      page.locator(
        `[data-testid="identity-vault-row"][data-store-id="${kept.storeId}"]`,
      ),
    ).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('remote-vault-choice')).toHaveCount(0)
    await expect(page.getByTestId('vault-panel')).toHaveCount(0)
    await expect(page.getByTestId('local-folder-setup')).toHaveCount(0)
    await expect.poll(() => localFolderPickerInvocationCount(page)).toBe(1)
    expect(await readSecretOfVault(page, kept)).toBe(kept.value)
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
              /^meta-secret-nook\/idn_[^/]+\/store_[^/]+\/events\/[A-Za-z0-9_-]{43}\.yaml$/.test(
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

    // Each browser filed its vault under the identity it created.
    const vaults = filedVaults(sharedFolder)
    expect(vaults).toHaveLength(2)
    expect(new Set(vaults.map((vault) => vault.identityId)).size).toBe(2)
  })

  test('lists each keyring when a folder holds several', async ({ page }) => {
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
    // Two identities wrote here; each is recovered as a whole.
    await expect(page.getByTestId('provider-identity')).toHaveCount(2)
    expect(await localFolderSnapshot(page)).toEqual(sharedFolder)

    // This browser's passkey belongs to the identity that wrote last;
    // recovering it is that identity's decision, run by its button.
    await page
      .locator(
        `[data-testid="provider-identity"][data-store-ids~="${latestStoreId}"]`,
      )
      .locator(
        '[data-testid="provider-identity-decision"][data-decision="addToBrowser"]',
      )
      .click()
    await expect(page.getByTestId('remote-vault-choice')).toHaveCount(0, {
      timeout: 30_000,
    })
    // The keyring lands on the keyrings page with its vault on its card;
    // no vault opens on its own.
    await expect(
      page.locator(
        `[data-testid="identity-vault-row"][data-store-id="${latestStoreId}"]`,
      ),
    ).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('vault-panel')).toHaveCount(0)
  })
})
