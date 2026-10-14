import { expect, type Page } from '@playwright/test'
import { UI_TIMEOUT_MS } from './environment'

/** Management pages of the unified identity and vault workspace. */
export enum ManagePage {
  Keys = 'keys',
  Vaults = 'vaults',
  Settings = 'settings',
  Devices = 'devices',
  Sync = 'sync',
  Passwords = 'passwords',
  Import = 'import',
}

const MANAGE_PAGE_MARKERS: Record<ManagePage, string> = {
  [ManagePage.Keys]: 'devices-access-dashboard',
  [ManagePage.Vaults]: 'vault-admin-vaults-section',
  [ManagePage.Settings]: 'browser-settings-panel',
  [ManagePage.Devices]: 'vault-devices-panel',
  [ManagePage.Sync]: 'storage-providers-section',
  [ManagePage.Passwords]: 'vault-unlock-section',
  [ManagePage.Import]: 'vault-import-export-section',
}

/** Pages that manage the identity; the rest manage the open vault. */
const IDENTITY_PAGES: ReadonlySet<ManagePage> = new Set([
  ManagePage.Keys,
  ManagePage.Vaults,
  ManagePage.Devices,
  ManagePage.Sync,
  ManagePage.Settings,
])

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
  const navItem = page.getByTestId(`manage-nav-${target}`)
  // The workspace rail lists every page while a vault is open; the
  // identities hub has no rail, so leave it through the open vault first.
  if (!(await navItem.isVisible())) {
    if (IDENTITY_PAGES.has(target)) {
      await openIdentitiesPage(page)
      const currentManage = page.locator(
        '[data-testid="identity-card"][data-status="unlocked"] [data-testid="identity-manage"]',
      )
      await currentManage.first().click()
      if (target === ManagePage.Keys) {
        await expect(marker).toBeVisible({ timeout: UI_TIMEOUT_MS })
        return
      }
    } else {
      await openVaultPage(page)
    }
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
    await openManagePage(page, ManagePage.Keys)
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

export type WorkspacePathPush = {
  readonly page: Page
  readonly path: string
}

/** Move the SPA to a workspace path the way browser history would. */
export async function pushWorkspacePath({
  page,
  path,
}: WorkspacePathPush): Promise<void> {
  await page.evaluate((target) => {
    history.pushState({}, '', target)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, path)
}
