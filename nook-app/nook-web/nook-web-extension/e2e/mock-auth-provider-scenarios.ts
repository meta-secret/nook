import { expect, test } from '@playwright/test'

import {
  launchPairedPinExtension,
  saveVaultLogin,
} from './helpers/paired-pin-extension'
import { startMockAuthServer } from './mock-auth'

export class MockAuthProviderScenarios {
  static register(): void {
    this.registerAmazon()
    this.registerLinkedIn()
    this.registerNetflix()
  }

  private static registerAmazon(): void {
    test('fills Amazon identifier', async ({ browserName }, testInfo) => {
      test.skip(
        browserName !== 'chromium',
        'Chrome extensions require Chromium',
      )
      const mockAuth = await startMockAuthServer()
      const paired = await launchPairedPinExtension(testInfo, {
        vaultName: 'Mock Amazon auth vault',
      })
      try {
        await saveVaultLogin(
          paired.vaultPage,
          'https://www.amazon.com',
          'alice@nook.test',
          'extension-fill-password',
        )
        const page = await paired.context.newPage()
        let interceptedAmazonRequestCount = 0
        await page.route('https://www.amazon.com/**', async (route) => {
          interceptedAmazonRequestCount += 1
          const requestedUrl = new URL(route.request().url())
          const localResponse = await page.request.get(
            `${mockAuth.origin}${requestedUrl.pathname}${requestedUrl.search}`,
          )
          await route.fulfill({ response: localResponse })
        })
        const amazonUrl =
          'https://www.amazon.com/ap/signin?openid.mode=checkid_setup&openid.return_to=https%3A%2F%2Fwww.amazon.com%2F'
        await page.goto(amazonUrl)
        expect(interceptedAmazonRequestCount).toBeGreaterThan(0)
        await expect(page).toHaveURL(amazonUrl)
        await expect(page.getByTestId('mock-auth-scenario')).toHaveText(
          'amazon-identifier',
        )
        const form = page.locator('#ap_login_form')
        await expect(form).toHaveAttribute('name', 'signIn')
        await expect(form).toHaveAttribute('method', 'post')
        await expect(form).toHaveAttribute('action', '/ax/claim')
        const email = form.locator('#ap_email_login')
        await expect(email).toHaveAttribute('name', 'email')
        await expect(email).toHaveAttribute('type', 'email')
        await expect(email).toHaveAttribute('autocomplete', 'webauthn')
        await expect(email).toHaveAttribute(
          'aria-label',
          'Enter mobile number or email',
        )
        await expect(email).toHaveValue('')
        const hiddenPassword = form.locator('#auth-credential-autofill-hint')
        await expect(hiddenPassword).toHaveClass(/\baok-hidden\b/u)
        await expect(hiddenPassword).toBeHidden()
        await expect(hiddenPassword).toHaveValue('')
        expect(
          await hiddenPassword.evaluate((field) => ({
            display: getComputedStyle(field).display,
            height: field.getBoundingClientRect().height,
            visibility: getComputedStyle(field).visibility,
            width: field.getBoundingClientRect().width,
          })),
        ).toEqual({
          display: 'none',
          height: 0,
          visibility: 'hidden',
          width: 0,
        })
        await expect(form.locator('input[type="hidden"]')).toHaveCount(2)
        const backdetect = page.locator('form[name="ue_backdetect"]')
        await expect(backdetect).toHaveCount(2)
        expect(
          await backdetect.evaluateAll((forms) =>
            forms.every(
              (form) =>
                form.getAttribute('action') === 'get' &&
                (form as HTMLFormElement).elements.length === 0,
            ),
          ),
        ).toBe(true)
        const continueButton = form.getByRole('button', { name: 'Continue' })
        await expect(continueButton).toHaveAttribute('type', 'submit')
        await expect(
          page.getByText('Create a free business account'),
        ).toBeVisible()
        await expect(page.getByRole('link', { name: 'Help' })).toBeVisible()
        await expect(
          page.getByRole('link', { name: 'Conditions of Use' }),
        ).toBeVisible()
        await expect(
          page.getByRole('link', { name: 'Privacy Notice' }),
        ).toBeVisible()
        const widget = page.locator('#nook-auth-widget')
        await expect(widget.getByText('Ready to sign in')).toBeVisible()
        await expect(
          widget.getByRole('button', { name: /passkey/i }),
        ).toHaveCount(0)
        await widget.getByRole('button', { name: 'Continue with Nook' }).click()
        await expect(page.getByTestId('mock-auth-success')).toHaveText(
          'Authentication complete',
          { timeout: 20_000 },
        )
        await expect
          .poll(() =>
            page.evaluate(
              (key) => sessionStorage.getItem(key) || '',
              'amazon-submission-evidence',
            ),
          )
          .toBe(
            JSON.stringify({
              submittedControl: 'Continue',
              emailMatched: true,
              hiddenPasswordUntouched: true,
              metadataUntouched: true,
              backdetectFormsUntouched: true,
              alternativesUntouched: true,
            }),
          )
        expect(interceptedAmazonRequestCount).toBeGreaterThan(1)
        await page.close()
      } finally {
        await paired.context.close()
        await mockAuth.close()
      }
    })
  }

