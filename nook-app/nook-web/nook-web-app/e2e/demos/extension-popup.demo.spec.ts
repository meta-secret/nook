import { expect, test, type Route } from '../fixtures'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ExtensionReadySetup } from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm'
import { demoBeat } from './pilot-demo-helpers'

const demoDir = path.dirname(fileURLToPath(import.meta.url))
const extensionDist = path.resolve(demoDir, '../../../nook-web-extension/dist')
const extensionRoutePrefix = '/__extension-popup/'

function installPopupDemoRuntime(): void {
  const device = {
    deviceId: 'popup-demo-device',
    devicePublicKey: 'popup-demo-public-key',
    deviceSigningPublicKey: 'popup-demo-signing-key',
  }
  const setup: ExtensionReadySetup = {
    status: 'ready',
    deviceLabel: 'Nook Extension - UI demo',
    pairedVaults: ['Personal vault'],
    selectedVaultStoreId: 'popup-demo-store',
    selectedVaultName: 'Personal vault',
    syncProviderCount: 0,
    eventCount: 1,
    eventLogHeads: ['popup-demo-event-head'],
    lastLocalSyncAt: '2026-08-25T00:00:00.000Z',
  }
  type RuntimeResponse = {
    readonly ok: boolean
    readonly setup?: typeof setup
    readonly status?: number
    readonly device?: typeof device
  }

  const runtime = {
    getURL: (resource: string) =>
      `${globalThis.location.origin}/__extension-popup/${resource}`,
    sendMessage: (
      message: { readonly type: string },
      callback: (response: RuntimeResponse) => void,
    ) => {
      switch (message.type) {
        case 'nook:extension-pairing-state-query': {
          const connected =
            new URLSearchParams(globalThis.location.search).get('state') ===
            'connected'
          callback(connected ? { ok: true, setup } : { ok: false })
          return
        }
        case 'nook:ensure-extension-session-runtime':
          callback({ ok: true })
          return
        case 'nook:extension-session-status':
          callback({ ok: true, status: 6, device })
          return
        default:
          callback({ ok: true })
      }
    },
  }

  const chromeStub = {
    i18n: { getUILanguage: () => 'en' },
    runtime,
  }
  const browserGlobal = globalThis as typeof globalThis & {
    chrome?: typeof chromeStub
  }
  if (browserGlobal.chrome) {
    Object.defineProperties(browserGlobal.chrome, {
      i18n: { configurable: true, value: chromeStub.i18n },
      runtime: { configurable: true, value: chromeStub.runtime },
    })
  } else {
    Object.defineProperty(browserGlobal, 'chrome', {
      configurable: true,
      value: chromeStub,
    })
  }
}

test('keeps the extension toolbar popup focused on one next action', async ({
  page,
}) => {
  await page.addInitScript(installPopupDemoRuntime)
  await page.route(`**${extensionRoutePrefix}**`, async (route: Route) => {
    const requestPath = new URL(route.request().url()).pathname
    const relativePath = requestPath.slice(extensionRoutePrefix.length)
    const response: Parameters<Route['fulfill']>[0] = {
      path: path.join(extensionDist, relativePath),
    }
    await route.fulfill(response)
  })

  await page.goto(`${extensionRoutePrefix}popup/index.html?state=connected`)
  await expect(
    page.locator(
      '[data-testid="stay-ready-btn"] + [data-testid="open-simple-vault-btn"]',
    ),
  ).toBeVisible()
  await demoBeat(page)
})
