import { expect, type Page } from '@playwright/test'
import { ENROLLMENT_UNLOCK_TIMEOUT_MS, UI_TIMEOUT_MS } from './environment'

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

/** How each page opens from the identity's card: an action in Manage, or
 * a row on the identity's details page (Manage, then Identity details). */
const MANAGE_PAGE_OPENERS: Record<
  Exclude<ManagePage, ManagePage.Import>,
  { readonly viaDetails: boolean; readonly testId: string }
> = {
  [ManagePage.Sync]: { viaDetails: false, testId: 'identity-menu-sync' },
  [ManagePage.Passwords]: {
    viaDetails: false,
    testId: 'identity-menu-passwords',
  },
  [ManagePage.Devices]: { viaDetails: true, testId: 'overview-open-devices' },
  [ManagePage.Vaults]: { viaDetails: true, testId: 'overview-open-vaults' },
  [ManagePage.Keys]: { viaDetails: true, testId: 'overview-keys' },
  [ManagePage.Settings]: {
    viaDetails: true,
    testId: 'overview-browser-settings',
  },
}

const MANAGE_PAGE_MARKERS: Record<ManagePage, string> = {
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
    const pageBack = page.getByTestId('page-bar-back')
    const flowBack = page
      .getByTestId('add-device-back')
      .or(page.getByTestId('identity-page-back'))
    await expect(
      vaultPanel.or(openRow).or(pageBack).or(flowBack).first(),
    ).toBeVisible({ timeout: UI_TIMEOUT_MS })
    if (await vaultPanel.isVisible()) return
    if (await openRow.isVisible()) {
      await openRow.click()
    } else if (await flowBack.isVisible()) {
      await flowBack.click()
    } else {
      await pageBack.click()
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
  // Import belongs to the vault page.
  if (target === ManagePage.Import) {
    await openVaultPage(page)
    await page.getByTestId('vault-import-btn').click()
    await expect(marker).toBeVisible({ timeout: UI_TIMEOUT_MS })
    return
  }
  // Every identity page opens from Manage on the current identity's card.
  if (!(await page.getByTestId('identities-hub').isVisible())) {
    await openIdentitiesPage(page)
  }
  const manage = page
    .locator(
      '[data-testid="identity-card"]:not([data-status="inactive"]) [data-testid="identity-manage"]',
    )
    .first()
  if ((await manage.getAttribute('aria-expanded')) !== 'true') {
    await manage.click()
  }
  const opener = MANAGE_PAGE_OPENERS[target]
  if (opener.viaDetails) {
    await page.getByTestId('identity-menu-details').click()
    await expect(page.getByTestId('identity-overview')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
  }
  const navItem = page.getByTestId(opener.testId).first()
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
  // Manage on a locked card opens the same menu; its items unlock first.
  await openManagePage(page, ManagePage.Keys)
}
