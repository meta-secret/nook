import { expect, test } from './fixtures'
import {
  clearBrowserVault,
  connectLocalVault,
  mockBip39Wordlist,
  openPasswordManagerImport,
  storedZip,
} from './helpers'

test.describe('local vault Apple / Safari imports', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/app/')
    await mockBip39Wordlist(page)
    await clearBrowserVault(page)
    await page.reload()
    await connectLocalVault(page)
  })

  test('imports Safari / Apple Passwords logins and verification codes from CSV', async ({
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

    await openPasswordManagerImport(page, 'apple-passwords')
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

    await openPasswordManagerImport(page, 'apple-passwords')
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

  test('imports Safari browsing-data ZIP passwords', async ({ page }) => {
    const exportCsv = [
      'Title,URL,Username,Password,Notes,OTPAuth',
      [
        '"Imported Safari account"',
        'https://safari-import.example/login',
        'safari-alice',
        'safari-imported-password',
        '"Imported from Safari"',
        '',
      ].join(','),
    ].join('\n')
    const exportZip = storedZip({
      'Bookmarks.html': '<html></html>',
      'Passwords.csv': exportCsv,
      'PaymentCards.json': '{"payment_cards":[]}',
    })

    await openPasswordManagerImport(page, 'apple-passwords')
    await page.getByTestId('apple-passwords-csv-file').setInputFiles({
      name: 'Safari Export.zip',
      mimeType: 'application/zip',
      buffer: exportZip,
    })
    await page.getByTestId('apple-passwords-import-submit').click()
    await expect(
      page.getByTestId('apple-passwords-import-result'),
    ).toContainText('Imported 1 items')

    await page.getByTestId('vault-secrets-tab').click()
    await expect(page.getByTestId('vault-group-login')).toContainText(
      'safari-alice',
    )
  })
})
