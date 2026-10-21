import type { Page } from '@playwright/test'
import { CompanionWasmSessionMessageType } from '../../../nook-web-shared/src/extension/companion-wasm-runtime-messages'
import { expect, test } from '../fixtures'
import {
  OTPAUTH_QR_MODULES,
  type QrModuleRows,
} from '../../tests/fixtures/otpauth-qr-modules'
import { QrModuleRaster } from '../../tests/fixtures/qr-module-raster'
import {
  demoBeat,
  injectPilotAutofill,
  loadPilotMessages,
} from './pilot-demo-helpers'
import { demoDomainEnumArgs, installDemoChromeStub } from './static-chrome-stub'

/** The demo authenticator's setup key, as a site shows it after "Enter code manually". */
const SETUP_KEY = 'JBSW Y3DP EHPK 3PXP'
const QR_MODULE_PX = 4

enum DemoQrMedia {
  InlineSvg = 'inline-svg',
  Canvas = 'canvas',
}

enum DemoSetupLayout {
  SemanticDialog = 'semantic dialog',
  NestedPlainDivs = 'nested plain divs',
}

type DemoDialogRequest = {
  readonly page: Page
  readonly media: DemoQrMedia
  readonly layout: DemoSetupLayout
}

type CanvasQrDrawing = {
  readonly modules: QrModuleRows
  readonly modulePx: number
}

const dialogStyles = `
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
  .setup-dialog h3 { margin: 0 0 8px; font-size: 16px; font-weight: 500; }
  .setup-dialog svg, .setup-dialog canvas { display: block; margin: 18px auto; }
  .setup-dialog .setup-key { margin: 18px 0; font: 600 18px ui-monospace, monospace; letter-spacing: 0.08em; text-align: center; }
  .setup-dialog footer { display: flex; justify-content: flex-end; gap: 12px; margin-top: 18px; }
`

const dialogDescription =
  'Scan this QR code to set up your account using your preferred authenticator app. Popular choices include <a href="https://support.google.com/accounts/answer/1066447">Google Authenticator</a>, <a href="https://www.microsoft.com/security/mobile-authenticator-app">Microsoft Authenticator</a>, and <a href="https://authy.com">Authy</a>.'

const manualKeyView = `
  <h2 id="mfa-title">Update authenticator app</h2>
  <h3>Enter your setup key in your authenticator app</h3>
  <div class="setup-key" data-testid="demo-setup-key">${SETUP_KEY}</div>
  <footer>
    <button type="button">Cancel</button>
    <button type="button">Continue</button>
  </footer>
`

async function openSettingsPage(page: Page): Promise<void> {
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
        <style>${dialogStyles}</style>
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
}

