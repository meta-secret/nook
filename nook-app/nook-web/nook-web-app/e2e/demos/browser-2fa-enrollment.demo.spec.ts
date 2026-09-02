import { expect, test } from '../fixtures'
import type { Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  demoDomainEnumArgs,
  installDemoChromeStub,
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

test('uses the paired demo vault for authenticator enrollment', async ({
  page,
}) => {
  const bootstrapErrors: Error[] = []
  page.on('pageerror', (error) => {
    if (error.message.includes("reading 'appendChild'")) {
      bootstrapErrors.push(error)
    }
  })

  const messages = JSON.parse(
    await readFile(
      path.join(extensionDist, '_locales/en/messages.json'),
      'utf8',
    ),
  ) as Record<string, ChromeMessage>
  const stubArgs = {
    localizedMessages: messages,
    ...demoDomainEnumArgs,
    enrollPilotFlow: true,
    enrollmentConfirmDelayMs: 1_200,
  }

  await page.addInitScript(installDemoChromeStub, stubArgs)

  enum BootstrapStartSignalKind {
    WaitingForHandler = 'waiting-for-handler',
    Ready = 'ready',
  }

  type BootstrapStartSignal =
    | { kind: BootstrapStartSignalKind.WaitingForHandler }
    | { kind: BootstrapStartSignalKind.Ready; signal: () => void }
  let bootstrapStartSignal: BootstrapStartSignal = {
    kind: BootstrapStartSignalKind.WaitingForHandler,
  }
  const wasmBootstrapStarted = new Promise<void>((resolve) => {
    bootstrapStartSignal = {
      kind: BootstrapStartSignalKind.Ready,
      signal: resolve,
    }
  })
  enum BootstrapReleaseSignalKind {
    Blocked = 'blocked',
    Releasable = 'releasable',
  }

  type BootstrapReleaseSignal =
    | { kind: BootstrapReleaseSignalKind.Blocked }
    | { kind: BootstrapReleaseSignalKind.Releasable; release: () => void }
  let bootstrapReleaseSignal: BootstrapReleaseSignal = {
    kind: BootstrapReleaseSignalKind.Blocked,
  }
  const wasmBootstrapReleased = new Promise<void>((resolve) => {
    bootstrapReleaseSignal = {
      kind: BootstrapReleaseSignalKind.Releasable,
      release: resolve,
    }
  })
  await page.route(/nook_wasm_bg.*\.wasm$/, async (route) => {
    if (bootstrapStartSignal.kind === BootstrapStartSignalKind.Ready) {
      bootstrapStartSignal.signal()
    }
    await wasmBootstrapReleased
    await route.continue().catch(() => {})
  })

  // Replace the document while the real app bootstrap is active. This covers
  // the stale mount-target race while retaining a real origin for enrollment.
  await page.goto('/app/', { waitUntil: 'commit' })
  await wasmBootstrapStarted
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
          #success { color: #94d4ae; font-weight: 650; }
        </style>
      </head>
      <body>
        <main id="app" data-bootstrap-sentinel="replacement-root">
          <span data-bootstrap-sentinel-child hidden></span>
          <h1>Authenticator setup</h1>
          <p>Scan this authenticator QR code to finish 2FA enrollment.</p>
          <img
            data-testid="demo-totp-qr"
            alt="Authenticator QR code"
            width="220"
            height="220"
            data-nook-otpauth-uri="${otpauthUri}"
            src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Crect width='220' height='220' fill='%23fff'/%3E%3Crect x='20' y='20' width='40' height='40' fill='%23000'/%3E%3Crect x='160' y='20' width='40' height='40' fill='%23000'/%3E%3Crect x='20' y='160' width='40' height='40' fill='%23000'/%3E%3C/svg%3E"
          />
          <form id="verify-form">
            <label>Verification code
              <input autocomplete="one-time-code" name="Code" type="text" />
            </label>
            <button type="submit">Verify</button>
          </form>
        </main>
      </body>
    </html>`)
  if (bootstrapReleaseSignal.kind === BootstrapReleaseSignalKind.Releasable) {
    bootstrapReleaseSignal.release()
  }
  const replacementChildCount = await page
    .locator('[data-bootstrap-sentinel="replacement-root"]')
    .evaluate((root) => root.children.length)

  await page.evaluate(() => {
    document
      .querySelector('#verify-form')
      ?.addEventListener('submit', (event) => {
        event.preventDefault()
        const setup = document.querySelector('#app')
        setup?.remove()
        const success = document.createElement('main')
        success.id = 'success'
        success.dataset.nookAuthOutcome = 'success'
        success.dataset.testid = 'mock-auth-success'
        success.innerHTML = `
          <h1>Authentication complete</h1>
          <p>Save your backup codes in a safe place.</p>
          <ul>
            <li>A1B2-C3D4-E5F6</li>
            <li>G7H8-I9J0-K1L2</li>
          </ul>
        `
        document.body.append(success)
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
  ).toBeVisible({ timeout: 15_000 })
  await expect(widget.getByTestId('nook-auth-gate-vault-status')).toHaveText(
    'Connected to Demo vault',
  )
  await expect(
    page.locator('[data-bootstrap-sentinel="replacement-root"]'),
  ).toBeVisible()
  expect(
    await page
      .locator('[data-bootstrap-sentinel="replacement-root"]')
      .evaluate((root) => root.children.length),
  ).toBe(replacementChildCount)
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
  await expect(
    widget.getByText(
      'Verification code filled. Submit on the site — Nook saves only after verified success.',
    ),
  ).toBeVisible()
  await demoBeat(page)

  await widget.getByRole('button', { name: 'Cancel' }).click()
  await expect(
    widget.getByRole('button', { name: 'Add 2FA from this page' }),
  ).toBeVisible()
  await widget.getByRole('button', { name: 'Add 2FA from this page' }).click()
  await expect(
    widget.getByRole('button', { name: 'Continue enrollment' }),
  ).toBeVisible()
  await widget.getByRole('button', { name: 'Continue enrollment' }).click()
  await expect(page.locator('input[name="Code"]')).toHaveValue('482913')
  await demoBeat(page)

  await page.getByRole('button', { name: 'Verify' }).click()
  await expect(page.getByTestId('mock-auth-success')).toBeVisible()
  // Enrollment evidence watches soft SPA success markers; keep this patient so
  // the demo matches the content-script commit path under load.
  await expect(
    widget.getByText('Authenticator saved to your vault.'),
  ).toBeVisible({ timeout: 30_000 })
  await expect(widget.getByTestId('nook-auth-gate-vault-status')).toHaveText(
    'Connected to Demo vault',
  )
  await demoBeat(page)

  await widget.getByRole('button', { name: 'Save backup codes' }).click()
  await expect(widget.locator('textarea')).toBeVisible()
  await demoBeat(page)

  await widget.getByRole('button', { name: 'Save backup codes' }).click()
  await expect(
    widget.getByRole('button', { name: 'Replace existing codes' }),
  ).toBeVisible()
  await demoBeat(page)

  await widget.getByRole('button', { name: 'Replace existing codes' }).click()
  await expect(widget.getByText('Backup codes saved')).toBeVisible()
  await expect(
    widget.getByRole('button', { name: 'Save backup codes' }),
  ).toBeVisible()
  await demoBeat(page)
  expect(bootstrapErrors).toEqual([])
})
