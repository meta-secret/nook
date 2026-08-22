import { expect, test } from '../fixtures'
import { connectLocalVault } from '../helpers'

const DEMO_BEAT_MS = 700

test('reach every security guide recommendation in a short vault shell', async ({
  page,
}) => {
  const viewport = { width: 1280, height: 600 }
  await page.setViewportSize(viewport)
  await connectLocalVault(page)

  await page.getByTestId('security-guide-toggle').click()
  await expect(page.getByTestId('security-guide-device')).toBeVisible()
  await page.waitForTimeout(DEMO_BEAT_MS)

  const addDevice = page.getByTestId('security-guide-add-device')
  await addDevice.scrollIntoViewIfNeeded()
  await expect(addDevice).toBeInViewport()
  await expect(page.getByTestId('vault-bottom-nav')).toBeInViewport()
  await page.waitForTimeout(DEMO_BEAT_MS)
})
