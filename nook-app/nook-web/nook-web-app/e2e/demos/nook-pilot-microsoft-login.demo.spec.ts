import { expect, test } from '../fixtures'
import {
  demoBeat,
  injectPilotAutofill,
  loadPilotMessages,
} from './pilot-demo-helpers'
import { demoDomainEnumArgs, installDemoChromeStub } from './static-chrome-stub'

test('retain Microsoft identifier login during repeated adornment writes, then fill and advance', async ({
  page,
}) => {
  const stubArgs = {
    localizedMessages: await loadPilotMessages(),
    ...demoDomainEnumArgs,
    loginPilotFlow: true,
  }
  await page.addInitScript(installDemoChromeStub, stubArgs)
  await page.route('https://login.live.com/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><head><title>Microsoft identifier simulation</title>
      <style>body { font: 18px system-ui; background: #e9edf5; display: grid; min-height: 95vh; place-items: center; } main { background: white; border-radius: 16px; padding: 40px; width: 360px; } form { display: grid; gap: 20px; } label { display: grid; gap: 8px; } input, button { padding: 12px; font: inherit; } button[type=submit] { color: white; background: #0067b8; border: 0; }</style>
      </head><body><form aria-hidden="true" hidden method="post"></form><main>
      <h1>Sign in</h1><p>Use your Microsoft account.</p>
      <form class="___cqaz2i0 fly5x3f" method="post" data-testid="microsoft-identifier-form">
        <label>Email or phone number<input id="usernameEntry" type="email" autocomplete="username webauthn" style="padding-right: 35px !important;"></label>
        <button type="button">Forgot your username?</button>
        <button type="submit" data-testid="primaryButton">Next</button>
      </form></main></body></html>`,
    }),
  )
  await page.goto(
    'https://login.live.com/oauth20_authorize.srf?client_id=fixture',
  )
  const form = page.getByTestId('microsoft-identifier-form')
  await form.evaluate((element) =>
    element.addEventListener('submit', (event) => {
      event.preventDefault()
      element.setAttribute('data-submitted', 'true')
    }),
  )
  await page.evaluate(installDemoChromeStub, stubArgs)
  await injectPilotAutofill(page)
  const widget = page.locator('#nook-auth-widget')
  await expect(widget.getByText('Ready to sign in')).toBeVisible()
  const retainedFrames = await page
    .locator('#usernameEntry')
    .evaluate(async (field) => {
      let retained = 0
      for (let frame = 0; frame < 60; frame += 1) {
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        )
        field.setAttribute('style', 'padding-right: 35px !important;')
        retained += Number(Boolean(document.getElementById('nook-auth-widget')))
      }
      return retained
    })
  expect(retainedFrames).toBe(60)
  await widget.getByRole('button', { name: 'Continue with Nook' }).click()
  await widget.getByRole('button', { name: 'Continue with Nook' }).click()
  await expect(page.locator('#usernameEntry')).toHaveValue('pilot@example.test')
  await expect(form).toHaveAttribute('data-submitted', 'true')
  await demoBeat(page)
})
