import { expect, type Locator, type Page } from '@playwright/test'
import { ENROLLMENT_UNLOCK_TIMEOUT_MS, UI_TIMEOUT_MS } from './environment'

/** Press a control that is visible and enabled right now. A panel can
 * re-render between that check and the press; the caller's next poll then
 * sees the new state. */
export async function pressIfReady(control: Locator): Promise<boolean> {
  const ready = control.and(control.page().locator(':enabled'))
  if (!(await ready.isVisible())) return false
  try {
    await ready.click({ timeout: 1_000 })
    return true
  } catch {
    return false
  }
}

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

/** How each identity page opens from the identity panel beside its card.
 * The vault's own pages open from its panel. */
const MANAGE_PAGE_OPENERS: Record<
  Exclude<ManagePage, ManagePage.Import | ManagePage.Passwords>,
  string
> = {
  [ManagePage.Sync]: 'overview-open-sync',
  [ManagePage.Devices]: 'overview-open-devices',
  [ManagePage.Vaults]: 'overview-open-vaults',
  [ManagePage.Keys]: 'overview-keys',
  [ManagePage.Settings]: 'overview-browser-settings',
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

/** Sections of the vault page, named by their tab test ids. */
export enum VaultSection {
  Secrets = 'secrets',
  PersonalData = 'personal-data',
}

/** Switch the open vault page to a section; cards and personal data live apart from secrets. */
export async function openVaultSection(
  page: Page,
  section: VaultSection,
): Promise<void> {
  const tab = page.getByTestId(`vault-section-${section}`)
  await tab.click({ timeout: UI_TIMEOUT_MS })
  await expect(tab).toHaveAttribute('aria-selected', 'true', {
    timeout: UI_TIMEOUT_MS,
  })
}

/** Return to the open vault's secret list from any workspace page. */
export async function openVaultPage(page: Page): Promise<void> {
  const vaultPanel = page.getByTestId('vault-panel')
  const openRow = page.locator(
    '[data-testid="identity-vault-row"][data-state="open"]',
  )
  const collapsedOpenRow = openRow.and(
    page.locator(':not([aria-expanded="true"])'),
  )
  const enter = page.getByTestId('vault-panel-open')
  const pageBack = page.getByTestId('page-bar-back')
  const flowBack = page
    .getByTestId('add-device-back')
    .or(page.getByTestId('identity-page-back'))
  // The workspace re-renders as the hub's cards load, so a control seen a
  // moment ago may be gone; re-read the page and press what is there now.
  await expect
    .poll(
      async () => {
        if (await vaultPanel.isVisible()) return true
        // The open vault's row opens its panel, which leads into the vault.
        if (await pressIfReady(enter)) return false
        if (await pressIfReady(collapsedOpenRow)) return false
        if (await openRow.isVisible()) return false
        if (await pressIfReady(flowBack)) return false
        await pressIfReady(pageBack)
        return false
      },
      { timeout: UI_TIMEOUT_MS * 3 },
    )
    .toBe(true)
}

/** Open the identities hub while a vault session is open. */
export async function openIdentitiesPage(page: Page): Promise<void> {
  await page.getByTestId('header-identities-btn').click()
  await expect(page.getByTestId('identities-hub')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
}

/** Open the open vault's panel beside its card on the identities page: its
 * passphrases, imports and browser extension live there. */
export async function openOpenVaultPanel(page: Page): Promise<void> {
  if (!(await page.getByTestId('identities-hub').isVisible())) {
    await openIdentitiesPage(page)
  }
  const openRow = page
    .locator('[data-testid="identity-vault-row"][data-state="open"]')
    .first()
  await expect(openRow).toBeVisible({ timeout: UI_TIMEOUT_MS })
  if ((await openRow.getAttribute('aria-expanded')) !== 'true') {
    await openRow.click()
  }
  await expect(page.getByTestId('vault-panel-manage')).toBeVisible({
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
  // Passphrases and imports belong to the open vault: its row opens its
  // panel.
  if (target === ManagePage.Passwords || target === ManagePage.Import) {
    await openOpenVaultPanel(page)
    await page
      .getByTestId(
        target === ManagePage.Import
          ? 'vault-panel-import'
          : 'vault-panel-passphrases',
      )
      .click()
    await expect(marker).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
    return
  }
  // Every identity page opens from the identity panel beside the card.
  await openIdentityPanel(page)
  // Without a sync provider the panel offers adding one, which opens Sync.
  const navItem =
    target === ManagePage.Sync
      ? page
          .getByTestId('overview-open-sync')
          .or(page.getByTestId('identity-action-add-sync'))
          .first()
      : page.getByTestId(MANAGE_PAGE_OPENERS[target]).first()
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

/** Open the identity panel beside the current identity's card. */
export async function openIdentityPanel(page: Page): Promise<void> {
  if (!(await page.getByTestId('identities-hub').isVisible())) {
    await openIdentitiesPage(page)
  }
  const toggle = page
    .locator(
      '[data-testid="identity-card"]:not([data-status="inactive"]) [data-testid="identity-overview-toggle"]',
    )
    .first()
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click()
  }
  await expect(page.getByTestId('identity-overview')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
}

/** Run one action of the identity panel. */
async function openManageItem(page: Page, testId: string): Promise<void> {
  await openIdentityPanel(page)
  const item = page.getByTestId(testId).first()
  await expect(item).toBeVisible({ timeout: UI_TIMEOUT_MS })
  await item.click()
}

/** Open the sync provider picker: the login gate's Add button, or "Add a
 * sync provider" in Manage once a vault is open. */
export async function beginAddSyncProvider(page: Page): Promise<void> {
  const picker = page.getByTestId('provider-picker-list')
  if (await picker.isVisible()) return
  const add = page.getByTestId('add-provider-btn').first()
  if (await add.isVisible()) {
    await add.click()
  } else {
    await openManageItem(page, 'identity-action-add-sync')
  }
  await expect(picker).toBeVisible({ timeout: UI_TIMEOUT_MS })
}

/** Open the add-device flow from the identity panel. Without a cloud sync
 * provider the panel shows what blocks it instead of the action, so the
 * flow, whose first step then asks for a provider, opens directly as its
 * route would. */
export async function openAddDevice(page: Page): Promise<void> {
  await openIdentityPanel(page)
  const item = page.getByTestId('identity-action-add-device').first()
  await expect(
    item.or(page.getByTestId('identity-device-needs-cloud')),
  ).toBeVisible({ timeout: UI_TIMEOUT_MS })
  if (await item.isVisible()) {
    await item.click()
  } else {
    await page.evaluate(() => {
      history.pushState({}, '', '/identity/devices/add')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
  }
  await expect(page.getByTestId('add-device-page')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
}

/** Switch to another vault from its row on the identities page: its panel
 * unlocks it with the identity's key, then opens it. */
export async function switchToVaultFromIdentities(
  page: Page,
  storeId: string,
): Promise<void> {
  const row = page.locator(
    `[data-testid="identity-vault-row"][data-store-id="${storeId}"]`,
  )
  await expect(row).toBeVisible({ timeout: UI_TIMEOUT_MS })
  if ((await row.getAttribute('aria-expanded')) !== 'true') await row.click()
  const vaultPanel = page.getByTestId('vault-panel')
  const unlock = page.getByTestId('vault-panel-unlock')
  const open = page.getByTestId('vault-panel-open')
  await expect
    .poll(
      async () => {
        if (await vaultPanel.isVisible()) return 'open'
        if (!(await pressIfReady(unlock))) await pressIfReady(open)
        return 'waiting'
      },
      { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    .toBe('open')
}
