import { expect, type Page } from '@playwright/test'
import {
  addSecret,
  assertVaultReady,
  beginAddSyncProvider,
  clearBrowserVault,
  connectLocalVault,
  expandSettingsSection,
  openStorageSettings,
  openVaultPage,
  uniqueSecretKey,
  waitForVaultOperationsIdle,
} from './helpers'
import {
  localFolderSnapshot,
  waitForLocalFolderEventRecords,
  type LocalFolderRecord,
} from './local-folder-mock'

/** One vault a local folder holds, and the identity folder that files it. */
export type FiledVault = {
  readonly identityId: string
  readonly storeId: string
}

const FILED_VAULT_EVENT_PATH =
  /^meta-secret-nook\/(idn_[^/]+)\/(store_[^/]+)\/events\//

/** The vaults a folder snapshot holds, each with the identity filing it. */
export function filedVaults(records: LocalFolderRecord[]): FiledVault[] {
  const vaults = new Map<string, FiledVault>()
  for (const record of records) {
    const match = FILED_VAULT_EVENT_PATH.exec(record.path)
    const [, identityId = '', storeId = ''] = match ? match : []
    if (identityId && storeId)
      vaults.set(`${identityId}/${storeId}`, { identityId, storeId })
  }
  return [...vaults.values()]
}

/** The store ids of the vaults a folder snapshot holds. */
export function vaultFolders(records: LocalFolderRecord[]): string[] {
  return [...new Set(filedVaults(records).map((vault) => vault.storeId))]
}

export async function connectLocalFolderProviderFromSettings(page: Page) {
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

/** Two vaults back up into the same folder; neither touches the other's
 * events. Each comes from a fresh browser, so each is filed under the
 * identity that browser created. */
export async function backUpTwoVaultsToOneFolder(
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
