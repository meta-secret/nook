import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import {
  addSecret,
  assertVaultReady,
  BIP39_SAMPLE_WORDS,
  clearBrowserVault,
  connectLocalVault,
  deleteSecret,
  expandSettingsSection,
  expandSecretRow,
  fillSeedPhraseGrid,
  flushNookLogPersistQueue,
  mockBip39Wordlist,
  readPersistedAppLogs,
  revealSecretInRow,
  UI_TIMEOUT_MS,
  uniqueSecretKey,
  unlockVaultOnLogin,
  waitForVaultUnlocked,
} from './helpers'

async function openBitwardenImport(page: Page) {
  await expandSettingsSection(page, 'import')
  const section = page.getByTestId('bitwarden-import-section')
  const toggle = section.getByRole('button').first()
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click()
  }
  await expect(page.getByTestId('bitwarden-import-panel')).toBeVisible()
}

async function openLastPassImport(page: Page) {
  await expandSettingsSection(page, 'import')
  const section = page.getByTestId('lastpass-import-section')
  const toggle = section.getByRole('button').first()
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click()
  }
  await expect(page.getByTestId('lastpass-import-panel')).toBeVisible()
}

async function openOnePasswordImport(page: Page) {
  await expandSettingsSection(page, 'import')
  const section = page.getByTestId('onepassword-import-section')
  const toggle = section.getByRole('button').first()
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click()
  }
  await expect(page.getByTestId('onepassword-import-panel')).toBeVisible()
}

async function openApplePasswordsImport(page: Page) {
  await expandSettingsSection(page, 'import')
  const section = page.getByTestId('apple-passwords-import-section')
  const toggle = section.getByRole('button').first()
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click()
  }
  await expect(page.getByTestId('apple-passwords-import-panel')).toBeVisible()
}

async function openChromePasswordsImport(page: Page) {
  await expandSettingsSection(page, 'import')
  const section = page.getByTestId('chrome-passwords-import-section')
  const toggle = section.getByRole('button').first()
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click()
  }
  await expect(page.getByTestId('chrome-passwords-import-panel')).toBeVisible()
}

