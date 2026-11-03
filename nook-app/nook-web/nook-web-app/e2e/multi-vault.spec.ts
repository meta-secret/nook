import { expect, test } from './fixtures'
import {
  beginAddSyncProvider,
  activeAuthProviderSeedScope,
  authorizeDeviceProtection,
  createLocalVaultOnLogin,
  disableLoginAutoUnlock,
  E2E_GOOGLE_ACCOUNT,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  readLocalVaultYamlFromIdb,
  saveAuthProvidersInBrowser,
  SeededProviderKind,
  unlockVaultOnLogin,
  openVaultPage,
  openManagePage,
  openIdentitiesPage,
  switchToVaultFromIdentities,
  ManagePage,
  listLocalVaultEntries,
  storeIdOfVaultYaml,
} from './helpers'
import { createLocalE2eGoogleDriveVaultStub } from './drive-stub'

type ViewportBox = {
  x: number
  y: number
  width: number
  height: number
}

type ViewportBounds = {
  width: number
  height: number
}

type VisibleInViewportRequest = {
  box: ViewportBox
  viewport: ViewportBounds
}

function assertBoxVisibleInViewport(request: VisibleInViewportRequest): void {
  expect(request.box.y).toBeGreaterThanOrEqual(0)
  expect(request.box.y + request.box.height).toBeLessThanOrEqual(
    request.viewport.height,
  )
  expect(request.box.x).toBeGreaterThanOrEqual(0)
}