  private static registerLinkedIn(): void {
    test('fills LinkedIn form-less credentials', async ({
      browserName,
    }, testInfo) => {
      test.skip(
        browserName !== 'chromium',
        'Chrome extensions require Chromium',
      )
      const mockAuth = await startMockAuthServer()
      const paired = await launchPairedPinExtension(testInfo, {
        vaultName: 'Mock LinkedIn auth vault',
      })
      try {
        await saveVaultLogin(
          paired.vaultPage,
          'https://www.linkedin.com',
          'alice@nook.test',
          'extension-fill-password',
        )
        const page = await paired.context.newPage()
        let interceptedLinkedInRequestCount = 0
        await page.route('https://www.linkedin.com/**', async (route) => {
          interceptedLinkedInRequestCount += 1
          const requestedUrl = new URL(route.request().url())
          const localResponse = await page.request.get(
            `${mockAuth.origin}${requestedUrl.pathname}${requestedUrl.search}`,
          )
          await route.fulfill({ response: localResponse })
        })
        await page.goto('https://www.linkedin.com/login/')
        expect(interceptedLinkedInRequestCount).toBeGreaterThan(0)
        await expect(page).toHaveURL('https://www.linkedin.com/login/')
        await expect(page.getByTestId('mock-auth-scenario')).toHaveText(
          'linkedin-combined',
        )
        await expect(page.locator('form')).toHaveCount(0)
        const active = page.getByTestId('linkedin-active-surface')
        const username = active.getByLabel('Email or phone')
        const password = active.getByLabel('Password')
        await expect(username).toHaveAttribute('type', 'email')
        await expect(username).toHaveAttribute('autocomplete', 'username')
        await expect(password).toHaveAttribute('type', 'password')
        await expect(password).toHaveAttribute(
          'autocomplete',
          'current-password',
        )
        expect(
          await active
            .locator('input[type="email"], input[type="password"]')
            .evaluateAll((fields) =>
              fields.every(
                (field) =>
                  !field.hasAttribute('id') && !field.hasAttribute('name'),
              ),
            ),
        ).toBe(true)
        await expect(
          active.getByRole('button', { name: 'Sign in' }),
        ).toHaveAttribute('type', 'button')
        await expect(
          active.getByRole('button', { name: 'Show password' }),
        ).toBeVisible()
        await expect(active.getByLabel('Keep me signed in')).toBeChecked()
        await expect(
          page.getByRole('link', { name: 'Forgot password?' }),
        ).toBeVisible()
        await expect(
          page.getByRole('button', { name: 'Sign in with Apple' }),
        ).toBeVisible()
        await expect(page.getByRole('link', { name: 'Join now' })).toBeVisible()
        await expect(
          page.getByRole('navigation', { name: 'Legal and help' }),
        ).toBeVisible()
        await expect(page.getByLabel('Language')).toBeVisible()
        const duplicate = page.getByTestId('linkedin-responsive-duplicate')
        await expect(duplicate).toBeHidden()
        await expect(duplicate.locator('input')).toHaveCount(2)
        expect(
          await duplicate
            .locator('input')
            .evaluateAll((fields) =>
              fields.map((field) => (field as HTMLInputElement).value),
            ),
        ).toEqual(['', ''])

        const widget = page.locator('#nook-auth-widget')
        await expect(widget.getByText('Ready to sign in')).toBeVisible()
        await widget.getByRole('button', { name: 'Continue with Nook' }).click()
        await expect(page.getByTestId('mock-auth-success')).toHaveText(
          'Authentication complete',
          { timeout: 20_000 },
        )
        await expect
          .poll(() =>
            page.evaluate(
              (key) => sessionStorage.getItem(key) || '',
              'linkedin-submission-evidence',
            ),
          )
          .toBe(
            JSON.stringify({
              visibleCredentialsMatched: true,
              hiddenDuplicateUntouched: true,
              signInActivated: true,
              alternativesUntouched: true,
              keepSignedInUnchanged: true,
            }),
          )
        expect(interceptedLinkedInRequestCount).toBeGreaterThan(1)
        await page.close()
      } finally {
        await paired.context.close()
        await mockAuth.close()
      }
    })
  }

