import { expect, test } from '../fixtures'
import type { Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  installStaticDemoChromeStub,
  type ChromeMessage,
} from './static-chrome-stub'

const DEMO_BEAT_MS = 900
const demoDir = path.dirname(fileURLToPath(import.meta.url))
const extensionDist = path.resolve(demoDir, '../../../nook-web-extension/dist')
const otpauthUri =
  'otpauth://totp/Demo%20Service:demo.user%40example.test?secret=JBSWY3DPEHPK3PXP&issuer=Demo%20Service&algorithm=SHA1&digits=6&period=30'

async function demoBeat(page: Page) {
  await page.waitForTimeout(DEMO_BEAT_MS)
}

function enrollmentChromeStubArgs(messages: Record<string, ChromeMessage>) {
  return {
    localizedMessages: messages,
    barcodeRawValue: otpauthUri,
    responsesByType: {
      'nook:website-authenticator-enroll-preview': {
        ok: true,
        status: 'ready',
        vaultStoreId: 'demo-vault',
        vaultName: 'Demo vault',
        preview: {
          issuer: 'Demo Service',
          account: 'demo.user@example.test',
          websiteUrl: 'https://demo.example.test',
          algorithm: 'SHA1',
          digits: 6,
          period: 30,
        },
      },
      'nook:website-authenticator-enroll-confirm': {
        ok: true,
        secretId: 'demo-authenticator-1',
      },
    },
  }
}

test('capture an authenticator QR through consented Pilot enrollment', async ({
  page,
}) => {
  const messages = JSON.parse(
    await readFile(
      path.join(extensionDist, '_locales/en/messages.json'),
      'utf8',
    ),
  ) as Record<string, ChromeMessage>
  const stubArgs = enrollmentChromeStubArgs(messages)

  await page.addInitScript(installStaticDemoChromeStub, stubArgs)

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
        </style>
      </head>
      <body>
        <main>
          <h1>Authenticator setup</h1>
          <p>Scan this authenticator QR code to finish 2FA enrollment.</p>
          <img
            data-testid="demo-totp-qr"
            alt="Authenticator QR code"
            width="220"
            height="220"
            src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Crect width='220' height='220' fill='%23fff'/%3E%3Crect x='20' y='20' width='40' height='40' fill='%23000'/%3E%3Crect x='160' y='20' width='40' height='40' fill='%23000'/%3E%3Crect x='20' y='160' width='40' height='40' fill='%23000'/%3E%3C/svg%3E"
          />
        </main>
      </body>
    </html>`)

  await page.evaluate(installStaticDemoChromeStub, stubArgs)
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
    widget.getByText('Review this authenticator before saving'),
  ).toBeVisible()
  await expect(widget.getByText(/Service:\s*Demo Service/)).toBeVisible()
  await expect(
    widget.getByText(/Account:\s*demo\.user@example\.test/),
  ).toBeVisible()
  await expect(widget.getByText(/JBSWY3DPEHPK3PXP/)).toHaveCount(0)
  await demoBeat(page)

  await widget.getByRole('button', { name: 'Save authenticator' }).click()
  await expect(
    widget.getByText('Authenticator saved to your vault.'),
  ).toBeVisible()
  await demoBeat(page)
})
