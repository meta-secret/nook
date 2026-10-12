import { test, expect } from './fixtures'
import {
  createWorkspace,
  addWorkspaceLogin,
  openWorkspace,
  workspaceReady,
} from './helpers/workspace'

test('keeps encrypted items after reload and opens with a backup password', async ({
  page,
}) => {
  await createWorkspace(page)
  await addWorkspaceLogin(page)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByLabel('Password label').fill('Recovery')
  await page
    .getByLabel('Password', { exact: true })
    .fill('correct horse battery staple 2026!')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.locator('.setting-row')).toContainText('Recovery')
  await page.reload()
  await expect(
    page.getByRole('heading', { name: 'A quiet place for your secrets.' }),
  ).toBeVisible()
  await page.getByRole('button').filter({ hasText: 'Workspace test' }).click()
  await page
    .getByRole('button', { name: 'Backup password', exact: true })
    .click()
  await page.getByLabel('Password label').selectOption({ label: 'Recovery' })
  await page.getByLabel('Password', { exact: true }).fill('incorrect-password')
  await page.getByRole('button', { name: 'Open vault', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.locator('.item-row')).toHaveCount(0)
  await page
    .getByLabel('Password', { exact: true })
    .fill('correct horse battery staple 2026!')
  await page.getByRole('button', { name: 'Open vault', exact: true }).click()
  await workspaceReady(page)
  await page.locator('.item-row').click()
  await page.getByRole('button', { name: 'Show value', exact: true }).click()
  await expect(
    page.getByText('workspace-secret', { exact: true }),
  ).toBeVisible()
})

test('remembers appearance, changes language and confirms deletion of local data', async ({
  page,
}) => {
  await createWorkspace(page)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const wasDark = await page
    .locator('html')
    .evaluate((root) => root.classList.contains('dark'))
  await page
    .getByRole('button', { name: 'Switch appearance', exact: true })
    .last()
    .click()
  await expect
    .poll(() =>
      page.locator('html').evaluate((root) => root.classList.contains('dark')),
    )
    .toBe(!wasDark)
  await page.getByRole('button', { name: 'Русский', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Настройки', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await page.reload()
  await expect
    .poll(() =>
      page.locator('html').evaluate((root) => root.classList.contains('dark')),
    )
    .toBe(!wasDark)
  await openWorkspace(page)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page
    .getByRole('button', { name: 'Delete data from this browser', exact: true })
    .click()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Settings', exact: true }),
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Delete data from this browser', exact: true })
    .click()
  await page.locator('.confirmation').getByRole('button').last().click()
  await expect(
    page.getByRole('heading', { name: 'A quiet place for your secrets.' }),
  ).toBeVisible()
  await page.reload()
  await expect(
    page.getByRole('button', { name: 'Create new passkey', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button').filter({ hasText: 'Workspace test' }),
  ).toHaveCount(0)
})