  private static registerNetflix(): void {
    test('fills Netflix credentials and submits only Continue', async ({
      browserName,
    }, testInfo) => {
      test.skip(
        browserName !== 'chromium',
        'Chrome extensions require Chromium',
      )
      const mockAuth = await startMockAuthServer()
      const paired = await launchPairedPinExtension(testInfo, {
        vaultName: 'Mock Netflix auth vault',
      })
      try {
        await saveVaultLogin(
          paired.vaultPage,
          'https://www.netflix.com',
          'alice@nook.test',
          'extension-fill-password',
        )
        const page = await paired.context.newPage()
        let interceptedNetflixRequestCount = 0
        await page.route('https://www.netflix.com/**', async (route) => {
          interceptedNetflixRequestCount += 1
          const requestedUrl = new URL(route.request().url())
          const localResponse = await page.request.get(
            `${mockAuth.origin}${requestedUrl.pathname}${requestedUrl.search}`,
          )
          await route.fulfill({ response: localResponse })
        })
        await page.goto('https://www.netflix.com/login')
        expect(interceptedNetflixRequestCount).toBeGreaterThan(0)
        await expect(page).toHaveURL('https://www.netflix.com/login')
        await expect(page.getByTestId('mock-auth-scenario')).toHaveText(
          'netflix-combined',
        )

        const form = page.getByTestId('netflix-login-form')
        expect(
          await form.evaluate((element) => ({
            actionAttributePresent: element.hasAttribute('action'),
            methodAttribute: element.getAttribute('method'),
            resolvedAction: (element as HTMLFormElement).action,
          })),
        ).toEqual({
          actionAttributePresent: false,
          methodAttribute: 'post',
          resolvedAction: 'https://www.netflix.com/login',
        })
        const username = form.locator('[name="userLoginId"]')
        const password = form.locator('[name="password"]')
        await expect(form.locator('input')).toHaveCount(2)
        await expect(username).toBeVisible()
        await expect(password).toBeVisible()
        await expect(username).toHaveAttribute('type', 'text')
        await expect(username).toHaveAttribute('autocomplete', 'email')
        await expect(username).toHaveAttribute(
          'aria-label',
          'Email or mobile number',
        )
        await expect(password).toHaveAttribute('type', 'password')
        await expect(password).toHaveAttribute('autocomplete', 'password')
        await expect(password).toHaveAttribute('aria-label', 'Password')
        await expect(
          form.getByRole('button', { name: 'Continue' }),
        ).toHaveAttribute('type', 'submit')
        await expect(
          form.getByRole('button', { name: 'Get Help' }),
        ).toHaveAttribute('type', 'button')
        await expect(
          page.getByRole('heading', { name: 'Enter your info to sign in' }),
        ).toBeVisible()
        await expect(
          page.getByRole('heading', {
            name: 'Or get started with a new account.',
          }),
        ).toBeVisible()
        await expect(
          page.getByTestId('netflix-recaptcha-disclosure'),
        ).toBeVisible()
        await expect(
          page.getByRole('link', { name: 'Questions? Contact us.' }),
        ).toBeVisible()
        await expect(page.getByLabel('Language')).toBeVisible()

        const widget = page.locator('#nook-auth-widget')
        await expect(widget.getByText('Ready to sign in')).toBeVisible()
        await widget.getByRole('button', { name: 'Continue with Nook' }).click()
        await expect(page.getByTestId('mock-auth-success')).toHaveText(
          'Authentication complete',
          { timeout: 20_000 },
        )
        await expect
          .poll(() =>
            page.evaluate(
              (key) => sessionStorage.getItem(key) || '',
              'netflix-submission-evidence',
            ),
          )
          .toBe(
            JSON.stringify({
              submittedControl: 'Continue',
              credentialsMatched: true,
              postWithoutAction: true,
              auxiliaryControlsUntouched: true,
            }),
          )
        expect(interceptedNetflixRequestCount).toBeGreaterThan(1)
        await page.close()
      } finally {
        await paired.context.close()
        await mockAuth.close()
      }
    })
  }
}
