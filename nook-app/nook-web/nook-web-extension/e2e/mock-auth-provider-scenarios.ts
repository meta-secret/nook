import { expect, test } from '@playwright/test'

import {
  launchPairedPinExtension,
  saveVaultLogin,
} from './helpers/paired-pin-extension'
import { startMockAuthServer } from './mock-auth'
import {
  AirbnbAuthControl,
  AirbnbAuthIdentityMatch,
  AirbnbAuthInteractionState,
} from './mock-auth/src/lib/airbnb-auth-flow'
import {
  BookingAuthControl,
  BookingAuthEmailMatch,
  BookingAuthInteractionState,
  BookingAuthPrimaryActivationState,
} from './mock-auth/src/lib/booking-auth-flow'
import {
  ClaudeAuthControl,
  ClaudeAuthEmailMatch,
  ClaudeAuthFormActionKind,
  ClaudeAuthFormMethod,
  ClaudeAuthInteractionState,
} from './mock-auth/src/lib/claude-auth-flow'
import {
  TeslaAuthControl,
  TeslaAuthEmailMatch,
  TeslaAuthPrimaryActivationState,
} from './mock-auth/src/lib/tesla-auth-flow'

enum SubmissionEvidencePollKind {
  Absent = 'absent',
  Present = 'present',
}

type SubmissionEvidencePollState =
  | { readonly kind: SubmissionEvidencePollKind.Absent }
  | {
      readonly kind: SubmissionEvidencePollKind.Present
      readonly value: string
    }

type SubmissionEvidencePollRequest = {
  readonly key: string
  readonly absentKind: SubmissionEvidencePollKind.Absent
  readonly presentKind: SubmissionEvidencePollKind.Present
}

