import { expect, type Page } from '@playwright/test'
import { UI_TIMEOUT_MS } from './environment'

/** Management pages of the unified identity and vault workspace. */
export type ManagePage =
  'keys' | 'vaults' | 'settings' | 'devices' | 'sync' | 'passwords' | 'import'

const MANAGE_PAGE_MARKERS: Record<ManagePage, string> = {
  keys: 'devices-access-dashboard',
  vaults: 'vault-admin-vaults-section',
  settings: 'browser-settings-panel',
  devices: 'vault-devices-panel',
  sync: 'storage-providers-section',
  passwords: 'vault-unlock-section',
  import: 'vault-import-export-section',
}

/** Return to the open vault's secret list from any workspace page. */
export async function openVaultPage(page: Page): Promise<void> {
  const vaultPanel = page.getByTestId('vault-panel')
  for (let step = 0; step < 3; step += 1) {
    if (await vaultPanel.isVisible()) return
    const openRow = page.locator(
      '[data-testid="identity-vault-row"][data-state="open"]',
    )
    if (await openRow.isVisible()) {
      await openRow.click()
    } else {
      await page.getByTestId('page-bar-back').click()
    }
    await page.waitForTimeout(50)
  }
  await expect(vaultPanel).toBeVisible({ timeout: UI_TIMEOUT_MS })
}

/** Open the identities hub while a vault session is open. */
export async function openIdentitiesPage(page: Page): Promise<void> {
  await page.getByTestId('header-identities-btn').click()
  await expect(page.getByTestId('identities-hub')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
}

/** Open one management page from wherever the workspace currently is. */
export async function openManagePage(
  page: Page,
  target: ManagePage,
): Promise<void> {
  const marker = page.getByTestId(MANAGE_PAGE_MARKERS[target])
  if (await marker.isVisible()) return
  const navItem = page.getByTestId(`manage-nav-${target}`)
  if (!(await navItem.isVisible())) {
    await openVaultPage(page)
    if (target === 'import') {
      await page.getByTestId('vault-import-btn').click()
      await expect(marker).toBeVisible({ timeout: UI_TIMEOUT_MS })
      return
    }
    await page.getByTestId('vault-manage-btn').click()
  }
  await expect(navItem).toBeVisible({ timeout: UI_TIMEOUT_MS })
  await navItem.click()
  await expect(marker).toBeVisible({ timeout: UI_TIMEOUT_MS })
}

/**
 * Open the identity Keys page (formerly Devices & access) from the
 * authenticated workspace or, while locked, from the current identity card.
 */
export async function openKeysPage(page: Page): Promise<void> {
  const dashboard = page.getByTestId('devices-access-dashboard')
  if (await dashboard.isVisible()) return
  if (await page.getByTestId('header-identities-btn').isVisible()) {
    await openManagePage(page, 'keys')
    return
  }
  const currentCard = page.locator(
    '[data-testid="identity-card"][data-status="locked"] [data-testid="identity-manage"]',
  )
  const manage = (await currentCard.count())
    ? currentCard.first()
    : page.getByTestId('identity-manage').first()
  await expect(manage).toBeVisible({ timeout: UI_TIMEOUT_MS })
  await manage.click()
  await expect(dashboard).toBeVisible({ timeout: UI_TIMEOUT_MS })
}
