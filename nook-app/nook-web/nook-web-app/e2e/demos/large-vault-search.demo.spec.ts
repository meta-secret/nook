import { expect, test } from '../fixtures'
import {
  connectLocalVault,
  expandSettingsSection,
  UI_TIMEOUT_MS,
} from '../helpers'

const DEMO_BEAT_MS = 700

test('search a paginated vault through public metadata', async ({ page }) => {
  test.setTimeout(60_000)
  await connectLocalVault(page)
  await expandSettingsSection(page, 'import')

  const bitwardenSection = page.getByTestId('bitwarden-import-section')
  const toggle = bitwardenSection.getByRole('button').first()
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click()
  }

  const items = Array.from({ length: 60 }, (_, index) => ({
    type: 1,
    name: `Search demo ${index}`,
    notes: '',
    login: {
      username: `demo-user-${index}`,
      password: `private-password-${index}`,
      uris: [{ uri: `https://demo-${index}.example` }],
      fido2Credentials: [],
    },
  }))
  await page.getByTestId('bitwarden-json-file').setInputFiles({
    name: 'large_vault_search_demo.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({ encrypted: false, folders: [], items }),
    ),
  })
  await page.getByTestId('bitwarden-import-submit').click()
  await expect(page.getByTestId('bitwarden-import-result')).toContainText(
    'Imported 60 items',
    { timeout: 30_000 },
  )

  await page.getByTestId('vault-secrets-tab').click()
  await expect(page.getByText('Page 1 of 2')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await page.waitForTimeout(DEMO_BEAT_MS)

  await page.getByTestId('search-secrets').fill('demo-user-59')
  await expect(
    page.getByTestId('secret-row').filter({ hasText: 'demo-user-59' }),
  ).toBeVisible({ timeout: UI_TIMEOUT_MS })
  await expect(page.getByTestId('secret-pagination')).toHaveCount(0)
  await page.waitForTimeout(DEMO_BEAT_MS)

  await page.getByTestId('search-secrets').fill('private-password-59')
  await expect(page.getByTestId('vault-empty-search')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await page.waitForTimeout(DEMO_BEAT_MS)
})
