import { expect, test } from '@playwright/test'
import {
  addSecret,
  assertVaultReady,
  clearBrowserVault,
  connectLocalVault,
  deleteSecret,
  uniqueSecretKey,
  waitForVaultUnlocked,
} from './helpers'

test.describe('local vault', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await clearBrowserVault(page)
    await page.reload()
    await connectLocalVault(page)
  })

  test('adds, reveals, searches, copies, and deletes a secret', async ({
    page,
    context,
  }) => {
    const key = uniqueSecretKey('e2e-local')
    const value = 'super-secret-value-123'

    await addSecret(page, key, value)

    const row = page.getByTestId('secret-row').filter({ hasText: key })
    await expect(row.getByText('••••••••••••••••')).toBeVisible()

    await row.getByRole('button', { name: 'Show password' }).click()
    await expect(row.getByText(value)).toBeVisible()

    await page.getByTestId('search-secrets').fill(key)
    await expect(row).toBeVisible()
    await page.getByTestId('search-secrets').fill('no-such-secret')
    await expect(page.getByTestId('vault-empty-search')).toBeVisible()

    await page.getByTestId('search-secrets').fill('')
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await row
      .getByRole('button', { name: 'Copy password to clipboard' })
      .click()
    await expect(
      row.getByRole('button', { name: 'Copy password to clipboard' }),
    ).toBeVisible()

    await deleteSecret(page, key)
  })

  test('password generator fills the secret value field', async ({ page }) => {
    await assertVaultReady(page)
    await page.getByTestId('add-secret-btn').click()
    await page.getByTestId('password-generator-toggle').click()
    await page.getByTestId('secret-value').fill('')
    await page.getByTestId('generate-password-btn').click()
    const generated = await page.getByTestId('secret-value').inputValue()
    expect(generated.length).toBeGreaterThanOrEqual(8)
  })

  test('persists secrets after reload', async ({ page }) => {
    const key = uniqueSecretKey('e2e-local-persist')
    const value = 'persist-me'

    await addSecret(page, key, value)
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await waitForVaultUnlocked(page)
    await assertVaultReady(page)

    const row = page.getByTestId('secret-row').filter({ hasText: key })
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: 'Show password' }).click()
    await expect(row.getByText(value)).toBeVisible()

    await deleteSecret(page, key)
  })
})
