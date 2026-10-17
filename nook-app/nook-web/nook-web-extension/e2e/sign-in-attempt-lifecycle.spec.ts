import {
  expect,
  test,
  type Locator,
  type Page,
  type PlaywrightWorkerOptions,
  type Route,
  type TestInfo,
} from '@playwright/test'
import {
  launchPairedPinExtension,
  saveVaultLogin,
} from './helpers/paired-pin-extension'

/** What the fixture site answers to the next submitted password. */
enum NamecheapLoginVerdict {
  WrongPassword = 'wrong-password',
  AccountLocked = 'account-locked',
  Accepted = 'accepted',
}
/** Which plain styled banner the login document shows after a rejection. */
enum NamecheapLoginBanner {
  None = 'none',
  WrongPassword = 'wrong-password',
  AccountLocked = 'account-locked',
}
type NamecheapRouteFulfillment = Parameters<Route['fulfill']>[0]
type PilotScreenshotOptions = Parameters<Locator['screenshot']>[0]
type PilotButtonOptions = Parameters<Locator['getByRole']>[1]
interface SignInAttemptBrowserRun {
  readonly browserName: PlaywrightWorkerOptions['browserName']
  readonly testInfo: TestInfo
}

/**
 * Namecheap-shaped fixture, not captured live content: a POST login that
 * redirects back to the login document. A rejection shows a plain styled
 * div (no role=alert, no aria-live) with a Password Reset link.
 */
class NamecheapLoginFixture {
  static readonly ORIGIN = 'https://www.namecheap.com'
  static readonly LOGIN_URL = `${NamecheapLoginFixture.ORIGIN}/myaccount/login/`
  static readonly USERNAME = 'pilot-user'
  static readonly PASSWORD = 'pilot-password-1'
  static readonly LOCK_MESSAGE =
    'Your account has been locked for 24 hours for three consecutive failed password or username entry attempts. Please use Password Reset option. Once the password is reset your account will be unlocked automatically.'
  static readonly WRONG_PASSWORD_MESSAGE =
    'The username or password you entered is incorrect. Please try again.'

  verdict = NamecheapLoginVerdict.WrongPassword
  private banner = NamecheapLoginBanner.None
  submissions = 0

  /**
   * Holds the site's native submit in the page (as a script-driven login
   * would), so the Pilot can be observed while the site has not answered.
   * A navigation in flight would block Playwright from reading the Pilot.
   */
  hold(page: Page): Promise<void> {
    return page.evaluate(() => {
      const form = document.querySelector('form')
      form?.addEventListener(
        'submit',
        (event) => {
          event.preventDefault()
          Reflect.set(window, '__nookFixtureSubmit', () =>
            HTMLFormElement.prototype.submit.call(form),
          )
        },
        { once: true },
      )
    })
  }

  /** Resolves once Nook's submit reached the page and the site deferred it. */
  async submitted(page: Page): Promise<void> {
    await page.waitForFunction(
      () => Reflect.get(window, '__nookFixtureSubmit') instanceof Function,
    )
  }

  release(page: Page): Promise<void> {
    return page.evaluate(() => {
      const submit: unknown = Reflect.get(window, '__nookFixtureSubmit')
      switch (true) {
        case submit instanceof Function:
          Reflect.apply(submit, window, [])
          return
        case true:
          break
      }
      throw new Error('the fixture submit was not held')
    })
  }

  async fulfill(route: Route): Promise<void> {
    const request = route.request()
    switch (request.method()) {
      case 'POST':
        return this.answerSubmission(route)
    }
    switch (new URL(request.url()).pathname) {
      case '/dashboard/':
        return route.fulfill(this.document(this.dashboard()))
    }
    return route.fulfill(this.document(this.login()))
  }

  /**
   * The POST answer is the next document itself. A fulfilled redirect would
   * leave its follow-up request unrouted, reaching the live site.
   */
  private async answerSubmission(route: Route): Promise<void> {
    this.submissions += 1
    return route.fulfill(this.document(this.submissionAnswer()))
  }

  private submissionAnswer(): string {
    switch (this.verdict) {
      case NamecheapLoginVerdict.Accepted:
        this.banner = NamecheapLoginBanner.None
        return this.dashboard()
      case NamecheapLoginVerdict.WrongPassword:
        this.banner = NamecheapLoginBanner.WrongPassword
        return this.login()
      case NamecheapLoginVerdict.AccountLocked:
        this.banner = NamecheapLoginBanner.AccountLocked
        return this.login()
    }
  }

