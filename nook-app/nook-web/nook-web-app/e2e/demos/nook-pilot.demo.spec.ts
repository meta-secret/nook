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

function loginPilotStubArgs(messages: Record<string, ChromeMessage>) {
  return {
    localizedMessages: messages,
    loginPilotFlow: true,
  }
}

function totpPilotStubArgs(messages: Record<string, ChromeMessage>) {
  return {
    localizedMessages: messages,
    responsesByType: {
      'nook:authentication-workflow-snapshot': {
        ok: true,
        snapshot: {
          kind: 'totp-challenge',
          stage: 'second-factor',
          action: 'fill-totp',
          currentStep: 2,
          totalSteps: 3,
          observationIndex: 0,
        },
      },
      'nook:website-authenticator-options': {
        ok: true,
        status: 'ready',
        accounts: [
          {
            vaultStoreId: 'demo-vault',
            vaultName: 'Demo vault',
            secretId: 'demo-totp-1',
            issuer: 'Namecheap',
            account: 'pilot@example.test',
          },
        ],
      },
      'nook:website-authenticator-fill': {
        ok: true,
        code: '482913',
      },
    },
  }
}

test('guide a login through the Nook Pilot control plane', async ({ page }) => {
  const messages = JSON.parse(
    await readFile(
      path.join(extensionDist, '_locales/en/messages.json'),
      'utf8',
    ),
  ) as Record<string, ChromeMessage>

  await page.addInitScript(installDemoChromeStub, loginPilotStubArgs(messages))

  await page.goto('/')
  await page.setContent(`<!doctype html>
    <html>
      <head>
        <title>Example account sign in</title>
        <style>
          :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
          * { box-sizing: border-box; }
          body {
            min-height: 100vh;
            margin: 0;
            display: grid;
            place-items: center;
            background:
              radial-gradient(circle at 20% 10%, rgb(48 57 79 / 55%), transparent 36%),
              linear-gradient(145deg, #11131a, #090a0f 70%);
            color: #f7f7f8;
          main {
            width: min(440px, calc(100vw - 48px));
            padding: 42px;
            border: 1px solid rgb(255 255 255 / 10%);
            border-radius: 22px;
            background: rgb(24 26 35 / 92%);
            box-shadow: 0 28px 90px rgb(0 0 0 / 45%);
          }
          .eyebrow { margin: 0 0 10px; color: #9ca5b9; font-size: 12px; letter-spacing: .14em; text-transform: uppercase; }
          h1 { margin: 0 0 10px; font-size: 32px; }
          .intro { margin: 0 0 28px; color: #aeb4c1; line-height: 1.5; }
          form { display: grid; gap: 18px; }
          label { display: grid; gap: 8px; color: #d8dbe3; font-size: 13px; font-weight: 650; }
          input {
            width: 100%;
            min-height: 48px;
            padding: 12px 14px;
            border: 1px solid rgb(255 255 255 / 12%);
            border-radius: 10px;
            background: #11131a;
            color: #f7f7f8;
            font: inherit;
          }
          form > button {
            min-height: 48px;
            border: 0;
            border-radius: 10px;
            background: #eef0f4;
            color: #171921;
            font: 750 14px/1 Inter, ui-sans-serif, system-ui, sans-serif;
          }
          #site-status { min-height: 20px; margin: 18px 0 0; color: #94d4ae; font-size: 13px; }
        </style>
      </head>
      <body>
        <main>
          <p class="eyebrow">Example account</p>
          <h1>Welcome back</h1>
          <p class="intro">Sign in to continue to your dashboard.</p>
          <form id="login-form">
            <label>Email<input autocomplete="username" name="email" type="email"></label>
            <label>Password<input autocomplete="current-password" name="password" type="password"></label>
            <button type="submit">Sign in</button>
          </form>
          <p id="site-status" role="status"></p>
        </main>
      </body>
    </html>`)
  await page.evaluate(() => {
    document
      .querySelector('#login-form')
      ?.addEventListener('submit', (event) => {
        event.preventDefault()
        const status = document.querySelector('#site-status')
        if (status) status.textContent = 'Secure sign-in submitted'
      })
  })
  await page.evaluate(installDemoChromeStub, loginPilotStubArgs(messages))
  await page.addScriptTag({
    path: path.join(extensionDist, 'content/autofill.js'),
    type: 'module',
  })

  const widget = page.locator('#nook-auth-widget')
  await expect(widget.getByText('Nook Pilot · 1/3')).toBeVisible()
  await expect(widget.getByText('Ready to sign in')).toBeVisible()
  await expect(widget.getByTestId('nook-auth-gate-vault-status')).toHaveText(
    'Connected to Demo vault',
  )
  await demoBeat(page)

  await widget.getByRole('button', { name: 'Continue with Nook' }).click()
  await expect(
    widget.getByText(
      'Unlock Nook in the companion window, then click Continue with Nook again.',
    ),
  ).toBeVisible()
  await demoBeat(page)

  await widget.getByRole('button', { name: 'Continue with Nook' }).click()
  await expect(widget.getByText('Choose which login to use.')).toBeVisible()
  await expect(
    widget.getByRole('button', { name: 'Saved login 1' }),
  ).toBeVisible()
  await expect(widget.getByText('pilot@example.test')).toHaveCount(0)
  await expect(widget.getByText('copilot@example.test')).toHaveCount(0)
  await demoBeat(page)

  await widget.getByRole('button', { name: 'Saved login 1' }).click()
  await expect(page.locator('[autocomplete="username"]')).toHaveValue(
    'pilot@example.test',
  )
  await expect(widget.getByText('Nook Pilot · 3/3')).toBeVisible()
  await expect(widget.getByText('Verifying sign-in')).toBeVisible()
  await expect(page.getByRole('status')).toHaveText('Secure sign-in submitted')
  await demoBeat(page)
})

