import { expect, test, type Route } from '../fixtures'
import { Effect } from 'effect'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { demoBeat } from './pilot-demo-helpers'
import { DeviceProtectionStatus } from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import {
  AuthenticatorPickerQueryMessage,
  AuthenticatorPickerQueryMessageType,
  AuthenticatorPickerSelectMessageType,
} from '../../../nook-web-extension/src/lib/authenticator-picker-messages'
import { LoginPickerQueryMessageType } from '../../../nook-web-extension/src/lib/login-picker-messages'
const demoDir = path.dirname(fileURLToPath(import.meta.url))
const extensionDist = path.resolve(demoDir, '../../../nook-web-extension/dist')
const extensionRoutePrefix = '/__extension-popup/'
type PopupDemoSession = {
  queryMessageType: LoginPickerQueryMessageType
  authenticatorQueryMessageType: AuthenticatorPickerQueryMessageType
  firstStatus: DeviceProtectionStatus
  followingStatus: DeviceProtectionStatus
  hasVaultConnection?: boolean
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
        case session.authenticatorQueryMessageType:
          {
            const decodedQuery = Effect.runSync(
              Effect.either(AuthenticatorPickerQueryMessage.decode(message)),
            )
            callback({
              ok: true,
              origin: 'https://accounts.example.test',
              accounts:
                decodedQuery._tag === 'Right'
                  ? decodedQuery.right.payload.query.trim().length === 0
                    ? [
                        {
                          vaultStoreId: 'popup-demo-store',
                          vaultName: 'Personal vault',
                          secretId: 'popup-demo-authenticator',
                          issuer: 'Example',
                          account: 'demo@example.test',
                        },
                      ]
                    : []
                  : [],
            })
          }
          return
        case AuthenticatorPickerSelectMessageType.NookAuthenticatorPickerSelect:
          callback({ ok: true })
          return
        case 'nook:extension-pairing-state-query':
          callback(
            session.hasVaultConnection === false
              ? { ok: false, reason: 'vault-not-connected' }
              : { ok: true, setup },
          )
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
        case 'nook:extension-session-unlock-pin':
          callback({ ok: true, device })
          return
        case 'nook:extension-session-vault-summary':
          callback({ ok: true, secretCount: 12 })
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
    authenticatorQueryMessageType:
      AuthenticatorPickerQueryMessageType.NookAuthenticatorPickerQuery,
    firstStatus: DeviceProtectionStatus.Unlocked,
    followingStatus: DeviceProtectionStatus.Passkey,
  }
  await page.addInitScript(installPopupDemoRuntime, session)
  await page.goto(`${extensionRoutePrefix}popup/index.html?state=mixed`)
  await expect(page.getByTestId('open-simple-vault-btn')).toBeVisible()
  await expect(page.getByTestId('companion-done-btn')).toHaveText('Done')
  await expect(page.getByTestId('connect-simple-vault-btn')).toBeHidden()
  await demoBeat(page)
})

