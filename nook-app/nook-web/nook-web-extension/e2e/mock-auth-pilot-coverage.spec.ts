import { expect, test, type BrowserContext, type Page } from '@playwright/test'
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
      const widget = loginPage.locator('#nook-auth-widget')
      await expect(widget.getByText('Ready to sign in')).toBeVisible()
      const loginPickerPromise = paired.context.waitForEvent('page')
      await widget.getByRole('button', { name: 'Continue with Nook' }).click()
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

  test('fills SPA, polluted Namecheap, Facebook, and combined login forms to success', async ({
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

      await expectPilotNamecheapShellSuccess({
        context: paired.context,
        url: `${mockAuth.origin}/login-with-hidden-header`,
      })

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

  test('fills both steps of the stable Google identifier-first mock', async ({
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

    const mockAuth = await startMockAuthServer()
    const paired = await launchPairedPinExtension(testInfo, {
      vaultName: 'Mock Google auth vault',
    })
    try {
      await saveVaultLogin(
        paired.vaultPage,
        mockAuth.origin,
        'alice@nook.test',
        'extension-fill-password',
      )

      const page = await paired.context.newPage()
      await page.goto(`${mockAuth.origin}/v3/signin/identifier`)
      await expect(page.getByTestId('google-auth-step')).toHaveText(
        'identifier',
      )
      await expect(page.locator('#identifierId')).toHaveAttribute(
        'autocomplete',
        'username webauthn',
      )
      await expect(page.locator('[name="hiddenPassword"]')).toHaveValue('')

      const widget = page.locator('#nook-auth-widget')
      await expect(widget.getByText('Ready to sign in')).toBeVisible()
      await widget.getByRole('button', { name: 'Continue with Nook' }).click()
      await expect(page).toHaveURL(/\/v3\/signin\/challenge\/pwd$/)
      await expect(page.getByTestId('google-auth-step')).toHaveText('password')
      await expect(page.getByTestId('google-selected-account')).toHaveText(
        'alice@nook.test',
      )
      await expect(page.locator('#login_form #identifierId')).toHaveAttribute(
        'autocomplete',
        'username',
      )
      await expect(page.locator('#login_form #identifierId')).toHaveValue(
        'alice@nook.test',
      )

      await expect(widget.getByText('Ready to sign in')).toBeVisible()
      await widget.getByRole('button', { name: 'Continue with Nook' }).click()
      await expect(page.getByTestId('mock-auth-success')).toHaveText(
        'Authentication complete',
        { timeout: 20_000 },
      )
      await page.close()
    } finally {
      await paired.context.close()
      await mockAuth.close()
    }
  })

  test('fills ChatGPT GET and OpenAI POST identifier forms', async ({
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

    const chatGpt = await startMockAuthServer()
    const openAi = await startMockAuthServer()
    const paired = await launchPairedPinExtension(testInfo, {
      vaultName: 'Mock OpenAI auth vault',
    })
    try {
      await saveVaultLogin(
        paired.vaultPage,
        chatGpt.origin,
        'alice@nook.test',
        'extension-fill-password',
      )
      // Both fixtures bind to localhost. Nook intentionally matches login
      // accounts by host, so one shared credential keeps this flow out of the
      // account-picker branch while still covering both form structures.

      const page = await paired.context.newPage()
      const authOrigin = encodeURIComponent(openAi.origin)
      await page.goto(`${chatGpt.origin}/auth/login?auth_origin=${authOrigin}`)
      await expect(page.getByTestId('mock-auth-scenario')).toHaveText(
        'chatgpt-identifier',
      )
      const chatGptForm = page.locator('form[action="/auth/login"]')
      await expect(chatGptForm).toHaveAttribute('method', 'get')
      await expect(page.locator('input[type="password"]')).toHaveCount(0)

      const widget = page.locator('#nook-auth-widget')
      await expect(widget.getByText('Ready to sign in')).toBeVisible()
      await widget.getByRole('button', { name: 'Continue with Nook' }).click()
      await expect(page).toHaveURL(`${openAi.origin}/log-in-or-create-account`)

      await expect(page.getByTestId('mock-auth-scenario')).toHaveText(
        'openai-identifier',
      )

      const identifierForm = page.locator('#openai-identifier-form')
      const socialForm = page.locator('#openai-social-form')
      await expect(identifierForm.locator('#email')).toHaveAttribute(
        'autocomplete',
        'email',
      )
      await expect(
        identifierForm.getByRole('button', { name: 'Continue with phone' }),
      ).toBeEnabled()
      await expect(socialForm).toBeHidden()
      await expect(
        identifierForm.locator(
          'button[name="intent"][form="openai-social-form"]',
        ),
      ).toHaveCount(3)
      expect(
        await identifierForm
          .locator('button[name="intent"][form="openai-social-form"]')
          .evaluateAll((buttons) =>
            buttons.every(
              (button) =>
                (button as HTMLButtonElement).form?.id === 'openai-social-form',
            ),
          ),
      ).toBe(true)
      await expect(page.locator('input[type="password"]')).toHaveCount(0)

      await expect(widget.getByText('Ready to sign in')).toBeVisible()
      await widget.getByRole('button', { name: 'Continue with Nook' }).click()
      await expect(page.getByTestId('mock-auth-success')).toHaveText(
        'Authentication complete',
        { timeout: 20_000 },
      )
      const expectedEvidence = JSON.stringify({
        submittedControlIdentity: 'openai-continue',
        emailMatched: true,
        phoneUntouched: true,
        socialFormUntouched: true,
      })
      await expect
        .poll(() =>
          page.evaluate(
            (key) => sessionStorage.getItem(key) || '',
            'openai-submission-evidence',
          ),
        )
        .toBe(expectedEvidence)
      await page.close()
    } finally {
      await paired.context.close()
      await Promise.all([chatGpt.close(), openAi.close()])
    }
  })

  test('fills the X identifier through its implicit GET form', async ({
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

    const mockAuth = await startMockAuthServer()
    const paired = await launchPairedPinExtension(testInfo, {
      vaultName: 'Mock X auth vault',
    })
    try {
      await saveVaultLogin(
        paired.vaultPage,
        mockAuth.origin,
        'alice@nook.test',
        'extension-fill-password',
      )

      const page = await paired.context.newPage()
      await page.goto(`${mockAuth.origin}/i/flow/login`)
      await expect(page).toHaveURL(
        `${mockAuth.origin}/i/jf/onboarding/web?mode=login`,
      )
      await expect(page.getByTestId('mock-auth-scenario')).toHaveText(
        'x-identifier',
      )
      const form = page.getByTestId('x-active-form')
      expect(
        await form.evaluate((element) => ({
          actionAttributePresent: element.hasAttribute('action'),
          methodAttributePresent: element.hasAttribute('method'),
          method: (element as HTMLFormElement).method,
        })),
      ).toEqual({
        actionAttributePresent: false,
        methodAttributePresent: false,
        method: 'get',
      })
      const username = form.locator('[name="username_or_email"]')
      await expect(username).toHaveAttribute('type', 'text')
      await expect(username).toHaveAttribute(
        'autocomplete',
        'username webauthn',
      )
      await expect(username).toHaveAttribute('name', 'username_or_email')
      await expect(page.getByTestId('x-hidden-password')).toBeHidden()
      await expect(form.locator('[name="password"]')).toHaveValue('')
      await expect(
        page
          .getByTestId('x-responsive-copy')
          .locator('[name="username_or_email"]'),
      ).toHaveValue('')
      await expect(
        form.getByRole('button', { name: 'Continue with Apple' }),
      ).toHaveAttribute('type', 'button')
      await expect(
        form.getByRole('button', { name: 'Continue with phone' }),
      ).toHaveAttribute('type', 'button')
      const continueControl = page.getByTestId('x-continue')
      await expect(continueControl).not.toHaveAttribute('role')
      await expect(continueControl).not.toHaveAttribute('tabindex')
      expect(await continueControl.evaluate((element) => element.tagName)).toBe(
        'DIV',
      )
      const googleFrame = form.locator('iframe[title="Continue with Google"]')
      await expect(googleFrame).not.toHaveAttribute('src')
      await expect(googleFrame).toHaveAttribute(
        'srcdoc',
        /Continue with Google/u,
      )

      const widget = page.locator('#nook-auth-widget')
      await expect(widget.getByText('Ready to sign in')).toBeVisible()
      await widget.getByRole('button', { name: 'Continue with Nook' }).click()
      await expect(page.getByTestId('mock-auth-success')).toHaveText(
        'Authentication complete',
        { timeout: 20_000 },
      )
      const expectedEvidence = JSON.stringify({
        credentialsMatched: true,
        hiddenPasswordUntouched: true,
        alternativesUntouched: true,
        nonSemanticContinueUntouched: true,
        implicitFormSubmission: true,
      })
      await expect
        .poll(() =>
          page.evaluate(
            (key) => sessionStorage.getItem(key) || '',
            'x-submission-evidence',
          ),
        )
        .toBe(expectedEvidence)
      await page.close()
    } finally {
      await paired.context.close()
      await mockAuth.close()
    }
  })

  test('fills the Microsoft consumer identifier through semantic Next', async ({
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

    const mockAuth = await startMockAuthServer()
    const paired = await launchPairedPinExtension(testInfo, {
      vaultName: 'Mock Microsoft consumer auth vault',
    })
    try {
      await saveVaultLogin(
        paired.vaultPage,
        'https://login.live.com',
        'alice@nook.test',
        'extension-fill-password',
      )

      const page = await paired.context.newPage()
      await page.route('https://login.live.com/**', async (route) => {
        const requestedUrl = new URL(route.request().url())
        const localResponse = await page.request.get(
          `${mockAuth.origin}${requestedUrl.pathname}${requestedUrl.search}`,
        )
        await route.fulfill({ response: localResponse })
      })
      await page.goto('https://login.live.com/')
      await expect(page.getByTestId('mock-auth-scenario')).toHaveText(
        'microsoft-consumer-identifier',
      )
      const form = page.getByTestId('microsoft-consumer-form')
      expect(
        await form.evaluate((element) => ({
          actionAttributePresent: element.hasAttribute('action'),
          ariaLabelPresent: element.hasAttribute('aria-label'),
          id: element.id,
          methodAttribute: element.getAttribute('method'),
          nameAttributePresent: element.hasAttribute('name'),
        })),
      ).toEqual({
        actionAttributePresent: false,
        ariaLabelPresent: false,
        id: '',
        methodAttribute: 'post',
        nameAttributePresent: false,
      })
      const username = page.locator('#usernameEntry')
      await expect(username).toHaveAttribute('type', 'email')
      await expect(username).toHaveAttribute(
        'autocomplete',
        'username webauthn',
      )
      await expect(username).not.toHaveAttribute('name')
      await expect(username).not.toHaveAttribute('placeholder')
      await expect(username).not.toHaveAttribute('aria-label')
      await expect(page.getByLabel('Email or phone number')).toBeVisible()
      await expect(page.locator('#i0116, [name="loginfmt"]')).toHaveCount(0)
      await expect(form.getByRole('button', { name: 'Close' })).toHaveAttribute(
        'type',
        'button',
      )
      await expect(
        form.getByRole('button', { name: 'Forgot your username?' }),
      ).toHaveAttribute('type', 'button')
      await expect(form.getByRole('button', { name: 'Next' })).toHaveAttribute(
        'type',
        'submit',
      )
      await expect(
        page.getByRole('link', { name: 'Create an account' }),
      ).toBeVisible()
      await expect(page.getByRole('link', { name: 'Help' })).toBeVisible()
      const unrelatedForm = page.getByTestId('microsoft-unrelated-empty-form')
      await expect(unrelatedForm).toHaveAttribute('method', 'post')
      await expect(unrelatedForm).toHaveAttribute('action', '')

      const widget = page.locator('#nook-auth-widget')
      await expect(widget.getByText('Ready to sign in')).toBeVisible()
      await widget.getByRole('button', { name: 'Continue with Nook' }).click()
      await expect(page.getByTestId('mock-auth-success')).toHaveText(
        'Authentication complete',
        { timeout: 20_000 },
      )
      const expectedEvidence = JSON.stringify({
        submittedControl: 'Next',
        usernameMatched: true,
        closeUntouched: true,
        recoveryUntouched: true,
        signupAndHelpUntouched: true,
        unrelatedFormUntouched: true,
      })
      await expect
        .poll(() =>
          page.evaluate(
            (key) => sessionStorage.getItem(key) || '',
            'microsoft-consumer-submission-evidence',
          ),
        )
        .toBe(expectedEvidence)
      await page.close()
    } finally {
      await paired.context.close()
      await mockAuth.close()
    }
  })

  test('fills the owned GitHub login without touching its decoys or alternatives', async ({
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

    const mockAuth = await startMockAuthServer()
    const paired = await launchPairedPinExtension(testInfo, {
      vaultName: 'Mock GitHub auth vault',
    })
    try {
      await saveVaultLogin(
        paired.vaultPage,
        mockAuth.origin,
        'alice@nook.test',
        'extension-fill-password',
      )

      const page = await paired.context.newPage()
      await page.goto(`${mockAuth.origin}/github/login`)
      await expect(page.getByTestId('mock-auth-scenario')).toHaveText(
        'github-owned-login',
      )
      const form = page.locator('form')
      await expect(form).toHaveAttribute('data-turbo', 'false')
      await expect(form).toHaveAttribute('accept-charset', 'UTF-8')
      await expect(page.locator('#login_field')).toHaveAttribute(
        'autocomplete',
        'username',
      )
      await expect(page.locator('#password')).toHaveAttribute(
        'autocomplete',
        'current-password',
      )
      const honeypot = page.locator('[name="required_field_mock_auth"]')
      await expect(honeypot).toHaveValue('')
      await expect(honeypot).toHaveAttribute('class', 'form-control')
      await expect(honeypot).not.toHaveAttribute('autocomplete')
      await expect(honeypot).not.toHaveAttribute('tabindex')
      await expect(honeypot).not.toHaveAttribute('aria-hidden')
      await expect(form.locator('#forgot-password')).toHaveAttribute(
        'href',
        '/password_reset',
      )
      const submit = form.locator('[name="commit"]')
      await expect(submit).toHaveAttribute('data-disable-with', 'Signing in…')
      await expect(submit).toHaveAttribute('data-signin-label', 'Sign in')
      await expect(submit).toHaveAttribute(
        'data-sso-label',
        'Sign in with your identity provider',
      )
      await expect(
        page.getByRole('button', { name: 'Sign in with a passkey' }),
      ).toBeEnabled()

      const widget = page.locator('#nook-auth-widget')
      await expect(widget.getByText('Ready to sign in')).toBeVisible()
      await widget.getByRole('button', { name: 'Continue with Nook' }).click()
      await expect(page.getByTestId('mock-auth-success')).toHaveText(
        'Authentication complete',
        { timeout: 20_000 },
      )
      const expectedEvidence = JSON.stringify({
        submittedControlIdentity: 'commit:Sign in',
        credentialsMatched: true,
        honeypotUnchanged: true,
        metadataUnchanged: true,
        alternativesUntouched: true,
      })
      await expect
        .poll(() =>
          page.evaluate(
            (key) => sessionStorage.getItem(key) || '',
            'github-submission-evidence',
          ),
        )
        .toBe(expectedEvidence)
      await page.close()
    } finally {
      await paired.context.close()
      await mockAuth.close()
    }
  })

  test('fills both Apple steps inside the exact cross-origin authorization frame', async ({
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

    const accountSite = await startMockAuthServer()
    const appleAuthorization = await startMockAuthServer()
    const paired = await launchPairedPinExtension(testInfo, {
      vaultName: 'Mock Apple auth vault',
    })
    try {
      await saveVaultLogin(
        paired.vaultPage,
        appleAuthorization.origin,
        'alice@nook.test',
        'extension-fill-password',
      )

      const page = await paired.context.newPage()
      const authOrigin = encodeURIComponent(appleAuthorization.origin)
      await page.goto(
        `${accountSite.origin}/account/sign-in?auth_origin=${authOrigin}`,
      )
      await expect(page.locator('#nook-auth-widget')).toHaveCount(0)

      const authorizationFrame = page.frameLocator(
        '[data-testid="apple-auth-frame"]',
      )
      await expect(
        authorizationFrame.getByTestId('apple-auth-step'),
      ).toHaveText('identifier')
      const identifier = authorizationFrame.locator('#account_name_text_field')
      await expect(identifier).toHaveAttribute(
        'autocomplete',
        'username webauthn',
      )
      await expect(authorizationFrame.locator('#continue')).toBeDisabled()
      await expect(
        authorizationFrame.getByRole('button', {
          name: 'Sign in with Passkey',
        }),
      ).toBeEnabled()
      await expect(
        authorizationFrame.locator('[name="decoyPassword"]'),
      ).toHaveValue('')

      const widget = authorizationFrame.locator('#nook-auth-widget')
      await expect(widget.getByText('Ready to sign in')).toBeVisible()
      await widget.getByRole('button', { name: 'Continue with Nook' }).click()
      await expect(
        authorizationFrame.getByTestId('apple-auth-step'),
      ).toHaveText('password')
      await expect(identifier).toHaveValue('alice@nook.test')
      await expect(
        authorizationFrame.locator('[name="decoyPassword"]'),
      ).toHaveValue('')
      await expect(page.locator('#nook-auth-widget')).toHaveCount(0)
      await expect(
        authorizationFrame.getByRole('button', {
          name: 'Sign in with Passkey',
        }),
      ).toBeEnabled()
      await expect(widget.getByText('Ready to sign in')).toBeVisible()
      await widget.getByRole('button', { name: 'Continue with Nook' }).click()
      await expect(
        authorizationFrame.getByTestId('mock-auth-success'),
      ).toHaveText('Authentication complete', { timeout: 20_000 })
      const expectedEvidence = JSON.stringify({
        identifierContinueSubmitted: true,
        passwordSignInSubmitted: true,
        loginCredentialsMatched: true,
        decoyPasswordUnchanged: true,
      })
      await expect
        .poll(() =>
          authorizationFrame
            .locator('body')
            .evaluate(
              () => sessionStorage.getItem('apple-submission-evidence') || '',
            ),
        )
        .toBe(expectedEvidence)
      await expect(page.locator('#nook-auth-widget')).toHaveCount(0)
      await page.close()
    } finally {
      await paired.context.close()
      await Promise.all([accountSite.close(), appleAuthorization.close()])
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
      await picker.getByTestId('authenticator-search').fill('bob-2fa')
      await expect(picker.getByText('Mock Auth Primary')).toHaveCount(0)
      await picker.getByRole('button', { name: /Mock Auth Secondary/ }).click()
      await expect(
        otpPage.locator('[autocomplete="one-time-code"]'),
      ).toHaveValue(/^\d{6}$/)
      await expect.poll(() => picker.isClosed()).toBe(true)
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

async function expectPilotNamecheapShellSuccess({
  context,
  url,
}: {
  readonly context: BrowserContext
  readonly url: string
}): Promise<void> {
  const page = await context.newPage()
  await page.goto(url)
  const widget = page.locator('#nook-auth-widget')
  await expect(widget.getByText('Ready to sign in')).toBeVisible()
  await widget.getByRole('button', { name: 'Continue with Nook' }).click()
  await expect(page.getByTestId('mock-auth-success')).toHaveText(
    'Authentication complete',
    { timeout: 20_000 },
  )
  const expectedEvidence = JSON.stringify({
    submittedControlIdentity: 'login-submit',
    headerUsernameUnchanged: true,
    headerPasswordUnchanged: true,
    searchUnchanged: true,
    newsletterUnchanged: true,
    loginCredentialsMatched: true,
  })
  await expect
    .poll(() =>
      page.evaluate(
        (key) => sessionStorage.getItem(key) || '',
        'namecheap-submission-evidence',
      ),
    )
    .toBe(expectedEvidence)
  await page.close()
}
