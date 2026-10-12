import { expect, test } from '../fixtures'
import { addWorkspaceLogin, createWorkspace } from '../helpers/workspace'

test('new workspace: create a vault, inspect an item, and open settings', async ({
  page,
}, testInfo) => {
  await createWorkspace(page, 'Personal vault')
  await addWorkspaceLogin(page, 'https://example.com', 'hello@example.com')
  await page.locator('.item-row').click()
  await expect(
    page.getByRole('heading', { name: 'https://example.com' }),
  ).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('workspace-desktop.png') })
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Settings', exact: true }),
  ).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('workspace-settings.png') })
  await page.getByRole('button', { name: 'All items', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('.item-row').click()
  await expect(
    page.getByRole('button', { name: 'Back', exact: true }),
  ).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('workspace-mobile.png') })
})