test('fill a Namecheap-like OTP challenge through Nook Pilot', async ({
  page,
}) => {
  const messages = JSON.parse(
    await readFile(
      path.join(extensionDist, '_locales/en/messages.json'),
      'utf8',
    ),
  ) as Record<string, ChromeMessage>

  await page.addInitScript(installDemoChromeStub, totpPilotStubArgs(messages))

  await page.goto('/')
  await page.setContent(`<!doctype html>
    <html>
      <head>
        <title>Enter OTP Code</title>
        <style>
          :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
          * { box-sizing: border-box; }
          body {
            min-height: 100vh;
            margin: 0;
            display: grid;
            place-items: center;
            background: #f3f4f6;
            color: #111827;
          }
          main {
            width: min(420px, calc(100vw - 48px));
            padding: 36px;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            background: #fff;
            box-shadow: 0 16px 40px rgb(15 23 42 / 12%);
          }
          h1 { margin: 0 0 12px; font-size: 28px; }
          .intro { margin: 0 0 24px; color: #4b5563; line-height: 1.5; }
          form { display: grid; gap: 16px; }
          input {
            width: 100%;
            min-height: 48px;
            padding: 12px 14px;
            border: 1px solid #d1d5db;
            border-radius: 6px;
            background: #fff;
            color: #111827;
            font: inherit;
          }
          button[type="submit"] {
            min-height: 48px;
            border: 0;
            border-radius: 6px;
            background: #dc2626;
            color: #fff;
            font: 750 14px/1 Inter, ui-sans-serif, system-ui, sans-serif;
          }
        </style>
      </head>
      <body>
        <main>
          <h1>Enter OTP Code</h1>
          <p class="intro">
            Open the two-factor authentication app on your device and verify
            your identity for your account <strong>pilot</strong>.
          </p>
          <form id="otp-form">
            <input
              id="Code"
              name="Code"
              type="text"
              inputmode="numeric"
              placeholder="Enter OTP Code"
              autocomplete="off"
            />
            <button type="submit">Submit</button>
          </form>
        </main>
      </body>
    </html>`)
  await page.evaluate(installDemoChromeStub, totpPilotStubArgs(messages))
  await page.addScriptTag({
    path: path.join(extensionDist, 'content/autofill.js'),
    type: 'module',
  })

  const widget = page.locator('#nook-auth-widget')
  await expect(widget.getByText('Nook Pilot · 2/3')).toBeVisible()
  await expect(widget.getByText('Fill your 2FA code')).toBeVisible()
  await demoBeat(page)

  await widget.getByRole('button', { name: 'Fill 2FA code' }).click()
  await expect(
    widget.getByRole('button', { name: 'Saved 2FA 1' }),
  ).toBeVisible()
  await demoBeat(page)
  await widget.getByRole('button', { name: 'Saved 2FA 1' }).click()
  await expect(page.getByPlaceholder('Enter OTP Code')).toHaveValue('482913')
  await expect(
    widget.getByText(
      'The code is filled. Review the site and submit it manually.',
    ),
  ).toBeVisible()
  await demoBeat(page)
})

