import { expect, test } from '../fixtures'
import { connectLocalVault, UI_TIMEOUT_MS } from '../helpers'

const DEMO_BEAT_MS = 700

async function demoBeat(page: Parameters<typeof connectLocalVault>[0]) {
  await page.waitForTimeout(DEMO_BEAT_MS)
}

test('add a two-factor authenticator and reveal its current code', async ({
  page,
}) => {
  await connectLocalVault(page)
  await demoBeat(page)

  await page.getByTestId('add-secret-btn').click()
  await demoBeat(page)
  await page.getByTestId('item-type-authenticator').click()
  await demoBeat(page)

  await page.getByTestId('authenticator-issuer').fill('OpenAI')
  await page.getByTestId('authenticator-account').fill('demo.user@example.com')
  await page
    .getByTestId('authenticator-website')
    .fill('https://chatgpt.com/auth')
  await page.getByTestId('authenticator-secret').fill('JBSWY3DPEHPK3PXP')
  await demoBeat(page)

  await page.getByTestId('save-secret-btn').click()
  const group = page
    .getByTestId('vault-site-group')
    .filter({ hasText: 'chatgpt.com' })
  await expect(group).toBeVisible({ timeout: UI_TIMEOUT_MS })
  const row = group
    .getByTestId('secret-row')
    .filter({ hasText: 'demo.user@example.com' })
  await expect(row).toBeVisible({ timeout: UI_TIMEOUT_MS })
  await demoBeat(page)

  await row.getByTestId('secret-row-toggle').click()
  await demoBeat(page)
  await expect(row.getByTestId('authenticator-website')).toContainText(
    'https://chatgpt.com/auth',
  )
  await row.getByTestId('reveal-secret-btn').click()
  await expect(row.getByTestId('authenticator-current-code')).toHaveText(
    /^\d{6}$/,
    { timeout: UI_TIMEOUT_MS },
  )
  await demoBeat(page)
})
