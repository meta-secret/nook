import { expect, type Page } from '@playwright/test'
import { ENROLLMENT_UNLOCK_TIMEOUT_MS, UI_TIMEOUT_MS } from './environment'

/** Management pages of the unified identity and vault workspace. */
export enum ManagePage {
  Overview = 'overview',
  Keys = 'keys',
  Vaults = 'vaults',
  Settings = 'settings',
  Devices = 'devices',
  Sync = 'sync',
  Passwords = 'passwords',
  Import = 'import',
}

const MANAGE_PAGE_MARKERS: Record<ManagePage, string> = {
  [ManagePage.Overview]: 'identity-overview',
  [ManagePage.Keys]: 'identity-keys',
  [ManagePage.Vaults]: 'vault-admin-vaults-section',
  [ManagePage.Settings]: 'browser-settings-panel',
  [ManagePage.Devices]: 'vault-devices-panel',
  [ManagePage.Sync]: 'storage-providers-section',
  [ManagePage.Passwords]: 'vault-unlock-section',
  [ManagePage.Import]: 'vault-import-export-section',
}

/** Return to the open vault's secret list from any workspace page. */
export async function openVaultPage(page: Page): Promise<void> {
  const vaultPanel = page.getByTestId('vault-panel')
  for (let step = 0; step < 3; step += 1) {
    if (await vaultPanel.isVisible()) return
    const openRow = page.locator(
      '[data-testid="identity-vault-row"][data-state="open"]',
    )
    // The hub's cards load after the page; wait for a way back to the vault.
    await expect(
      vaultPanel.or(openRow).or(page.getByTestId('page-bar-back')).first(),
    ).toBeVisible({ timeout: UI_TIMEOUT_MS })
    if (await vaultPanel.isVisible()) return
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
  // Import belongs to the vault page; every other page is on the identity
  // rail, which Manage on the current identity's card opens at Overview.
  if (target === ManagePage.Import) {
    await openVaultPage(page)
    await page.getByTestId('vault-import-btn').click()
    await expect(marker).toBeVisible({ timeout: UI_TIMEOUT_MS })
    return
  }
  const navItem = page.getByTestId(`manage-nav-${target}`)
  if (!(await navItem.isVisible())) {
    await openIdentitiesPage(page)
    const currentManage = page.locator(
      '[data-testid="identity-card"][data-status="unlocked"] [data-testid="identity-manage"]',
    )
    await currentManage.first().click()
    await expect(page.getByTestId('identity-overview')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    if (target === ManagePage.Overview) return
  }
  await expect(navItem).toBeVisible({ timeout: UI_TIMEOUT_MS })
  await navItem.click()
  // Identity pages read the identity directory, which retries while the
  // vault engine is busy with a sync.
  await expect(marker).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
}

/**
 * Open the identity Keys page from the authenticated workspace or, while
 * locked, through Manage on the current identity card (which unlocks it).
 */
export async function openKeysPage(page: Page): Promise<void> {
  const keys = page.getByTestId('identity-keys')
  if (await keys.isVisible()) return
  if (!(await page.getByTestId('header-identities-btn').isVisible())) {
    const currentCard = page.locator(
      '[data-testid="identity-card"][data-status="locked"] [data-testid="identity-manage"]',
    )
    const manage = (await currentCard.count())
      ? currentCard.first()
      : page.getByTestId('identity-manage').first()
    await expect(manage).toBeVisible({ timeout: UI_TIMEOUT_MS })
    await manage.click()
    await expect(page.getByTestId('identity-overview')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
  }
  await openManagePage(page, ManagePage.Keys)
}
