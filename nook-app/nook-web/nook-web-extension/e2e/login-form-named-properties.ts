import { expect, type Page, type Route, type TestInfo } from '@playwright/test'
import { Effect } from 'effect'
import { launchPairedPinExtension } from './helpers/paired-pin-extension'

type NamedLoginEnvironment = Awaited<
  ReturnType<typeof launchPairedPinExtension>
>
type NamedLoginScenarioContext = { readonly self: NamedLoginScenario }

export class NamedLoginScenario {
  private readonly generatorContext: NamedLoginScenarioContext = { self: this }
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
    const response: Parameters<Route['fulfill']>[0] = {
      contentType: 'text/html',
      body: `<!doctype html><html><body>
        <h1>Log In</h1>
        <form id="login-form" class="account-panel" action="/Account/Login" method="post" autocomplete="off">
          <input type="hidden" name="id" value="opaque-request-id">
          <input type="hidden" name="className" value="opaque-form-state">
          <label for="username">Username (Email Address)</label>
          <input id="username" name="UserName" type="text">
          <label for="password">Password</label>
          <a href="/forgot-password">Forgot password?</a>
          <input id="password" name="Password" type="password">
          <button type="submit">Log In</button>
          <a href="/register">Create an account</a>
        </form>
      </body></html>`,
    }
    return route.fulfill(response)
  }

  private requireFocusedRecognition(page: Page): Promise<void> {
    return page.locator('form').evaluate((form) => {
      // No valid whole-form POST ceremony: focus must independently recognize
      // each credential after the ordinary page scan finishes.
      form.setAttribute('method', 'get')
      form.querySelector('button')?.remove()
    })
  }

  private exercise = Effect.fn(
    this.generatorContext,
    function* (paired: NamedLoginEnvironment) {
      const page = yield* Effect.tryPromise(() => paired.context.newPage())
      yield* Effect.tryPromise(() =>
        page.route('https://example.test/**', this.fulfill.bind(this)),
      )
      yield* Effect.tryPromise(() =>
        page.goto('https://example.test/Account/Login?id=request'),
      )
      const namedProperties = yield* Effect.tryPromise(() =>
        page
          .locator('form')
          .evaluate((form) => [typeof form.id, typeof form.className]),
      )
      expect(namedProperties).toEqual(['object', 'object'])
      const widget = page.locator('#nook-auth-widget')
      yield* Effect.tryPromise(() =>
        expect(widget.getByText('Ready to sign in')).toBeVisible(),
      )
      for (const selector of ['#username', '#password']) {
        yield* Effect.tryPromise(() => page.locator(selector).click())
        yield* Effect.tryPromise(() =>
          expect(widget.getByText('Ready to sign in')).toBeVisible(),
        )
        yield* Effect.tryPromise(() =>
          expect(page.locator(selector)).toHaveValue(''),
        )
      }
      yield* Effect.tryPromise(() => this.requireFocusedRecognition(page))
      for (const selector of ['#username', '#password']) {
        yield* Effect.tryPromise(() => page.locator(selector).click())
        yield* Effect.tryPromise(() =>
          expect(widget).toHaveAttribute(
            'data-nook-credential-mode',
            'focused',
          ),
        )
        yield* Effect.tryPromise(() =>
          expect(page.locator(selector)).toHaveValue(''),
        )
      }
    },
  )
}
