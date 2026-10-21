import {
  expect,
  type Locator,
  type Page,
  type Route,
  type TestInfo,
} from '@playwright/test'
import { Effect } from 'effect'
import {
  launchPairedPinExtension,
  saveVaultAuthenticator,
} from './helpers/paired-pin-extension'

type NamecheapOtpEnvironment = Awaited<
  ReturnType<typeof launchPairedPinExtension>
>
type NamecheapOtpScenarioContext = { readonly self: NamecheapOtpScenario }
type NamecheapOtpDocumentResponse = Parameters<Route['fulfill']>[0]
type NamecheapOtpButtonOptions = Parameters<Locator['getByRole']>[1]

/** Synthetic page using the observed field attributes and local card structure. */
export class NamecheapOtpScenario {
  private readonly generatorContext: NamecheapOtpScenarioContext = {
    self: this,
  }
  private submissions = 0
  private navigationRequests = 0

  constructor(private readonly testInfo: TestInfo) {}

  run(): Promise<void> {
    return Effect.runPromise(
      Effect.acquireUseRelease(
        Effect.tryPromise(() => launchPairedPinExtension(this.testInfo)),
        this.exercise.bind(this),
        (paired) =>
          Effect.tryPromise(paired.context.close.bind(paired.context)),
      ),
    )
  }

  private fulfill(route: Route): Promise<void> {
    switch (route.request().isNavigationRequest()) {
      case true:
        this.navigationRequests += 1
        break
      case false:
        break
    }
    switch (route.request().method()) {
      case 'POST':
        this.submissions += 1
        break
    }
    const response: NamecheapOtpDocumentResponse = {
      contentType: 'text/html',
      body: `<!doctype html><html><body>
        <fragment><fragment-app-test><div><form>
          <div><div style="display:flex"><div class="gb-scope twofa"><div class="gb-panel">
            <header class="gb-panel__header"><h1>Enter OTP Code</h1></header>
            <div class="gb-panel__body">
              <label class="gb-d-block gb-mb-1">Open the two-factor authentication app on your device to view your authentication code.</label>
              <input type="tel" class="gb-form-control gb-mb-small " autocomplete="off" placeholder="Enter OTP Code" data-ncid="verification-otp">
              <p class="gb-text-base gb-my-2"><a href="/twofa/backup/">Want to use a Backup Code?</a></p>
              <div><button type="button">Cancel</button><button type="submit">Submit</button></div>
            </div>
          </div></div></div></div>
        </form></div></fragment-app-test></fragment>
        <script>document.querySelector('[data-ncid="verification-otp"]').focus()</script>
      </body></html>`,
    }
    return route.fulfill(response)
  }

  private removeAuthenticationSemantics(page: Page): Promise<void> {
    return page.locator('form').evaluate((form) => {
      form.querySelector('input')?.setAttribute('placeholder', 'Coupon code')
      form.querySelector('input')?.setAttribute('name', 'coupon')
      form.querySelector('input')?.removeAttribute('inputmode')
      form.querySelector('input')?.removeAttribute('maxlength')
      form.querySelector('a')?.remove()
      form.querySelector('button[type="submit"]')?.replaceChildren('Apply')
      document.querySelector('h1')?.replaceChildren('Apply discount')
      document.querySelector('p')?.replaceChildren('Enter your coupon code.')
    })
  }

  private exercise = Effect.fn(
    this.generatorContext,
    function* (paired: NamecheapOtpEnvironment) {
      yield* Effect.tryPromise(() =>
        saveVaultAuthenticator(
          paired.vaultPage,
          'Unrelated issuer',
          'chosen-authenticator@nook.test',
          'JBSWY3DPEHPK3PXP',
        ),
      )
      const page = yield* Effect.tryPromise(() => paired.context.newPage())
      yield* Effect.tryPromise(() =>
        page.route('https://namecheap.com/**', this.fulfill.bind(this)),
      )
      const challengeUrl =
        'https://namecheap.com/twofa/totp/?ReturnUrl=%2Fmyaccount%2F'
      yield* Effect.tryPromise(() => page.goto(challengeUrl))
      const input = page.locator('[data-ncid="verification-otp"]')
      yield* Effect.tryPromise(() => expect(input).toBeFocused())
      const widget = page.locator('#nook-auth-widget')
      yield* Effect.tryPromise(() =>
        expect(widget.getByText('Fill your 2FA code')).toBeVisible(),
      )
      yield* Effect.tryPromise(() => expect(input).toHaveValue(''))
      expect(this.submissions).toBe(0)
      expect(this.navigationRequests).toBe(1)
      // Keep the initial-load placeholder regression above, then model a
      // client-rendered challenge whose numeric hint arrives after its field.
      yield* Effect.tryPromise(() =>
        input.evaluate((field) => {
          field.removeAttribute('placeholder')
          field.setAttribute('type', 'text')
          field.setAttribute('maxlength', '6')
        }),
      )
      yield* Effect.tryPromise(() => expect(widget).toHaveCount(0))
      yield* Effect.tryPromise(() =>
        input.evaluate((field) => field.setAttribute('inputmode', 'numeric')),
      )
      yield* Effect.tryPromise(() =>
        expect(widget.getByText('Fill your 2FA code')).toBeVisible(),
      )
      yield* Effect.tryPromise(() => expect(input).toHaveValue(''))
      const pickerPromise = page.context().waitForEvent('page')
      const fillButton: NamecheapOtpButtonOptions = { name: 'Fill 2FA code' }
      yield* Effect.tryPromise(() =>
        widget.getByRole('button', fillButton).click(),
      )
      const picker = yield* Effect.tryPromise(() => pickerPromise)
      yield* Effect.tryPromise(() =>
        picker.waitForURL(/intent=authenticator-picker/),
      )
      yield* Effect.tryPromise(() => expect(input).toHaveValue(''))
      yield* Effect.tryPromise(() =>
        expect(picker.getByText('Unrelated issuer')).toBeVisible(),
      )
      yield* Effect.tryPromise(() =>
        expect(page.locator('body')).not.toContainText(
          'chosen-authenticator@nook.test',
        ),
      )
      yield* Effect.tryPromise(() =>
        expect(page.locator('body')).not.toContainText('Unrelated issuer'),
      )
      const authenticatorButton: NamecheapOtpButtonOptions = {
        name: /Unrelated issuer/,
      }
      yield* Effect.tryPromise(() =>
        picker.getByRole('button', authenticatorButton).click(),
      )
      yield* Effect.tryPromise(() => expect(input).toHaveValue(/^\d{6}$/))
      yield* Effect.tryPromise(() => expect(page).toHaveURL(challengeUrl))
      expect(this.submissions).toBe(0)
      expect(this.navigationRequests).toBe(1)

      // Retain the mounted widget while the field becomes a non-auth code;
      // its removal proves the existing classifier processed the mutation.
      yield* Effect.tryPromise(() => this.removeAuthenticationSemantics(page))
      yield* Effect.tryPromise(() => expect(widget).toHaveCount(0))
      yield* Effect.tryPromise(() => input.clear())
      yield* Effect.tryPromise(() => input.focus())
      yield* Effect.tryPromise(() => expect(input).toHaveValue(''))
      yield* Effect.tryPromise(() => expect(widget).toHaveCount(0))
      expect(this.submissions).toBe(0)
    },
  )
}
