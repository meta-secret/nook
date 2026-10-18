import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '../fixtures'
import {
  connectLocalVault,
  expandSettingsSection,
  UI_TIMEOUT_MS,
  openManagePage,
  ManagePage,
} from '../helpers'

const DEMO_BEAT_MS = 700
const demoDir = path.dirname(fileURLToPath(import.meta.url))
const exportQrImages = [
  'fixtures/google-authenticator-export-demo-1-of-2.png',
  'fixtures/google-authenticator-export-demo-2-of-2.png',
].map((fixture) => path.join(demoDir, fixture))

test('import a two-part Google Authenticator export by choosing both QR images at once', async ({
  page,
}) => {
  await connectLocalVault(page)
  await openManagePage(page, ManagePage.Import)
  await expandSettingsSection(page, 'import')

  await page
    .getByTestId('google-authenticator-import-section')
    .getByRole('button')
    .first()
    .click()
  await expect(
    page.getByTestId('google-authenticator-import-panel'),
  ).toBeVisible({ timeout: UI_TIMEOUT_MS })

  await page
    .getByTestId('google-authenticator-qr-image')
    .setInputFiles(exportQrImages)
  await expect(
    page.getByTestId('google-authenticator-scanned-count'),
  ).toContainText('QR codes scanned: 2', { timeout: UI_TIMEOUT_MS })
  await page.waitForTimeout(DEMO_BEAT_MS)

  await page.getByTestId('google-authenticator-import-submit').click()
  const result = page.getByTestId('google-authenticator-import-result')
  await expect(result).toBeVisible({ timeout: UI_TIMEOUT_MS })
  await expect(result).toContainText('Imported 4 verification codes.')

  await page.waitForTimeout(DEMO_BEAT_MS)
})