test('detect a Microsoft-like email-first login through Nook Pilot', async ({
  page,
}) => {
  const messages = JSON.parse(
    await readFile(
      path.join(extensionDist, '_locales/en/messages.json'),
      'utf8',
    ),
  ) as Record<string, ChromeMessage>

  await page.addInitScript(installDemoChromeStub, loginPilotStubArgs(messages))

  await page.goto('/')
  await page.setContent(`<!doctype html>
    <html>
      <head>
        <title>Sign in to your Microsoft account</title>
        <style>
          :root { color-scheme: light; font-family: "Segoe UI", ui-sans-serif, system-ui, sans-serif; }
          * { box-sizing: border-box; }
          body {
            min-height: 100vh;
            margin: 0;
            display: grid;
            place-items: center;
            background: #f2f2f2;
            color: #1b1b1b;
          }
          main {
            width: min(440px, calc(100vw - 48px));
            padding: 44px 44px 36px;
            border: 1px solid #e0e0e0;
            background: #fff;
            box-shadow: 0 2px 6px rgb(0 0 0 / 10%);
          }
          h1 { margin: 0 0 12px; font-size: 24px; font-weight: 600; }
          .intro { margin: 0 0 24px; color: #616161; line-height: 1.5; }
          form { display: grid; gap: 18px; }
          input {
            width: 100%;
            min-height: 48px;
            padding: 12px 10px;
            border: 0;
            border-bottom: 1px solid #605e5c;
            background: transparent;
            color: #1b1b1b;
            font: inherit;
          }
          button[type="submit"] {
            justify-self: end;
            min-height: 40px;
            min-width: 108px;
            border: 0;
            background: #0067b8;
            color: #fff;
            font: 600 15px/1 "Segoe UI", ui-sans-serif, system-ui, sans-serif;
          }
        </style>
      </head>
      <body>
        <main>
          <h1>Sign in</h1>
          <p class="intro">Use your work, school, or personal Microsoft account.</p>
          <form id="loginForm">
            <input
              type="email"
              name="loginfmt"
              id="i0116"
              placeholder="Email, phone, or Skype"
              aria-label="Enter your email, phone, or Skype."
            />
            <button type="submit" id="idSIButton9">Next</button>
          </form>
        </main>
      </body>
    </html>`)
  await page.evaluate(installDemoChromeStub, loginPilotStubArgs(messages))
  await page.addScriptTag({
    path: path.join(extensionDist, 'content/autofill.js'),
    type: 'module',
  })

  const widget = page.locator('#nook-auth-widget')
  await expect(widget.getByText('Nook Pilot · 1/3')).toBeVisible()
  await expect(widget.getByText('Ready to sign in')).toBeVisible()
  await expect(
    widget.getByRole('button', { name: 'Continue with Nook' }),
  ).toBeVisible()
  await expect(page.locator('[name="loginfmt"]')).toBeVisible()
  await demoBeat(page)
})
