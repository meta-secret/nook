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

  test('shows extension-owned login picker usernames and completes plain success', async ({
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
      const widget = loginPage.locator('html > aside#nook-auth-widget')
      await expect(widget.getByText('Ready to sign in')).toBeVisible()
      const loginPickerPromise = paired.context.waitForEvent('page')
      await widget.getByRole('button', { name: 'Fill saved login' }).click()
      await expect(
        widget.getByText(
          'Choose a saved username in the Nook window. Matching logins for this site are listed there.',
        ),
      ).toBeVisible()
      await expect(widget.getByText('alice@nook.test')).toHaveCount(0)
      await expect(widget.getByText('bob@nook.test')).toHaveCount(0)
      const loginPicker = await loginPickerPromise
      await loginPicker.waitForURL(/intent=login-picker/)
      await expect(loginPicker.getByText('alice@nook.test')).toBeVisible({
        timeout: 20_000,
      })
      await expect(loginPicker.getByText('bob@nook.test')).toBeVisible()
      await loginPicker
        .getByRole('button', { name: /alice@nook\.test/ })
        .click()
      await expect(loginPage.getByTestId('mock-auth-success')).toHaveText(
        'Authentication complete',
        { timeout: 20_000 },
      )
      await expect.poll(() => loginPicker.isClosed()).toBe(true)
    } finally {
      await paired.context.close()
      await mockAuth.close()
    }
  })

  test('replaces a collapsed login action when QR enrollment appears', async ({
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

    const mockAuth = await startMockAuthServer()
    const paired = await launchPairedPinExtension(testInfo, {
      vaultName: 'Mock auth enrollment transition vault',
    })
    try {
      await saveVaultLogin(
        paired.vaultPage,
        mockAuth.origin,
        'alice@nook.test',
        'extension-fill-password',
      )

      const loginPage = await paired.context.newPage()
      await loginPage.goto(`${mockAuth.origin}/plain/login`)
      const widget = loginPage.locator('html > aside#nook-auth-widget')
      await expect(
        widget.getByRole('button', { name: 'Fill saved login' }),
      ).toBeVisible({ timeout: 20_000 })
      await widget.getByRole('button', { name: 'Collapse Nook' }).click()
      await expect(widget).toHaveAttribute('aria-expanded', 'false')

      await loginPage.evaluate(() => {
        const qr = document.createElement('canvas')
        qr.width = 120
        qr.height = 120
        qr.setAttribute('aria-label', 'Authenticator QR')
        document.querySelector('main')?.append(qr)
      })

      await expect(
        widget.getByRole('button', { name: 'Fill saved login' }),
      ).toHaveCount(0)
      await expect(
        widget.getByRole('button', { name: 'Add 2FA from this page' }),
      ).toBeVisible({ timeout: 20_000 })
      await expect(widget).toHaveAttribute('aria-expanded', 'true')
    } finally {
      await paired.context.close()
      await mockAuth.close()
    }
  })

  test('cancels open login pickers when the authentication context changes', async ({
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

    const mockAuth = await startMockAuthServer()
    const paired = await launchPairedPinExtension(testInfo, {
      vaultName: 'Mock auth checkpoint vault',
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
      const widget = loginPage.locator('html > aside#nook-auth-widget')
      await expect(widget.getByText('Ready to sign in')).toBeVisible()
      const loginPickerPromise = paired.context.waitForEvent('page')
      await widget.getByRole('button', { name: 'Fill saved login' }).click()
      const loginPicker = await loginPickerPromise
      await loginPicker.waitForURL(/intent=login-picker/)
      await expect(loginPicker.getByText('alice@nook.test')).toBeVisible({
        timeout: 20_000,
      })

      await loginPage.evaluate(() => {
        const form = document.querySelector('form')
        if (!form) throw new Error('mock login form missing')
        form.classList.add('validation-ready')
      })

      await expect.poll(() => loginPicker.isClosed()).toBe(true)
      await expect(widget.getByText('Ready to sign in')).toBeVisible({
        timeout: 20_000,
      })
      await expect(widget).not.toHaveAttribute('inert', '')
      await expect(
        widget.getByRole('button', { name: 'Fill saved login' }),
      ).toBeEnabled()
      const viewportPickerPromise = paired.context.waitForEvent('page')
      await widget.getByRole('button', { name: 'Fill saved login' }).click()
      const viewportPicker = await viewportPickerPromise
      await viewportPicker.waitForURL(/intent=login-picker/)
      await expect(viewportPicker.getByText('alice@nook.test')).toBeVisible({
        timeout: 20_000,
      })

      await loginPage.evaluate(() => {
        window.dispatchEvent(new Event('resize'))
      })

      await expect.poll(() => viewportPicker.isClosed()).toBe(true)
      await expect(widget.getByText('Ready to sign in')).toBeVisible({
        timeout: 20_000,
      })
      await expect(widget).not.toHaveAttribute('inert', '')
      await expect(
        widget.getByRole('button', { name: 'Fill saved login' }),
      ).toBeEnabled()
      const hiddenAncestorPickerPromise = paired.context.waitForEvent('page')
      await widget.getByRole('button', { name: 'Fill saved login' }).click()
      const hiddenAncestorPicker = await hiddenAncestorPickerPromise
      await hiddenAncestorPicker.waitForURL(/intent=login-picker/)
      await expect(
        hiddenAncestorPicker.getByText('alice@nook.test'),
      ).toBeVisible({
        timeout: 20_000,
      })

      await loginPage.evaluate(() => {
        const form = document.querySelector('form')
        if (!form?.parentElement)
          throw new Error('mock login form owner missing')
        form.parentElement.hidden = true
      })

      await expect.poll(() => hiddenAncestorPicker.isClosed()).toBe(true)
      await expect(widget).toHaveCount(0, { timeout: 20_000 })
      await loginPage.evaluate(() => {
        const form = document.querySelector('form')
        if (!form?.parentElement)
          throw new Error('mock login form owner missing')
        form.parentElement.hidden = false
      })
      await expect(widget.getByText('Ready to sign in')).toBeVisible({
        timeout: 20_000,
      })
      await expect(widget).not.toHaveAttribute('inert', '')
      await expect(
        widget.getByRole('button', { name: 'Fill saved login' }),
      ).toBeEnabled()
      const checkpointPickerPromise = paired.context.waitForEvent('page')
      await widget.getByRole('button', { name: 'Fill saved login' }).click()
      const checkpointPicker = await checkpointPickerPromise
      await checkpointPicker.waitForURL(/intent=login-picker/)
      await expect(checkpointPicker.getByText('alice@nook.test')).toBeVisible({
        timeout: 20_000,
      })

      await loginPage.evaluate(() => {
        const form = document.querySelector('form')
        if (!form) throw new Error('mock login form missing')
        document.body.id = 'nook-auth-widget'
        if (!form.id) form.id = 'checkpoint-login-form'
        const checkpoint = document.createElement('label')
        checkpoint.setAttribute('data-nook-manual-checkpoint', '')
        const checkbox = document.createElement('input')
        checkbox.type = 'checkbox'
        checkbox.setAttribute('form', form.id)
        checkpoint.append(checkbox, ' I agree to the Terms')
        form.after(checkpoint)
      })

      await expect(widget).toHaveCount(0, { timeout: 20_000 })
      await expect.poll(() => checkpointPicker.isClosed()).toBe(true)
      await expect(loginPage.locator('[autocomplete="username"]')).toHaveValue(
        '',
      )
      await expect(
        loginPage.locator('[autocomplete="current-password"]'),
      ).toHaveValue('')
      await expect(loginPage.getByTestId('mock-auth-success')).toHaveCount(0)
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
      await expect(
        loginWidget.getByTestId('nook-auth-gate-expand'),
      ).toBeVisible()
      await loginWidget.getByTestId('nook-auth-gate-expand').click()
      await expect(loginWidget.getByText('Ready to sign in')).toBeVisible()
      await loginWidget
        .getByRole('button', { name: 'Fill saved login' })
        .click()
      await expect(
        loginWidget.getByText(
          'No saved login matches this site. Add one through Open Simple Vault in the Nook toolbar menu.',
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

  test('fills SPA, hidden-header, Facebook, and combined login forms to success', async ({
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

      // Facebook: aria-hidden ancestor must not block CSS-visible email/pass.
      await expectPilotPlainSuccess(
        paired.context,
        `${mockAuth.origin}/facebook`,
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
      await widget.getByRole('button', { name: 'Fill saved login' }).click()
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

  test('prompts toolbar unlock when locked then resumes Fill saved login', async ({
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

      const loginPage = await paired.context.newPage()
      await loginPage.goto(`${mockAuth.origin}/plain/login`)
      const widget = loginPage.locator('#nook-auth-widget')
      await expect(widget.getByText('Ready to sign in')).toBeVisible()

      await lockExtensionSession(paired.context)
      await expect(widget.getByTestId('nook-auth-gate-expand')).toBeVisible({
        timeout: 20_000,
      })

      await loginPage.reload()
      await expect(widget.getByTestId('nook-auth-gate-expand')).toBeVisible()
      await widget.getByTestId('nook-auth-gate-expand').click()
      await expect(widget.getByText('Ready to sign in')).toBeVisible()
      await widget.getByRole('button', { name: 'Fill saved login' }).click()
      await expect(
        widget.getByText(
          'Open Nook from the browser toolbar, unlock it, then choose Fill saved login again.',
        ),
      ).toBeVisible({ timeout: 15_000 })

      await lockExtensionSession(paired.context)
      await expect(widget.getByTestId('nook-auth-gate-expand')).toBeVisible({
        timeout: 20_000,
      })
      await unlockExtensionPopupPin(paired.context, paired.extensionId)

      await expect(widget.getByText('Ready to sign in')).toBeVisible({
        timeout: 20_000,
      })
      await widget.getByRole('button', { name: 'Fill saved login' }).click()
      await expect(loginPage.getByTestId('mock-auth-success')).toHaveText(
        'Authentication complete',
        { timeout: 20_000 },
      )
    } finally {
      await paired.context.close()
      await mockAuth.close()
    }
  })

  test('rescans when an existing control gains the explicit passkey marker', async ({
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

    const mockAuth = await startMockAuthServer()
    const paired = await launchPairedPinExtension(testInfo, {
      vaultName: 'Mock auth passkey marker vault',
    })
    try {
      const page = await paired.context.newPage()
      await page.goto(`${mockAuth.origin}/plain/login`)
      await page.evaluate(() => {
        document.body.replaceChildren()
        const passkeyControl = document.createElement('button')
        passkeyControl.type = 'button'
        passkeyControl.textContent = 'Continue'
        passkeyControl.dataset.testid = 'dynamic-passkey-control'
        document.body.append(passkeyControl)
      })
      const widget = page.locator('#nook-auth-widget')
      await expect(widget).toHaveCount(0, { timeout: 20_000 })

      await page.getByTestId('dynamic-passkey-control').evaluate((control) => {
        control.setAttribute('data-nook-passkey-control', '')
      })

      await expect(
        widget.getByRole('button', { name: 'Create passkey' }),
      ).toBeVisible({ timeout: 20_000 })
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
      const pickerPromise = paired.context.waitForEvent('page')
      await otpWidget.getByRole('button', { name: 'Fill 2FA code' }).click()
      const picker = await pickerPromise
      await picker.waitForURL(/intent=authenticator-picker/)
      await expect(
        otpWidget.getByText(
          'Choose a saved 2FA item in the Nook window. You can search all 2FA items in your vault.',
        ),
      ).toBeVisible()
      await expect(
        picker.getByTestId('authenticator-destination'),
      ).toContainText(`Code will be filled on ${mockAuth.origin}.`)
      await expect(otpWidget.getByText('alice-2fa@nook.test')).toHaveCount(0)
      await expect(otpWidget.getByText('bob-2fa@nook.test')).toHaveCount(0)
      await expect(picker.getByText('Mock Auth Primary')).toBeVisible()
      await expect(picker.getByText('Mock Auth Secondary')).toBeVisible()

      await otpPage.locator('form').evaluate((form) => {
        form.classList.add('validation-ready')
      })
      await expect.poll(() => picker.isClosed()).toBe(true)
      await expect(otpWidget.getByText('Fill your 2FA code')).toBeVisible({
        timeout: 20_000,
      })
      await expect(
        otpWidget.getByRole('button', { name: 'Fill 2FA code' }),
      ).toBeEnabled()

      const resumedPickerPromise = paired.context.waitForEvent('page')
      await otpWidget.getByRole('button', { name: 'Fill 2FA code' }).click()
      const resumedPicker = await resumedPickerPromise
      await resumedPicker.waitForURL(/intent=authenticator-picker/)
      await resumedPicker.getByTestId('authenticator-search').fill('bob-2fa')
      await expect(resumedPicker.getByText('Mock Auth Primary')).toHaveCount(0)
      await resumedPicker
        .getByRole('button', { name: /Mock Auth Secondary/ })
        .click()
      await expect(
        otpPage.locator('[autocomplete="one-time-code"]'),
      ).toHaveValue(/^\d{6}$/)
      await expect.poll(() => resumedPicker.isClosed()).toBe(true)
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
  await widget.getByRole('button', { name: 'Fill saved login' }).click()
  await expect(page.getByTestId('mock-auth-success')).toHaveText(
    'Authentication complete',
    { timeout: 20_000 },
  )
  await page.close()
}
