import { expect, test } from '../fixtures'
import {
  demoBeat,
  injectPilotAutofill,
  loadPilotMessages,
} from './pilot-demo-helpers'
import { demoDomainEnumArgs, installDemoChromeStub } from './static-chrome-stub'

test('fill only the local login inside a page-wide ASP.NET form', async ({
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
    <html><head><title>Page-wide account sign in</title><style>:root { color-scheme: dark; font-family: Inter, system-ui, sans-serif; } * { box-sizing: border-box; } body { margin: 0; background: #090b12; color: #f7f8fb; } #aspnetForm { min-height: 100vh; display: grid; grid-template-rows: auto 1fr auto; } header, footer { display: flex; gap: 12px; align-items: center; padding: 18px 28px; background: #141824; } footer { justify-content: center; color: #aab2c5; } .loginBox { place-self: center; width: min(440px, calc(100vw - 48px)); padding: 38px; border: 1px solid #30384d; border-radius: 20px; background: #171b28; box-shadow: 0 24px 80px #0008; } h1 { margin: 0 0 8px; } p { color: #aab2c5; } label { display: grid; gap: 7px; margin-top: 16px; } input, button { min-height: 44px; padding: 10px 12px; border: 1px solid #39435b; border-radius: 9px; background: #0e111a; color: inherit; font: inherit; } .loginBox [type="submit"] { width: 100%; margin-top: 20px; background: #eef1f7; color: #111522; font-weight: 750; } #site-status { min-height: 22px; color: #8fddb0; }</style></head>
      <body>
        <form id="aspnetForm" method="post" onsubmit="event.preventDefault(); document.querySelector('#site-status').textContent = event.submitter.id === 'login-submit' ? 'Local login submitted' : 'External page control activated'">
          <header><strong>Example Domains</strong><input name="LoginUserName" title="Your username" autocomplete="on" hidden><input name="LoginPassword" title="Your password" type="password" autocomplete="on" hidden><input name="search" type="search" value="account help"><button type="submit">Search</button></header>
          <div class="gb-scope loginBox nc_login"><div class="gb-panel"><div class="gb-panel__body"><fieldset class="loginForm"><h1>Sign in</h1><p>Nook should recognize only this local authentication surface.</p><label>Username<input name="LoginUserName" title="Your username" autocomplete="on" class="gb-form-control nc_username nc_username_required"></label><label>Password<input name="LoginPassword" title="Your password" type="password" autocomplete="on" class="nc_password nc_password_required handlereturn gb-form-control"></label><input id="login-submit" type="submit" value="Sign in" class="nc_login_submit"><p id="site-status" role="status"></p></fieldset></div></div></div>
          <footer><span>Product updates</span><input name="newsletter-email" type="email" value="reader@example.test"><button type="button">Use a passkey</button><button type="submit">Subscribe</button></footer>
        </form></body></html>`)
  await page.evaluate(installDemoChromeStub, stubArgs)
  await injectPilotAutofill(page)

  const widget = page.locator('#nook-auth-widget')
  await expect(widget.getByText('Ready to sign in')).toBeVisible()
  await widget.getByRole('button', { name: 'Continue with Nook' }).click()
  await widget.getByRole('button', { name: 'Continue with Nook' }).click()

  await expect(page.locator('.loginForm [name="LoginUserName"]')).toHaveValue(
    'pilot@example.test',
  )
  await expect(page.locator('.loginForm [name="LoginPassword"]')).toHaveValue(
    'demo-password-never-recorded',
  )
  await expect(page.locator('header [name="LoginUserName"]')).toHaveValue('')
  await expect(page.locator('header [name="LoginPassword"]')).toHaveValue('')
  await expect(page.locator('[name="search"]')).toHaveValue('account help')
  await expect(page.locator('[name="newsletter-email"]')).toHaveValue(
    'reader@example.test',
  )
  await expect(page.getByRole('status')).toHaveText('Local login submitted')
  await demoBeat(page)
})
