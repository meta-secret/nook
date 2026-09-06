import { expect, test } from '../fixtures'
import {
  demoBeat,
  injectPilotAutofill,
  loadPilotMessages,
} from './pilot-demo-helpers'
import { demoDomainEnumArgs, installDemoChromeStub } from './static-chrome-stub'

test('continue through the X identifier-only login form', async ({ page }) => {
  const messages = await loadPilotMessages()
  const stubArgs = {
    localizedMessages: messages,
    ...demoDomainEnumArgs,
    loginPilotFlow: true,
  }
  await page.addInitScript(installDemoChromeStub, stubArgs)
  await page.goto('/i/jf/onboarding/web?mode=login')
  await page.setContent(`<!doctype html>
    <html><head><title>Log in to X</title><style>:root { color-scheme: dark; font-family: Inter, system-ui, sans-serif; } * { box-sizing: border-box; } body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #000; color: #f2f2f2; } main { width: min(440px, calc(100vw - 48px)); padding: 42px; border: 1px solid #2f3336; border-radius: 20px; background: #000; box-shadow: 0 28px 90px #000c; } h1 { margin-top: 0; } form { display: grid; gap: 14px; } input, button, [data-testid='x-continue'] { width: 100%; min-height: 48px; padding: 12px 14px; border: 1px solid #536471; border-radius: 999px; background: #000; color: inherit; font: inherit; } button { background: #fff; color: #0f1419; font-weight: 700; } label { color: #8b98a5; } [data-testid='x-continue'] { display: grid; place-items: center; background: #eff3f4; color: #0f1419; font-weight: 750; } #site-status { min-height: 24px; color: #78d69f; }</style></head>
      <body><main><h1>Sign in to X</h1>
        <section data-testid="x-responsive-copy" style="display: none"><form><input name="username_or_email" type="text" autocomplete="username webauthn"><div><input name="password" type="password"></div><div>Continue</div></form></section>
        <form data-testid="x-active-form"><iframe title="Continue with Google" sandbox srcdoc="<button type='button'>Continue with Google</button>"></iframe><button id="x-apple" type="button">Continue with Apple</button><button id="x-phone" type="button">Continue with phone</button><label for="x-username">Email or username</label><input id="x-username" name="username_or_email" type="text" autocomplete="username webauthn"><div data-testid="x-hidden-password" style="display: none"><input id="x-password" name="password" type="password"></div><div data-testid="x-continue">Continue</div></form>
        <p id="site-status" role="status"></p></main>
        <script>const form = document.querySelector('[data-testid="x-active-form"]'); form.addEventListener('submit', (event) => { event.preventDefault(); const username = form.querySelector('[name="username_or_email"]').value; const password = form.querySelector('[name="password"]').value; if (username === 'pilot@example.test' && password === '') document.querySelector('#site-status').textContent = 'X identifier submitted'; });</script>
      </body></html>`)
  await page.evaluate(installDemoChromeStub, stubArgs)
  await injectPilotAutofill(page)

  const form = page.getByTestId('x-active-form')
  const widget = page.locator('#nook-auth-widget')
  await expect(form).not.toHaveAttribute('method')
  await expect(form).not.toHaveAttribute('action')
  await expect(form.locator('[name="username_or_email"]')).toHaveAttribute(
    'autocomplete',
    'username webauthn',
  )
  await expect(page.getByTestId('x-hidden-password')).toBeHidden()
  await expect(form.locator('button[type="button"]')).toHaveCount(2)
  await expect(form.locator('iframe')).toHaveCount(1)
  await expect(page.getByTestId('x-continue')).not.toHaveAttribute('role')
  await expect(widget.getByText('Ready to sign in')).toBeVisible()

  await widget.getByRole('button', { name: 'Continue with Nook' }).click()
  await widget.getByRole('button', { name: 'Continue with Nook' }).click()

  await expect(form.locator('[name="username_or_email"]')).toHaveValue(
    'pilot@example.test',
  )
  await expect(form.locator('[name="password"]')).toHaveValue('')
  await expect(
    page.getByTestId('x-responsive-copy').locator('[name="username_or_email"]'),
  ).toHaveValue('')
  await expect(page.getByRole('status')).toHaveText('X identifier submitted')
  await demoBeat(page)
})
