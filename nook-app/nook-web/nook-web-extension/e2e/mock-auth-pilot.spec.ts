import { expect, test } from '@playwright/test'
import {
  launchPairedPinExtension,
  saveVaultAuthenticator,
  saveVaultLogin,
} from './helpers/paired-pin-extension'
import { startMockAuthServer } from './mock-auth'

test.describe('PIN Pilot against mock auth', () => {
  test.describe.configure({ timeout: 180_000 })

  test('completes plain login through Continue with Nook', async ({
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

    const mockAuth = await startMockAuthServer()
    const paired = await launchPairedPinExtension(testInfo)
    try {
      await saveVaultLogin(
        paired.vaultPage,
        mockAuth.origin,
        'alice@nook.test',
        'extension-fill-password',
      )

      const loginPage = await paired.context.newPage()
      await loginPage.goto(`${mockAuth.origin}/plain/login`)
      const widget = loginPage.locator('#nook-auth-widget')
      await expect(widget.getByText('Ready to sign in')).toBeVisible()
      await expect(
        widget.getByTestId('nook-auth-gate-vault-status'),
      ).toHaveText(/Connected to Mock auth vault/)
      // Single matching login fills and submits without an account chooser.
      await widget.getByRole('button', { name: 'Continue with Nook' }).click()
      await expect(loginPage.getByTestId('mock-auth-success')).toHaveText(
        'Authentication complete',
        { timeout: 20_000 },
      )
      await expect(loginPage.getByTestId('mock-auth-flow')).toHaveText(
        'plain-login',
      )
    } finally {
      await paired.context.close()
      await mockAuth.close()
    }
  })

  test('completes login then 2FA through Pilot', async ({
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

    const mockAuth = await startMockAuthServer()
    const paired = await launchPairedPinExtension(testInfo, {
      vaultName: 'Mock auth 2FA vault',
    })
    try {
      await saveVaultLogin(
        paired.vaultPage,
        mockAuth.origin,
        'alice-2fa@nook.test',
        'extension-fill-password',
      )
      await saveVaultAuthenticator(
        paired.vaultPage,
        'Mock Auth',
        'alice-2fa@nook.test',
        'JBSWY3DPEHPK3PXP',
      )

      const loginPage = await paired.context.newPage()
      await loginPage.goto(`${mockAuth.origin}/totp/login`)
      const loginWidget = loginPage.locator('#nook-auth-widget')
      await expect(loginWidget.getByText('Ready to sign in')).toBeVisible({
        timeout: 20_000,
      })
      await loginWidget
        .getByRole('button', { name: 'Continue with Nook' })
        .click()

      await expect(loginPage).toHaveURL(/\/totp\/verify$/, { timeout: 20_000 })
      const otpWidget = loginPage.locator('#nook-auth-widget')
      await expect(otpWidget.getByText('Fill your 2FA code')).toBeVisible({
        timeout: 15_000,
      })
      const authenticatorPickerPromise = paired.context.waitForEvent('page')
      await otpWidget.getByRole('button', { name: 'Fill 2FA code' }).click()
      const authenticatorPicker = await authenticatorPickerPromise
      await authenticatorPicker.waitForURL(/intent=authenticator-picker/)
      await authenticatorPicker
        .getByRole('button', { name: /Mock Auth/ })
        .click()
      await expect(loginPage.getByTestId('mock-auth-otp-input')).toHaveValue(
        /^\d{6}$/,
      )
      await expect.poll(() => authenticatorPicker.isClosed()).toBe(true)

      await loginPage.getByRole('button', { name: 'Submit' }).click()
      await expect(loginPage.getByTestId('mock-auth-success')).toHaveText(
        'Authentication complete',
        { timeout: 20_000 },
      )
      await expect(loginPage.getByTestId('mock-auth-flow')).toHaveText(
        'login-then-totp',
      )
    } finally {
      await paired.context.close()
      await mockAuth.close()
    }
  })
})