async function openProtonPassImport(page: Page) {
  await expandSettingsSection(page, 'import')
  const section = page.getByTestId('proton-pass-import-section')
  const toggle = section.getByRole('button').first()
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click()
  }
  await expect(page.getByTestId('proton-pass-import-panel')).toBeVisible()
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function storedZip(entries: Record<string, string>): Buffer {
  const localRecords: Buffer[] = []
  const centralRecords: Buffer[] = []
  let offset = 0

  for (const [name, text] of Object.entries(entries)) {
    const fileName = Buffer.from(name)
    const data = Buffer.from(text)
    const checksum = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(fileName.length, 26)
    localRecords.push(local, fileName, data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(fileName.length, 28)
    central.writeUInt32LE(offset, 42)
    centralRecords.push(central, fileName)
    offset += local.length + fileName.length + data.length
  }

  const centralDirectory = Buffer.concat(centralRecords)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(entries).length, 8)
  end.writeUInt16LE(Object.keys(entries).length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...localRecords, centralDirectory, end])
}

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

  test('adds an authenticator with a simple setup-key form and live TOTP code', async ({
    page,
  }) => {
    const issuer = uniqueSecretKey('e2e-authenticator')
    const account = `${issuer}@example.com`

    await page.getByTestId('add-secret-btn').click()
    await page.getByTestId('item-type-authenticator').click()
    await page.getByTestId('authenticator-issuer').fill(issuer)
    await page.getByTestId('authenticator-account').fill(account)
    await page.getByTestId('authenticator-secret').fill('not-valid!')
    await expect(page.getByTestId('authenticator-algorithm')).toHaveCount(0)
    await expect(page.getByTestId('authenticator-digits')).toHaveCount(0)
    await expect(page.getByTestId('authenticator-period')).toHaveCount(0)
    await expect(page.getByTestId('authenticator-backup-codes')).toHaveCount(0)
    await page.getByTestId('save-secret-btn').click()
    await expect(page.getByTestId('secret-form-error')).toBeVisible()
    await expect(page.getByTestId('secret-form-error')).toContainText(
      'Enter a valid Base32 authenticator secret.',
    )

    await page.getByTestId('authenticator-secret').fill('JBSWY3DPEHPK3PXP')
    await page.getByTestId('save-secret-btn').click()

    const row = page.getByTestId('secret-row').filter({ hasText: account })
    await expect(row).toBeVisible({ timeout: UI_TIMEOUT_MS })
    await row.getByTestId('secret-row-toggle').click()
    await expect(row.getByTestId('authenticator-current-code')).toHaveText(
      '••••••',
    )
    await expect(row.getByTestId('authenticator-backup-codes')).toHaveCount(0)

    await revealSecretInRow(row)
    await expect(row.getByTestId('authenticator-current-code')).toHaveText(
      /^\d{6}$/,
      { timeout: UI_TIMEOUT_MS },
    )

    await expect(row.getByText('JBSWY3DPEHPK3PXP')).toBeVisible()

    await deleteSecret(page, issuer)
  })

  test('adds an authenticator from an otpauth URI without separate issuer input', async ({
    page,
  }) => {
    const issuer = uniqueSecretKey('e2e-authenticator-uri')
    const account = `${issuer}+alerts@example.com`
    const uri = `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=JBSWY3DPEHPK3PXP&issuer=${encodeURIComponent(issuer)}`

    await page.getByTestId('add-secret-btn').click()
    await page.getByTestId('item-type-authenticator').click()
    await page.getByTestId('authenticator-secret').fill(uri)
    await expect(page.getByTestId('save-secret-btn')).toBeEnabled()
    await page.getByTestId('save-secret-btn').click()

    const row = page.getByTestId('secret-row').filter({ hasText: account })
    await expect(row).toBeVisible({ timeout: UI_TIMEOUT_MS })

    await deleteSecret(page, issuer)
  })

  test('keeps password-manager import forms folded until selected', async ({
    page,
  }) => {
    await expandSettingsSection(page, 'import')

    const bitwardenSection = page.getByTestId('bitwarden-import-section')
    const lastPassSection = page.getByTestId('lastpass-import-section')
    const onePasswordSection = page.getByTestId('onepassword-import-section')
    const applePasswordsSection = page.getByTestId(
      'apple-passwords-import-section',
    )
    const chromePasswordsSection = page.getByTestId(
      'chrome-passwords-import-section',
    )
    const bitwardenToggle = bitwardenSection.getByRole('button').first()
    const lastPassToggle = lastPassSection.getByRole('button').first()
    const onePasswordToggle = onePasswordSection.getByRole('button').first()
    const applePasswordsToggle = applePasswordsSection
      .getByRole('button')
      .first()
    const chromePasswordsToggle = chromePasswordsSection
      .getByRole('button')
      .first()

    await expect(applePasswordsSection).toBeVisible()
    await expect(chromePasswordsSection).toBeVisible()
    await expect(bitwardenSection).toBeVisible()
    await expect(lastPassSection).toBeVisible()
    await expect(onePasswordSection).toBeVisible()
    await expect(applePasswordsToggle).toHaveAttribute('aria-expanded', 'false')
    await expect(chromePasswordsToggle).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    await expect(bitwardenToggle).toHaveAttribute('aria-expanded', 'false')
    await expect(lastPassToggle).toHaveAttribute('aria-expanded', 'false')
    await expect(onePasswordToggle).toHaveAttribute('aria-expanded', 'false')
    await expect(
      page.getByTestId('apple-passwords-import-panel'),
    ).not.toBeVisible()
    await expect(
      page.getByTestId('chrome-passwords-import-panel'),
    ).not.toBeVisible()
    await expect(page.getByTestId('bitwarden-import-panel')).not.toBeVisible()
    await expect(page.getByTestId('onepassword-import-panel')).not.toBeVisible()

    await applePasswordsToggle.click()
    await expect(page.getByTestId('apple-passwords-import-panel')).toBeVisible()
    await expect(
      page.getByTestId('chrome-passwords-import-panel'),
    ).not.toBeVisible()
    await expect(page.getByTestId('bitwarden-import-panel')).not.toBeVisible()
    await expect(page.getByTestId('lastpass-import-panel')).not.toBeVisible()
    await expect(page.getByTestId('onepassword-import-panel')).not.toBeVisible()

    await bitwardenToggle.click()
    await expect(
      page.getByTestId('apple-passwords-import-panel'),
    ).not.toBeVisible()
    await expect(
      page.getByTestId('chrome-passwords-import-panel'),
    ).not.toBeVisible()
    await expect(page.getByTestId('bitwarden-import-panel')).toBeVisible()
    await expect(page.getByTestId('lastpass-import-panel')).not.toBeVisible()
    await expect(page.getByTestId('onepassword-import-panel')).not.toBeVisible()

    await lastPassToggle.click()
    await expect(page.getByTestId('bitwarden-import-panel')).not.toBeVisible()
    await expect(page.getByTestId('lastpass-import-panel')).toBeVisible()
    await expect(page.getByTestId('onepassword-import-panel')).not.toBeVisible()

    await onePasswordToggle.click()
    await expect(
      page.getByTestId('apple-passwords-import-panel'),
    ).not.toBeVisible()
    await expect(
      page.getByTestId('chrome-passwords-import-panel'),
    ).not.toBeVisible()
    await expect(page.getByTestId('bitwarden-import-panel')).not.toBeVisible()
    await expect(page.getByTestId('lastpass-import-panel')).not.toBeVisible()
    await expect(page.getByTestId('onepassword-import-panel')).toBeVisible()

    await chromePasswordsToggle.click()
    await expect(
      page.getByTestId('apple-passwords-import-panel'),
    ).not.toBeVisible()
    await expect(page.getByTestId('bitwarden-import-panel')).not.toBeVisible()
    await expect(page.getByTestId('onepassword-import-panel')).not.toBeVisible()
    await expect(
      page.getByTestId('chrome-passwords-import-panel'),
    ).toBeVisible()
  })

  test('imports Chrome-family browser logins from CSV', async ({ page }) => {
    const exportCsv = [
      'name,url,username,password,note',
      [
        '"Imported browser account"',
        'https://chrome-import.example/login',
        'chrome-alice',
        'chrome-imported-password',
        '"Imported from Chrome"',
      ].join(','),
    ].join('\n')

    await openChromePasswordsImport(page)
    await page.getByTestId('chrome-passwords-csv-file').setInputFiles({
      name: 'Chrome Passwords.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(exportCsv),
    })
    await page.getByTestId('chrome-passwords-import-submit').click()
    await expect(
      page.getByTestId('chrome-passwords-import-result'),
    ).toContainText('Imported 1 logins')

    await page.getByTestId('vault-secrets-tab').click()
    const loginGroup = page.getByTestId('vault-group-login')
    await expect(loginGroup).toContainText('chrome-alice')

    await openChromePasswordsImport(page)
    await page.getByTestId('chrome-passwords-csv-file').setInputFiles({
      name: 'Chrome Passwords.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(exportCsv),
    })
    await page.getByTestId('chrome-passwords-import-submit').click()
    await expect(
      page.getByTestId('chrome-passwords-import-result'),
    ).toContainText('Imported 0 logins')
    await expect(
      page.getByTestId('chrome-passwords-import-result'),
    ).toContainText('1 duplicates')
  })

  test('imports Apple Passwords logins and verification codes from CSV', async ({
    page,
  }) => {
    const exportCsv = [
      'Title,URL,Username,Password,Notes,OTPAuth',
      [
        '"Imported Apple account"',
        'https://apple-import.example/login',
        'apple-alice',
        'apple-imported-password',
        '"Imported from Apple Passwords"',
        '"otpauth://totp/Apple%20Import%3Aapple-alice?secret=JBSWY3DPEHPK3PXP&issuer=Apple%20Import"',
      ].join(','),
    ].join('\n')

    await openApplePasswordsImport(page)
    await page.getByTestId('apple-passwords-csv-file').setInputFiles({
      name: 'Passwords.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(exportCsv),
    })
    await page.getByTestId('apple-passwords-import-submit').click()
    await expect(
      page.getByTestId('apple-passwords-import-result'),
    ).toContainText('Imported 2 items')

    await page.getByTestId('vault-secrets-tab').click()
    await expect(page.getByTestId('vault-group-login')).toContainText(
      'apple-alice',
    )
    await expect(page.getByTestId('vault-group-authenticator')).toContainText(
      'apple-alice',
    )

    await openApplePasswordsImport(page)
    await page.getByTestId('apple-passwords-csv-file').setInputFiles({
      name: 'Passwords.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(exportCsv),
    })
    await page.getByTestId('apple-passwords-import-submit').click()
    await expect(
      page.getByTestId('apple-passwords-import-result'),
    ).toContainText('Imported 0 items')
    await expect(
      page.getByTestId('apple-passwords-import-result'),
    ).toContainText('2 duplicates')
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

    await openBitwardenImport(page)
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

    await page.getByTestId('vault-secrets-tab').click()
    await expect(page.getByTestId('vault-group-login')).toContainText(
      'bitwarden-alice',
    )
    await expect(page.getByTestId('vault-group-secure-note')).toContainText(
      'Imported private note',
    )

    await openBitwardenImport(page)
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

  test('imports a 1Password 1PUX archive idempotently', async ({ page }) => {
    const archive = storedZip({
      'export.attributes': JSON.stringify({
        version: 3,
        description: '1Password Unencrypted Export',
        createdAt: 1585333569,
      }),
      'export.data': JSON.stringify({
        accounts: [
          {
            vaults: [
              {
                attrs: { name: 'Personal' },
                items: [
                  {
                    categoryUuid: '001',
                    state: 'active',
                    overview: {
                      title: 'Imported 1Password login',
                      url: 'https://1password.example/login',
                      urls: [],
                      tags: ['migration'],
                    },
                    details: {
                      loginFields: [
                        {
                          value: 'onepassword-alice',
                          name: 'username',
                          fieldType: 'T',
                          designation: 'username',
                        },
                        {
                          value: 'onepassword-secret',
                          name: 'password',
                          fieldType: 'P',
                          designation: 'password',
                        },
                      ],
                      notesPlain: 'Imported from 1Password',
                      sections: [],
                    },
                  },
                  {
                    categoryUuid: '003',
                    state: 'active',
                    overview: { title: 'Imported 1Password note' },
                    details: {
                      notesPlain: 'Private note body',
                      sections: [],
                    },
                  },
                  {
                    categoryUuid: '002',
                    overview: { title: 'Skipped card' },
                  },
                ],
              },
            ],
          },
        ],
      }),
    })

    await openOnePasswordImport(page)
    await page.getByTestId('onepassword-pux-file').setInputFiles({
      name: 'account.1pux',
      mimeType: 'application/zip',
      buffer: archive,
    })
    await page.getByTestId('onepassword-import-submit').click()
    await expect(page.getByTestId('onepassword-import-result')).toContainText(
      'Imported 2 items',
    )
    await expect(page.getByTestId('onepassword-import-result')).toContainText(
      '1 unsupported',
    )

    await page.getByTestId('vault-secrets-tab').click()
    await expect(page.getByTestId('vault-group-login')).toContainText(
      'onepassword-alice',
    )
    await expect(page.getByTestId('vault-group-secure-note')).toContainText(
      'Imported 1Password note',
    )

    await openOnePasswordImport(page)
    await page.getByTestId('onepassword-pux-file').setInputFiles({
      name: 'account.1pux',
      mimeType: 'application/zip',
      buffer: archive,
    })
    await page.getByTestId('onepassword-import-submit').click()
    await expect(page.getByTestId('onepassword-import-result')).toContainText(
      'Imported 0 items',
    )
    await expect(page.getByTestId('onepassword-import-result')).toContainText(
      '2 duplicates',
    )
  })

  test('enriches matching imports and keeps different passwords', async ({
    page,
  }) => {
    const bitwardenExport = JSON.stringify({
      encrypted: false,
      folders: [],
      items: [
        {
          id: 'shared-login',
          type: 1,
          name: 'Shared login',
          notes: 'Meaningful note',
          fields: [{ name: 'source', value: 'Bitwarden' }],
          login: {
            username: 'shared-alice',
            password: 'shared-secret',
            uris: [{ uri: 'https://shared.example/login' }],
          },
        },
      ],
    })
    const onePasswordArchive = (password: string) =>
      storedZip({
        'export.attributes': JSON.stringify({
          version: 3,
          description: '1Password Unencrypted Export',
        }),
        'export.data': JSON.stringify({
          accounts: [
            {
              vaults: [
                {
                  attrs: { name: 'Personal' },
                  items: [
                    {
                      categoryUuid: '001',
                      state: 'active',
                      overview: {
                        title: 'Shared login',
                        url: 'https://shared.example/login',
                        tags: ['1password'],
                      },
                      details: {
                        loginFields: [
                          {
                            value: 'shared-alice',
                            designation: 'username',
                          },
                          {
                            value: password,
                            designation: 'password',
                            fieldType: 'P',
                          },
                        ],
                        notesPlain: 'Meaningful note',
                        sections: [],
                      },
                    },
                  ],
                },
              ],
            },
          ],
        }),
      })

    await openBitwardenImport(page)
    await page.getByTestId('bitwarden-json-file').setInputFiles({
      name: 'bitwarden_export.json',
      mimeType: 'application/json',
      buffer: Buffer.from(bitwardenExport),
    })
    await page.getByTestId('bitwarden-import-submit').click()
    await expect(page.getByTestId('bitwarden-import-result')).toContainText(
      'Imported 1 item',
    )

    await openOnePasswordImport(page)
    await page.getByTestId('onepassword-pux-file').setInputFiles({
      name: 'account.1pux',
      mimeType: 'application/zip',
      buffer: onePasswordArchive('shared-secret'),
    })
    await page.getByTestId('onepassword-import-submit').click()
    await expect(page.getByTestId('onepassword-import-result')).toContainText(
      'Imported 1 item',
    )

    await page.getByTestId('vault-secrets-tab').click()
    let rows = page
      .getByTestId('secret-row')
      .filter({ hasText: 'shared-alice' })
    await expect(rows).toHaveCount(1)
    await revealSecretInRow(rows.first())
    await expect(rows.first()).toContainText('field.source: Bitwarden')
    await expect(rows.first()).toContainText('tags: 1password')

    await openOnePasswordImport(page)
    await page.getByTestId('onepassword-pux-file').setInputFiles({
      name: 'account.1pux',
      mimeType: 'application/zip',
      buffer: onePasswordArchive('rotated-secret'),
    })
    await page.getByTestId('onepassword-import-submit').click()
    await expect(page.getByTestId('onepassword-import-result')).toContainText(
      'Imported 1 item',
    )
    await page.getByTestId('vault-secrets-tab').click()
    rows = page.getByTestId('secret-row').filter({ hasText: 'shared-alice' })
    await expect(rows).toHaveCount(2)
  })

  test('imports LastPass logins and secure notes from CSV idempotently', async ({
    page,
  }) => {
    const exportCsv = [
      'url,username,password,extra,name,grouping,fav',
      'https://lastpass.example/login,lastpass-alice,lastpass-secret,"Recovery codes, elsewhere",Imported LastPass login,Work,1',
      'http://sn,,,"# LastPass note\n\nKeep offline",Imported LastPass note,Personal,0',
    ].join('\n')

    await openLastPassImport(page)
    await page.getByTestId('lastpass-csv-file').setInputFiles({
      name: 'lastpass_export.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(exportCsv),
    })
    await page.getByTestId('lastpass-import-submit').click()
    await expect(page.getByTestId('lastpass-import-result')).toContainText(
      'Imported 2 items',
    )

    await page.getByTestId('vault-secrets-tab').click()
    await expect(page.getByTestId('vault-group-login')).toContainText(
      'lastpass-alice',
    )
    await expect(page.getByTestId('vault-group-secure-note')).toContainText(
      'Imported LastPass note',
    )

    await openLastPassImport(page)
    await page.getByTestId('lastpass-csv-file').setInputFiles({
      name: 'lastpass_export.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(exportCsv),
    })
    await page.getByTestId('lastpass-import-submit').click()
    await expect(page.getByTestId('lastpass-import-result')).toContainText(
      'Imported 0 items',
    )
    await expect(page.getByTestId('lastpass-import-result')).toContainText(
      '2 duplicates',
    )
  })

  test('imports Proton Pass logins and secure notes idempotently', async ({
    page,
  }) => {
    const archive = storedZip({
      'Proton Pass/data.json': JSON.stringify({
        userId: 'user',
        version: '1.32.0',
        vaults: {
          work: {
            name: 'Work',
            items: [
              {
                data: {
                  metadata: {
                    name: 'Imported Proton login',
                    note: 'Recovery codes elsewhere',
                  },
                  extraFields: [
                    {
                      fieldName: 'PIN',
                      type: 'hidden',
                      data: { content: '1234' },
                    },
                  ],
                  type: 'login',
                  content: {
                    itemEmail: 'proton-alice@example.com',
                    itemUsername: 'proton-alice',
                    password: 'proton-secret',
                    urls: ['https://proton-pass.example/login'],
                    totpUri: 'otpauth://totp/example',
                    passkeys: [],
                  },
                },
                state: 1,
                pinned: true,
                files: [],
              },
              {
                data: {
                  metadata: {
                    name: 'Imported Proton note',
                    note: 'Private note body',
                  },
                  extraFields: [],
                  type: 'note',
                  content: {},
                },
                state: 1,
              },
              {
                data: {
                  metadata: { name: 'Skipped card', note: '' },
                  extraFields: [],
                  type: 'creditCard',
                  content: {},
                },
                state: 1,
              },
            ],
          },
        },
      }),
    })

    await openProtonPassImport(page)
    await page.getByTestId('proton-pass-export-file').setInputFiles({
      name: 'Proton Pass_export.zip',
      mimeType: 'application/zip',
      buffer: archive,
    })
    await page.getByTestId('proton-pass-import-submit').click()
    await expect(page.getByTestId('proton-pass-import-result')).toContainText(
      'Imported 2 items',
    )
    await expect(page.getByTestId('proton-pass-import-result')).toContainText(
      '1 unsupported',
    )

    await page.getByTestId('vault-secrets-tab').click()
    await expect(page.getByTestId('vault-group-login')).toContainText(
      'proton-alice',
    )
    await expect(page.getByTestId('vault-group-secure-note')).toContainText(
      'Imported Proton note',
    )

    await openProtonPassImport(page)
    await page.getByTestId('proton-pass-export-file').setInputFiles({
      name: 'Proton Pass_export.zip',
      mimeType: 'application/zip',
      buffer: archive,
    })
    await page.getByTestId('proton-pass-import-submit').click()
    await expect(page.getByTestId('proton-pass-import-result')).toContainText(
      'Imported 0 items',
    )
    await expect(page.getByTestId('proton-pass-import-result')).toContainText(
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

    await openBitwardenImport(page)
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

    await openBitwardenImport(page)
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

    await page.getByTestId('vault-secrets-tab').click()
    await expect(page.getByTestId('secret-row')).toHaveCount(50)
    await expect(page.getByTestId('secret-pagination')).toBeVisible()
    await expect(page.getByText('Page 1 of 26')).toBeVisible()

    await page.getByTestId('secret-page-next').click()
    await expect(page.getByText('Page 2 of 26')).toBeVisible()
    await expect(page.getByTestId('secret-row')).toHaveCount(50)

    await page.getByTestId('search-secrets').fill('bulk-user-1299')
    await expect(
      page.getByTestId('secret-row').filter({ hasText: 'bulk-user-1299' }),
    ).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('secret-pagination')).toHaveCount(0)
  })

  test('decrypts paginated credentials only for reveal or secret copy', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    const items = Array.from({ length: 55 }, (_, index) => ({
      type: 1,
      name: `Demand login ${index}`,
      notes: `private-note-${index}`,
      login: {
        username: `demand-user-${index}`,
        password: `demand-password-${index}`,
        uris: [{ uri: `https://demand-${index}.example` }],
        fido2Credentials: [],
      },
    }))

    await openBitwardenImport(page)
    await page.getByTestId('bitwarden-json-file').setInputFiles({
      name: 'bitwarden_demand_decrypt.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({ encrypted: false, folders: [], items }),
      ),
    })
    await page.getByTestId('bitwarden-import-submit').click()
    await expect(page.getByTestId('bitwarden-import-result')).toContainText(
      'Imported 55 items',
    )
    await page.getByTestId('vault-secrets-tab').click()

    const decryptLogCount = async () => {
      await flushNookLogPersistQueue(page)
      return (
        (await readPersistedAppLogs(page, 1000))?.filter((entry) =>
          entry.message.includes('secret plaintext exposed on demand'),
        ).length ?? 0
      )
    }

    const beforeNavigation = await decryptLogCount()
    await page.getByTestId('secret-page-next').click()
    await expect(page.getByText('Page 2 of 2')).toBeVisible()
    await expect(page.getByTestId('secret-row')).toHaveCount(5)
    await expect(page.getByTestId('secret-page-next')).toBeDisabled()
    await expect(page.getByTestId('secret-page-previous')).toBeEnabled()
    await page.getByTestId('search-secrets').fill('demand-user-54')
    const row = page
      .getByTestId('secret-row')
      .filter({ hasText: 'demand-user-54' })
    await expect(row).toBeVisible()
    await expect.poll(decryptLogCount).toBe(beforeNavigation)

    await row.getByTestId('secret-row-toggle').click()
    await expect(row.getByTestId('revealed-secret')).toContainText('••••')
    await expect(row).not.toContainText('demand-password-54')
    await expect(row).not.toContainText('private-note-54')

    await row.getByTestId('reveal-secret-btn').click()
    await expect(row.getByTestId('revealed-secret')).toContainText(
      'demand-password-54',
    )
    await expect(row).toContainText('private-note-54')
    await expect.poll(decryptLogCount).toBe(beforeNavigation + 1)

    await row.getByTestId('reveal-secret-btn').click()
    await expect(row).not.toContainText('demand-password-54')
    await expect(row).not.toContainText('private-note-54')
    await expect.poll(decryptLogCount).toBe(beforeNavigation + 1)

    await row.getByRole('button', { name: 'Copy secret' }).click()
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe('demand-password-54')
    await expect(row).not.toContainText('demand-password-54')
    await expect.poll(decryptLogCount).toBe(beforeNavigation + 2)

    await row.getByRole('button', { name: 'Copy username' }).click()
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe('demand-user-54')
    await expect.poll(decryptLogCount).toBe(beforeNavigation + 2)
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
