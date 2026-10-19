import { CompanionWasmSessionMessageType } from '../../../nook-web-shared/src/extension/companion-wasm-runtime-messages'
import { expect, test } from '../fixtures'
import {
  demoBeat,
  injectPilotAutofill,
  loadPilotMessages,
} from './pilot-demo-helpers'
import { demoDomainEnumArgs, installDemoChromeStub } from './static-chrome-stub'

const otpauthUri =
  'otpauth://totp/Demo%20Service:demo.user%40example.test?secret=JBSWY3DPEHPK3PXP&issuer=Demo%20Service&algorithm=SHA1&digits=6&period=30'

test('offers 2FA enrollment from a portaled setup dialog with an inline SVG QR', async ({
  page,
}) => {
  const stubArgs = {
    localizedMessages: await loadPilotMessages(),
    ...demoDomainEnumArgs,
    enrollPilotFlow: true,
    recordRuntimeMessageTypes: true,
  }
  await page.addInitScript(installDemoChromeStub, stubArgs)
  await page.goto('/')
  await page.setContent(`<!doctype html>
    <html>
      <head>
        <title>Account security</title>
        <style>
          :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
          body { margin: 0; min-height: 100vh; background: #f4f5f7; color: #16181d; }
          main { max-width: 640px; margin: 48px auto; padding: 32px; border-radius: 16px; background: #fff; }
          .setup-dialog {
            position: fixed;
            top: 50%;
            left: 50%;
            z-index: 10;
            width: min(440px, calc(100vw - 48px));
            padding: 28px;
            border-radius: 18px;
            background: #fff;
            box-shadow: 0 24px 64px rgb(0 0 0 / 24%);
            transform: translate(-50%, -50%);
          }
          .setup-dialog h2 { margin: 0 0 8px; font-size: 20px; }
          .setup-dialog svg { display: block; margin: 18px auto; }
          .setup-dialog footer { display: flex; justify-content: flex-end; gap: 12px; margin-top: 18px; }
        </style>
      </head>
      <body>
        <main>
          <h1>Account security</h1>
          <p>Manage how you sign in to your account.</p>
          <button type="button">Update authenticator app</button>
        </main>
      </body>
    </html>`)
  await page.evaluate(installDemoChromeStub, stubArgs)
  await injectPilotAutofill(page)

  const widget = page.locator('#nook-auth-widget')
  await demoBeat(page)
  await expect(widget).toHaveCount(0)

  // Portal-style modal appended to <body> after load, as React dialogs do.
  await page.evaluate((uri) => {
    // The companion runtime records only into an existing list.
    window.__nookDemoRuntimeMessageTypes = ((v) => (v ? v : []))(
      window.__nookDemoRuntimeMessageTypes,
    )
    const dialog = document.createElement('div')
    dialog.className = 'setup-dialog'
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    dialog.setAttribute('aria-labelledby', 'mfa-title')
    dialog.setAttribute('aria-describedby', 'mfa-description')
    dialog.innerHTML = `
      <h2 id="mfa-title">Update authenticator app</h2>
      <div id="mfa-description">Scan this QR code to set up your account using your preferred authenticator app. Popular choices include <a href="https://support.google.com/accounts/answer/1066447">Google Authenticator</a>, <a href="https://www.microsoft.com/security/mobile-authenticator-app">Microsoft Authenticator</a>, and <a href="https://authy.com">Authy</a>.</div>
      <svg data-testid="demo-dialog-qr" width="220" height="220" viewBox="0 0 220 220" data-nook-otpauth-uri="${uri}">
        <rect width="220" height="220" fill="#fff"/>
        <rect x="20" y="20" width="40" height="40" fill="#000"/>
        <rect x="160" y="20" width="40" height="40" fill="#000"/>
        <rect x="20" y="160" width="40" height="40" fill="#000"/>
        <rect x="90" y="90" width="40" height="40" fill="#000"/>
      </svg>
      <a href="#manual-setup">Enter code manually</a>
      <footer>
        <button type="button">Cancel</button>
        <button type="button">Continue</button>
      </footer>
    `
    document.body.append(dialog)
  }, otpauthUri)

  await expect(
    page.getByRole('dialog', { name: 'Update authenticator app' }),
  ).toBeVisible()
  await expect(page.getByTestId('demo-dialog-qr')).toBeVisible()
  const addButton = widget.getByRole('button', {
    name: 'Add 2FA from this page',
  })
  await expect(addButton).toBeVisible()
  await expect(widget.getByTestId('nook-auth-gate-vault-status')).toHaveText(
    'Connected to Demo vault',
  )
  await demoBeat(page)

  await addButton.click()
  await expect(
    widget.getByRole('heading', {
      name: /Review this authenticator before continuing/,
    }),
  ).toBeVisible()
  await expect(widget.getByText(/Service:\s*Demo Service/)).toBeVisible()
  await expect(
    widget.getByText(/Account:\s*demo\.user@example\.test/),
  ).toBeVisible()
  await expect(widget.getByText(/JBSWY3DPEHPK3PXP/)).toHaveCount(0)
  await demoBeat(page)

  await widget.getByRole('button', { name: 'Continue enrollment' }).click()
  await expect(
    widget.getByText('Authenticator saved to your vault.'),
  ).toBeVisible()
  const runtimeMessages = await page.evaluate(() => {
    const messages = window.__nookDemoRuntimeMessageTypes
    return Array.isArray(messages) ? messages : []
  })
  expect(runtimeMessages).toContain(
    CompanionWasmSessionMessageType.AuthenticationAuthenticatorSetupObservation,
  )
  expect(runtimeMessages).toContain('nook:website-authenticator-enroll-stage')
  expect(runtimeMessages).toContain('nook:website-authenticator-enroll-confirm')
  await demoBeat(page)
})
