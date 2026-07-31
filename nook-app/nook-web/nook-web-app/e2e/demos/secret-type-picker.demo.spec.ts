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

  await page.getByTestId('item-type-login').click()
  await expect(page.getByTestId('secret-label')).toBeVisible()
  await expect(page.getByTestId('login-username')).toBeVisible()
  await page.getByTestId('secret-label').fill('https://login.example.com')
  await page.getByTestId('login-username').fill('ada@example.com')
  await page.getByTestId('password-generator-toggle').click()
  await page.getByTestId('generate-password-btn').click()
  await expect(page.getByTestId('secret-value')).not.toHaveValue('')
  await page.waitForTimeout(DEMO_BEAT_MS)

  await page.getByTestId('save-secret-btn').click()
  const saved = page
    .getByTestId('secret-row')
    .filter({ hasText: 'https://login.example.com' })
  await expect(saved).toBeVisible({ timeout: UI_TIMEOUT_MS })
  await expect(saved).toContainText('ada@example.com')
  await page.waitForTimeout(DEMO_BEAT_MS)

  await page.getByTestId('add-secret-btn').click()
  await expect(picker).toBeVisible()
  await expect(picker.getByRole('button')).toHaveCount(8)
  await page.getByTestId('item-type-login').click()
  await expect(page.getByTestId('secret-label')).toBeVisible()
  await page.getByTestId('change-secret-type-btn').click()
  await expect(picker).toBeVisible()
  await page.getByTestId('add-secret-back-btn').click()
  await expect(page.getByTestId('add-secret-panel')).toBeHidden()

  // Re-entering proves the explicit empty -> selected -> empty transition
  // leaves no stale form selection behind.
  await page.getByTestId('add-secret-btn').click()
  await expect(picker).toBeVisible()
  await expect(page.getByTestId('secret-label')).toBeHidden()
  await page.waitForTimeout(DEMO_BEAT_MS)
})
