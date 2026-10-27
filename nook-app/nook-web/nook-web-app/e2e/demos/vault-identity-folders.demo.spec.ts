import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import { clearBrowserVault, installPasskeyMock } from '../helpers'
import { installLocalFolderPickerMock } from '../local-folder-mock'
import { backUpTwoVaultsToOneFolder, filedVaults } from '../local-folder-vaults'
import enLocale from '../../../../nook-platform/nook-app-common/locales/en.json' with { type: 'json' }

const DEMO_BEAT_MS = 700

async function demoBeat(page: Page) {
  await page.waitForTimeout(DEMO_BEAT_MS)
}

test('a sync folder files each vault under the identity that wrote it, and recovery shows whose it is', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('nook_e2e_manual_passkey', 'true')
  })
  await installPasskeyMock(page)
  await installLocalFolderPickerMock(page)
  await page.goto('/app/')

  // Two browsers, each with its own identity, back up into one folder.
  const { sharedFolder } = await backUpTwoVaultsToOneFolder(page)
  const vaults = filedVaults(sharedFolder)
  expect(vaults).toHaveLength(2)
  expect(new Set(vaults.map((vault) => vault.identityId)).size).toBe(2)
  await demoBeat(page)

  // A fresh browser recovering from the folder sees both vaults, each named
  // by the identity folder that files it.
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
  for (const vault of vaults) {
    const row = page.locator(
      `[data-testid="provider-vault-row"][data-store-id="${vault.storeId}"]`,
    )
    await expect(row.getByTestId('provider-vault-identity')).toHaveText(
      enLocale.provider_vaults.filed_under.replace(
        '{identity}',
        vault.identityId.slice('idn_'.length, 'idn_'.length + 8),
      ),
    )
  }
  await demoBeat(page)
})
