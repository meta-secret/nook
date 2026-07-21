import { expect, test } from '../fixtures'
import type { Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { installDemoChromeStub, type ChromeMessage } from './static-chrome-stub'

const DEMO_BEAT_MS = 900
const demoDir = path.dirname(fileURLToPath(import.meta.url))
const extensionDist = path.resolve(demoDir, '../../../nook-web-extension/dist')

async function demoBeat(page: Page) {
  await page.waitForTimeout(DEMO_BEAT_MS)
}

test('propose Create passkey through Nook Pilot without silent ceremony', async ({
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
    passkeyPilotFlow: true,
  }

  await page.addInitScript(installDemoChromeStub, stubArgs)

  await page.goto('/')
  await page.setContent(`<!doctype html>
    <html>
      <head>
        <title>Example passkey signup</title>
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
          button {
            min-height: 48px;
            margin-top: 18px;
            padding: 0 18px;
            border: 0;
            border-radius: 10px;
            background: #eef0f4;
            color: #171921;
            font: 750 14px/1 Inter, ui-sans-serif, system-ui, sans-serif;
          }
          #started { display: none; margin-top: 16px; color: #94d4ae; font-weight: 650; }
          body.started #started { display: block; }
        </style>
      </head>
      <body>
        <main>
          <h1>Sign in with a passkey</h1>
          <p>Nook can propose creating a passkey after you approve.</p>
          <button type="button" data-nook-passkey-control data-testid="demo-passkey-control">
            Create a passkey
          </button>
          <p id="started" data-testid="demo-passkey-started">Site passkey ceremony started</p>
        </main>
      </body>
    </html>`)
  await page.evaluate(() => {
    document
      .querySelector('[data-testid="demo-passkey-control"]')
      ?.addEventListener('click', () => {
        document.body.classList.add('started')
      })
  })
  await page.evaluate(installDemoChromeStub, stubArgs)
  await page.addScriptTag({
    path: path.join(extensionDist, 'content/autofill.js'),
    type: 'module',
  })

  const widget = page.locator('#nook-auth-widget')
  await expect(
    widget.getByRole('button', { name: 'Create passkey' }),
  ).toBeVisible()
  await expect(widget.getByTestId('nook-auth-gate-vault-status')).toHaveText(
    'Connected to Demo vault',
  )
  await demoBeat(page)

  await widget.getByRole('button', { name: 'Create passkey' }).click()
  await expect(page.getByTestId('demo-passkey-started')).toBeVisible()
  await expect(
    widget.getByText(/Continue in the Nook passkey prompt|окне ключа доступа/i),
  ).toBeVisible()
  await demoBeat(page)
})
