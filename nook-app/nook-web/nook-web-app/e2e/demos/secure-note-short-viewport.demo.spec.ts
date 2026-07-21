import { expect, test } from '../fixtures'
import { connectLocalVault, UI_TIMEOUT_MS } from '../helpers'

const DEMO_BEAT_MS = 700

async function demoBeat(page: Parameters<typeof connectLocalVault>[0]) {
  await page.waitForTimeout(DEMO_BEAT_MS)
}

test('keep secure-note editing usable above a short mobile viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await connectLocalVault(page)
  await demoBeat(page)

  await expect(page.getByTestId('extension-install-setup')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await demoBeat(page)

  await page.getByTestId('add-secret-btn').click()
  await demoBeat(page)
  await page.getByTestId('item-type-secure-note').click()
  await demoBeat(page)

  await expect(page.getByTestId('extension-install-setup')).toHaveCount(0)
  await expect(page.getByTestId('add-secret-cancel-btn')).toBeInViewport()
  await expect(page.getByTestId('save-secret-btn')).toBeInViewport()
  await demoBeat(page)

  await page.getByTestId('secret-label').fill('Travel recovery notes')
  await page
    .getByTestId('secret-value')
    .fill(
      '## Airports\n\n- Keep boarding passes offline\n- Store hotel Wi-Fi codes here',
    )
  await page.getByTestId('secret-value').focus()
  await page.setViewportSize({ width: 390, height: 500 })
  await demoBeat(page)

  await page.getByTestId('markdown-editor').scrollIntoViewIfNeeded()
  await expect(page.getByTestId('extension-install-setup')).toHaveCount(0)
  await expect(page.getByTestId('markdown-editor')).toBeInViewport()
  await expect(page.getByTestId('vault-bottom-nav')).toBeInViewport()
  await demoBeat(page)

  await page.getByTestId('save-secret-btn').click()
  await expect(
    page.getByTestId('secret-row').filter({ hasText: 'Travel recovery notes' }),
  ).toBeVisible({ timeout: UI_TIMEOUT_MS })
  await expect(page.getByTestId('extension-install-setup')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await demoBeat(page)
})
