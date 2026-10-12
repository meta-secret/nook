import { expect, test } from '../fixtures'
import {
  demoBeat,
  injectPilotAutofill,
  loadPilotMessages,
} from './pilot-demo-helpers'
import { demoDomainEnumArgs, installDemoChromeStub } from './static-chrome-stub'

function installMicrosoftLoginStages(element: HTMLElement | SVGElement): void {
  enum MicrosoftLoginStage {
    Identifier = 'identifier',
    Password = 'password',
    Complete = 'complete',
  }
  let stage = MicrosoftLoginStage.Identifier
  element.addEventListener('submit', (event) => {
    event.preventDefault()
    switch (stage) {
      case MicrosoftLoginStage.Identifier: {
        const identifier: HTMLInputElement | undefined =
          element.querySelectorAll<HTMLInputElement>('#usernameEntry')[0]
        switch (identifier) {
          case undefined:
            throw new Error('Microsoft identifier fixture input missing')
        }
        element.setAttribute('data-identifier', identifier.value)
        element.innerHTML =
          '<label>Password<input id="passwordEntry" type="password" autocomplete="current-password"></label><button type="submit" data-testid="primaryButton">Sign in</button>'
        stage = MicrosoftLoginStage.Password
        element.setAttribute('data-stage', stage)
        break
      }
      case MicrosoftLoginStage.Password: {
        const password: HTMLInputElement | undefined =
          element.querySelectorAll<HTMLInputElement>('#passwordEntry')[0]
        switch (password) {
          case undefined:
            throw new Error('Microsoft password fixture input missing')
        }
        element.setAttribute('data-password', password.value)
        stage = MicrosoftLoginStage.Complete
        element.setAttribute('data-stage', stage)
        element.innerHTML =
          '<p role="status">Microsoft authentication complete</p>'
        break
      }
      case MicrosoftLoginStage.Complete:
        break
    }
  })
}

test('retain Microsoft identifier login during adornment writes, then fill both login stages', async ({
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
  await form.evaluate(installMicrosoftLoginStages)
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
  await expect(form).toHaveAttribute('data-identifier', 'pilot@example.test')
  await expect(form).toHaveAttribute('data-stage', 'password')
  await expect(page.locator('#passwordEntry')).toBeVisible()
  await demoBeat(page)
  await expect(
    widget.getByRole('button', { name: 'Continue with Nook' }),
  ).toBeVisible()
  await widget.getByRole('button', { name: 'Continue with Nook' }).click()
  await expect(form).toHaveAttribute(
    'data-password',
    'demo-password-never-recorded',
  )
  await expect(form).toHaveAttribute('data-stage', 'complete')
  await expect(form.getByRole('status')).toHaveText(
    'Microsoft authentication complete',
  )
  await demoBeat(page)
})