  private bannerMarkup(): string {
    switch (this.banner) {
      case NamecheapLoginBanner.None:
        return ''
      case NamecheapLoginBanner.WrongPassword:
        return `<div class="login-notice">${NamecheapLoginFixture.WRONG_PASSWORD_MESSAGE}</div>`
      case NamecheapLoginBanner.AccountLocked:
        return `<div class="login-notice">Your account has been locked for 24 hours for three consecutive failed password or username entry attempts. Please use <a href="/myaccount/login/password-reset/">Password Reset</a> option. Once the password is reset your account will be unlocked automatically.</div>`
    }
  }

  private login(): string {
    return `<main class="page"><section class="login-card">
      <header><h2>Log in to your account</h2><a href="/myaccount/signup/">Sign up</a></header>
      ${this.bannerMarkup()}
      <form method="post" action="/myaccount/login/">
        <label for="LoginUserName">Username</label>
        <input id="LoginUserName" name="LoginUserName" type="text" autocomplete="username">
        <label for="LoginPassword">Password</label>
        <input id="LoginPassword" name="LoginPassword" type="password" autocomplete="current-password">
        <p><a href="/myaccount/login/forgot/">Forgot username or password?</a></p>
        <button type="submit">Sign in</button>
      </form>
    </section></main>`
  }

  private dashboard(): string {
    return `<main class="page"><h1>Dashboard</h1><p>Welcome back. Your domains are listed below.</p></main>`
  }

  private document(body: string): NamecheapRouteFulfillment {
    return {
      contentType: 'text/html',
      body: `<!doctype html><html><head><title>Namecheap</title><style>
        body { margin: 0; font: 16px/1.5 system-ui, sans-serif; background: #ffffff; color: #212121; }
        .page { max-width: 560px; margin: 48px auto; }
        .login-card { padding: 28px; background: #efefef; }
        .login-card header { display: flex; justify-content: space-between; border-bottom: 1px solid #d0d0d0; margin-bottom: 20px; }
        .login-notice { margin: 0 0 20px; padding: 18px 26px; background: #fbe8ec; color: #b3001b; }
        .login-notice a { color: #e2231a; text-decoration: none; }
        label { display: block; margin-top: 14px; }
        input { box-sizing: border-box; width: 100%; padding: 10px; font: inherit; }
        button { margin-top: 20px; width: 100%; padding: 14px; background: #d4202c; color: #fff; border: 0; font: inherit; }
      </style></head><body>${body}</body></html>`,
    }
  }
}

/** Drives the Pilot through failed, retained, dismissed and confirmed sign-in attempts. */
class SignInAttemptLifecycleScenario {
  private readonly fixture = new NamecheapLoginFixture()

  constructor(private readonly run: SignInAttemptBrowserRun) {}

  async execute(): Promise<void> {
    test.skip(
      this.run.browserName !== 'chromium',
      'Chrome extensions require Chromium',
    )
    const paired = await launchPairedPinExtension(this.run.testInfo)
    try {
      await saveVaultLogin(
        paired.vaultPage,
        NamecheapLoginFixture.ORIGIN,
        NamecheapLoginFixture.USERNAME,
        NamecheapLoginFixture.PASSWORD,
      )
      const page = await paired.context.newPage()
      await page.route(
        `${NamecheapLoginFixture.ORIGIN}/**`,
        this.fixture.fulfill.bind(this.fixture),
      )
      await page.goto(NamecheapLoginFixture.LOGIN_URL)
      await this.wrongPassword(page)
      await this.accountLocked(page)
      await this.signedIn(page)
    } finally {
      await paired.context.close()
    }
  }

  private widget(page: Page): Locator {
    return page.locator('#nook-auth-widget')
  }

  private button(request: PilotButtonRequest): Locator {
    const options: PilotButtonOptions = { name: request.name, exact: true }
    return this.widget(request.page).getByRole('button', options)
  }

  private async screenshot(request: PilotScreenshotRequest): Promise<void> {
    const options: PilotScreenshotOptions = {
      path: this.run.testInfo.outputPath(request.name),
      animations: 'disabled',
      caret: 'initial',
    }
    await this.widget(request.page)
      .locator('[data-testid="nook-auth-gate"]')
      .screenshot(options)
  }

