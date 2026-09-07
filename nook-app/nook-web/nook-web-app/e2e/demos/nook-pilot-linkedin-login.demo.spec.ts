import { expect, test } from '../fixtures'
import {
  demoBeat,
  injectPilotAutofill,
  loadPilotMessages,
} from './pilot-demo-helpers'
import { demoDomainEnumArgs, installDemoChromeStub } from './static-chrome-stub'

test('fill and activate the form-less LinkedIn login surface', async ({
  page,
}) => {
  const messages = await loadPilotMessages()
  const stubArgs = {
    localizedMessages: messages,
    ...demoDomainEnumArgs,
    loginPilotFlow: true,
  }
  await page.addInitScript(installDemoChromeStub, stubArgs)
  await page.goto('/login/')
  await page.setContent(`<!doctype html>
    <html><head><title>LinkedIn sign in</title><style>:root { color-scheme: light; font-family: Inter, system-ui, sans-serif; } * { box-sizing: border-box; } body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f4f2ee; color: #1d2226; } main { width: min(420px, calc(100vw - 48px)); padding: 36px; border-radius: 10px; background: #fff; box-shadow: 0 8px 28px #0002; } h1 { margin-top: 0; } [data-testid='linkedin-active-surface'] { display: grid; gap: 14px; } label { display: grid; gap: 6px; } input, button, select { min-height: 46px; padding: 10px 12px; border: 1px solid #56687a; border-radius: 6px; font: inherit; } [data-testid='linkedin-sign-in'] { border-radius: 999px; background: #0a66c2; color: #fff; font-weight: 700; } nav { display: flex; gap: 12px; margin-top: 16px; flex-wrap: wrap; } #site-status { min-height: 24px; color: #167642; }</style></head>
      <body><main><h1>Sign in</h1><section data-testid="linkedin-active-surface">
        <label>Email or phone<input type="email" autocomplete="username"></label>
        <label>Password<input type="password" autocomplete="current-password"></label>
        <button type="button" data-alternative>Show password</button>
        <label><input type="checkbox" checked>Keep me signed in</label>
        <a href="/checkpoint/rp/request-password-reset" data-alternative>Forgot password?</a>
        <button type="button" data-testid="linkedin-sign-in">Sign in</button>
      </section><button type="button" data-alternative>Sign in with Apple</button><a href="/signup" data-alternative>Join now</a>
      <nav aria-label="Legal and help"><a href="/legal/privacy-policy" data-alternative>Privacy Policy</a><a href="/help" data-alternative>Help Center</a></nav>
      <section data-testid="linkedin-responsive-duplicate" hidden><label>Email or phone<input type="email" autocomplete="username"></label><label>Password<input type="password" autocomplete="current-password"></label><button type="button">Sign in</button></section>
      <p id="site-status" role="status"></p></main>
      <script>const active = document.querySelector('[data-testid="linkedin-active-surface"]'); let alternatives = 0; document.querySelectorAll('[data-alternative]').forEach((control) => control.addEventListener('click', (event) => { event.preventDefault(); alternatives += 1; })); active.querySelector('[data-testid="linkedin-sign-in"]').addEventListener('click', () => { const fields = active.querySelectorAll('input'); const hidden = document.querySelector('[data-testid="linkedin-responsive-duplicate"]'); const hiddenFields = hidden.querySelectorAll('input'); if (fields[0].value === 'pilot@example.test' && fields[1].value === 'demo-password-never-recorded' && fields[2].checked && [...hiddenFields].every((field) => field.value === '') && alternatives === 0) document.querySelector('#site-status').textContent = 'LinkedIn authentication complete'; });</script>
      </body></html>`)
  await page.evaluate(installDemoChromeStub, stubArgs)
  await injectPilotAutofill(page)

  const active = page.getByTestId('linkedin-active-surface')
  const username = active.getByLabel('Email or phone')
  const password = active.getByLabel('Password')
  const primary = active.getByRole('button', { name: 'Sign in' })
  const duplicate = page.getByTestId('linkedin-responsive-duplicate')
  const widget = page.locator('#nook-auth-widget')

  await expect(page.locator('form')).toHaveCount(0)
  await expect(primary).toHaveAttribute('type', 'button')
  await expect(username).toHaveAttribute('autocomplete', 'username')
  await expect(password).toHaveAttribute('autocomplete', 'current-password')
  expect(
    await active
      .locator('input[type="email"], input[type="password"]')
      .evaluateAll((fields) =>
        fields.every(
          (field) => !field.hasAttribute('id') && !field.hasAttribute('name'),
        ),
      ),
  ).toBe(true)
  await expect(duplicate).toBeHidden()
  await expect(widget.getByText('Ready to sign in')).toBeVisible()

  await widget.getByRole('button', { name: 'Continue with Nook' }).click()
  await widget.getByRole('button', { name: 'Continue with Nook' }).click()

  await expect(username).toHaveValue('pilot@example.test')
  await expect(password).toHaveValue('demo-password-never-recorded')
  expect(
    await duplicate
      .locator('input')
      .evaluateAll((fields) =>
        fields.map((field) => (field as HTMLInputElement).value),
      ),
  ).toEqual(['', ''])
  await expect(active.getByLabel('Keep me signed in')).toBeChecked()
  await expect(
    page.getByRole('button', { name: 'Sign in with Apple' }),
  ).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'Forgot password?' }),
  ).toBeVisible()
  await expect(page.getByRole('link', { name: 'Join now' })).toBeVisible()
  await expect(page.getByRole('status')).toHaveText(
    'LinkedIn authentication complete',
  )
  await demoBeat(page)
})
