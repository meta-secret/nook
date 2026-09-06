import { expect, test } from '../fixtures'
import {
  demoBeat,
  injectPilotAutofill,
  loadPilotMessages,
} from './pilot-demo-helpers'
import { demoDomainEnumArgs, installDemoChromeStub } from './static-chrome-stub'

test('complete Apple identifier-first authentication beside its passkey alternative', async ({
  page,
}) => {
  const messages = await loadPilotMessages()
  const stubArgs = {
    localizedMessages: messages,
    ...demoDomainEnumArgs,
    loginPilotFlow: true,
  }
  await page.addInitScript(installDemoChromeStub, stubArgs)
  await page.goto('/')
  await page.setContent(`<!doctype html>
    <html><head><title>Apple Account sign in</title><style>:root { color-scheme: dark; font-family: Inter, system-ui, sans-serif; } * { box-sizing: border-box; } body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #07080b; color: #f5f5f7; } main { width: min(460px, calc(100vw - 48px)); padding: 42px; border: 1px solid #35363a; border-radius: 24px; background: #17181c; box-shadow: 0 28px 90px #0009; } h1 { margin-top: 0; } fieldset { border: 0; padding: 0; } label { display: grid; gap: 8px; margin: 20px 0; } input, button { width: 100%; min-height: 48px; padding: 11px 14px; border: 1px solid #484a50; border-radius: 12px; background: #0d0e11; color: inherit; font: inherit; } button { margin-top: 12px; cursor: pointer; } [type='submit'] { background: #f5f5f7; color: #111216; font-weight: 750; } [type='submit']:disabled { opacity: .45; } #site-status { min-height: 24px; color: #83d4a6; }</style></head>
      <body><main><h1>Sign in to Apple Account</h1><p id="step">identifier</p><form id="sign-in-form" method="post"><fieldset aria-label="Sign in to Apple Account"><label>Email or Phone Number<input id="account_name_text_field" name="accountName" type="text" autocomplete="username webauthn" oninput="document.querySelector('#continue').disabled = !this.value"></label><input name="decoyPassword" type="password" hidden><button type="button">Sign in with Passkey</button><button id="continue" type="submit" disabled>Continue</button></fieldset></form><p id="site-status" role="status"></p></main>
        <script>window.appleSubmit = (event) => { event.preventDefault(); const form = event.currentTarget; const submitter = event.submitter instanceof HTMLElement ? event.submitter.id : ''; const value = (selector) => form.querySelector(selector)?.value || ''; const step = document.querySelector('#step'); const status = document.querySelector('#site-status'); if (step.textContent === 'identifier') { if (submitter !== 'continue' || value('#account_name_text_field') !== 'pilot@example.test' || value('[name="decoyPassword"]') !== '') return; step.textContent = 'password'; form.innerHTML = '<fieldset aria-label="Sign in to Apple Account"><label>Email or Phone Number<input id="account_name_text_field" name="accountName" type="text" autocomplete="username webauthn" value="pilot@example.test"></label><label>Password<input id="password_text_field" name="password" type="password" autocomplete="current-password"></label><input name="decoyPassword" type="password" hidden><button type="button">Sign in with Passkey</button><button id="sign-in" type="submit">Sign In</button></fieldset>'; return; } if (submitter === 'sign-in' && value('#account_name_text_field') === 'pilot@example.test' && value('#password_text_field') === 'demo-password-never-recorded' && value('[name="decoyPassword"]') === '') status.textContent = 'Apple authentication complete'; }; document.querySelector('#sign-in-form').addEventListener('submit', window.appleSubmit);</script>
      </body></html>`)
  await page.evaluate(installDemoChromeStub, stubArgs)
  await injectPilotAutofill(page)

  const widget = page.locator('#nook-auth-widget')
  await expect(
    page.getByRole('button', { name: 'Sign in with Passkey' }),
  ).toBeEnabled()
  await expect(page.locator('#continue')).toBeDisabled()
  await expect(widget.getByText('Ready to sign in')).toBeVisible()
  await widget.getByRole('button', { name: 'Continue with Nook' }).click()
  await widget.getByRole('button', { name: 'Continue with Nook' }).click()

  await expect(page.locator('#step')).toHaveText('password')
  await expect(page.locator('#account_name_text_field')).toHaveValue(
    'pilot@example.test',
  )
  await expect(page.locator('[name="decoyPassword"]')).toHaveValue('')
  await expect(
    page.getByRole('button', { name: 'Sign in with Passkey' }),
  ).toBeEnabled()
  await expect(widget.getByText('Ready to sign in')).toBeVisible()
  await widget.getByRole('button', { name: 'Continue with Nook' }).click()

  await expect(page.locator('#password_text_field')).toHaveValue(
    'demo-password-never-recorded',
  )
  await expect(page.locator('[name="decoyPassword"]')).toHaveValue('')
  await expect(page.getByRole('status')).toHaveText(
    'Apple authentication complete',
  )
  await demoBeat(page)
})