test('restores the paired companion home after a restart unlock', async ({
  page,
}) => {
  const session: PopupDemoSession = {
    queryMessageType: LoginPickerQueryMessageType.NookLoginPickerQuery,
    authenticatorQueryMessageType:
      AuthenticatorPickerQueryMessageType.NookAuthenticatorPickerQuery,
    firstStatus: DeviceProtectionStatus.Pin,
    followingStatus: DeviceProtectionStatus.Pin,
  }
  await page.addInitScript(installPopupDemoRuntime, session)
  await page.goto(`${extensionRoutePrefix}popup/index.html`)
  await expect(page.getByTestId('extension-device-setup')).toBeVisible()
  await page.getByTestId('device-protection-pin-unlock-input').fill('123456')
  await page.getByTestId('device-protection-pin-unlock-btn').click()
  await expect(page.getByTestId('extension-toolbar-menu')).toBeVisible()
  await expect(page.getByTestId('extension-device-setup')).toHaveCount(0)
  await expect(page.getByTestId('companion-vault-status')).toHaveAttribute(
    'data-connected',
    'true',
  )
  await expect(page.getByTestId('companion-vault-status')).toContainText(
    'Personal vault',
  )
  await expect(page.getByTestId('companion-title')).toHaveText(
    'Ready for sign-ins',
  )
  await expect(page.getByTestId('companion-description')).toContainText(
    'Personal vault',
  )
  await expect(page.getByTestId('companion-done-btn')).toBeVisible()
  await expect(page.getByTestId('open-simple-vault-btn')).toBeVisible()
  await expect(page.getByTestId('connect-simple-vault-btn')).toBeHidden()
  await expect(page.getByTestId('companion-secret-count')).toHaveText('12')
  await expect(page.getByTestId('companion-identity-status')).toHaveText(
    'Linked',
  )
  await expect(page.getByTestId('companion-connection-status')).toHaveText(
    'Connected',
  )
  await demoBeat(page)
})

test('explains the next step when the protected identity has no vault', async ({
  page,
}) => {
  const session: PopupDemoSession = {
    queryMessageType: LoginPickerQueryMessageType.NookLoginPickerQuery,
    authenticatorQueryMessageType:
      AuthenticatorPickerQueryMessageType.NookAuthenticatorPickerQuery,
    firstStatus: DeviceProtectionStatus.Unlocked,
    followingStatus: DeviceProtectionStatus.Unlocked,
    hasVaultConnection: false,
  }
  await page.addInitScript(installPopupDemoRuntime, session)
  await page.goto(`${extensionRoutePrefix}popup/index.html`)

  await expect(page.getByTestId('companion-title')).toHaveText(
    'Connect your vault',
  )
  await expect(page.getByTestId('companion-secret-count')).toHaveText(
    'Unavailable',
  )
  await expect(page.getByTestId('companion-identity-status')).toHaveText(
    'Protected',
  )
  await expect(page.getByTestId('companion-connection-status')).toHaveText(
    'Vault not connected',
  )
  await expect(page.getByTestId('connect-simple-vault-btn')).toBeVisible()
  await expect(page.getByTestId('open-simple-vault-btn')).toBeVisible()
  await demoBeat(page)
})

test('shows no account choices when cleanup has invalidated the picker', async ({
  page,
}) => {
  // The real popup renders the denied query projection. Consuming WASM handles
  // and cleanup overlap are exercised by account-picker-lock.test.ts.
  const session: PopupDemoSession = {
    queryMessageType: LoginPickerQueryMessageType.NookLoginPickerQuery,
    authenticatorQueryMessageType:
      AuthenticatorPickerQueryMessageType.NookAuthenticatorPickerQuery,
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

test('searches the authenticator picker without losing account context', async ({
  page,
}) => {
  const session: PopupDemoSession = {
    queryMessageType: LoginPickerQueryMessageType.NookLoginPickerQuery,
    authenticatorQueryMessageType:
      AuthenticatorPickerQueryMessageType.NookAuthenticatorPickerQuery,
    firstStatus: DeviceProtectionStatus.Unlocked,
    followingStatus: DeviceProtectionStatus.Passkey,
  }
  await page.addInitScript(installPopupDemoRuntime, session)
  await page.goto(
    `${extensionRoutePrefix}popup/index.html?intent=authenticator-picker&request=popup-demo-authenticator`,
  )

  await expect(page.getByTestId('authenticator-picker')).toBeVisible()
  await expect(page.getByTestId('authenticator-destination')).toContainText(
    'accounts.example.test',
  )
  await expect(page.getByTestId('authenticator-results')).toContainText(
    'demo@example.test',
  )
  await page.getByTestId('authenticator-search').fill('unknown account')
  await expect(page.getByTestId('authenticator-results')).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await demoBeat(page)
})
