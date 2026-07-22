import { expect, test } from '../fixtures'
import {
  connectLocalVault,
  expandSettingsSection,
  UI_TIMEOUT_MS,
} from '../helpers'

const DEMO_BEAT_MS = 700

test('search a paginated vault through encrypted metadata', async ({
  page,
}) => {
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

  const storedCatalog = await page.evaluate(
    () =>
      new Promise<Array<{ key: string; value: string }>>((resolve, reject) => {
        const request = indexedDB.open('nook_db')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const transaction = request.result.transaction('vault', 'readonly')
          const cursor = transaction.objectStore('vault').openCursor()
          const rows: Array<{ key: string; value: string }> = []
          cursor.onerror = () => reject(cursor.error)
          cursor.onsuccess = () => {
            const current = cursor.result
            if (!current) {
              resolve(rows)
              return
            }
            if (
              typeof current.key === 'string' &&
              (current.key.startsWith('secret_search:') ||
                current.key.startsWith('secret_search_v2:'))
            ) {
              rows.push({ key: current.key, value: String(current.value) })
            }
            current.continue()
          }
        }
      }),
  )
  expect(storedCatalog.length).toBeGreaterThan(0)
  expect(
    storedCatalog.every(({ key }) => key.startsWith('secret_search_v2:')),
  ).toBe(true)
  expect(
    storedCatalog.every(({ value }) =>
      value.includes('-----BEGIN AGE ENCRYPTED FILE-----'),
    ),
  ).toBe(true)
  expect(
    storedCatalog.some(({ value }) => value.includes('demo-user-59')),
  ).toBe(false)

  await page.getByTestId('search-secrets').fill('private-password-59')
  await expect(page.getByTestId('vault-empty-search')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await page.waitForTimeout(DEMO_BEAT_MS)
})
