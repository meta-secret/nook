import { expect, test } from '../fixtures'
import {
  demoBeat,
  injectPilotAutofill,
  loadPilotMessages,
} from './pilot-demo-helpers'
import { demoDomainEnumArgs, installDemoChromeStub } from './static-chrome-stub'

test('fill and continue through the Tesla email-first surface', async ({
  page,
}) => {
  const messages = await loadPilotMessages()
  const stubArgs = {
    localizedMessages: messages,
    ...demoDomainEnumArgs,
    loginPilotFlow: true,
  }
  await page.addInitScript(installDemoChromeStub, stubArgs)
  await page.goto('/oauth2/v1/authorize')
  await page.setContent(`<!doctype html>
    <html><head><title>Tesla Auth - Sign In</title><style>:root { color-scheme: light; font-family: Inter, system-ui, sans-serif; } * { box-sizing: border-box; } body { margin: 0; min-height: 100vh; color: #171a20; background: #fff; } header { padding: 24px 40px; } header a { color: inherit; font-size: 20px; font-weight: 750; text-decoration: none; } main { width: min(390px, calc(100vw - 48px)); margin: 52px auto; } h1 { margin: 0 0 32px; text-align: center; } form, label { display: grid; gap: 10px; } button, input { min-height: 48px; padding: 11px 13px; border: 1px solid #777; border-radius: 4px; background: #fff; color: inherit; font: inherit; } form button { background: #3e6ae1; border-color: #3e6ae1; color: #fff; font-weight: 700; } form button:disabled { background: #d0d1d2; border-color: #d0d1d2; } main > a, main > button { display: block; width: 100%; margin-top: 18px; text-align: center; } main > p { text-align: center; } footer { display: flex; justify-content: center; gap: 18px; margin-top: 80px; } #site-status { min-height: 24px; color: #167342; }</style></head>
      <body><header><a href="https://www.tesla.com/" aria-label="Tesla home" data-auxiliary>Tesla</a></header><main><h1>Sign In</h1>
        <form data-testid="tesla-auth-form"><label>Email<input name="identity" autocomplete="email webauthn" aria-label="Email"></label><button type="submit" disabled data-testid="tesla-primary">Next</button></form>
        <a href="/forgot" data-auxiliary>Trouble Signing In?</a><p>Or</p><button type="button" data-auxiliary>Create Account</button><button type="button" data-auxiliary>Select Language</button><p id="site-status" role="status"></p></main>
        <footer><a href="/privacy" data-auxiliary>Privacy</a><a href="/contact" data-auxiliary>Contact</a></footer>
        <script>const email = document.querySelector('[name="identity"]'); const next = document.querySelector('[data-testid="tesla-primary"]'); email.addEventListener('input', () => { next.disabled = email.value.trim().length === 0; }); document.querySelectorAll('[data-auxiliary]').forEach((control) => { control.addEventListener('click', (event) => { event.preventDefault(); control.setAttribute('data-activated', ''); }); }); document.querySelector('[data-testid="tesla-auth-form"]').addEventListener('submit', (event) => { event.preventDefault(); if (email.value === 'pilot@example.test' && !document.querySelector('[data-activated]')) document.querySelector('#site-status').textContent = 'Tesla authentication complete'; });</script>
      </body></html>`)
  await page.evaluate(installDemoChromeStub, stubArgs)
  await injectPilotAutofill(page)

  const form = page.getByTestId('tesla-auth-form')
  const email = form.getByLabel('Email')
  const next = form.getByRole('button', { name: 'Next' })
  const widget = page.locator('#nook-auth-widget')
  await expect(page).toHaveTitle('Tesla Auth - Sign In')
  await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible()
  await expect(page.locator('form')).toHaveCount(1)
  await expect(form).not.toHaveAttribute('method')
  await expect(form).not.toHaveAttribute('action')
  await expect(form).toHaveJSProperty('method', 'get')
  await expect(email).not.toHaveAttribute('type')
  await expect(email).toHaveAttribute('name', 'identity')
  await expect(email).toHaveAttribute('autocomplete', 'email webauthn')
  await expect(next).toBeDisabled()
  await expect(page.getByText('Trouble Signing In?')).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Create Account' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Select Language' }),
  ).toBeVisible()
  await expect(widget.getByText('Ready to sign in')).toBeVisible()

  await widget.getByRole('button', { name: 'Continue with Nook' }).click()
  await widget.getByRole('button', { name: 'Continue with Nook' }).click()

  await expect(email).toHaveValue('pilot@example.test')
  await expect(next).toBeEnabled()
  await expect(page.getByRole('status')).toHaveText(
    'Tesla authentication complete',
  )
  await expect(page.locator('[data-activated]')).toHaveCount(0)
  await expect(page.getByText('hCaptcha')).toHaveCount(0)
  await demoBeat(page)
})
