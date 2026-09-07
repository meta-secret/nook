import { expect, test } from '../fixtures'
import {
  demoBeat,
  injectPilotAutofill,
  loadPilotMessages,
} from './pilot-demo-helpers'
import { demoDomainEnumArgs, installDemoChromeStub } from './static-chrome-stub'

test('fill and continue through the Booking.com email-first surface', async ({
  page,
}) => {
  const messages = await loadPilotMessages()
  const stubArgs = {
    localizedMessages: messages,
    ...demoDomainEnumArgs,
    loginPilotFlow: true,
  }
  await page.addInitScript(installDemoChromeStub, stubArgs)
  await page.goto('/sign-in')
  await page.setContent(`<!doctype html>
    <html><head><title>Sign in or create an account | Booking.com</title><style>:root { color-scheme: light; font-family: Inter, system-ui, sans-serif; } * { box-sizing: border-box; } body { margin: 0; min-height: 100vh; color: #1a1a1a; background: #fff; } header { display: flex; gap: 18px; align-items: center; padding: 22px 44px; background: #003b95; color: #fff; } header a:first-child { margin-right: auto; font-size: 22px; font-weight: 750; } a { color: #06c; } header a { color: #fff; } main { width: min(440px, calc(100vw - 48px)); margin: 70px auto; } h1 { margin: 0 0 12px; } [data-testid="booking-email-surface"], label { display: grid; gap: 10px; } button, input, select { min-height: 48px; padding: 11px 13px; border: 1px solid #777; border-radius: 6px; background: #fff; color: inherit; font: inherit; } [data-testid="booking-primary"] { background: #0671ce; border-color: #0671ce; color: #fff; font-weight: 700; } nav { display: flex; gap: 12px; margin: 20px 0; } nav a { padding: 12px; border: 1px solid #bbb; border-radius: 6px; } #site-status { min-height: 24px; color: #167342; }</style></head>
      <body><header><a href="/" data-auxiliary>Booking.com</a><button aria-label="Select your language" data-auxiliary>English</button><a href="/help" aria-label="Help and support" data-auxiliary>Help</a></header>
      <main><h1>Sign in or create an account</h1><p>You can sign in using your Booking.com account to access our services.</p>
        <form data-testid="booking-auth-form"><section data-testid="booking-email-surface"><label>Email address<input type="email" name="username" autocomplete="username webauthn" aria-label="Email address" placeholder="Enter your email address"></label><button type="submit" data-testid="booking-primary">Continue with email</button></section>
          <p>or use one of these options</p><nav aria-label="Alternative sign-in options"><a href="/social/consent/google" data-auxiliary>Sign in with Google</a><a href="/social/consent/apple" data-auxiliary>Sign in with Apple</a><a href="/social/consent/facebook" data-auxiliary>Sign in with Facebook</a></nav>
          <p>Lost access to your email? <a href="/recover" data-auxiliary>Recover your account</a></p></form><p data-testid="booking-disclosure">By signing in or creating an account, you agree with our <a href="/terms" data-auxiliary>Terms &amp; Conditions</a> and <a href="/privacy" data-auxiliary>Privacy Statement</a>.</p><p id="site-status" role="status"></p>
      </main><script>document.querySelectorAll('[data-auxiliary]').forEach((control) => { control.addEventListener('click', (event) => { event.preventDefault(); control.setAttribute('data-activated', ''); }); }); document.querySelector('[data-testid="booking-auth-form"]').addEventListener('submit', (event) => { event.preventDefault(); const email = document.querySelector('[name="username"]'); if (email.value === 'pilot@example.test' && !document.querySelector('[data-activated]')) document.querySelector('#site-status').textContent = 'Booking.com authentication complete'; });</script>
      </body></html>`)
  await page.evaluate(installDemoChromeStub, stubArgs)
  await injectPilotAutofill(page)

  const surface = page.getByTestId('booking-email-surface')
  const email = surface.getByLabel('Email address')
  const widget = page.locator('#nook-auth-widget')
  await expect(page).toHaveTitle('Sign in or create an account | Booking.com')
  const form = page.getByTestId('booking-auth-form')
  await expect(page.locator('form')).toHaveCount(1)
  await expect(form).not.toHaveAttribute('method')
  await expect(form).not.toHaveAttribute('action')
  await expect(form).toHaveJSProperty('method', 'get')
  await expect(email).toHaveAttribute('name', 'username')
  await expect(email).toHaveAttribute('type', 'email')
  await expect(email).toHaveAttribute('autocomplete', 'username webauthn')
  await expect(
    page.getByRole('navigation', { name: 'Alternative sign-in options' }),
  ).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'Recover your account' }),
  ).toBeVisible()
  await expect(widget.getByText('Ready to sign in')).toBeVisible()

  await widget.getByRole('button', { name: 'Continue with Nook' }).click()
  await widget.getByRole('button', { name: 'Continue with Nook' }).click()

  await expect(email).toHaveValue('pilot@example.test')
  await expect(page.getByRole('status')).toHaveText(
    'Booking.com authentication complete',
  )
  await expect(page.getByTestId('booking-disclosure')).toBeVisible()
  await expect(page.locator('[data-activated]')).toHaveCount(0)
  await demoBeat(page)
})
