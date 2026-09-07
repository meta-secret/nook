import { expect, test } from '../fixtures'
import {
  demoBeat,
  injectPilotAutofill,
  loadPilotMessages,
} from './pilot-demo-helpers'
import { demoDomainEnumArgs, installDemoChromeStub } from './static-chrome-stub'

test('fill and submit the Claude email-first form', async ({ page }) => {
  const messages = await loadPilotMessages()
  const stubArgs = {
    localizedMessages: messages,
    ...demoDomainEnumArgs,
    loginPilotFlow: true,
  }
  await page.addInitScript(installDemoChromeStub, stubArgs)
  await page.goto('/login')
  await page.setContent(`<!doctype html>
    <html><head><title>Sign in - Claude</title><style>:root { color-scheme: light; font-family: Inter, system-ui, sans-serif; } * { box-sizing: border-box; } body { margin: 0; min-height: 100vh; color: #191919; background: #f5f4ee; } header { padding: 24px 40px; } nav { display: flex; gap: 24px; align-items: center; } nav a:first-child { margin-right: auto; font-size: 24px; font-weight: 750; } a { color: inherit; } main { width: min(440px, calc(100vw - 48px)); margin: 80px auto; padding: 40px; border-radius: 16px; background: #fff; box-shadow: 0 18px 60px #3e3a2c26; } h1 { margin-top: 0; } form, label { display: grid; gap: 10px; } button, input { min-height: 48px; width: 100%; margin: 8px 0; padding: 11px 13px; border: 1px solid #999; border-radius: 9px; background: #fff; color: inherit; font: inherit; } [type="submit"] { background: #1f1f1f; color: #fff; font-weight: 700; } .separator { text-align: center; } #site-status { min-height: 24px; color: #247145; }</style></head>
      <body><header><nav aria-label="Claude"><a href="/" data-auxiliary>Claude</a><a href="/product" data-auxiliary>Product</a><a href="/work" data-auxiliary>For work</a></nav></header>
      <main><h1>Sign in</h1><button type="button" data-google>Continue with Google</button><p class="separator">or</p>
        <form method="post" data-testid="claude-email-form"><label>Email<input name="email" type="email" autocomplete="email" aria-label="Email"></label><button type="submit">Continue with email</button></form>
        <button type="button" data-sso>Continue with SSO</button><p data-testid="claude-disclosure">By continuing, you acknowledge our <a href="/privacy" data-auxiliary>privacy policy</a> and product update disclosure.</p><p id="site-status" role="status"></p>
      </main><script>document.querySelectorAll('[data-google], [data-sso], [data-auxiliary]').forEach((control) => { control.addEventListener('click', (event) => { event.preventDefault(); control.setAttribute('data-activated', ''); }); }); document.querySelector('[data-testid="claude-email-form"]').addEventListener('submit', (event) => { event.preventDefault(); const form = event.currentTarget; if (event.submitter.textContent.trim() === 'Continue with email' && form.method === 'post' && !form.hasAttribute('action') && form.elements.email.value === 'pilot@example.test' && !document.querySelector('[data-activated]')) document.querySelector('#site-status').textContent = 'Claude authentication complete'; });</script>
      </body></html>`)
  await page.evaluate(installDemoChromeStub, stubArgs)
  await injectPilotAutofill(page)

  const form = page.getByTestId('claude-email-form')
  const email = form.getByLabel('Email')
  const widget = page.locator('#nook-auth-widget')
  await expect(page).toHaveTitle('Sign in - Claude')
  await expect(form).toHaveAttribute('method', 'post')
  await expect(form).not.toHaveAttribute('action')
  await expect(email).toHaveAttribute('autocomplete', 'email')
  await expect(
    form.getByRole('button', { name: 'Continue with email' }),
  ).toHaveAttribute('type', 'submit')
  await expect(
    page.getByRole('button', { name: 'Continue with Google' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Continue with SSO' }),
  ).toBeVisible()
  await expect(widget.getByText('Ready to sign in')).toBeVisible()

  await widget.getByRole('button', { name: 'Continue with Nook' }).click()
  await widget.getByRole('button', { name: 'Continue with Nook' }).click()

  await expect(email).toHaveValue('pilot@example.test')
  await expect(page.getByRole('status')).toHaveText(
    'Claude authentication complete',
  )
  await expect(page.getByTestId('claude-disclosure')).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Claude' })).toBeVisible()
  await demoBeat(page)
})
