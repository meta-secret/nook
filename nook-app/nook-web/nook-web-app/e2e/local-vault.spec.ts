import { expect, test } from './fixtures'
import {
  addSecret,
  assertVaultReady,
  BIP39_SAMPLE_WORDS,
  clearBrowserVault,
  connectLocalVaultLegacy,
  deleteSecret,
  expandSecretRow,
  fillSeedPhraseGrid,
  mockBip39Wordlist,
  revealSecretInRow,
  UI_TIMEOUT_MS,
  uniqueSecretKey,
  unlockVaultOnLogin,
  waitForVaultUnlocked,
} from './helpers'

test.describe('local vault', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/app/')
    await mockBip39Wordlist(page)
    await clearBrowserVault(page)
    await page.reload()
    await connectLocalVaultLegacy(page)
  })

  test('adds, reveals, searches, copies, and deletes a secret', async ({
    page,
    context,
  }) => {
    const key = uniqueSecretKey('e2e-local')
    const value = 'super-secret-value-123'

    await addSecret(page, key, value)

    const row = page.getByTestId('secret-row').filter({ hasText: key })
    await expandSecretRow(page, key)
    await expect(row.getByText('••••••••••••••••')).toBeVisible()

    await revealSecretInRow(row)
    await expect(row.getByText(value)).toBeVisible()

    await page.getByTestId('search-secrets').fill(key)
    await expect(row).toBeVisible()
    await page.getByTestId('search-secrets').fill('no-such-secret')
    await expect(page.getByTestId('vault-empty-search')).toBeVisible()

    await page.getByTestId('search-secrets').fill('')
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await row.getByRole('button', { name: 'Copy secret' }).click()
    await expect(row.getByRole('button', { name: 'Copy secret' })).toBeVisible()

    await deleteSecret(page, key)
  })

  test('password generator fills the secret value field', async ({ page }) => {
    await assertVaultReady(page)
    await page.getByTestId('add-secret-btn').click()
    await page.getByTestId('item-type-login').click()
    await page.getByTestId('password-generator-toggle').click()
    await page.getByTestId('secret-value').fill('')
    await page.getByTestId('generate-password-btn').click()
    const generated = await page.getByTestId('secret-value').inputValue()
    expect(generated.length).toBeGreaterThanOrEqual(8)
  })

  test('adds an API key without a website URL', async ({ page }) => {
    const value = 'sk-test-api-key-no-website'

    await page.getByTestId('add-secret-btn').click()
    await page.getByTestId('item-type-api-key').click()
    await page.getByTestId('secret-value').fill(value)
    await expect(page.getByTestId('save-secret-btn')).toBeEnabled()
    await page.getByTestId('save-secret-btn').click()

    const row = page
      .getByTestId('vault-group-api-key')
      .getByTestId('secret-row')
    await expect(row).toBeVisible({ timeout: UI_TIMEOUT_MS })
    await revealSecretInRow(row)
    await expect(row.getByText(value)).toBeVisible()
  })

  test('groups logins, API keys, and seed phrases', async ({ page }) => {
    await page.getByTestId('add-secret-btn').click()
    await page.getByTestId('item-type-login').click()
    await page.getByTestId('secret-label').fill('https://login.example.com')
    await page.getByTestId('login-username').fill('alice')
    await page.getByTestId('secret-value').fill('login-password')
    await page.getByTestId('login-notes').fill('Personal account')
    await page.getByTestId('save-secret-btn').click()

    await page.getByTestId('add-secret-btn').click()
    await page.getByTestId('item-type-api-key').click()
    await page.getByTestId('secret-label').fill('https://api.example.com')
    await page.getByTestId('secret-value').fill('api-key-value')
    await page.getByTestId('api-key-expiration').fill('2030-01-01')
    await page.getByTestId('save-secret-btn').click()

    await page.getByTestId('add-secret-btn').click()
    await page.getByTestId('item-type-seed-phrase').click()
    await page.getByTestId('secret-label').fill('Main wallet')
    await fillSeedPhraseGrid(page, BIP39_SAMPLE_WORDS)
    await expect(page.getByTestId('seed-phrase-valid')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await page.getByTestId('save-secret-btn').click()

    await expect(page.getByTestId('vault-group-login')).toContainText('alice')
    await expandSecretRow(page, 'alice')
    await expect(page.getByTestId('vault-group-login')).toContainText(
      'login.example.com',
    )
    await expandSecretRow(page, 'api.example.com')
    await expect(page.getByTestId('vault-group-api-key')).toContainText(
      '2030-01-01',
    )
    await expect(page.getByTestId('vault-group-seed-phrase')).toContainText(
      'Main wallet',
    )
  })

  test('adds, reveals, and deletes a secure note with markdown', async ({
    page,
  }) => {
    const title = uniqueSecretKey('e2e-note')
    const noteBody = '# Recovery\n\n- step one\n\nUse **backup** code `1234`.'

    await page.getByTestId('add-secret-btn').click()
    await page.getByTestId('item-type-secure-note').click()
    await page.getByTestId('secret-label').fill(title)
    await page.getByTestId('secret-value').fill(noteBody)
    await page.getByTestId('markdown-tab-preview').click()
    await expect(page.getByTestId('markdown-preview')).toContainText('Recovery')
    await expect(page.getByTestId('markdown-preview').locator('h1')).toHaveText(
      'Recovery',
    )
    await expect(
      page.getByTestId('markdown-preview').locator('strong'),
    ).toHaveText('backup')
    await expect(
      page.getByTestId('markdown-preview').locator('ul li'),
    ).toHaveCount(1)
    await page.getByTestId('save-secret-btn').click()

    const row = page.getByTestId('secret-row').filter({ hasText: title })
    await expect(page.getByTestId('vault-group-secure-note')).toBeVisible()
    await expect(row).toBeVisible()

    await revealSecretInRow(row)
    await expect(row.getByRole('heading', { name: 'Recovery' })).toBeVisible()
    await expect(row.getByText('backup')).toBeVisible()
    await expect(row.getByText('1234')).toBeVisible()

    await deleteSecret(page, title)
  })

  test('persists secrets after reload', async ({ page }) => {
    const key = uniqueSecretKey('e2e-local-persist')
    const value = 'persist-me'

    await addSecret(page, key, value)
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByTestId('login-gate')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await unlockVaultOnLogin(page)
    await waitForVaultUnlocked(page)
    await assertVaultReady(page)

    const row = page.getByTestId('secret-row').filter({ hasText: key })
    await expect(row).toBeVisible()
    await revealSecretInRow(row)
    await expect(row.getByText(value)).toBeVisible()

    await deleteSecret(page, key)
  })
})
