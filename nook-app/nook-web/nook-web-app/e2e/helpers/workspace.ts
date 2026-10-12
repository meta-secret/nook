import { expect, type Page } from '@playwright/test'
import { disableVaultIdleLock, waitForStorageChainIdle } from './vault-runtime'

export async function createWorkspace(
  page: Page,
  name = 'Workspace test',
  path = '/app/',
) {
  await page.addInitScript(() =>
    localStorage.setItem('nook_e2e_manual_passkey', 'true'),
  )
  await page.goto(path)
  await createLocalWorkspace(page, name)
}
export async function createLocalWorkspace(page: Page, name: string) {
  await expect(
    page.getByRole('heading', { name: 'A quiet place for your secrets.' }),
  ).toBeVisible({ timeout: 60000 })
  const setup = page.getByRole('button', {
    name: 'Create new passkey',
    exact: true,
  })
  const nameInput = page.getByLabel('Vault name', { exact: true })
  await expect(setup.or(nameInput)).toBeVisible({ timeout: 60000 })
  if (await setup.isVisible()) await setup.click()
  await page.getByLabel('Vault name', { exact: true }).fill(name)
  await page
    .getByRole('button', { name: 'Create a vault', exact: true })
    .click()
  await workspaceReady(page)
}
export async function workspaceReady(page: Page) {
  await expect(page.getByRole('heading', { name: 'All items' })).toBeVisible({
    timeout: 60000,
  })
  await expect
    .poll(() => page.evaluate(() => window.__nookVault?.isVerifying))
    .toBe(false)
  await waitForStorageChainIdle(page)
  await disableVaultIdleLock(page)
}
export async function addWorkspaceLogin(
  page: Page,
  website = 'https://example.com',
  username = 'workspace-user',
) {
  await page
    .getByRole('button', { name: 'Add Secret', exact: true })
    .first()
    .click()
  await page.getByLabel('Website', { exact: true }).fill(website)
  await page.getByLabel('Username', { exact: true }).fill(username)
  await page.getByLabel('Password', { exact: true }).fill('workspace-secret')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(
    page.locator('.item-row').filter({ hasText: username }),
  ).toBeVisible()
}
export async function openWorkspace(page: Page, name = 'Workspace test') {
  await page.getByRole('button').filter({ hasText: name }).click()
  await authorizeWorkspace(page)
}
export async function authorizeWorkspace(page: Page) {
  const shell = page.getByTestId('authenticated-shell')
  const choices = page.locator('.vault-choice')
  await expect(shell.or(choices.first())).toBeVisible({ timeout: 60000 })
  if (await shell.isVisible()) return
  if (!(await page.locator('.vault-choice.chosen').count()))
    await choices.first().click()
  const continueButton = page.getByRole('button', {
    name: 'Continue with passkey',
    exact: true,
  })
  const openButton = page.getByRole('button', {
    name: 'Open vault',
    exact: true,
  })
  await expect(continueButton.or(openButton)).toBeVisible()
  if (await continueButton.isVisible()) await continueButton.click()
  await openButton.click()
  await expect(shell).toBeVisible({ timeout: 60000 })
  await waitForStorageChainIdle(page)
  await disableVaultIdleLock(page)
}
