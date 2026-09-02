import { expect, test } from '../fixtures'

const PUBLIC_SITE_PATH = ((v) => (v ? v : ''))(
  process.env.NOOK_E2E_PUBLIC_SITE_PATH,
)
const DEMO_BEAT_MS = 650

test('public landing modules preserve locale, theme, and install behavior', async ({
  page,
}) => {
  await page.route('**/downloads/extension.json', async (route) => {
    const extensionId = 'abcdefghijklmnopabcdefghijklmnop'
    await route.fulfill({
      json: {
        schema_version: 2,
        channel: 'production',
        version: '1.2.3',
        extension_id: extensionId,
        install_method: 'chrome_web_store',
        install_url: `https://chromewebstore.google.com/detail/${extensionId}`,
      },
    })
  })

  await page.goto(`${PUBLIC_SITE_PATH}/`)
  await expect(page).toHaveTitle('Nook — Keys, not accounts')
  await expect(page.locator('h1')).toHaveText('Keys,not accounts.')
  await expect(page.locator('h1 br')).toHaveCount(1)
  await expect(page.locator('.capsule-stage')).toBeVisible()
  await page.waitForTimeout(DEMO_BEAT_MS)

  await page.locator('[data-locale="ru"]').click()
  await expect(page.locator('h1')).toHaveText('Ключи,не аккаунты.')
  await expect(page.locator('h1 br')).toHaveCount(1)
  await expect(page.locator('.extension-manual code')).toHaveText(
    'chrome://extensions',
  )
  await page.waitForTimeout(DEMO_BEAT_MS)

  await page.getByTestId('landing-theme-toggle').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.waitForTimeout(DEMO_BEAT_MS)

  await page.locator('#browser-extension').scrollIntoViewIfNeeded()
  await expect(page.locator('#browser-extension')).toBeInViewport()
  await expect(page.locator('.extension-install-action')).toHaveText(
    'Добавить в Chrome',
  )
  await expect(page.locator('.extension-install-status')).toHaveText(
    'Канал: production · Версия: 1.2.3',
  )
  await page.waitForTimeout(DEMO_BEAT_MS)

  await page.locator('#cryptography').scrollIntoViewIfNeeded()
  const cryptoTerm = page.locator('.crypto-term').nth(3)
  await cryptoTerm.click()
  await expect(page.locator('.readout-title')).toHaveText(
    await cryptoTerm.innerText(),
  )
  await page.waitForTimeout(DEMO_BEAT_MS)
})
