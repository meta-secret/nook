import { expect, test } from '../fixtures'
import {
  addVaultPassword,
  clearBrowserVault,
  connectLocalVault,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  expectVaultPasswordStatus,
  openStorageSettings,
  unlockWithCardPassword,
  wipeDeviceIdentity,
} from '../helpers'

const DEMO_BEAT_MS = 700

test('recover a local vault with its backup password after device-key loss', async ({
  page,
}) => {
  await page.goto('/app/')
  await clearBrowserVault(page)
  await page.reload()
  await connectLocalVault(page)
  await openStorageSettings(page)
  await addVaultPassword(page, 'Recovery', 'recovery-pass-99')
  await expectVaultPasswordStatus(page, 1, {
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await page.waitForTimeout(DEMO_BEAT_MS)

  await wipeDeviceIdentity(page)
  await page.reload()
  await expect(page.getByTestId('card-password-unlock-open')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await expect
    .poll(() =>
      page.evaluate(() =>
        ((v) => (v ? v : ''))(
          (
            window as Window & {
              __nookVault?: { deviceId?: string }
            }
          ).__nookVault?.deviceId,
        ),
      ),
    )
    .toBe('')
  await page.waitForTimeout(DEMO_BEAT_MS)

  const joinClose = page.getByTestId('join-enrollment-close')
  if (await joinClose.isVisible()) {
    await joinClose.click()
  }
  // The locked card pairs Unlock with Backup password; the password opens
  // beside the card.
  const directory = process.env.NOOK_DEMO_SCREENSHOT_DIR
  if (directory) {
    await page.screenshot({ path: `${directory}/locked-card.png` })
  }
  await page.getByTestId('card-password-unlock-open').click()
  await expect(page.getByTestId('identity-card-password')).toBeVisible()
  if (directory) {
    await page.screenshot({ path: `${directory}/locked-backup-password.png` })
  }
  await unlockWithCardPassword(page, { password: 'recovery-pass-99' })
  await expect(page.getByTestId('vault-admin-panel')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await expect(page).toHaveURL(/\/identity\/passwords$/)
  await page.waitForTimeout(DEMO_BEAT_MS)
})
