import { expect, test } from '../fixtures'
import {
  demoBeat,
  injectPilotAutofill,
  loadPilotMessages,
} from './pilot-demo-helpers'
import { demoDomainEnumArgs, installDemoChromeStub } from './static-chrome-stub'

test('keeps a detached password login with its browser-owned form', async ({
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
    <html>
      <head>
        <title>Detached account sign in</title>
        <style>
          :root { color-scheme: dark; font-family: Inter, system-ui, sans-serif; }
          * { box-sizing: border-box; }
          body { min-height: 100vh; margin: 0; display: grid; place-items: center; background: #10131b; color: #f7f8fb; }
          main { width: min(440px, calc(100vw - 48px)); padding: 36px; border: 1px solid #374055; border-radius: 18px; background: #1a1f2c; }
          h1 { margin: 0 0 8px; }
          p { color: #b1bad0; }
          .fields { display: grid; gap: 16px; }
          label { display: grid; gap: 8px; }
          input, button { min-height: 46px; padding: 10px 12px; border: 1px solid #45506a; border-radius: 9px; background: #10131b; color: inherit; font: inherit; }
          button { border: 0; background: #f2f4f8; color: #151924; font-weight: 750; }
          #site-status { min-height: 22px; color: #98d9af; }
        </style>
      </head>
      <body>
        <main>
          <h1>Welcome back</h1>
          <p>Sign in to your account.</p>
          <form id="account-authentication" method="post"></form>
          <section class="fields" aria-label="Account sign in">
            <label>Email<input form="account-authentication" name="email" type="email" autocomplete="username"></label>
            <label>Password<input form="account-authentication" name="password" type="password" autocomplete="current-password"></label>
            <button form="account-authentication" type="submit">Sign in</button>
          </section>
          <p id="site-status" role="status"></p>
        </main>
      </body>
    </html>`)
  await page.evaluate(() => {
    document
      .querySelector('#account-authentication')
      ?.addEventListener('submit', (event) => {
        event.preventDefault()
        const status = document.querySelector('#site-status')
        if (status) status.textContent = 'Detached form login submitted'
      })
  })
  await page.evaluate(installDemoChromeStub, stubArgs)
  await injectPilotAutofill(page)

  const widget = page.locator('#nook-auth-widget')
  await expect(widget.getByText('Ready to sign in')).toBeVisible()
  await widget.getByRole('button', { name: 'Continue with Nook' }).click()
  await widget.getByRole('button', { name: 'Continue with Nook' }).click()

  await expect(page.locator('[name="email"]')).toHaveValue('pilot@example.test')
  await expect(page.locator('[name="password"]')).toHaveValue(
    'demo-password-never-recorded',
  )
  await expect(page.getByRole('status')).toHaveText(
    'Detached form login submitted',
  )
  await demoBeat(page)
})
