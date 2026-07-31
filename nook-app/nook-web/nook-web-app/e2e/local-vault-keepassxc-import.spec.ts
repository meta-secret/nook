import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import {
  clearBrowserVault,
  connectLocalVault,
  expandSettingsSection,
  mockBip39Wordlist,
} from './helpers'

async function openKeePassXcImport(page: Page) {
  await expandSettingsSection(page, 'import')
  const section = page.getByTestId('keepassxc-import-section')
  const toggle = section.getByRole('button').first()
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click()
  }
  await expect(page.getByTestId('keepassxc-import-panel')).toBeVisible()
}

test.describe('local vault KeePassXC import', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/app/')
    await mockBip39Wordlist(page)
    await clearBrowserVault(page)
    await page.reload()
    await connectLocalVault(page)
  })

  test('imports KeePassXC logins and secure notes from CSV idempotently', async ({
    page,
  }) => {
    const exportCsv = [
      'Group,Title,Username,Password,URL,Notes,TOTP',
      'Root/Work,Imported KeePassXC login,keepassxc-alice,keepassxc-secret,https://keepassxc.example/login,"Recovery codes, elsewhere",',
      'Root/Personal,Imported KeePassXC note,,,,"# KeePassXC note\n\nKeep offline",',
    ].join('\n')

    await page.getByTestId('vault-admin-tab').click()
    await openKeePassXcImport(page)
    await page.getByTestId('keepassxc-csv-file').setInputFiles({
      name: 'keepassxc_export.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(exportCsv),
    })
    await page.getByTestId('keepassxc-import-submit').click()
    await expect(page.getByTestId('keepassxc-import-result')).toContainText(
      'Imported 2 items',
    )

    await page.getByTestId('vault-secrets-tab').click()
    await expect(page.getByTestId('vault-group-login')).toContainText(
      'keepassxc-alice',
    )
    await expect(page.getByTestId('vault-group-secure-note')).toContainText(
      'Imported KeePassXC note',
    )

    await page.getByTestId('vault-admin-tab').click()
    await openKeePassXcImport(page)
    await page.getByTestId('keepassxc-csv-file').setInputFiles({
      name: 'keepassxc_export.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(exportCsv),
    })
    await page.getByTestId('keepassxc-import-submit').click()
    await expect(page.getByTestId('keepassxc-import-result')).toContainText(
      'Imported 0 items',
    )
    await expect(page.getByTestId('keepassxc-import-result')).toContainText(
      '2 duplicates',
    )
  })
})
