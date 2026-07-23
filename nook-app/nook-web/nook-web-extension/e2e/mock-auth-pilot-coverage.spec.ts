import { expect, test, type Page } from '@playwright/test'
import {
  launchPairedPinExtension,
  lockExtensionSession,
  saveVaultAuthenticator,
  saveVaultLogin,
  unlockExtensionPopupPin,
} from './helpers/paired-pin-extension'
import { MOCK_AUTH_SECOND_TOTP_SECRET, startMockAuthServer } from './mock-auth'

test.describe('PIN Pilot mock-auth coverage', () => {
  test.describe.configure({ timeout: 180_000 })

  test('shows ordinal login chooser and completes plain success', async ({
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

    const mockAuth = await startMockAuthServer()
    const paired = await launchPairedPinExtension(testInfo, {
      vaultName: 'Mock auth chooser vault',
    })
    try {
      await saveVaultLogin(
        paired.vaultPage,
        mockAuth.origin,
        'alice@nook.test',
        'extension-fill-password',
      )
      await saveVaultLogin(
        paired.vaultPage,
        mockAuth.origin,
        'bob@nook.test',
        'second-extension-password',
      )

      const loginPage = await paired.context.newPage()
      await loginPage.goto(`${mockAuth.origin}/plain/login`)
      const widget = loginPage.locator('#nook-auth-widget')
      await expect(widget.getByText('Ready to sign in')).toBeVisible()
      await widget.getByRole('button', { name: 'Continue with Nook' }).click()
      await expect(widget.getByText('Choose which login to use.')).toBeVisible()
      await expect(widget.getByText('alice@nook.test')).toHaveCount(0)
      await expect(widget.getByText('bob@nook.test')).toHaveCount(0)
      await widget.getByRole('button', { name: 'Saved login 1' }).click()
      await expect(loginPage.getByTestId('mock-auth-success')).toHaveText(
        'Authentication complete',
        { timeout: 20_000 },
      )
    } finally {
      await paired.context.close()
      await mockAuth.close()
    }
  })

  test('surfaces no-match and empty authenticator states', async ({
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

    const mockAuth = await startMockAuthServer()
    const paired = await launchPairedPinExtension(testInfo, {
      vaultName: 'Mock auth empty vault',
    })
    try {
      const loginPage = await paired.context.newPage()
      await loginPage.goto(`${mockAuth.origin}/plain/login`)
      const loginWidget = loginPage.locator('#nook-auth-widget')
      await expect(loginWidget.getByText('Ready to sign in')).toBeVisible()
      await loginWidget
        .getByRole('button', { name: 'Continue with Nook' })
        .click()
      await expect(
        loginWidget.getByText(
          'No saved login matches this site yet. Open the vault to add one.',
        ),
      ).toBeVisible()
      await expect(loginPage.getByTestId('mock-auth-success')).toHaveCount(0)

      const otpPage = await paired.context.newPage()
      await otpPage.goto(`${mockAuth.origin}/otp`)
      const otpWidget = otpPage.locator('#nook-auth-widget')
      const emptyPickerPromise = paired.context.waitForEvent('page')
      await otpWidget.getByRole('button', { name: 'Fill 2FA code' }).click()
      const emptyPicker = await emptyPickerPromise
      await emptyPicker.waitForURL(/intent=authenticator-picker/)
      await expect(
        emptyPicker.getByRole('heading', { name: 'Choose a 2FA code' }),
      ).toBeVisible()
      await expect(
        emptyPicker.getByText('No matching 2FA items.'),
      ).toBeVisible()
      await emptyPicker.close()
    } finally {
      await paired.context.close()
      await mockAuth.close()
    }
  })

  test('fills SPA, hidden-header, and combined login forms to success', async ({
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

    const mockAuth = await startMockAuthServer()
    const paired = await launchPairedPinExtension(testInfo, {
      vaultName: 'Mock auth quirks vault',
    })
    try {
      await saveVaultLogin(
        paired.vaultPage,
        mockAuth.origin,
        'alice@nook.test',
        'extension-fill-password',
      )

      await expectPilotPlainSuccess(
        paired.context,
        `${mockAuth.origin}/spa`,
        async (page) => {
          await page.getByRole('button', { name: 'Next' }).click()
          await expect(
            page.locator('[autocomplete="current-password"]'),
          ).toBeVisible()
        },
      )

      await expectPilotPlainSuccess(
        paired.context,
        `${mockAuth.origin}/login-with-hidden-header`,
      )

      // Combined page: success proves Pilot targeted the login form (signup
      // cannot authenticate against the fixture accounts).
      await expectPilotPlainSuccess(
        paired.context,
        `${mockAuth.origin}/combined`,
      )
    } finally {
      await paired.context.close()
      await mockAuth.close()
    }
  })

  test('does not claim success after wrong-password autofill', async ({
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

    const mockAuth = await startMockAuthServer()
    const paired = await launchPairedPinExtension(testInfo, {
      vaultName: 'Mock auth wrong-password vault',
    })
    try {
      await saveVaultLogin(
        paired.vaultPage,
        mockAuth.origin,
        'alice@nook.test',
        'wrong-password',
      )

      const loginPage = await paired.context.newPage()
      await loginPage.goto(`${mockAuth.origin}/plain/login`)
      const widget = loginPage.locator('#nook-auth-widget')
      await expect(widget.getByText('Ready to sign in')).toBeVisible()
      await widget.getByRole('button', { name: 'Continue with Nook' }).click()
      await expect(loginPage.getByRole('alert')).toHaveText(
        'Invalid username or password.',
        { timeout: 20_000 },
      )
      await expect(loginPage.getByTestId('mock-auth-success')).toHaveCount(0)
      await expect(loginPage).toHaveURL(/\/plain\/login$/)
    } finally {
      await paired.context.close()
      await mockAuth.close()
    }
  })

  test('prompts unlock when locked then resumes Continue with Nook', async ({
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

    const mockAuth = await startMockAuthServer()
    const paired = await launchPairedPinExtension(testInfo, {
      vaultName: 'Mock auth lock vault',
    })
    try {
      await saveVaultLogin(
        paired.vaultPage,
        mockAuth.origin,
        'alice@nook.test',
        'extension-fill-password',
      )

      await lockExtensionSession(paired.context)

      const loginPage = await paired.context.newPage()
      await loginPage.goto(`${mockAuth.origin}/plain/login`)
      const widget = loginPage.locator('#nook-auth-widget')
      await expect(widget.getByText('Ready to sign in')).toBeVisible()
      await widget.getByRole('button', { name: 'Continue with Nook' }).click()
      await expect(
        widget.getByText(
          'Unlock Nook in the companion window, then click Continue with Nook again.',
        ),
      ).toBeVisible({ timeout: 15_000 })

      await unlockExtensionPopupPin(paired.context, paired.extensionId)

      await widget.getByRole('button', { name: 'Continue with Nook' }).click()
      await expect(loginPage.getByTestId('mock-auth-success')).toHaveText(
        'Authentication complete',
        { timeout: 20_000 },
      )
    } finally {
      await paired.context.close()
      await mockAuth.close()
    }
  })

  test('shows multi-authenticator chooser and fills a code', async ({
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

    const mockAuth = await startMockAuthServer()
    const paired = await launchPairedPinExtension(testInfo, {
      vaultName: 'Mock auth multi-2fa vault',
    })
    try {
      await saveVaultAuthenticator(
        paired.vaultPage,
        'Mock Auth Primary',
        'alice-2fa@nook.test',
        'JBSWY3DPEHPK3PXP',
      )
      await saveVaultAuthenticator(
        paired.vaultPage,
        'Mock Auth Secondary',
        'bob-2fa@nook.test',
        MOCK_AUTH_SECOND_TOTP_SECRET,
      )
      await expect(
        paired.vaultPage
          .getByTestId('vault-group-authenticator')
          .getByTestId('secret-row'),
      ).toHaveCount(2)

      const otpPage = await paired.context.newPage()
      await otpPage.goto(`${mockAuth.origin}/otp`)
      const otpWidget = otpPage.locator('#nook-auth-widget')
      await expect(otpWidget.getByText('Fill your 2FA code')).toBeVisible()
      await expect(
        otpWidget.getByRole('button', { name: 'Save backup codes' }),
      ).toBeVisible()
      const pickerPromise = paired.context.waitForEvent('page')
      await otpWidget.getByRole('button', { name: 'Fill 2FA code' }).click()
      const picker = await pickerPromise
      await picker.waitForURL(/intent=authenticator-picker/)
      await expect(
        otpWidget.getByText(
          'Choose a saved 2FA item in the Nook window. You can search all 2FA items in your vault.',
        ),
      ).toBeVisible()
      await expect(otpWidget.getByText('alice-2fa@nook.test')).toHaveCount(0)
      await expect(otpWidget.getByText('bob-2fa@nook.test')).toHaveCount(0)
      await expect(picker.getByText('Mock Auth Primary')).toBeVisible()
      await expect(picker.getByText('Mock Auth Secondary')).toBeVisible()
      await picker.getByTestId('authenticator-search').fill('bob-2fa')
      await expect(picker.getByText('Mock Auth Primary')).toHaveCount(0)
      await picker.getByRole('button', { name: /Mock Auth Secondary/ }).click()
      await expect(
        otpPage.locator('[autocomplete="one-time-code"]'),
      ).toHaveValue(/^\d{6}$/)
      await expect(picker).toBeClosed()
    } finally {
      await paired.context.close()
      await mockAuth.close()
    }
  })
})

async function expectPilotPlainSuccess(
  context: Awaited<ReturnType<typeof launchPairedPinExtension>>['context'],
  url: string,
  beforeContinue?: (page: Page) => Promise<void>,
): Promise<void> {
  const page = await context.newPage()
  await page.goto(url)
  if (beforeContinue) await beforeContinue(page)
  const widget = page.locator('#nook-auth-widget')
  await expect(widget.getByText('Ready to sign in')).toBeVisible()
  await widget.getByRole('button', { name: 'Continue with Nook' }).click()
  await expect(page.getByTestId('mock-auth-success')).toHaveText(
    'Authentication complete',
    { timeout: 20_000 },
  )
  await page.close()
}
