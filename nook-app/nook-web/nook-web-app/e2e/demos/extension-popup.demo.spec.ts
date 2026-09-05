import { expect, test, type Route } from '../fixtures'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { demoBeat } from './pilot-demo-helpers'
import { DeviceProtectionStatus } from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import { LoginPickerQueryMessageType } from '../../../nook-web-extension/src/lib/login-picker-messages'
const demoDir = path.dirname(fileURLToPath(import.meta.url))
const extensionDist = path.resolve(demoDir, '../../../nook-web-extension/dist')
const extensionRoutePrefix = '/__extension-popup/'
type PopupDemoSession = {
  queryMessageType: LoginPickerQueryMessageType
  firstStatus: DeviceProtectionStatus
  followingStatus: DeviceProtectionStatus
}
function installPopupDemoRuntime(session: PopupDemoSession): void {
  let statusReads = 0
  const device = {
    deviceId: 'popup-demo-device',
    devicePublicKey: 'popup-demo-public-key',
    deviceSigningPublicKey: 'popup-demo-signing-key',
  }
  const setup = {
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
  const runtime = {
    getURL: (resource: string) =>
      `${globalThis.location.origin}/__extension-popup/${resource}`,
    sendMessage: (
      message: { readonly type: string },
      callback: (response: unknown) => void,
    ) => {
      switch (message.type) {
        case session.queryMessageType:
          callback({ ok: false, reason: 'login-picker-expired' })
          return
        case 'nook:extension-pairing-state-query':
          callback({ ok: true, setup })
          return
        case 'nook:extension-session-status':
          callback({
            ok: true,
            status:
              statusReads++ === 0
                ? session.firstStatus
                : session.followingStatus,
            device,
          })
          return
        default:
          // Picker cancellation is a one-way message when the page closes.
          callback?.({ ok: true })
      }
    },
  }
  const chromeStub = {
    i18n: { getUILanguage: () => 'en' },
    runtime,
  }
  const descriptor: PropertyDescriptor = { value: chromeStub }
  Object.defineProperty(globalThis, 'chrome', descriptor)
}
test.beforeEach(async ({ page }) => {
  await page.route(`**${extensionRoutePrefix}**`, async (route: Route) => {
    const requestPath = new URL(route.request().url()).pathname
    const relativePath = requestPath.slice(extensionRoutePrefix.length)
    await route.fulfill({
      path: path.join(extensionDist, relativePath),
    })
  })
})
test('keeps mixed session status safe and actionable', async ({ page }) => {
  const session: PopupDemoSession = {
    queryMessageType: LoginPickerQueryMessageType.NookLoginPickerQuery,
    firstStatus: DeviceProtectionStatus.Unlocked,
    followingStatus: DeviceProtectionStatus.Passkey,
  }
  await page.addInitScript(installPopupDemoRuntime, session)
  await page.goto(`${extensionRoutePrefix}popup/index.html?state=mixed`)
  await expect(
    page.locator(
      '[data-testid="stay-ready-btn"] + [data-testid="open-simple-vault-btn"]',
    ),
  ).toBeVisible()
  await expect(page.getByTestId('connect-simple-vault-btn')).toBeHidden()
  await demoBeat(page)
})

test('reopens an unlocked popup without another ceremony', async ({ page }) => {
  const session: PopupDemoSession = {
    queryMessageType: LoginPickerQueryMessageType.NookLoginPickerQuery,
    firstStatus: DeviceProtectionStatus.Unlocked,
    followingStatus: DeviceProtectionStatus.Unlocked,
  }
  await page.addInitScript(installPopupDemoRuntime, session)
  await page.goto(`${extensionRoutePrefix}popup/index.html`)
  await expect(page.getByTestId('extension-toolbar-menu')).toBeVisible()
  await expect(page.getByTestId('extension-device-setup')).toHaveCount(0)
  await page.reload()
  await expect(page.getByTestId('extension-toolbar-menu')).toBeVisible()
  await expect(page.getByTestId('extension-device-setup')).toHaveCount(0)
  await expect(page.getByTestId('device-protection-unlock-btn')).toHaveCount(0)
  await demoBeat(page)
})

test('shows no account choices when cleanup has invalidated the picker', async ({
  page,
}) => {
  // The real popup renders the denied query projection. Consuming WASM handles
  // and cleanup overlap are exercised by account-picker-lock.test.ts.
  const session: PopupDemoSession = {
    queryMessageType: LoginPickerQueryMessageType.NookLoginPickerQuery,
    firstStatus: DeviceProtectionStatus.Unlocked,
    followingStatus: DeviceProtectionStatus.Passkey,
  }
  await page.addInitScript(installPopupDemoRuntime, session)
  await page.goto(
    `${extensionRoutePrefix}popup/index.html?intent=login-picker&request=cleanup-blocked`,
  )
  await expect(page.getByTestId('login-picker')).toBeVisible()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByTestId('login-results')).toHaveCount(0)
  await expect(page.getByTestId('login-destination')).toHaveCount(0)
  await page.getByTestId('login-search').fill('another account')
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByTestId('login-results')).toHaveCount(0)
  await demoBeat(page)
})
