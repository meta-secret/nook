import { expect, test } from '../fixtures'
import {
  clearBrowserVault,
  connectLocalVault,
  enrollmentCodeFromLink,
  openOnboardDevicePanel,
  seedSyncProvidersWhileUnlocked,
  submitOnboardEnrollmentCode,
} from '../helpers'

const DEMO_BEAT_MS = 700
const IDENTITY_PASSPHRASE = 'portable-identity-demo'

test('issue an identity enrollment link through the portable Rust policy', async ({
  page,
}) => {
  await page.goto('/app/')
  await clearBrowserVault(page)
  await page.reload()
  await connectLocalVault(page)

  await seedSyncProvidersWhileUnlocked(page)
  await page.waitForTimeout(DEMO_BEAT_MS)

  await openOnboardDevicePanel(page)
  await expect(page.getByTestId('onboard-provider-list')).toBeVisible()
  await page.waitForTimeout(DEMO_BEAT_MS)

  const linkInput = await submitOnboardEnrollmentCode(page, IDENTITY_PASSPHRASE)
  const enrollmentLink = (await linkInput.inputValue()).trim()
  expect(enrollmentLink).toContain('#enroll=')
  expect(enrollmentCodeFromLink(enrollmentLink)).toMatch(/^[A-Za-z0-9_-]+$/)
  await expect(page.getByTestId('onboard-link')).toContainText(enrollmentLink)
  await expect(page.getByText('Issued')).toBeVisible()
  await page.waitForTimeout(DEMO_BEAT_MS)
})
