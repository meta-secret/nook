import { expect, test } from '../fixtures'
import type { Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { installDemoChromeStub, type ChromeMessage } from './static-chrome-stub'

const DEMO_BEAT_MS = 900
const demoDir = path.dirname(fileURLToPath(import.meta.url))
const extensionDist = path.resolve(demoDir, '../../../nook-web-extension/dist')
const otpauthUri =
  'otpauth://totp/Demo%20Service:demo.user%40example.test?secret=JBSWY3DPEHPK3PXP&issuer=Demo%20Service&algorithm=SHA1&digits=6&period=30'

async function demoBeat(page: Page) {
  await page.waitForTimeout(DEMO_BEAT_MS)
}

test('guide authenticator enrollment through consented Pilot ceremony', async ({
  page,
}) => {
  const messages = JSON.parse(
    await readFile(
      path.join(extensionDist, '_locales/en/messages.json'),
      'utf8',
    ),
  ) as Record<string, ChromeMessage>
  const stubArgs = {
    localizedMessages: messages,
    barcodeRawValue: otpauthUri,
    enrollPilotFlow: true,
  }

  await page.addInitScript(installDemoChromeStub, stubArgs)

  await page.goto('/')
  await page.setContent(`<!doctype html>
    <html>
      <head>
        <title>Authenticator setup</title>
        <style>
          :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
          body {
            min-height: 100vh;
            margin: 0;
            display: grid;
            place-items: center;
            background: linear-gradient(145deg, #11131a, #090a0f 70%);
            color: #f7f7f8;
          }
          main {
            width: min(440px, calc(100vw - 48px));
            padding: 36px;
            border: 1px solid rgb(255 255 255 / 10%);
            border-radius: 22px;
            background: rgb(24 26 35 / 92%);
            text-align: center;
          }
          img {
            width: 220px;
            height: 220px;
            margin: 18px auto 0;
            border-radius: 12px;
            background: #fff;
          }
          form { display: grid; gap: 12px; margin-top: 18px; text-align: left; }
          input {
            min-height: 44px;
            padding: 10px 12px;
            border-radius: 10px;
            border: 1px solid rgb(255 255 255 / 12%);
            background: #11131a;
            color: #f7f7f8;
            font: inherit;
          }
          #success { display: none; color: #94d4ae; font-weight: 650; }
          body.verified #setup { display: none; }
          body.verified #success { display: block; }
        </style>
      </head>
      <body>
        <main id="setup">
          <h1>Authenticator setup</h1>
          <p>Scan this authenticator QR code to finish 2FA enrollment.</p>
          <img
            data-testid="demo-totp-qr"
            alt="Authenticator QR code"
            width="220"
            height="220"
            src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Crect width='220' height='220' fill='%23fff'/%3E%3Crect x='20' y='20' width='40' height='40' fill='%23000'/%3E%3Crect x='160' y='20' width='40' height='40' fill='%23000'/%3E%3Crect x='20' y='160' width='40' height='40' fill='%23000'/%3E%3C/svg%3E"
          />
          <form id="verify-form">
            <label>Verification code
              <input autocomplete="one-time-code" name="Code" type="text" />
            </label>
            <button type="submit">Verify</button>
          </form>
        </main>
        <main id="success" data-nook-auth-outcome="success" data-testid="mock-auth-success">
          Authentication complete
        </main>
      </body>
    </html>`)

  await page.evaluate(() => {
    document
      .querySelector('#verify-form')
      ?.addEventListener('submit', (event) => {
        event.preventDefault()
        document.body.classList.add('verified')
      })
  })
  await page.evaluate(installDemoChromeStub, stubArgs)
  await page.addScriptTag({
    path: path.join(extensionDist, 'content/autofill.js'),
    type: 'module',
  })

  const widget = page.locator('#nook-auth-widget')
  await expect(
    widget.getByRole('button', { name: 'Add 2FA from this page' }),
  ).toBeVisible()
  await expect(widget.getByTestId('nook-auth-gate-vault-status')).toHaveText(
    'Connected to Demo vault',
  )
  await demoBeat(page)

  await widget.getByRole('button', { name: 'Add 2FA from this page' }).click()
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
  await expect(page.locator('input[name="Code"]')).toHaveValue('482913', {
    timeout: 15_000,
  })
  await demoBeat(page)

  await page.getByRole('button', { name: 'Verify' }).click()
  await expect(page.getByTestId('mock-auth-success')).toBeVisible()
  await expect(
    widget.getByText('Authenticator saved to your vault.'),
  ).toBeVisible({ timeout: 15_000 })
  await demoBeat(page)
})