/** Appends a portal-style modal to <body> after load, as React dialogs do. */
async function openSetupDialog({
  page,
  media,
  layout,
}: DemoDialogRequest): Promise<void> {
  const raster = new QrModuleRaster({
    modules: OTPAUTH_QR_MODULES,
    modulePx: QR_MODULE_PX,
  })
  const qrMarkup = {
    [DemoQrMedia.InlineSvg]: raster.svgMarkup('data-testid="demo-dialog-qr"'),
    [DemoQrMedia.Canvas]: `<canvas data-testid="demo-dialog-qr" width="${raster.edgePx}" height="${raster.edgePx}"></canvas>`,
  }[media]
  await page.evaluate(
    ({ description, qr, manualKey, layout, layouts }) => {
      // The companion runtime records only into an existing list.
      window.__nookDemoRuntimeMessageTypes = ((v) => (v ? v : []))(
        window.__nookDemoRuntimeMessageTypes,
      )
      const dialog = document.createElement('div')
      dialog.className = 'setup-dialog'
      switch (layout) {
        case layouts.SemanticDialog:
          dialog.setAttribute('role', 'dialog')
          dialog.setAttribute('aria-modal', 'true')
          dialog.setAttribute('aria-labelledby', 'mfa-title')
          dialog.setAttribute('aria-describedby', 'mfa-description')
          break
        case layouts.NestedPlainDivs:
          break
      }
      dialog.innerHTML = `
        <h2 id="mfa-title">Update authenticator app</h2>
        <div id="mfa-description">${description}</div>
        <div><div>${qr}</div></div>
        <button type="button" data-testid="demo-enter-code-manually">Enter code manually</button>
        <footer>
          <button type="button">Cancel</button>
          <button type="button">Continue</button>
        </footer>
      `
      dialog
        .querySelector('[data-testid="demo-enter-code-manually"]')
        ?.addEventListener('click', () => {
          dialog.removeAttribute('aria-describedby')
          dialog.innerHTML = manualKey
        })
      document.body.append(dialog)
    },
    {
      description: dialogDescription,
      qr: qrMarkup,
      manualKey: manualKeyView,
      layout,
      layouts: DemoSetupLayout,
    },
  )
  if (media === DemoQrMedia.Canvas) {
    const drawing: CanvasQrDrawing = {
      modules: OTPAUTH_QR_MODULES,
      modulePx: QR_MODULE_PX,
    }
    await page.evaluate(({ modules, modulePx }) => {
      const canvas = document.querySelector(
        'canvas[data-testid="demo-dialog-qr"]',
      )
      if (!(canvas instanceof HTMLCanvasElement))
        throw new Error('No QR canvas')
      const context = canvas.getContext('2d')
      if (!context) throw new Error('No QR canvas context')
      const quietZone = 4 * modulePx
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.fillStyle = '#000000'
      modules.forEach((row, y) => {
        ;[...row].forEach((module, x) => {
          if (module !== '#') return
          context.fillRect(
            quietZone + x * modulePx,
            quietZone + y * modulePx,
            modulePx,
            modulePx,
          )
        })
      })
    }, drawing)
  }
}

async function recordedRuntimeMessages(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const messages = window.__nookDemoRuntimeMessageTypes
    return Array.isArray(messages) ? messages : []
  })
}

const setupScenarios = [
  { media: DemoQrMedia.InlineSvg, layout: DemoSetupLayout.SemanticDialog },
  { media: DemoQrMedia.Canvas, layout: DemoSetupLayout.SemanticDialog },
  { media: DemoQrMedia.InlineSvg, layout: DemoSetupLayout.NestedPlainDivs },
]

for (const { media, layout } of setupScenarios) {
  test(`enrolls 2FA from a real ${media} QR in portaled ${layout}`, async ({
    page,
  }) => {
    await openSettingsPage(page)
    const widget = page.locator('#nook-auth-widget')
    await demoBeat(page)
    await expect(widget).toHaveCount(0)

    const dialogRequest: DemoDialogRequest = { page, media, layout }
    await openSetupDialog(dialogRequest)
    await expect(page.locator('.setup-dialog')).toBeVisible()
    switch (layout) {
      case DemoSetupLayout.SemanticDialog:
        await expect(
          page.getByRole('dialog', { name: 'Update authenticator app' }),
        ).toBeVisible()
        break
      case DemoSetupLayout.NestedPlainDivs:
        await expect(page.getByRole('dialog')).toHaveCount(0)
        break
    }
    await expect(page.getByTestId('demo-dialog-qr')).toBeVisible()
    const addButton = widget.getByRole('button', {
      name: 'Add 2FA from this page',
    })
    await expect(addButton).toBeVisible()
    await expect(widget.getByTestId('nook-auth-gate-vault-status')).toHaveText(
      'Connected to Demo vault',
    )
    const beforeConsent = await recordedRuntimeMessages(page)
    expect(beforeConsent).not.toContain(
      CompanionWasmSessionMessageType.ResolveAuthenticatorEnrollmentCandidates,
    )
    expect(beforeConsent).not.toContain(
      'nook:website-authenticator-enroll-stage',
    )
    await demoBeat(page)

    await addButton.click()
    await expect(
      widget.getByRole('heading', {
        name: /Review this authenticator before continuing/,
      }),
    ).toBeVisible()
    // The ZXing reader decoded the real QR offscreen; Rust parsed its labels.
    await expect(widget.getByRole('textbox', { name: 'Service' })).toHaveValue(
      'Demo Service',
    )
    await expect(widget.getByRole('textbox', { name: 'Account' })).toHaveValue(
      'demo.user@example.test',
    )
    await expect(widget.getByText(/JBSWY3DPEHPK3PXP/)).toHaveCount(0)
    await demoBeat(page)

    await widget.getByRole('button', { name: 'Continue enrollment' }).click()
    await expect(
      widget.getByText('Authenticator saved to your vault.'),
    ).toBeVisible()
    const runtimeMessages = await recordedRuntimeMessages(page)
    expect(runtimeMessages).toContain(
      CompanionWasmSessionMessageType.AuthenticationAuthenticatorSetupObservation,
    )
    expect(runtimeMessages).toContain(
      CompanionWasmSessionMessageType.ResolveAuthenticatorEnrollmentCandidates,
    )
    expect(runtimeMessages).toContain('nook:website-authenticator-enroll-stage')
    expect(runtimeMessages).toContain(
      'nook:website-authenticator-enroll-confirm',
    )
    await expect
      .poll(() => page.evaluate(() => window.__nookDemoReviewedLabels))
      .toEqual({ issuer: 'Demo Service', account: 'demo.user@example.test' })
    await demoBeat(page)
  })
}