  private async signIn(page: Page): Promise<void> {
    const widget = this.widget(page)
    await expect(widget.getByText('Ready to sign in')).toBeVisible({
      timeout: 20_000,
    })
    const signIn: PilotButtonRequest = { page, name: 'Sign in' }
    await this.button(signIn).click()
  }

  private async wrongPassword(page: Page): Promise<void> {
    this.fixture.verdict = NamecheapLoginVerdict.WrongPassword
    await this.fixture.hold(page)
    await this.signIn(page)
    await this.fixture.submitted(page)
    const widget = this.widget(page)
    await expect(widget.getByText('Signing in…')).toBeVisible({
      timeout: 20_000,
    })
    const signingIn: PilotScreenshotRequest = { page, name: 'signing-in.png' }
    await this.screenshot(signingIn)
    await this.fixture.release(page)
    await expect(widget.getByText('Sign-in failed')).toBeVisible({
      timeout: 20_000,
    })
    await expect(
      widget.getByText('The site says the username or password is wrong.'),
    ).toBeVisible()
    await expect(widget.getByTestId('nook-sign-in-site-message')).toHaveText(
      NamecheapLoginFixture.WRONG_PASSWORD_MESSAGE,
    )
    await expect(widget.getByText('Ready to sign in')).toHaveCount(0)
    const failed: PilotScreenshotRequest = {
      page,
      name: 'failed-wrong-password.png',
    }
    await this.screenshot(failed)
    const dismiss: PilotButtonRequest = { page, name: 'Dismiss' }
    await this.button(dismiss).click()
    await expect(widget.getByText('Sign-in failed')).toHaveCount(0)
  }

  private async accountLocked(page: Page): Promise<void> {
    this.fixture.verdict = NamecheapLoginVerdict.AccountLocked
    await page.goto(NamecheapLoginFixture.LOGIN_URL)
    await this.signIn(page)
    const widget = this.widget(page)
    await expect(widget.getByText('Sign-in failed')).toBeVisible({
      timeout: 20_000,
    })
    await expect(
      widget.getByText('The site has locked this account.'),
    ).toBeVisible()
    await expect(widget.getByTestId('nook-sign-in-site-message')).toHaveText(
      NamecheapLoginFixture.LOCK_MESSAGE,
    )
    const reset: PilotButtonRequest = { page, name: 'Reset password' }
    await expect(this.button(reset)).toBeVisible()
    const locked: PilotScreenshotRequest = {
      page,
      name: 'failed-account-locked.png',
    }
    await this.screenshot(locked)

    // The failed attempt is retained across a further reload, not reset to Ready.
    await page.goto(NamecheapLoginFixture.LOGIN_URL)
    await expect(widget.getByText('Sign-in failed')).toBeVisible({
      timeout: 20_000,
    })
    await expect(
      widget.getByText('The site has locked this account.'),
    ).toBeVisible()
    await expect(widget.getByText('Ready to sign in')).toHaveCount(0)
    await expect(this.button(reset)).toBeVisible()
    const tryAgain: PilotButtonRequest = { page, name: 'Try again' }
    await expect(this.button(tryAgain)).toBeVisible()
    const another: PilotButtonRequest = { page, name: 'Choose another login' }
    await expect(this.button(another)).toBeVisible()

    const dismiss: PilotButtonRequest = { page, name: 'Dismiss' }
    await this.button(dismiss).click()
    await expect(widget.getByText('Sign-in failed')).toHaveCount(0)
    await page.goto(NamecheapLoginFixture.LOGIN_URL)
    await expect(widget.getByText('Ready to sign in')).toBeVisible({
      timeout: 20_000,
    })
  }

  private async signedIn(page: Page): Promise<void> {
    this.fixture.verdict = NamecheapLoginVerdict.Accepted
    await this.signIn(page)
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({
      timeout: 20_000,
    })
    const widget = this.widget(page)
    await expect(widget.getByText('Signed in')).toBeVisible({ timeout: 20_000 })
    const signedIn: PilotScreenshotRequest = { page, name: 'signed-in.png' }
    await this.screenshot(signedIn)
    expect(this.fixture.submissions).toBe(3)
  }
}

type PilotButtonRequest = { readonly page: Page; readonly name: string }
type PilotScreenshotRequest = { readonly page: Page; readonly name: string }

test('sign-in attempt shows failure reasons across reloads and confirms success', async ({
  browserName,
}, testInfo) => {
  test.setTimeout(240_000)
  const run: SignInAttemptBrowserRun = { browserName, testInfo }
  await new SignInAttemptLifecycleScenario(run).execute()
})