export class MockAuthProviderScenarios {
  static register(): void {
    this.registerAmazon()
    this.registerLinkedIn()
    this.registerNetflix()
    this.registerClaude()
    this.registerBooking()
    this.registerTesla()
    this.registerAirbnb()
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

  private static registerClaude(): void {
    test('fills Claude email and submits only Continue with email', async ({
      browserName,
    }, testInfo) => {
      test.skip(
        browserName !== 'chromium',
        'Chrome extensions require Chromium',
      )
      const mockAuth = await startMockAuthServer()
      const paired = await launchPairedPinExtension(testInfo, {
        vaultName: 'Mock Claude auth vault',
      })
      try {
        await saveVaultLogin(
          paired.vaultPage,
          'https://claude.ai',
          'alice@nook.test',
          'extension-fill-password',
        )
        const page = await paired.context.newPage()
        let interceptedClaudeRequestCount = 0
        await page.route('https://claude.ai/**', async (route) => {
          interceptedClaudeRequestCount += 1
          const requestedUrl = new URL(route.request().url())
          const localResponse = await page.request.get(
            `${mockAuth.origin}${requestedUrl.pathname}${requestedUrl.search}`,
          )
          await route.fulfill({ response: localResponse })
        })
        await page.goto('https://claude.ai/login')
        expect(interceptedClaudeRequestCount).toBeGreaterThan(0)
        await expect(page).toHaveURL('https://claude.ai/login')
        await expect(page).toHaveTitle('Sign in - Claude')
        await expect(page.getByTestId('mock-auth-scenario')).toHaveText(
          'claude-email-first',
        )

        const form = page.getByTestId('claude-email-form')
        await expect(form).not.toHaveAttribute('action')
        await expect(form).toHaveAttribute('method', 'post')
        expect(
          await form.evaluate((element) => (element as HTMLFormElement).action),
        ).toBe('https://claude.ai/login')
        const email = form.getByLabel('Email')
        await expect(form.locator('input')).toHaveCount(1)
        await expect(email).toHaveAttribute('type', 'email')
        await expect(email).toHaveAttribute('name', 'email')
        await expect(email).toHaveAttribute('autocomplete', 'email')
        await expect(email).toHaveValue('')
        await expect(
          form.getByRole('button', { name: 'Continue with email' }),
        ).toHaveAttribute('type', 'submit')
        const google = page.getByRole('button', {
          name: 'Continue with Google',
        })
        const sso = page.getByRole('button', { name: 'Continue with SSO' })
        await expect(google).toHaveAttribute('type', 'button')
        await expect(sso).toHaveAttribute('type', 'button')
        expect(
          await google.evaluate(
            (button) => !(button as HTMLButtonElement).form,
          ),
        ).toBe(true)
        expect(
          await sso.evaluate((button) => !(button as HTMLButtonElement).form),
        ).toBe(true)
        await expect(page.getByText('or', { exact: true })).toBeVisible()
        await expect(page.getByTestId('claude-disclosure')).toBeVisible()
        await expect(
          page.getByRole('navigation', { name: 'Claude' }),
        ).toBeVisible()

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
              'claude-submission-evidence',
            ),
          )
          .toBe(
            JSON.stringify({
              submittedControl: ClaudeAuthControl.ContinueWithEmail,
              emailMatch: ClaudeAuthEmailMatch.Matched,
              formMethod: ClaudeAuthFormMethod.Post,
              formAction: ClaudeAuthFormActionKind.Omitted,
              googleInteraction: ClaudeAuthInteractionState.Untouched,
              ssoInteraction: ClaudeAuthInteractionState.Untouched,
              disclosureInteraction: ClaudeAuthInteractionState.Untouched,
              marketingInteraction: ClaudeAuthInteractionState.Untouched,
            }),
          )
        expect(interceptedClaudeRequestCount).toBeGreaterThan(1)
        await page.close()
      } finally {
        await paired.context.close()
        await mockAuth.close()
      }
    })
  }

  private static registerBooking(): void {
    test('fills Booking.com email and activates only Continue with email', async ({
      browserName,
    }, testInfo) => {
      test.skip(
        browserName !== 'chromium',
        'Chrome extensions require Chromium',
      )
      const mockAuth = await startMockAuthServer()
      const paired = await launchPairedPinExtension(testInfo, {
        vaultName: 'Mock Booking.com auth vault',
      })
      try {
        await saveVaultLogin(
          paired.vaultPage,
          'https://account.booking.com',
          'alice@nook.test',
          'extension-fill-password',
        )
        const page = await paired.context.newPage()
        let interceptedBookingRequestCount = 0
        await page.route('https://account.booking.com/**', async (route) => {
          interceptedBookingRequestCount += 1
          const requestedUrl = new URL(route.request().url())
          const localResponse = await page.request.get(
            `${mockAuth.origin}${requestedUrl.pathname}${requestedUrl.search}`,
          )
          await route.fulfill({ response: localResponse })
        })
        await page.goto('https://account.booking.com/sign-in')
        expect(interceptedBookingRequestCount).toBeGreaterThan(0)
        await expect(page).toHaveURL('https://account.booking.com/sign-in')
        await expect(page).toHaveTitle(
          'Sign in or create an account | Booking.com',
        )
        await expect(page.getByTestId('mock-auth-scenario')).toHaveText(
          'booking-email-first',
        )

        const surface = page.getByTestId('booking-email-surface')
        const form = page.getByTestId('booking-auth-form')
        const email = surface.getByLabel('Email address')
        const primary = surface.getByRole('button', {
          name: 'Continue with email',
        })
        await expect(page.locator('form')).toHaveCount(1)
        await expect(form).not.toHaveAttribute('method')
        await expect(form).not.toHaveAttribute('action')
        await expect(form).toHaveJSProperty('method', 'get')
        await expect(form).toHaveJSProperty(
          'action',
          'https://account.booking.com/sign-in',
        )
        await expect(surface.locator('input')).toHaveCount(1)
        await expect(email).toHaveAttribute('name', 'username')
        await expect(email).toHaveAttribute('type', 'email')
        await expect(email).toHaveAttribute('autocomplete', 'username webauthn')
        await expect(email).toHaveAttribute(
          'placeholder',
          'Enter your email address',
        )
        await expect(primary).toHaveAttribute('type', 'submit')
        await expect(primary).not.toHaveAttribute('formaction')
        await expect(form.locator('button[type="submit"]')).toHaveCount(1)
        await expect(email).toHaveValue('')
        await expect(page.locator('input[type="password"]')).toHaveCount(0)
        for (const [name, href] of [
          ['Sign in with Google', '/social/consent/google'],
          ['Sign in with Apple', '/social/consent/apple'],
          ['Sign in with Facebook', '/social/consent/facebook'],
        ] as const) {
          await expect(page.getByRole('link', { name })).toHaveAttribute(
            'href',
            href,
          )
          await expect(form.getByRole('link', { name })).toHaveCount(1)
        }
        await expect(
          page.getByRole('link', { name: 'Recover your account' }),
        ).toBeVisible()
        await expect(
          form.getByRole('link', { name: 'Recover your account' }),
        ).toHaveCount(1)
        await expect(page.getByTestId('booking-disclosure')).toBeVisible()
        await expect(
          page.getByRole('link', { name: 'Help and support' }),
        ).toBeVisible()
        await expect(
          page.getByRole('button', { name: 'Select your language' }),
        ).toBeVisible()

        const widget = page.locator('#nook-auth-widget')
        await expect(widget.getByText('Ready to sign in')).toBeVisible()
        await widget.getByRole('button', { name: 'Continue with Nook' }).click()
        await expect(page.getByTestId('mock-auth-success')).toHaveText(
          'Authentication complete',
          { timeout: 20_000 },
        )
        await expect
          .poll(() =>
            page.evaluate<
              SubmissionEvidencePollState,
              SubmissionEvidencePollRequest
            >(
              ({ key, absentKind, presentKind }) => {
                for (const [entryKey, value] of Object.entries(
                  sessionStorage,
                )) {
                  if (entryKey === key) {
                    return { kind: presentKind, value }
                  }
                }
                return { kind: absentKind }
              },
              {
                key: 'booking-submission-evidence',
                absentKind: SubmissionEvidencePollKind.Absent,
                presentKind: SubmissionEvidencePollKind.Present,
              },
            ),
          )
          .toEqual({
            kind: SubmissionEvidencePollKind.Present,
            value: JSON.stringify({
              submittedControl: BookingAuthControl.ContinueWithEmail,
              emailMatch: BookingAuthEmailMatch.Matched,
              primaryActivation: BookingAuthPrimaryActivationState.Activated,
              googleInteraction: BookingAuthInteractionState.Untouched,
              appleInteraction: BookingAuthInteractionState.Untouched,
              facebookInteraction: BookingAuthInteractionState.Untouched,
              recoveryInteraction: BookingAuthInteractionState.Untouched,
              brandInteraction: BookingAuthInteractionState.Untouched,
              disclosureInteraction: BookingAuthInteractionState.Untouched,
              helpInteraction: BookingAuthInteractionState.Untouched,
              languageInteraction: BookingAuthInteractionState.Untouched,
            }),
          })
        expect(interceptedBookingRequestCount).toBeGreaterThan(1)
        await page.close()
      } finally {
        await paired.context.close()
        await mockAuth.close()
      }
    })
  }

  private static registerTesla(): void {
    test('fills Tesla Email and activates only Next', async ({
      browserName,
    }, testInfo) => {
      test.skip(
        browserName !== 'chromium',
        'Chrome extensions require Chromium',
      )
      const mockAuth = await startMockAuthServer()
      const paired = await launchPairedPinExtension(testInfo, {
        vaultName: 'Mock Tesla auth vault',
      })
      try {
        await saveVaultLogin(
          paired.vaultPage,
          'https://auth.tesla.com',
          'alice@nook.test',
          'extension-fill-password',
        )
        const page = await paired.context.newPage()
        let interceptedTeslaRequestCount = 0
        const forbiddenAuthenticationRequests: string[] = []
        page.on('request', (request) => {
          const url = request.url()
          if (
            /hcaptcha\.com|captcha|accounts\.google|appleid|facebook/u.test(url)
          ) {
            forbiddenAuthenticationRequests.push(url)
          }
        })
        await page.route('https://auth.tesla.com/**', async (route) => {
          interceptedTeslaRequestCount += 1
          const requestedUrl = new URL(route.request().url())
          const localResponse = await page.request.get(
            `${mockAuth.origin}${requestedUrl.pathname}${requestedUrl.search}`,
          )
          await route.fulfill({ response: localResponse })
        })
        const teslaUrl = 'https://auth.tesla.com/oauth2/v1/authorize'
        await page.goto(teslaUrl)
        expect(interceptedTeslaRequestCount).toBeGreaterThan(0)
        await expect(page).toHaveURL(teslaUrl)
        await expect(page).toHaveTitle('Tesla Auth - Sign In')
        await expect(page.getByTestId('mock-auth-scenario')).toHaveText(
          'tesla-email-first',
        )

        const form = page.getByTestId('tesla-auth-form')
        const email = form.getByLabel('Email')
        const next = form.getByRole('button', { name: 'Next' })
        await expect(page.locator('form')).toHaveCount(1)
        await expect(form).not.toHaveAttribute('method')
        await expect(form).not.toHaveAttribute('action')
        await expect(form).toHaveJSProperty('method', 'get')
        await expect(form).toHaveJSProperty('action', teslaUrl)
        await expect(form.locator('input')).toHaveCount(1)
        await expect(email).not.toHaveAttribute('type')
        await expect(email).toHaveJSProperty('type', 'text')
        await expect(email).toHaveAttribute('name', 'identity')
        await expect(email).toHaveAttribute('autocomplete', 'email webauthn')
        await expect(email).toHaveValue('')
        await expect(next).toHaveAttribute('type', 'submit')
        await expect(next).not.toHaveAttribute('formaction')
        await expect(next).toBeDisabled()
        await expect(form.locator('button[type="submit"]')).toHaveCount(1)
        await expect(page.locator('input[type="password"]')).toHaveCount(0)
        await expect(page.getByText('Trouble Signing In?')).toBeVisible()
        await expect(
          page.getByRole('button', { name: 'Create Account' }),
        ).toHaveAttribute('type', 'button')
        await expect(
          page.getByRole('button', { name: 'Select Language' }),
        ).toBeVisible()
        await expect(
          page.getByRole('link', { name: 'Tesla home' }),
        ).toBeVisible()
        await expect(page.getByRole('link', { name: 'Privacy' })).toBeVisible()
        await expect(page.getByRole('link', { name: 'Contact' })).toBeVisible()
        await expect(page.getByText('hCaptcha')).toHaveCount(0)

        const widget = page.locator('#nook-auth-widget')
        await expect(widget.getByText('Ready to sign in')).toBeVisible()
        await widget.getByRole('button', { name: 'Continue with Nook' }).click()
        await expect(page.getByTestId('mock-auth-success')).toHaveText(
          'Authentication complete',
          { timeout: 20_000 },
        )
        await expect
          .poll(() =>
            page.evaluate<
              SubmissionEvidencePollState,
              SubmissionEvidencePollRequest
            >(
              ({ key, absentKind, presentKind }) => {
                for (const [entryKey, value] of Object.entries(
                  sessionStorage,
                )) {
                  if (entryKey === key) {
                    return { kind: presentKind, value }
                  }
                }
                return { kind: absentKind }
              },
              {
                key: 'tesla-submission-evidence',
                absentKind: SubmissionEvidencePollKind.Absent,
                presentKind: SubmissionEvidencePollKind.Present,
              },
            ),
          )
          .toEqual({
            kind: SubmissionEvidencePollKind.Present,
            value: JSON.stringify({
              submittedControl: TeslaAuthControl.Next,
              emailMatch: TeslaAuthEmailMatch.Matched,
              primaryActivation: TeslaAuthPrimaryActivationState.Activated,
              auxiliaryControlsUntouched: true,
            }),
          })
        expect(interceptedTeslaRequestCount).toBeGreaterThan(1)
        expect(forbiddenAuthenticationRequests).toEqual([])
        await page.close()
      } finally {
        await paired.context.close()
        await mockAuth.close()
      }
    })
  }

  private static registerAirbnb(): void {
    test('fills Airbnb identity and activates only Continue', async ({
      browserName,
    }, testInfo) => {
      test.skip(
        browserName !== 'chromium',
        'Chrome extensions require Chromium',
      )
      const mockAuth = await startMockAuthServer()
      const paired = await launchPairedPinExtension(testInfo, {
        vaultName: 'Mock Airbnb auth vault',
      })
      try {
        await saveVaultLogin(
          paired.vaultPage,
          'https://www.airbnb.com',
          'alice@nook.test',
          'extension-fill-password',
        )
        const page = await paired.context.newPage()
        let interceptedAirbnbRequestCount = 0
        const forbiddenAuthenticationRequests: string[] = []
        page.on('request', (request) => {
          const url = request.url()
          if (/google|gstatic|apple(?:id)?\.|captcha/u.test(url)) {
            forbiddenAuthenticationRequests.push(url)
          }
        })
        await page.route('https://www.airbnb.com/**', async (route) => {
          interceptedAirbnbRequestCount += 1
          const requestedUrl = new URL(route.request().url())
          const localResponse = await page.request.get(
            `${mockAuth.origin}${requestedUrl.pathname}${requestedUrl.search}`,
          )
          await route.fulfill({ response: localResponse })
        })
        const airbnbUrl = 'https://www.airbnb.com/login'
        await page.goto(airbnbUrl)
        expect(interceptedAirbnbRequestCount).toBeGreaterThan(0)
        await expect(page).toHaveURL(airbnbUrl)
        await expect(page.getByTestId('mock-auth-scenario')).toHaveText(
          'airbnb-identity-first',
        )

        const form = page.getByTestId('airbnb-auth-form')
        const identity = form.getByLabel('Phone number or email')
        const primary = form.getByRole('button', { name: 'Continue' })
        await expect(page.locator('form')).toHaveCount(1)
        await expect(form).not.toHaveAttribute('method')
        await expect(form).not.toHaveAttribute('action')
        await expect(form).toHaveJSProperty('method', 'get')
        await expect(form).toHaveJSProperty('action', airbnbUrl)
        await expect(form.locator('input')).toHaveCount(1)
        await expect(identity).toHaveAttribute('type', 'text')
        await expect(identity).not.toHaveAttribute('name')
        await expect(identity).not.toHaveAttribute('aria-label')
        await expect(identity).toHaveAttribute('inputmode', 'email')
        await expect(identity).toHaveAttribute('autocomplete', 'tel-national')
        await expect(identity).toHaveValue('')
        await expect(primary).toHaveAttribute('type', 'submit')
        await expect(primary).toBeEnabled()
        await expect(form.locator('button[type="submit"]')).toHaveCount(1)
        for (const name of ['Continue with Google', 'Continue with Apple']) {
          const alternative = page.getByRole('button', { name })
          await expect(alternative).toHaveAttribute('type', 'button')
          expect(
            await alternative.evaluate(
              (button) => !(button as HTMLButtonElement).form,
            ),
          ).toBe(true)
        }
        await expect(page.locator('[role="dialog"]')).toHaveCount(0)

        const widget = page.locator('#nook-auth-widget')
        await expect(widget.getByText('Ready to sign in')).toBeVisible()
        await widget.getByRole('button', { name: 'Continue with Nook' }).click()
        await expect(page.getByTestId('mock-auth-success')).toHaveText(
          'Authentication complete',
          { timeout: 20_000 },
        )
        await expect
          .poll(() =>
            page.evaluate<
              SubmissionEvidencePollState,
              SubmissionEvidencePollRequest
            >(
              ({ key, absentKind, presentKind }) => {
                for (const [entryKey, value] of Object.entries(
                  sessionStorage,
                )) {
                  if (entryKey === key) return { kind: presentKind, value }
                }
                return { kind: absentKind }
              },
              {
                key: 'airbnb-submission-evidence',
                absentKind: SubmissionEvidencePollKind.Absent,
                presentKind: SubmissionEvidencePollKind.Present,
              },
            ),
          )
          .toEqual({
            kind: SubmissionEvidencePollKind.Present,
            value: JSON.stringify({
              submittedControl: AirbnbAuthControl.Continue,
              identityMatch: AirbnbAuthIdentityMatch.Matched,
              primaryActivation: AirbnbAuthInteractionState.Activated,
              alternativeActivationCount: 0,
            }),
          })
        await expect(identity).toHaveValue('alice@nook.test')
        expect(interceptedAirbnbRequestCount).toBeGreaterThan(1)
        expect(forbiddenAuthenticationRequests).toEqual([])
        await page.close()
      } finally {
        await paired.context.close()
        await mockAuth.close()
      }
    })
  }
}