test('enrolls 2FA from a setup key shown after "Enter code manually"', async ({
  page,
}) => {
  await openSettingsPage(page)
  const widget = page.locator('#nook-auth-widget')
  const dialogRequest: DemoDialogRequest = {
    page,
    media: DemoQrMedia.InlineSvg,
    layout: DemoSetupLayout.SemanticDialog,
  }
  await openSetupDialog(dialogRequest)
  await expect(
    widget.getByRole('button', { name: 'Add 2FA from this page' }),
  ).toBeVisible()
  await demoBeat(page)

  // The key view replaces the QR; its instructions alone keep the action.
  await page.getByTestId('demo-enter-code-manually').click()
  await expect(page.getByTestId('demo-setup-key')).toHaveText(SETUP_KEY)
  await expect(page.getByTestId('demo-dialog-qr')).toHaveCount(0)
  const addButton = widget.getByRole('button', {
    name: 'Add 2FA from this page',
  })
  await expect(addButton).toBeVisible()
  await demoBeat(page)

  await addButton.click()
  await expect(
    widget.getByRole('heading', {
      name: /Review this authenticator before continuing/,
    }),
  ).toBeVisible()
  const service = widget.getByRole('textbox', { name: 'Service' })
  const pageHost = await page.evaluate(() =>
    location.hostname.replace(/^www\./, ''),
  )
  await expect(service).toHaveValue(pageHost)
  await expect(widget.getByRole('textbox', { name: 'Account' })).toHaveValue('')
  await expect(widget.getByText(/JBSW/)).toHaveCount(0)
  const continueButton = widget.getByRole('button', {
    name: 'Continue enrollment',
  })
  await expect(continueButton).toBeEnabled()
  // Rust rejects an empty Service before the site step, so it cannot fail later.
  await service.fill('')
  await expect(continueButton).toBeDisabled()
  await service.fill('Demo Service')
  await expect(continueButton).toBeEnabled()
  await widget
    .getByRole('textbox', { name: 'Account' })
    .fill('demo.user@example.test')
  await demoBeat(page)

  await widget.getByRole('button', { name: 'Continue enrollment' }).click()
  await expect(
    widget.getByText('Authenticator saved to your vault.'),
  ).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => window.__nookDemoReviewedLabels))
    .toEqual({ issuer: 'Demo Service', account: 'demo.user@example.test' })
  await demoBeat(page)
})
