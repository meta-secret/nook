import { test, expect as baseExpect } from './fixtures'
import {
  createWorkspace,
  addWorkspaceLogin,
  openWorkspace,
} from './helpers/workspace'

test.describe.configure({ mode: 'default' })
const expect = baseExpect.configure({ timeout: 30000 })
test.use({ actionTimeout: 30000 })

test('creates, edits, searches, locks and reopens the new workspace', async ({
  page,
}, testInfo) => {
  await createWorkspace(page)
  await addWorkspaceLogin(page)
  const item = page.locator('.item-row').filter({ hasText: 'example.com' })
  await expect(item).toBeVisible()
  await item.click()
  await expect(
    page.getByText('workspace-secret', { exact: true }),
  ).not.toBeVisible()
  await page.getByRole('button', { name: 'Show value', exact: true }).click()
  await expect(
    page.getByText('workspace-secret', { exact: true }),
  ).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('workspace-desktop.png') })
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByLabel('Username', { exact: true }).fill('edited-user')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(
    page.locator('.item-row').filter({ hasText: 'edited-user' }),
  ).toBeVisible()
  const search = page.getByRole('textbox', { name: 'Search your vault' })
  await search.fill('absent-record')
  await search.press('Enter')
  await expect(page.locator('.item-row')).toHaveCount(0)
  await search.fill('edited-user')
  await search.press('Enter')
  await expect(page.locator('.item-row')).toHaveCount(1)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Settings', exact: true }),
  ).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('workspace-settings.png') })
  await page.getByRole('button', { name: 'All items', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('.item-row').click()
  await expect(page.locator('.detail-pane')).toBeVisible()
  await expect(page.locator('.item-list')).not.toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('workspace-mobile.png') })
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(page.locator('.item-list')).toBeVisible()
  await page.getByRole('button', { name: 'Lock vault', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'A quiet place for your secrets.' }),
  ).toBeVisible()
  await expect(
    page.getByText('workspace-secret', { exact: true }),
  ).not.toBeVisible()
  await openWorkspace(page)
  await page.locator('.item-row').click()
  await page.getByRole('button', { name: 'Show value', exact: true }).click()
  await expect(
    page.getByText('workspace-secret', { exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(
    page.getByText('workspace-secret', { exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await page
    .locator('.confirmation')
    .getByRole('button', { name: 'Delete', exact: true })
    .click()
  await expect(page.locator('.item-list')).toBeVisible()
  await expect(page.locator('.item-row')).toHaveCount(0)
})

test('passkey cancellation keeps the device setup screen and allows retry', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('nook_e2e_manual_passkey', 'true')
    localStorage.setItem('nook_e2e_passkey_mode', 'cancel')
  })
  await page.goto('/app/')
  await page
    .getByRole('button', { name: 'Create new passkey', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: 'Create new passkey', exact: true }),
  ).toBeEnabled()
  await expect(page.getByLabel('Vault name', { exact: true })).toHaveCount(0)
  await expect(page.getByLabel('PIN', { exact: true })).toHaveCount(0)
  await page.evaluate(() => localStorage.removeItem('nook_e2e_passkey_mode'))
  await page
    .getByRole('button', { name: 'Create new passkey', exact: true })
    .click()
  await expect(page.getByLabel('Vault name', { exact: true })).toBeVisible()
})

test('idle lock removes revealed plaintext from the screen', async ({
  page,
}) => {
  await createWorkspace(page)
  await addWorkspaceLogin(page)
  await page.locator('.item-row').click()
  await page.getByRole('button', { name: 'Show value', exact: true }).click()
  await expect(
    page.getByText('workspace-secret', { exact: true }),
  ).toBeVisible()
  await page.evaluate(() => window.__nookVault?.startIdleSessionTracking())
  await expect(
    page.getByRole('heading', { name: 'A quiet place for your secrets.' }),
  ).toBeVisible({ timeout: 12000 })
  await expect(page.getByText('workspace-secret', { exact: true })).toHaveCount(
    0,
  )
  await openWorkspace(page)
  await expect(page.locator('.item-row')).toHaveCount(1)
})
