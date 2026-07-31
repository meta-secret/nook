import { expect, test } from './fixtures'
import {
  clearBrowserVault,
  connectLocalVault,
  mockBip39Wordlist,
  openPasswordManagerImport,
} from './helpers'

test.describe('local vault Keeper import', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/app/')
    await mockBip39Wordlist(page)
    await clearBrowserVault(page)
    await page.reload()
    await connectLocalVault(page)
  })

  test('imports Keeper logins and secure notes from CSV idempotently', async ({
    page,
  }) => {
    const exportCsv = [
      'Folder,Title,Login,Password,Website Address,Notes,Shared Folder,Custom Field1 Name,Custom Field1 Value',
      'Work,Imported Keeper login,keeper-alice,keeper-secret,https://keeper.example/login,Recovery codes,,$oneTimeCode,otpauth://totp/Keeper?secret=ABC',
      'Personal,Imported Keeper note,,,,"# Keeper note\n\nKeep offline",Team,,',
    ].join('\n')

    await openPasswordManagerImport(page, 'keeper')
    await page.getByTestId('keeper-csv-file').setInputFiles({
      name: 'keeper_export.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(exportCsv),
    })
    await page.getByTestId('keeper-import-submit').click()
    await expect(page.getByTestId('keeper-import-result')).toContainText(
      'Imported 2 items',
    )

    await page.getByTestId('vault-secrets-tab').click()
    await expect(page.getByTestId('vault-group-login')).toContainText(
      'keeper-alice',
    )
    await expect(page.getByTestId('vault-group-secure-note')).toContainText(
      'Imported Keeper note',
    )

    await openPasswordManagerImport(page, 'keeper')
    await page.getByTestId('keeper-csv-file').setInputFiles({
      name: 'keeper_export.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(exportCsv),
    })
    await page.getByTestId('keeper-import-submit').click()
    await expect(page.getByTestId('keeper-import-result')).toContainText(
      'Imported 0 items',
    )
    await expect(page.getByTestId('keeper-import-result')).toContainText(
      '2 duplicates',
    )
  })
})
