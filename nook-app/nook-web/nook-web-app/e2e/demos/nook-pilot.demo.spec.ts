import { expect, test } from '../fixtures'
import type { Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEMO_BEAT_MS = 900
const demoDir = path.dirname(fileURLToPath(import.meta.url))
const extensionDist = path.resolve(demoDir, '../../../nook-web-extension/dist')

type ChromeMessage = { message: string }

async function demoBeat(page: Page) {
  await page.waitForTimeout(DEMO_BEAT_MS)
}

function installChromeStub(localizedMessages: Record<string, ChromeMessage>) {
  type RuntimeMessage = {
    type?: string
    payload?: { secretId?: string }
  }
  type RuntimeCallback = (response?: unknown) => void

  const responseFor = (message: RuntimeMessage): unknown => {
    switch (message.type) {
      case 'nook:authentication-workflow-snapshot':
        return {
          ok: true,
          snapshot: {
            kind: 'login',
            stage: 'credentials',
            action: 'continue-with-nook',
            currentStep: 1,
            totalSteps: 3,
            observationIndex: 0,
          },
        }
      case 'nook:website-login-options':
        return {
          ok: true,
          status: 'ready',
          accounts: [
            {
              vaultStoreId: 'demo-vault',
              vaultName: 'Demo vault',
              secretId: 'demo-login-1',
              username: 'pilot@example.test',
              websiteUrl: location.origin,
              websiteHost: location.hostname,
            },
            {
              vaultStoreId: 'demo-vault',
              vaultName: 'Demo vault',
              secretId: 'demo-login-2',
              username: 'copilot@example.test',
              websiteUrl: location.origin,
              websiteHost: location.hostname,
            },
          ],
        }
      case 'nook:website-login-fill':
        return {
          ok: true,
          username:
            message.payload?.secretId === 'demo-login-2'
              ? 'copilot@example.test'
              : 'pilot@example.test',
          password: 'demo-password-never-recorded',
        }
      default:
        return { ok: true }
    }
  }

  const chromeStub = {
    i18n: {
      getMessage(key: string, substitution?: string) {
        const message = localizedMessages[key]?.message ?? ''
        return substitution ? message.replaceAll('$1', substitution) : message
      },
    },
    runtime: {
      lastError: undefined,
      getURL(resource: string) {
        return resource === 'icons/nook.png' ? '/favicon.png' : resource
      },
      sendMessage(message: RuntimeMessage, callback?: RuntimeCallback) {
        const response = responseFor(message)
        if (callback) queueMicrotask(() => callback(response))
      },
    },
    storage: {
      local: {
        get(
          _keys: string | string[] | Record<string, unknown>,
          callback: (items: Record<string, unknown>) => void,
        ) {
          queueMicrotask(() =>
            callback({
              'nook:extension-setup': {
                status: 'ready',
                deviceLabel: 'Demo browser',
                pairedVaults: ['Demo vault'],
                selectedVaultName: 'Demo vault',
                syncProviderCount: 1,
                eventCount: 3,
                eventLogHeads: ['demo-head'],
                lastLocalSyncAt: '2026-07-20T00:00:00.000Z',
              },
            }),
          )
        },
      },
    },
  }
  const browserGlobal = globalThis as typeof globalThis & {
    chrome?: Record<string, unknown>
  }
  if (browserGlobal.chrome) {
    Object.defineProperties(browserGlobal.chrome, {
      i18n: {
        configurable: true,
        value: chromeStub.i18n,
      },
      runtime: {
        configurable: true,
        value: chromeStub.runtime,
      },
      storage: {
        configurable: true,
        value: chromeStub.storage,
      },
    })
  } else {
    Object.defineProperty(browserGlobal, 'chrome', {
      configurable: true,
      value: chromeStub,
    })
  }
}

test('guide a login through the Nook Pilot control plane', async ({ page }) => {
  const messages = JSON.parse(
    await readFile(
      path.join(extensionDist, '_locales/en/messages.json'),
      'utf8',
    ),
  ) as Record<string, ChromeMessage>

  await page.addInitScript(installChromeStub, messages)

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
  await page.evaluate(installChromeStub, messages)
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