async function seedScopedSyncProviders(
  page: import('@playwright/test').Page,
  storeA: string,
  storeB: string,
) {
  const driveStub = createLocalE2eGoogleDriveVaultStub(
    '',
    'nook-multi-vault-a.yaml',
  )
  await driveStub.install(page, {
    accessToken: 'ya29.e2e_file_sync_token',
    fileName: 'nook-multi-vault-a.yaml',
  })
  await saveAuthProvidersInBrowser(
    page,
    {
      providers: [
        {
          kind: SeededProviderKind.GoogleDrive,
          id: 'provider-a',
          label: 'File · nook-multi-vault-a',
          accessToken: 'ya29.e2e_file_sync_token',
          fileName: 'nook-multi-vault-a.yaml',
          account: E2E_GOOGLE_ACCOUNT,
          scope: activeAuthProviderSeedScope(storeA),
        },
        {
          kind: SeededProviderKind.GoogleDrive,
          id: 'provider-b',
          label: 'File · nook-multi-vault-b',
          accessToken: 'ya29.e2e_file_sync_token',
          fileName: 'nook-multi-vault-b.yaml',
          account: E2E_GOOGLE_ACCOUNT,
          scope: activeAuthProviderSeedScope(storeB),
        },
      ],
    },
    activeAuthProviderSeedScope(storeA),
  )
  await disableLoginAutoUnlock(page)
  await page.reload()
  await expect(page.getByTestId('login-gate')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await unlockVaultOnLogin(page, { storeId: storeA })
  await expect(page.getByTestId('vault-panel')).toBeVisible()
}

test.describe('multi-vault on one browser profile', () => {
  test('creates two vaults, switches between them, and shares identity sync providers', async ({
    page,
  }) => {
    await page.goto('/app/')
    await createLocalVaultOnLogin(page)
    await expect(page.getByTestId('vault-panel')).toBeVisible()

    const vaultAYaml = await readLocalVaultYamlFromIdb(page)
    const storeA = storeIdOfVaultYaml(vaultAYaml)

    await openIdentitiesPage(page)
    await expect(page.getByTestId('identity-vault-row')).toHaveCount(1)
    await page.getByTestId('identity-new-vault').click()
    await expect(page.getByTestId('login-new-vault-panel')).toBeVisible()
    await page.getByTestId('login-vault-name-input').fill('Vault B')
    await page.getByTestId('login-create-additional-vault-btn').click()
    await expect
      .poll(
        async () => {
          const yaml = await readLocalVaultYamlFromIdb(page)
          return storeIdOfVaultYaml(yaml)
        },
        { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
      )
      .not.toBe(storeA)
    const vaultBYaml = await readLocalVaultYamlFromIdb(page)
    const storeB = storeIdOfVaultYaml(vaultBYaml)
    await openManagePage(page, ManagePage.Vaults)
    await expect(page.getByTestId('vault-admin-panel')).toBeVisible()

    const registry = await listLocalVaultEntries(page)
    const registryStoreIds = registry.map((entry) => entry.store_id)
    expect(registryStoreIds).toEqual(expect.arrayContaining([storeA, storeB]))
    expect(registry).toHaveLength(2)

    await expect(page.getByTestId('vault-admin-panel')).toBeVisible()
    await expect(
      page.locator(
        '[data-testid="vault-admin-name"][data-store-id="' + storeB + '"]',
      ),
    ).toContainText('Vault B')
    await page
      .locator(
        '[data-testid="vault-admin-rename-btn"][data-store-id="' +
          storeB +
          '"]',
      )
      .click()
    await page
      .locator(
        '[data-testid="vault-admin-name-input"][data-store-id="' +
          storeB +
          '"]',
      )
      .fill('Vault Bee')
    await page
      .locator(
        '[data-testid="vault-admin-rename-btn"][data-store-id="' +
          storeB +
          '"]',
      )
      .click()
    await expect
      .poll(async () => {
        const entries = await listLocalVaultEntries(page)
        return entries.find((entry) => entry.store_id === storeB)?.label
      })
      .toBe('Vault Bee')
    await expect(
      page.locator(
        '[data-testid="vault-admin-name"][data-store-id="' + storeB + '"]',
      ),
    ).toContainText('Vault Bee')
    await expect(page.getByTestId('vault-admin-vaults-section')).toBeVisible()
    await expect(page.getByTestId('vault-admin-name')).toHaveCount(2)

    await openManagePage(page, ManagePage.Sync)
    await beginAddSyncProvider(page)
    await expect(page.getByTestId('provider-picker-list')).toBeVisible()
    await openVaultPage(page)
    await expect(page.getByTestId('vault-panel')).toBeVisible()

    for (let i = 0; i < 2; i += 1) {
      await page.getByTestId('header-lock-vault-btn').click()
      await authorizeDeviceProtection(page, { storeId: storeB })
      await expect(page.getByTestId('vault-panel')).toBeVisible()
      await expect(page.getByTestId('page-bar-title')).toContainText(
        'Vault Bee',
      )
    }

    await openIdentitiesPage(page)
    const vaultRows = page.getByTestId('identity-vault-row')
    await expect(vaultRows).toHaveCount(2)
    const viewport = page.viewportSize()
    if (!viewport) {
      throw new Error('Page viewport size was not available.')
    }
    for (const row of await vaultRows.all()) {
      const rowBox = await row.boundingBox()
      if (!rowBox) {
        throw new Error('Identity vault row was clipped out of the viewport.')
      }
      const rowVisibility: VisibleInViewportRequest = {
        box: rowBox,
        viewport,
      }
      assertBoxVisibleInViewport(rowVisibility)
    }
    await expect(
      page.locator(
        '[data-testid="identity-vault-row"][data-store-id="' + storeB + '"]',
      ),
    ).toHaveAttribute('data-state', 'open')

    await switchToVaultFromIdentities(page, storeA)

    let activeYaml = await readLocalVaultYamlFromIdb(page)
    expect(storeIdOfVaultYaml(activeYaml)).toEqual(storeA)

    await openIdentitiesPage(page)
    await switchToVaultFromIdentities(page, storeB)
    activeYaml = await readLocalVaultYamlFromIdb(page)
    expect(storeIdOfVaultYaml(activeYaml)).toEqual(storeB)

    await seedScopedSyncProviders(page, storeA, storeB)
    await openManagePage(page, ManagePage.Sync)
    // Sync providers mount the identity, so every vault of it uses them.
    await expect(page.getByTestId('settings-provider-oauth-file')).toHaveCount(
      2,
    )
    await expect(page.getByTestId('settings-providers-list')).toContainText(
      'nook-multi-vault-a',
    )
    await expect(page.getByTestId('settings-providers-list')).toContainText(
      'nook-multi-vault-b',
    )
  })
})
