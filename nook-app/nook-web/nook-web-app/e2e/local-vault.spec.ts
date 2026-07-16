import { readFileSync } from 'node:fs'
import { expect, test } from './fixtures'
import {
  addSecret,
  assertVaultReady,
  BIP39_SAMPLE_WORDS,
  clearBrowserVault,
  connectLocalVault,
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

  test('imports Bitwarden logins and secure notes from JSON', async ({
    page,
  }) => {
    const exportJson = JSON.stringify({
      encrypted: false,
      folders: [],
      items: [
        {
          id: 'bitwarden-login-1',
          type: 1,
          name: 'Imported GitHub',
          notes: 'Work account',
          login: {
            username: 'bitwarden-alice',
            password: 'imported-password',
            uris: [{ uri: 'https://github.com/login' }],
          },
        },
        {
          id: 'bitwarden-note-1',
          type: 2,
          name: 'Imported private note',
          notes: 'Imported note body',
          secureNote: { type: 0 },
        },
        {
          id: 'bitwarden-card-1',
          type: 3,
          name: 'Skipped card',
          card: { number: '4111111111111111' },
        },
      ],
    })

    await page.getByTestId('import-bitwarden-btn').click()
    await page.getByTestId('bitwarden-json-file').setInputFiles({
      name: 'bitwarden_export.json',
      mimeType: 'application/json',
      buffer: Buffer.from(exportJson),
    })
    await page.getByTestId('bitwarden-import-submit').click()
    await expect(page.getByTestId('bitwarden-import-result')).toContainText(
      'Imported 2 items',
    )
    await expect(page.getByTestId('bitwarden-import-result')).toContainText(
      '1 unsupported',
    )

    await page.getByTestId('bitwarden-import-back').click()
    await expect(page.getByTestId('vault-group-login')).toContainText(
      'bitwarden-alice',
    )
    await expect(page.getByTestId('vault-group-secure-note')).toContainText(
      'Imported private note',
    )

    await page.getByTestId('import-bitwarden-btn').click()
    await page.getByTestId('bitwarden-json-file').setInputFiles({
      name: 'bitwarden_export.json',
      mimeType: 'application/json',
      buffer: Buffer.from(exportJson),
    })
    await page.getByTestId('bitwarden-import-submit').click()
    await expect(page.getByTestId('bitwarden-import-result')).toContainText(
      'Imported 0 items',
    )
    await expect(page.getByTestId('bitwarden-import-result')).toContainText(
      '2 duplicates',
    )
  })

  test('imports a password-protected encrypted Bitwarden JSON export', async ({
    page,
  }) => {
    const encryptedExport = readFileSync(
      new URL(
        '../../../nook-core/src/secrets/fixtures/bitwarden_encrypted_pbkdf2.json',
        import.meta.url,
      ),
    )

    await page.getByTestId('import-bitwarden-btn').click()
    await page.getByTestId('bitwarden-json-file').setInputFiles({
      name: 'bitwarden_encrypted_export.json',
      mimeType: 'application/json',
      buffer: encryptedExport,
    })
    await page
      .getByTestId('bitwarden-export-password')
      .fill('correct horse battery staple')
    await page.getByTestId('bitwarden-import-submit').click()

    await expect(page.getByTestId('bitwarden-import-result')).toContainText(
      'Imported 2 items',
    )
    await expect(page.getByTestId('bitwarden-export-password')).toHaveValue('')
  })

  test('imports 1,300 Bitwarden logins without hanging', async ({ page }) => {
    test.setTimeout(60_000)
    const items = Array.from({ length: 1_300 }, (_, index) => ({
      type: 1,
      name: `Bulk login ${index}`,
      notes: '',
      login: {
        username: `bulk-user-${index}`,
        password: `bulk-password-${index}`,
        uris: [{ uri: `https://bulk-${index}.example` }],
        fido2Credentials: [],
      },
    }))
    const exportJson = JSON.stringify({
      encrypted: false,
      folders: [],
      items,
    })

    await page.getByTestId('import-bitwarden-btn').click()
    await page.getByTestId('bitwarden-json-file').setInputFiles({
      name: 'bitwarden_large_export.json',
      mimeType: 'application/json',
      buffer: Buffer.from(exportJson),
    })
    const started = Date.now()
    await page.getByTestId('bitwarden-import-submit').click()
    await expect(page.getByTestId('bitwarden-import-result')).toContainText(
      'Imported 1300 items',
      { timeout: 30_000 },
    )
    expect(Date.now() - started).toBeLessThan(30_000)
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
