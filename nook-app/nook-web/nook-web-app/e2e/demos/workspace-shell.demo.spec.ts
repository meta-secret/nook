import { expect, test } from '../fixtures'
import {
  clearBrowserVault,
  connectLocalVault,
  openOpenVaultPanel,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  UI_TIMEOUT_MS,
} from '../helpers'

const DEMO_BEAT_MS = 700

test('the vault page holds items; the identity card manages the rest', async ({
  page,
}) => {
  await page.goto('/app/')
  await clearBrowserVault(page)
  await page.reload()
  await connectLocalVault(page)
  await expect(page.getByTestId('vault-panel')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })

  // The vault page holds only its items: imports and the browser extension
  // belong to the vault's panel beside the card, management to the card.
  await expect(page.getByTestId('vault-import-btn')).toHaveCount(0)
  await expect(page.getByTestId('vault-extension-install')).toHaveCount(0)
  await expect(page.getByTestId('identity-menu')).toHaveCount(0)
  await page.waitForTimeout(DEMO_BEAT_MS)

  await openOpenVaultPanel(page)
  await expect(page.getByTestId('vault-panel-import')).toBeVisible()
  await expect(page.getByTestId('vault-extension-install')).toBeVisible()
  await page.waitForTimeout(DEMO_BEAT_MS)

  // Manage on the identity card holds actions, adding a device first;
  // a fresh identity also offers its protection checklist, above its vaults.
  await page.getByTestId('header-identities-btn').click()
  const protection = page.getByTestId('identity-protection-toggle')
  await expect(protection).toContainText('Protect this identity')
  const vaultRow = page.getByTestId('identity-vault-row').first()
  await expect(vaultRow).toBeVisible()
  const protectionBox = await protection.boundingBox()
  const vaultRowBox = await vaultRow.boundingBox()
  if (!protectionBox || !vaultRowBox) {
    throw new Error('Protection and vault rows must have layout boxes')
  }
  expect(protectionBox.y).toBeLessThan(vaultRowBox.y)
  await page.getByTestId('identity-manage').first().click()
  const menu = page.getByTestId('identity-menu')
  await expect(menu).toBeVisible()
  for (const item of ['add-device', 'sync', 'vaults']) {
    await expect(page.getByTestId(`identity-menu-${item}`)).toBeVisible()
  }
  await page.waitForTimeout(DEMO_BEAT_MS)

  // Overview opens beside the card: devices, cloud copies, vaults and
  // sign-in, each tile opening its page.
  await page.getByTestId('identity-overview-toggle').first().click()
  await expect(page.getByTestId('identity-overview')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await page.getByTestId('overview-open-devices').first().click()
  await expect(page).toHaveURL(/\/identity\/devices$/)
  await expect(page.getByTestId('vault-devices-panel')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await page.waitForTimeout(DEMO_BEAT_MS)

  await page.getByTestId('identity-page-back').click()
  await expect(page.getByTestId('identity-overview')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
})
