import { expect, test } from '../fixtures'
import { UnlockMethod } from '$lib/components/login/login-unlock-state'
import {
  addVaultPassword,
  clearBrowserVault,
  connectLocalVault,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  openStorageSettings,
  selectLoginUnlockMethod,
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
  await page.waitForTimeout(DEMO_BEAT_MS)

  await wipeDeviceIdentity(page)
  await page.reload()
  await expect(page.getByTestId('login-local-unlock-step')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __nookVault?: { deviceId?: string }
            }
          ).__nookVault?.deviceId ?? '',
      ),
    )
    .toBe('')
  await page.waitForTimeout(DEMO_BEAT_MS)

  const joinClose = page.getByTestId('join-enrollment-close')
  if (await joinClose.isVisible()) {
    await joinClose.click()
  }
  await selectLoginUnlockMethod(page, UnlockMethod.Password)
  await page
    .getByTestId('login-password-entry-list')
    .getByRole('button', { name: 'Recovery' })
    .click()
  await page.getByTestId('login-password-input').fill('recovery-pass-99')
  await page.getByTestId('unlock-vault-btn').click()
  await expect(page.getByTestId('vault-admin-panel')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await expect(page).toHaveURL(/\/admin$/)
  await page.waitForTimeout(DEMO_BEAT_MS)
})
