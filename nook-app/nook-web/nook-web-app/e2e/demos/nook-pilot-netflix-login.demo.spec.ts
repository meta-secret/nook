import { expect, test } from '../fixtures'
import {
  demoBeat,
  injectPilotAutofill,
  loadPilotMessages,
} from './pilot-demo-helpers'
import { demoDomainEnumArgs, installDemoChromeStub } from './static-chrome-stub'

test('fill and submit the Netflix combined credential form', async ({
  page,
}) => {
  const messages = await loadPilotMessages()
  const stubArgs = {
    localizedMessages: messages,
    ...demoDomainEnumArgs,
    loginPilotFlow: true,
  }
  await page.addInitScript(installDemoChromeStub, stubArgs)
  await page.goto('/login')
  await page.setContent(`<!doctype html>
    <html><head><title>Netflix sign in simulation</title><style>:root { color-scheme: dark; font-family: Inter, system-ui, sans-serif; } * { box-sizing: border-box; } body { margin: 0; min-height: 100vh; display: grid; grid-template-rows: 1fr auto; background: #111; color: #fff; } main { place-self: center; width: min(460px, calc(100vw - 48px)); padding: 40px; border-radius: 12px; background: #202020; box-shadow: 0 20px 70px #0009; } h1 { margin-top: 0; } form { display: grid; gap: 16px; } label { display: grid; gap: 7px; } input, button, select { min-height: 48px; padding: 11px 13px; border: 1px solid #777; border-radius: 6px; background: #171717; color: inherit; font: inherit; } [type="submit"] { background: #d71920; border-color: #d71920; font-weight: 750; } a { color: #d3d3d3; } footer { display: flex; gap: 18px; align-items: center; justify-content: center; flex-wrap: wrap; padding: 22px; color: #bbb; } #site-status { min-height: 24px; color: #91e6af; }</style></head>
      <body><main><h1>Enter your info to sign in</h1>
        <form method="post" data-testid="netflix-login-form">
          <label>Email or mobile number<input name="userLoginId" type="text" autocomplete="email" aria-label="Email or mobile number"></label>
          <label>Password<input name="password" type="password" autocomplete="password" aria-label="Password"></label>
          <button type="submit">Continue</button><button type="button" data-auxiliary>Get Help</button>
        </form><section><h2>Or get started with a new account.</h2><a href="/signup" data-auxiliary>Sign up</a></section>
        <p data-testid="netflix-recaptcha-disclosure">This page is protected by reCAPTCHA to ensure you're not a bot.</p><p id="site-status" role="status"></p>
      </main><footer><a href="/help" data-auxiliary>Questions? Contact us.</a><a href="/terms" data-auxiliary>Terms of Use</a><a href="/privacy" data-auxiliary>Privacy</a><label>Language<select data-auxiliary><option>English</option></select></label></footer>
      <script>let auxiliaryActivations = 0; document.querySelectorAll('[data-auxiliary]').forEach((control) => { control.addEventListener('click', (event) => { event.preventDefault(); auxiliaryActivations += 1; }); control.addEventListener('change', () => { auxiliaryActivations += 1; }); }); document.querySelector('[data-testid="netflix-login-form"]').addEventListener('submit', (event) => { event.preventDefault(); const form = event.currentTarget; const valid = event.submitter.textContent.trim() === 'Continue' && form.method === 'post' && !form.hasAttribute('action') && form.elements.userLoginId.value === 'pilot@example.test' && form.elements.password.value === 'demo-password-never-recorded' && auxiliaryActivations === 0; if (valid) document.querySelector('#site-status').textContent = 'Netflix authentication complete'; });</script>
      </body></html>`)
  await page.evaluate(installDemoChromeStub, stubArgs)
  await injectPilotAutofill(page)

  const form = page.getByTestId('netflix-login-form')
  const username = form.locator('[name="userLoginId"]')
  const password = form.locator('[name="password"]')
  const widget = page.locator('#nook-auth-widget')
  await expect(form).toHaveAttribute('method', 'post')
  await expect(form).not.toHaveAttribute('action')
  await expect(username).toHaveAttribute('autocomplete', 'email')
  await expect(password).toHaveAttribute('autocomplete', 'password')
  await expect(form.getByRole('button', { name: 'Get Help' })).toHaveAttribute(
    'type',
    'button',
  )
  await expect(widget.getByText('Ready to sign in')).toBeVisible()

  await widget.getByRole('button', { name: 'Continue with Nook' }).click()
  await widget.getByRole('button', { name: 'Continue with Nook' }).click()

  await expect(username).toHaveValue('pilot@example.test')
  await expect(password).toHaveValue('demo-password-never-recorded')
  await expect(page.getByRole('status')).toHaveText(
    'Netflix authentication complete',
  )
  await expect(page.getByTestId('netflix-recaptcha-disclosure')).toBeVisible()
  await expect(page.getByLabel('Language')).toBeVisible()
  await demoBeat(page)
})
