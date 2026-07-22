import { expect, test } from '../fixtures'
import { connectLocalVault, UI_TIMEOUT_MS } from '../helpers'

const DEMO_BEAT_MS = 700

test('choose from the compact secret type picker', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await connectLocalVault(page)
  await page.waitForTimeout(DEMO_BEAT_MS)

  await page.getByTestId('add-secret-btn').click()
  const picker = page.getByTestId('item-type-picker')
  await expect(picker).toBeVisible({ timeout: UI_TIMEOUT_MS })
  await expect(picker.getByRole('button')).toHaveCount(8)
  await expect(page.getByTestId('item-type-passkey')).toBeInViewport()

  const loginBox = await page.getByTestId('item-type-login').boundingBox()
  expect(loginBox).toBeTruthy()
  expect(loginBox?.height).toBeLessThanOrEqual(84)
  await page.waitForTimeout(DEMO_BEAT_MS)
})
