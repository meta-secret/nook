import { expect, test } from '../fixtures'
import { connectLocalVault, UI_TIMEOUT_MS } from '../helpers'

const DEMO_BEAT_MS = 700

async function demoBeat(page: Parameters<typeof connectLocalVault>[0]) {
  await page.waitForTimeout(DEMO_BEAT_MS)
}

test('add a credit card and reveal the card number', async ({ page }) => {
  await connectLocalVault(page)
  await demoBeat(page)

  await page.getByTestId('add-secret-btn').click()
  await demoBeat(page)
  await page.getByTestId('item-type-credit-card').click()
  await demoBeat(page)

  await page.getByTestId('secret-label').fill('Personal Visa')
  await page.getByTestId('credit-card-cardholder').fill('Ada Lovelace')
  await page.getByTestId('credit-card-number').fill('4111111111111111')
  await page.getByTestId('credit-card-exp-month').fill('12')
  await page.getByTestId('credit-card-exp-year').fill('2030')
  await page.getByTestId('credit-card-cvv').fill('123')
  await demoBeat(page)

  await page.getByTestId('save-secret-btn').click()
  const row = page
    .getByTestId('secret-row')
    .filter({ hasText: 'Personal Visa' })
  await expect(row).toBeVisible({ timeout: UI_TIMEOUT_MS })
  await expect(row).toContainText('1111')
  await demoBeat(page)

  await row.getByTestId('secret-row-toggle').click()
  await demoBeat(page)
  await row.getByTestId('reveal-secret-btn').click()
  await expect(row.getByTestId('credit-card-number-value')).toContainText(
    '4111111111111111',
    { timeout: UI_TIMEOUT_MS },
  )
  await expect(row.getByTestId('credit-card-cvv-value')).toContainText('123')
  await demoBeat(page)
})
