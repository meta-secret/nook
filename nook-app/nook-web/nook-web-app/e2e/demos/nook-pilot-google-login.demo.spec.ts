import { expect, test } from '../fixtures'
import {
  demoBeat,
  injectPilotAutofill,
  loadPilotMessages,
} from './pilot-demo-helpers'
import { demoDomainEnumArgs, installDemoChromeStub } from './static-chrome-stub'

test('detect and complete Google identifier then password-only authentication', async ({
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
    <html><head><title>Google Account sign in</title><style>:root { color-scheme: light; font-family: Inter, system-ui, sans-serif; } * { box-sizing: border-box; } body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f8fafd; color: #202124; } main { width: min(440px, calc(100vw - 48px)); padding: 36px; border: 1px solid #dadce0; border-radius: 14px; background: #fff; box-shadow: 0 8px 28px #0002; } h1 { margin: 0 0 10px; font-size: 28px; font-weight: 500; } p { color: #5f6368; } form { display: grid; gap: 16px; } label { display: grid; gap: 8px; color: #3c4043; } input, button { width: 100%; min-height: 46px; padding: 11px 13px; border: 1px solid #80868b; border-radius: 6px; background: #fff; color: inherit; font: inherit; } button { border: 0; background: #1a73e8; color: #fff; font-weight: 650; cursor: pointer; } #password-step { display: grid; gap: 18px; } #selected-account { padding: 10px 12px; border: 1px solid #dadce0; border-radius: 18px; color: #3c4043; } #site-status { min-height: 24px; color: #137333; } </style></head>
      <body><main><h1>Sign in</h1><p id="step">identifier</p>
        <form id="identifier-form" method="post"><label for="identifierId">Email or phone<input id="identifierId" name="identifier" type="email" autocomplete="username"></label><input name="decoyPassword" type="password" hidden><button id="identifierNext" type="submit">Next</button></form>
        <section id="password-step" hidden aria-label="Google password challenge"><div id="selected-account" data-testid="google-selected-account">pilot@example.test</div><form id="password-form" method="post"><label for="Passwd">Password<input id="Passwd" name="Passwd" type="password" autocomplete="current-password" aria-label="Enter your password"></label><button id="passwordNext" type="submit">Next</button></form></section>
        <p id="site-status" role="status"></p>
      </main><script>const identifierForm = document.querySelector('#identifier-form'); const identifier = document.querySelector('#identifierId'); const decoy = document.querySelector('[name="decoyPassword"]'); const passwordStep = document.querySelector('#password-step'); const passwordForm = document.querySelector('#password-form'); const password = document.querySelector('#Passwd'); const step = document.querySelector('#step'); const status = document.querySelector('#site-status'); identifierForm.addEventListener('submit', (event) => { event.preventDefault(); if (event.submitter?.id !== 'identifierNext' || identifier.value !== 'pilot@example.test' || decoy.value !== '') return; identifierForm.hidden = true; passwordStep.hidden = false; step.textContent = 'password'; }); passwordForm.addEventListener('submit', (event) => { event.preventDefault(); if (event.submitter?.id === 'passwordNext' && password.value === 'demo-password-never-recorded') status.textContent = 'Google authentication complete'; });</script>
      </body></html>`)
  await page.evaluate(installDemoChromeStub, stubArgs)
  await injectPilotAutofill(page)

  const widget = page.locator('#nook-auth-widget')
  await expect(page.locator('#identifierId')).toHaveAttribute(
    'autocomplete',
    'username',
  )
  await expect(widget.getByText('Ready to sign in')).toBeVisible()
  await widget.getByRole('button', { name: 'Continue with Nook' }).click()
  await widget.getByRole('button', { name: 'Continue with Nook' }).click()

  await expect(page.locator('#step')).toHaveText('password')
  await expect(page.locator('#identifier-form')).toBeHidden()
  await expect(page.getByTestId('google-selected-account')).toHaveText(
    'pilot@example.test',
  )
  await expect(page.getByTestId('google-selected-account')).toBeVisible()
  await expect(
    page.locator(
      '#password-step input[autocomplete="username"], #password-step input[type="email"], #password-step input[name="identifier"]',
    ),
  ).toHaveCount(0)
  await expect(
    page.locator('#password-step input[name="Passwd"]'),
  ).toHaveAttribute('autocomplete', 'current-password')
  await expect(widget.getByText('Ready to sign in')).toBeVisible()
  await widget.getByRole('button', { name: 'Continue with Nook' }).click()

  await expect(page.getByLabel('Enter your password')).toHaveValue(
    'demo-password-never-recorded',
  )
  await expect(page.getByRole('status')).toHaveText(
    'Google authentication complete',
  )
  await demoBeat(page)
})
