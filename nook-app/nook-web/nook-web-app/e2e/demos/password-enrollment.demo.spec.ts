import { expect, test } from '../fixtures'
import {
  addVaultPassword,
  clearBrowserVault,
  connectLocalVault,
  enrollmentCodeFromLink,
  openOnboardDevicePanel,
  openStorageSettings,
  seedSyncProvidersWhileUnlocked,
  submitOnboardEnrollmentCode,
} from '../helpers'

const DEMO_BEAT_MS = 700
const ENROLLMENT_PASSWORD = 'portable-enrollment-demo'

test('issue a password enrollment link through the portable Rust policy', async ({
  page,
}) => {
  await page.goto('/app/')
  await clearBrowserVault(page)
  await page.reload()
  await connectLocalVault(page)

  await openStorageSettings(page)
  await addVaultPassword(page, 'Second device', ENROLLMENT_PASSWORD)
  await seedSyncProvidersWhileUnlocked(page)
  await page.waitForTimeout(DEMO_BEAT_MS)

  await openOnboardDevicePanel(page)
  await expect(page.getByTestId('onboard-password-entry-list')).toBeVisible()
  const secondDeviceTextOptions: Parameters<typeof page.getByText>[1] = {
    exact: true,
  }
  await expect(
    page.getByText('Second device', secondDeviceTextOptions),
  ).toBeVisible()
  await page.waitForTimeout(DEMO_BEAT_MS)

  const linkInput = await submitOnboardEnrollmentCode(page, ENROLLMENT_PASSWORD)
  const enrollmentLink = (await linkInput.inputValue()).trim()
  expect(enrollmentLink).toContain('#enroll=')
  expect(enrollmentCodeFromLink(enrollmentLink)).toMatch(/^[A-Za-z0-9_-]+$/)
  await expect(page.getByTestId('onboard-link')).toContainText(enrollmentLink)
  await expect(page.getByText('Issued')).toBeVisible()
  await page.waitForTimeout(DEMO_BEAT_MS)
})
