import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import {
  connectLocalVault,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  installPasskeyMock,
  ManagePage,
  openIdentitiesPage,
  openManagePage,
  readLocalVaultYamlFromIdb,
  UI_TIMEOUT_MS,
} from '../helpers'

const DEMO_BEAT_MS = 700
const TRAVEL_PIN = '246810'

async function demoBeat(page: Page) {
  await page.waitForTimeout(DEMO_BEAT_MS)
}

async function snapshot(page: Page, name: string) {
  const directory = process.env.NOOK_DEMO_SCREENSHOT_DIR
  if (!directory) return
  await page.screenshot({ path: `${directory}/${name}.png`, fullPage: true })
}

function parseStoreId(yaml: string): string {
  const storeId = yaml.match(/^store_id:\s*(\S+)/m)?.[1]
  if (!storeId) {
    throw new Error('store_id missing from vault yaml')
  }
  return storeId
}

function vaultAdminEntry(page: Page, storeId: string) {
  return page.locator(
    `[data-testid="vault-admin-entry"][data-store-id="${storeId}"]`,
  )
}

test('Manage → Vaults lists only the vaults the identity in use owns', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('nook_e2e_manual_passkey', 'true')
  })
  await installPasskeyMock(page)
  await connectLocalVault(page)
  const firstStoreId = parseStoreId(await readLocalVaultYamlFromIdb(page))

  // The first identity's Vaults page lists its own vault.
  await openManagePage(page, ManagePage.Vaults)
  await expect(vaultAdminEntry(page, firstStoreId)).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await snapshot(page, '1-first-identity-vaults')
  await demoBeat(page)

  // A second identity on this browser, protected with a PIN, gets its own
  // vault.
  await openIdentitiesPage(page)
  await page.getByTestId('identity-new').click()
  await page.getByTestId('new-identity-name-input').fill('Travel')
  await page.getByTestId('new-identity-continue').click()
  await expect(page.getByTestId('new-identity-key')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await page.evaluate(() => {
    localStorage.setItem('nook_e2e_passkey_mode', 'unavailable')
  })
  await page.getByTestId('device-protection-setup-btn').click()
  await page.getByTestId('device-protection-pin-input').fill(TRAVEL_PIN)
  await page.getByTestId('device-protection-pin-confirm').fill(TRAVEL_PIN)
  await page.getByTestId('device-protection-pin-setup-btn').click()
  await page.evaluate(() => {
    localStorage.removeItem('nook_e2e_passkey_mode')
  })
  await expect(page.getByTestId('new-identity-ready')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await page.getByTestId('new-identity-vault-input').fill('Trip')
  await page.getByTestId('new-identity-create-vault').click()
  await expect
    .poll(async () => parseStoreId(await readLocalVaultYamlFromIdb(page)), {
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    .not.toBe(firstStoreId)
  const tripStoreId = parseStoreId(await readLocalVaultYamlFromIdb(page))
  await openIdentitiesPage(page)
  await expect(page.getByTestId('identity-card')).toHaveCount(2, {
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await snapshot(page, '2-two-identities')
  await demoBeat(page)

  // Travel's Vaults page lists Trip only: the first identity's vault is
  // stored on this browser too, but it is not Travel's to rename or delete
  // everywhere.
  await openManagePage(page, ManagePage.Vaults)
  await expect(vaultAdminEntry(page, tripStoreId)).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await expect(
    page.locator(
      `[data-testid="vault-admin-name"][data-store-id="${tripStoreId}"]`,
    ),
  ).toContainText('Trip')
  await expect(vaultAdminEntry(page, firstStoreId)).toHaveCount(0)
  await expect(page.getByTestId('vault-admin-entry')).toHaveCount(1)
  await snapshot(page, '3-travel-vaults')
  await demoBeat(page)

  // The open vault renames from its row; the name is recorded in the vault's
  // event log, so every device of the identity shows it.
  const tripRename = page.locator(
    `[data-testid="vault-admin-rename-btn"][data-store-id="${tripStoreId}"]`,
  )
  await tripRename.click()
  await page
    .locator(
      `[data-testid="vault-admin-name-input"][data-store-id="${tripStoreId}"]`,
    )
    .fill('Trip 2026')
  await tripRename.click()
  await expect(
    page.locator(
      `[data-testid="vault-admin-name"][data-store-id="${tripStoreId}"]`,
    ),
  ).toContainText('Trip 2026', { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  await snapshot(page, '4-renamed-open-vault')
  await demoBeat(page)
})
