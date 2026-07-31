import { expect, test } from './fixtures'
import {
  clearBrowserVault,
  connectLocalVault,
  mockBip39Wordlist,
  openPasswordManagerImport,
  storedZip,
} from './helpers'

test.describe('local vault Dashlane import', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/app/')
    await mockBip39Wordlist(page)
    await clearBrowserVault(page)
    await page.reload()
    await connectLocalVault(page)
  })

  test('imports Dashlane credentials and verification codes from CSV', async ({
    page,
  }) => {
    const exportCsv = [
      'username,username2,username3,title,password,note,url,category,otpSecret',
      [
        'dash-alice',
        '',
        '',
        'Imported Dashlane account',
        'dashlane-imported-password',
        'Imported from Dashlane',
        'https://dashlane-import.example/login',
        'Work',
        'JBSWY3DPEHPK3PXP',
      ].join(','),
    ].join('\n')

    await openPasswordManagerImport(page, 'dashlane')
    await page.getByTestId('dashlane-export-file').setInputFiles({
      name: 'credentials.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(exportCsv),
    })
    await page.getByTestId('dashlane-import-submit').click()
    await expect(page.getByTestId('dashlane-import-result')).toContainText(
      'Imported 2 items',
    )

    await page.getByTestId('vault-secrets-tab').click()
    await expect(page.getByTestId('vault-group-login')).toContainText(
      'dash-alice',
    )
    await expect(page.getByTestId('vault-group-authenticator')).toContainText(
      'dash-alice',
    )

    await openPasswordManagerImport(page, 'dashlane')
    await page.getByTestId('dashlane-export-file').setInputFiles({
      name: 'credentials.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(exportCsv),
    })
    await page.getByTestId('dashlane-import-submit').click()
    await expect(page.getByTestId('dashlane-import-result')).toContainText(
      'Imported 0 items',
    )
    await expect(page.getByTestId('dashlane-import-result')).toContainText(
      '2 duplicates',
    )
  })

  test('imports Dashlane notes and credit cards from ZIP', async ({ page }) => {
    const credentials = [
      'username,title,password,note,url,category,otpUrl',
      'bob,GitHub,pass,,https://github.com,,',
    ].join('\n')
    const notes = ['title,note', 'Private,"Keep offline"'].join('\n')
    const payments = [
      'type,account_name,account_holder,cc_number,code,expiration_month,expiration_year',
      'credit_card,Travel,Ada Lovelace,4111111111111111,123,12,2030',
      'bank,Checking,Ada,999,,,',
    ].join('\n')
    const exportZip = storedZip({
      'credentials.csv': credentials,
      'securenotes.csv': notes,
      'payments.csv': payments,
    })

    await openPasswordManagerImport(page, 'dashlane')
    await page.getByTestId('dashlane-export-file').setInputFiles({
      name: 'dashlane-export.zip',
      mimeType: 'application/zip',
      buffer: exportZip,
    })
    await page.getByTestId('dashlane-import-submit').click()
    await expect(page.getByTestId('dashlane-import-result')).toContainText(
      'Imported 3 items',
    )
    await expect(page.getByTestId('dashlane-import-result')).toContainText(
      '1 unsupported',
    )

    await page.getByTestId('vault-secrets-tab').click()
    await expect(page.getByTestId('vault-group-login')).toContainText('bob')
    await expect(page.getByTestId('vault-group-secure-note')).toContainText(
      'Private',
    )
    await expect(page.getByTestId('vault-group-credit-card')).toContainText(
      'Travel',
    )
  })
})
