import { expect, test } from '../fixtures'
import {
  connectLocalVault,
  expandSettingsSection,
  UI_TIMEOUT_MS,
} from '../helpers'

const DEMO_BEAT_MS = 700

test('browse concise password import source labels', async ({ page }) => {
  await connectLocalVault(page)
  await page.getByTestId('vault-admin-tab').click()
  await expandSettingsSection(page, 'import')

  const sources = [
    ['apple-passwords-import-section', 'Apple Passwords'],
    ['chrome-passwords-import-section', 'Chrome or another browser'],
    ['google-authenticator-import-section', 'Google Authenticator'],
    ['bitwarden-import-section', 'Bitwarden'],
    ['lastpass-import-section', 'LastPass'],
    ['onepassword-import-section', '1Password'],
    ['proton-pass-import-section', 'Proton Pass'],
  ] as const

  for (const [testId, label] of sources) {
    const toggle = page.getByTestId(testId).getByRole('button').first()
    await expect(toggle.getByText(label, { exact: true })).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await expect(toggle).not.toContainText('Import from')
  }

  const bitwardenItems = Array.from({ length: 1_300 }, (_, index) => ({
    type: 1,
    name: `Demo login ${index}`,
    login: {
      username: `demo-user-${index}`,
      password: `demo-password-${index}`,
      uris: [{ uri: `https://demo-${index}.example` }],
      fido2Credentials: [],
    },
  }))
  await page.getByTestId('bitwarden-import-section').getByRole('button').click()
  await page.getByTestId('bitwarden-json-file').setInputFiles({
    name: 'bitwarden_demo_export.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({ encrypted: false, folders: [], items: bitwardenItems }),
    ),
  })
  await page.getByTestId('bitwarden-import-submit').click()
  await expect(page.getByTestId('bitwarden-import-progress')).toBeVisible()

  await page.waitForTimeout(DEMO_BEAT_MS)
})
