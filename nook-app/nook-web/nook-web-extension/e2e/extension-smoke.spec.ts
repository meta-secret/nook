import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
} from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ExtensionPairingApprovedMessage } from '../../nook-web-shared/src/extension/runtime-messages'
import {
  attachNookLogsForTest,
  readPersistedAppLogs,
} from '../../nook-web-app/e2e/helpers'
import { installMockPasskeyRuntime } from '../../nook-web-app/e2e/passkey-mock'
import {
  belongsToSentinelVault,
  belongsToSimpleVault,
  DEFAULT_SIMPLE_VAULT_URL,
  matchingSentinelVaultBaseUrl,
  normalizeSimpleVaultBaseUrl,
  simpleVaultUrl,
} from '../src/lib/simple-vault-target'
import { startMockAuthServer } from './mock-auth'
import { waitForExtensionPairingReady } from './helpers/extension-approval'

const EXTENSION_UNLOCK_TIMEOUT_MS = 30_000

async function advanceCreateVaultWizardToFinalStep(page: Page) {
  const chooser = page.getByTestId('login-create-vault-chooser')
  await expect(chooser).toBeVisible({ timeout: EXTENSION_UNLOCK_TIMEOUT_MS })

  const finalStep = page.getByTestId('create-vault-wizard-create')
  if (await finalStep.isVisible()) return

  const simplePath = page.getByTestId('get-started-path-simple')
  await expect(simplePath).toBeVisible({
    timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
  })
  await simplePath.click()

  await expect(finalStep).toBeVisible({ timeout: EXTENSION_UNLOCK_TIMEOUT_MS })
  const nameInput = page.getByTestId('login-vault-name-input')
  if (!(await nameInput.inputValue()).trim()) {
    await nameInput.fill('Test vault', {
      timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
    })
  }
}

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const extensionDir =
  process.env.NOOK_EXTENSION_E2E_DIR || path.join(rootDir, 'dist')
const chromiumExecutablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined
const setupStorageKey = 'nook:extension-setup'
const pairingGrantStorageKey = 'nook:extension-pairing-grant:store-e2e'
const syntheticEventLogRecords = [
  {
    eventId: 'event-e2e',
    path: 'events/event-e2e.yaml',
    event: { schema_version: 1 },
  },
]
const connectedSetupState = {
  status: 'ready',
  deviceLabel: 'Nook Extension - Chromium test profile',
  pairedVaults: ['Personal'],
  selectedVaultName: 'Personal',
  syncProviderCount: 0,
  eventCount: 1,
  eventLogHeads: ['event-e2e'],
  lastLocalSyncAt: '2026-07-07T00:00:00.000Z',
}
const simpleVaultBaseUrl = normalizeSimpleVaultBaseUrl(
  process.env.NOOK_SIMPLE_VAULT_URL || DEFAULT_SIMPLE_VAULT_URL,
)
const isHostedSmoke = process.env.NOOK_EXTENSION_E2E_HOSTED === 'true'
const extensionApprovalVaultName = isHostedSmoke
  ? 'test-vault'
  : 'Extension approval vault'

async function startLoginServer() {
  return startMockAuthServer()
}

async function registerWebsitePasskey(page: Page): Promise<string> {
  const ceremony = page.evaluate(async () => {
    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge: new Uint8Array(32).fill(7),
        rp: { id: 'localhost', name: 'Nook extension e2e' },
        user: {
          id: new TextEncoder().encode('nook-e2e-user'),
          name: 'alice@example.com',
          displayName: 'Alice',
        },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        authenticatorSelection: {
          residentKey: 'required',
          userVerification: 'required',
        },
        timeout: 15_000,
      },
    })) as PublicKeyCredential
    return credential.id
  })
  await expect(page.locator('aside[aria-label="Nook passkey"]')).toBeVisible()
  await page.keyboard.press('Enter')
  return ceremony
}

async function assertWebsitePasskey(
  page: Page,
  credentialId: string,
): Promise<void> {
  const ceremony = page.evaluate(async (id) => {
    const rawId = Uint8Array.from(
      atob(
        id.replaceAll('-', '+').replaceAll('_', '/') +
          '='.repeat((4 - (id.length % 4)) % 4),
      ),
      (character) => character.charCodeAt(0),
    )
    const credential = (await navigator.credentials.get({
      publicKey: {
        challenge: new Uint8Array(32).fill(9),
        rpId: 'localhost',
        allowCredentials: [{ type: 'public-key', id: rawId }],
        userVerification: 'required',
        timeout: 15_000,
      },
    })) as PublicKeyCredential
    const response = credential.response as AuthenticatorAssertionResponse
    return {
      id: credential.id,
      authenticatorDataLength: response.authenticatorData.byteLength,
      signatureLength: response.signature.byteLength,
    }
  }, credentialId)
  await expect(page.locator('aside[aria-label="Nook passkey"]')).toBeVisible()
  await page.keyboard.press('Enter')
  const result = await ceremony
  expect(result).toMatchObject({
    id: credentialId,
    authenticatorDataLength: 37,
  })
  expect(result.signatureLength).toBeGreaterThan(64)
}

async function getServiceWorker(context: BrowserContext) {
  return (
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker', { timeout: 15_000 }))
  )
}

async function launchExtensionContext(userDataDir: string) {
  await mkdir(userDataDir, { recursive: true })
  return chromium.launchPersistentContext(userDataDir, {
    headless: false,
    executablePath: chromiumExecutablePath,
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
    ],
  })
}

async function setupPasskeyExtensionPopup(
  context: BrowserContext,
): Promise<Page> {
  const worker = await getServiceWorker(context)
  const extensionId = new URL(worker.url()).host
  const popupPage = await context.newPage()
  await popupPage.goto(`chrome-extension://${extensionId}/popup/index.html`)
  await expect(popupPage.getByTestId('extension-device-setup')).toBeVisible()
  await popupPage.getByTestId('device-protection-create-new-choice').click()
  await popupPage.getByTestId('device-protection-setup-btn').click()
  await expect(popupPage.getByTestId('extension-companion-home')).toBeVisible()
  return popupPage
}

async function openSimpleVaultConnection(
  context: BrowserContext,
  popupPage: Page,
): Promise<Page> {
  const openedConnectPage = context.waitForEvent('page')
  await popupPage.getByTestId('connect-simple-vault-btn').click()
  const simplePage = await openedConnectPage
  await expect(simplePage).toHaveURL((url) =>
    belongsToSimpleVault(simpleVaultBaseUrl, url.toString()),
  )
  return simplePage
}

async function readExtensionStorage(context: BrowserContext) {
  const worker = await getServiceWorker(context)
  return worker.evaluate(
    () =>
      new Promise<Record<string, unknown>>((resolve) => {
        const browserGlobal = globalThis as unknown as {
          chrome: {
            storage: {
              local: {
                get(
                  keys: undefined,
                  callback: (items: Record<string, unknown>) => void,
                ): void
              }
            }
          }
        }
        browserGlobal.chrome.storage.local.get(undefined, resolve)
      }),
  )
}

async function writeExtensionStorage(
  page: Page,
  items: Record<string, unknown>,
) {
  await page.evaluate(
    (storageItems) =>
      new Promise<void>((resolve) => {
        chrome.storage.local.set(storageItems, resolve)
      }),
    items,
  )
}

async function sendExternalMessage(
  page: Page,
  extensionId: string,
  message: unknown,
) {
  return page.evaluate(
    ({ runtimeId, runtimeMessage }) =>
      new Promise<unknown>((resolve, reject) => {
        const browserGlobal = globalThis as typeof globalThis & {
          chrome?: {
            runtime?: {
              lastError?: { message?: string }
              sendMessage(
                extensionId: string,
                message: unknown,
                callback: (response?: unknown) => void,
              ): void
            }
          }
        }
        const runtime = browserGlobal.chrome?.runtime
        if (!runtime) {
          reject(new Error('Extension messaging is unavailable.'))
          return
        }
        runtime.sendMessage(runtimeId, runtimeMessage, (response) => {
          if (runtime.lastError?.message) {
            reject(new Error(runtime.lastError.message))
            return
          }
          resolve(response)
        })
      }),
    { runtimeId: extensionId, runtimeMessage: message },
  )
}

test('sets up the extension device first and sends its public keys to Simple Vault', async ({
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

  const manifest = JSON.parse(
    await readFile(path.join(extensionDir, 'manifest.json'), 'utf8'),
  ) as { action?: { default_popup?: string } }
  expect(manifest.action?.default_popup).toBe('popup/index.html')

  const loginServer = await startLoginServer()
  const userDataDir = testInfo.outputPath('chromium-profile')
  const context = await launchExtensionContext(userDataDir)

  await context.route('**/*', (route) => {
    const url = route.request().url()
    if (belongsToSimpleVault(simpleVaultBaseUrl, url)) {
      return route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><body><h1>Simple Vault</h1></body></html>',
      })
    }
    if (belongsToSentinelVault(simpleVaultBaseUrl, url)) {
      return route.fulfill({
        contentType: 'text/html',
        body: '<form><input autocomplete="username"><input type="password"></form>',
      })
    }
    return route.continue()
  })

  try {
    const worker = await getServiceWorker(context)
    const extensionId = new URL(worker.url()).host

    const popupPage = await context.newPage()
    await popupPage.goto(`chrome-extension://${extensionId}/popup/index.html`)
    await expect(popupPage.getByTestId('extension-device-setup')).toBeVisible()
    await expect(
      popupPage.getByTestId('device-protection-use-existing-choice'),
    ).toHaveText('Authenticate')
    await expect(popupPage.getByTestId('device-mode-select')).toBeHidden()
    await expect(
      popupPage.getByTestId('device-protection-create-new-choice'),
    ).toHaveText('Create passkey')
    await expect(
      popupPage.getByTestId('device-protection-setup-btn'),
    ).toBeHidden()

    await popupPage.getByTestId('device-protection-create-new-choice').click()
    await expect(popupPage.getByTestId('device-mode-select')).toHaveValue(
      'standard',
    )
    await expect(
      popupPage.getByTestId('device-protection-setup-btn'),
    ).toHaveText('Create new passkey')
    await expect(
      popupPage.getByTestId('device-protection-use-existing-choice'),
    ).toBeVisible()

    const openedConnectPage = context.waitForEvent('page', { timeout: 30_000 })
    expect(
      await popupPage.evaluate(
        () =>
          new Promise<unknown>((resolve) => {
            chrome.runtime.sendMessage(
              {
                type: 'nook:begin-extension-pairing',
                payload: {
                  deviceId: 'device-popup-e2e',
                  devicePublicKey: 'age1popup',
                  deviceSigningPublicKey: 'popup-signing-key',
                  deviceLabel: 'Nook Extension - Chromium test profile',
                },
              },
              resolve,
            )
          }),
      ),
    ).toEqual({ ok: true })
    const simplePage = await openedConnectPage
    await expect(simplePage).toHaveURL((url) => {
      const expected = new URL(
        simpleVaultUrl(simpleVaultBaseUrl, 'extension-connect'),
      )
      return (
        url.origin === expected.origin &&
        url.pathname === expected.pathname &&
        url.searchParams.get('extension_id') === extensionId &&
        url.searchParams.get('device_id') === 'device-popup-e2e' &&
        url.searchParams.get('device_public_key') === 'age1popup' &&
        url.searchParams.get('device_signing_public_key') ===
          'popup-signing-key' &&
        url.searchParams.get('nonce') !== null &&
        url.searchParams.get('scopes') ===
          'vault-access,password-filling,passkey-management,sync-provider-credentials'
      )
    })

    const openedCompanionPage = context.waitForEvent('page', {
      timeout: 30_000,
    })
    expect(
      await sendExternalMessage(simplePage, extensionId, {
        type: 'nook:open-companion-launcher',
      }),
    ).toEqual({ ok: true })
    const companionPage = await openedCompanionPage
    await expect(companionPage).toHaveURL(
      `chrome-extension://${extensionId}/popup/index.html`,
    )
    await expect(
      companionPage.getByTestId('extension-device-setup'),
    ).toBeVisible()
    await companionPage.close()

    const loginPage = await context.newPage()
    await loginPage.goto(`${loginServer.origin}/login`)
    const widget = loginPage.locator('#nook-auth-widget')
    await expect(widget).toBeVisible()
    await expect(widget.getByText('Nook Pilot · 1/3')).toBeVisible()
    await expect(widget.getByText('Ready to sign in')).toBeVisible()
    await expect(widget.getByText('localhost')).toBeVisible()
    await expect(widget.getByTestId('nook-auth-gate-vault-status')).toHaveText(
      'Vault not connected',
    )
    await expect(
      widget.getByRole('button', { name: 'Continue with Nook' }),
    ).toBeVisible()
    await expect(
      widget.getByRole('button', { name: 'Open vault' }),
    ).toBeVisible()

    const hiddenHeaderLoginPage = await context.newPage()
    await hiddenHeaderLoginPage.goto(
      `${loginServer.origin}/login-with-hidden-header`,
    )
    const hiddenHeaderWidget =
      hiddenHeaderLoginPage.locator('#nook-auth-widget')
    await expect(hiddenHeaderWidget.getByText('Ready to sign in')).toBeVisible()
    await expect(
      hiddenHeaderWidget.getByRole('button', { name: 'Continue with Nook' }),
    ).toBeVisible()
    await expect(hiddenHeaderWidget.getByText('Manual checkpoint')).toHaveCount(
      0,
    )

    await widget.evaluate((host) => {
      host.shadowRoot
        ?.querySelector<HTMLButtonElement>('button.primary-button')
        ?.click()
    })
    await expect(widget.getByText('Ready to sign in')).toBeVisible()

    await widget.getByRole('button', { name: 'Collapse Nook' }).click()
    await expect(
      widget.getByRole('button', { name: 'Continue with Nook' }),
    ).toBeHidden()
    await expect(
      widget
        .getByTestId('nook-auth-gate-expand')
        .getByText('1/3', { exact: true }),
    ).toBeVisible()
    await expect(
      widget.getByRole('button', { name: /Expand Nook: Nook Pilot · 1\/3/ }),
    ).toBeVisible()
    await widget.getByTestId('nook-auth-gate-expand').click()
    await expect(
      widget.getByRole('button', { name: 'Continue with Nook' }),
    ).toBeVisible()

    const openedVault = context.waitForEvent('page')
    await widget.getByRole('button', { name: 'Open vault' }).click()
    await expect(await openedVault).toHaveURL(simpleVaultBaseUrl)

    const signupPage = await context.newPage()
    await signupPage.goto(`${loginServer.origin}/signup`)
    const signupWidget = signupPage.locator('#nook-auth-widget')
    await expect(signupWidget.getByText('Nook Pilot · 2/5')).toBeVisible()
    await expect(signupWidget.getByText('Signup detected')).toBeVisible()
    await expect(
      signupWidget.getByRole('button', { name: 'Take over' }),
    ).toBeVisible()
    await signupWidget.evaluate((host) => {
      host.shadowRoot
        ?.querySelector<HTMLButtonElement>('button.text-button')
        ?.click()
    })
    await expect(signupWidget).toBeVisible()

    const otpPage = await context.newPage()
    await otpPage.goto(`${loginServer.origin}/otp`)
    const otpWidget = otpPage.locator('#nook-auth-widget')
    await expect(otpWidget.getByText('Nook Pilot · 2/3')).toBeVisible()
    await expect(otpWidget.getByText('Fill your 2FA code')).toBeVisible()

    const hiddenOtpPage = await context.newPage()
    await hiddenOtpPage.goto(`${loginServer.origin}/otp-hidden`)
    const hiddenOtpWidget = hiddenOtpPage.locator('#nook-auth-widget')
    await expect(hiddenOtpWidget).toHaveCount(0)
    await hiddenOtpPage
      .getByRole('button', { name: 'Continue to verification' })
      .click()
    await expect(hiddenOtpWidget.getByText('Fill your 2FA code')).toBeVisible()

    const combinedPage = await context.newPage()
    await combinedPage.goto(`${loginServer.origin}/combined`)
    const combinedWidget = combinedPage.locator('#nook-auth-widget')
    await expect(combinedWidget.getByText('Ready to sign in')).toBeVisible()
    await expect(
      combinedWidget.getByRole('button', { name: 'Continue with Nook' }),
    ).toBeVisible()

    const spaPage = await context.newPage()
    await spaPage.goto(`${loginServer.origin}/spa`)
    const spaWidget = spaPage.locator('#nook-auth-widget')
    await expect(
      spaWidget.getByRole('button', { name: 'Continue with Nook' }),
    ).toBeVisible()
    await spaPage.getByRole('button', { name: 'Next' }).click()
    await expect(
      spaWidget.getByRole('button', { name: 'Continue with Nook' }),
    ).toBeVisible()

    const microsoftPage = await context.newPage()
    await microsoftPage.goto(`${loginServer.origin}/microsoft`)
    const microsoftWidget = microsoftPage.locator('#nook-auth-widget')
    await expect(
      microsoftWidget.getByRole('button', { name: 'Continue with Nook' }),
    ).toBeVisible()
    await expect(microsoftPage.locator('[name="loginfmt"]')).toBeVisible()

    const slackPage = await context.newPage()
    await slackPage.goto(`${loginServer.origin}/slack`)
    const slackWidget = slackPage.locator('#nook-auth-widget')
    await expect(
      slackWidget.getByRole('button', { name: 'Continue with Nook' }),
    ).toBeVisible()
    await expect(slackPage.locator('[data-qa="login_email"]')).toBeVisible()

    const sentinelPage = await context.newPage()
    const sentinelUrl =
      matchingSentinelVaultBaseUrl(simpleVaultBaseUrl) ??
      'https://sentinel.nokey.sh/'
    await sentinelPage.goto(sentinelUrl)
    await expect(sentinelPage.locator('#nook-auth-widget')).toHaveCount(0)

    const forgedGrant = {
      type: 'nook:extension-pairing-approved',
      payload: {
        vaultType: 'sentinel',
        deviceId: 'sentinel-device-e2e',
        devicePublicKey: 'age1sentinel',
        deviceSigningPublicKey: 'sentinel-signing-key',
        deviceLabel: 'Forged Sentinel device',
        vaultStoreId: 'sentinel-store-e2e',
        vaultName: 'Sentinel safe',
        approvedAt: '2026-07-07T00:00:00.000Z',
        scopes: ['vault-access'],
        providers: [],
      },
      eventLogRecords: syntheticEventLogRecords,
    }
    expect(
      await sendExternalMessage(simplePage, extensionId, forgedGrant),
    ).toEqual({ ok: false, reason: 'invalid-pairing-grant' })

    const approvedGrant: ExtensionPairingApprovedMessage = {
      type: 'nook:extension-pairing-approved',
      payload: {
        vaultType: 'simple',
        deviceId: 'device-e2e',
        devicePublicKey: 'age1extension',
        deviceSigningPublicKey: 'extension-signing-key',
        deviceLabel: 'Nook Extension - Chromium test profile',
        vaultStoreId: 'store-e2e',
        vaultName: 'Personal',
        approvedAt: '2026-07-07T00:00:00.000Z',
        scopes: ['vault-access', 'password-filling'],
        providers: [],
      },
      eventLogRecords: syntheticEventLogRecords,
    }
    expect(
      await sendExternalMessage(simplePage, extensionId, approvedGrant),
    ).toEqual({ ok: false, reason: 'event-log-import-failed' })

    const storage = await readExtensionStorage(context)
    expect(storage[pairingGrantStorageKey]).toBeUndefined()
    expect(storage[setupStorageKey]).toBeUndefined()
  } finally {
    await context.close()
    await loginServer.close()
  }
})

test('shows extension unlock when a paired device identity is unavailable', async ({
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

  const userDataDir = testInfo.outputPath('chromium-profile')
  await mkdir(userDataDir, { recursive: true })
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    executablePath: chromiumExecutablePath,
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
    ],
  })

  try {
    const worker = await getServiceWorker(context)
    const extensionId = new URL(worker.url()).host
    const popupPage = await context.newPage()
    await popupPage.goto(`chrome-extension://${extensionId}/popup/index.html`)
    await writeExtensionStorage(popupPage, {
      [setupStorageKey]: connectedSetupState,
    })
    await popupPage.reload()

    await expect(popupPage.getByTestId('extension-device-setup')).toBeVisible()
    await expect(popupPage.getByTestId('open-simple-vault-btn')).toHaveCount(0)
  } finally {
    await context.close()
  }
})

test('creates a passkey from browser-native WASM options after extension messaging', async ({
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

  const userDataDir = testInfo.outputPath('chromium-profile')
  const context = await launchExtensionContext(userDataDir)
  await context.addInitScript(installMockPasskeyRuntime)

  try {
    const popupPage = await setupPasskeyExtensionPopup(context)
    await expect(popupPage.getByTestId('open-simple-vault-btn')).toBeVisible()
    await expect(popupPage.getByTestId('stay-as-companion-btn')).toBeVisible()
    await openSimpleVaultConnection(context, popupPage)
  } finally {
    await context.close()
  }
})

test('uses a passkey-backed extension to create, approve, lock, and unlock a Simple Vault', async ({
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')
  testInfo.setTimeout(180_000)

  const userDataDir =
    process.env.NOOK_EXTENSION_E2E_PROFILE_DIR ||
    testInfo.outputPath('chromium-profile')
  const context = await launchExtensionContext(userDataDir)
  const loginServer = await startLoginServer()
  const website = isHostedSmoke ? undefined : await context.newPage()
  await website?.goto(`${loginServer.origin}/login`)
  const websiteAfterUnlock = isHostedSmoke ? undefined : await context.newPage()
  await websiteAfterUnlock?.goto(`${loginServer.origin}/login`)
  await context.addInitScript(installMockPasskeyRuntime)

  try {
    const popupPage = await setupPasskeyExtensionPopup(context)
    const extensionId = new URL(popupPage.url()).host
    const simplePage = await openSimpleVaultConnection(context, popupPage)
    const connectUrl = new URL(simplePage.url())
    const extensionDeviceId = connectUrl.searchParams.get('device_id')
    const extensionDevicePublicKey =
      connectUrl.searchParams.get('device_public_key')
    const extensionDeviceSigningPublicKey = connectUrl.searchParams.get(
      'device_signing_public_key',
    )
    const initialHandoffNonce = connectUrl.searchParams.get('nonce')
    expect(extensionDeviceId).toBeTruthy()
    expect(extensionDevicePublicKey).toBeTruthy()
    expect(extensionDeviceSigningPublicKey).toBeTruthy()
    expect(initialHandoffNonce).toBeTruthy()

    await advanceCreateVaultWizardToFinalStep(simplePage)
    await simplePage
      .getByTestId('login-vault-name-input')
      .fill(extensionApprovalVaultName)
    await expect(
      simplePage.getByText(
        `Create “${extensionApprovalVaultName}” locally using the extension's protected device key.`,
      ),
    ).toBeVisible()
    await expect(simplePage.getByText(/passkey is required/i)).toHaveCount(0)
    await simplePage.getByTestId('login-create-device-vault-btn').click()
    await expect(simplePage.getByTestId('passkey-auth-overlay')).toHaveCount(0)
    await expect(
      simplePage.getByTestId('extension-connect-consent'),
    ).toBeVisible()
    expect(
      await simplePage.evaluate(
        ({
          extensionId,
          nonce,
          deviceId,
          devicePublicKey,
          deviceSigningPublicKey,
        }) =>
          new Promise((resolve) => {
            chrome.runtime.sendMessage(
              extensionId,
              {
                type: 'nook:extension-identity-handoff-request',
                payload: {
                  recipientPublicKey: 'age1replayattempt',
                  nonce,
                  expectedDeviceId: deviceId,
                  expectedDevicePublicKey: devicePublicKey,
                  expectedDeviceSigningPublicKey: deviceSigningPublicKey,
                },
              },
              resolve,
            )
          }),
        {
          extensionId,
          nonce: initialHandoffNonce,
          deviceId: extensionDeviceId,
          devicePublicKey: extensionDevicePublicKey,
          deviceSigningPublicKey: extensionDeviceSigningPublicKey,
        },
      ),
    ).toEqual({
      ok: false,
      reason: 'extension-identity-handoff-not-issued',
    })
    if (!isHostedSmoke) {
      expect(
        await simplePage.evaluate(
          () =>
            (
              window as Window & {
                __nookVault?: { deviceId?: string }
              }
            ).__nookVault?.deviceId,
        ),
      ).toBe(extensionDeviceId)
    }

    await simplePage.getByTestId('approve-extension-device-btn').click()
    await waitForExtensionPairingReady(
      simplePage,
      async () => {
        const storage = await readExtensionStorage(context)
        return storage[setupStorageKey]
      },
      extensionApprovalVaultName,
    )
    const pairedStorage = await readExtensionStorage(context)
    const pairedGrant = Object.entries(pairedStorage).find(([key]) =>
      key.startsWith('nook:extension-pairing-grant:'),
    )?.[1]
    expect(pairedGrant).toEqual(
      expect.objectContaining({
        scopes: expect.arrayContaining([
          'passkey-management',
          'password-filling',
        ]),
      }),
    )

    const openedPairingLauncher = context.waitForEvent('page')
    expect(
      await sendExternalMessage(simplePage, extensionId, {
        type: 'nook:open-companion-launcher',
        payload: { intent: 'pair' },
      }),
    ).toEqual({ ok: true })
    const pairingLauncher = await openedPairingLauncher
    await expect(pairingLauncher).toHaveURL(
      `chrome-extension://${extensionId}/popup/index.html?intent=pair`,
    )
    await expect(
      pairingLauncher.getByTestId('extension-companion-home'),
    ).toBeVisible()
    await expect(
      pairingLauncher.getByTestId('companion-vault-status'),
    ).toHaveAttribute('data-connected', 'false')
    await expect(
      pairingLauncher.getByTestId('connect-simple-vault-btn'),
    ).toBeVisible()

    const reopenedConnectPage = context.waitForEvent('page')
    await pairingLauncher.getByTestId('connect-simple-vault-btn').click()
    const reconnectPage = await reopenedConnectPage
    await expect(reconnectPage).toHaveURL((url) =>
      belongsToSimpleVault(simpleVaultBaseUrl, url.toString()),
    )
    await reconnectPage.close()
    await pairingLauncher.close()

    let websiteCredentialId: string | undefined
    if (website) {
      websiteCredentialId = await registerWebsitePasskey(website)
      expect(websiteCredentialId).toBeTruthy()
      await assertWebsitePasskey(website, websiteCredentialId)
      await website.close()
    }

    await simplePage.getByRole('button', { name: 'Done' }).click()
    await expect(simplePage.getByTestId('authenticated-shell')).toBeVisible()
    await simplePage.close()

    const connectedPopupPage = await context.newPage()
    await connectedPopupPage.goto(
      `chrome-extension://${extensionId}/popup/index.html`,
    )
    await expect(
      connectedPopupPage.getByTestId('extension-companion-home'),
    ).toBeVisible()
    await expect(
      connectedPopupPage.getByTestId('stay-as-companion-btn'),
    ).toBeVisible()
    await expect(
      connectedPopupPage.getByTestId('open-simple-vault-btn'),
    ).toBeVisible()

    const reopenedVaultPagePromise = context.waitForEvent('page')
    await connectedPopupPage.getByTestId('open-simple-vault-btn').click()
    const reopenedVaultPage = await reopenedVaultPagePromise
    await expect(reopenedVaultPage).toHaveURL((url) => {
      const expected = new URL(simpleVaultBaseUrl)
      return (
        url.origin === expected.origin && url.pathname === expected.pathname
      )
    })
    await expect(
      reopenedVaultPage.getByTestId('authenticated-shell'),
    ).toBeVisible({
      timeout: 15_000,
    })
    await expect(
      reopenedVaultPage.getByTestId('passkey-auth-overlay'),
    ).toHaveCount(0)
    if (!isHostedSmoke) {
      expect(
        await reopenedVaultPage.evaluate(
          () =>
            (
              window as Window & {
                __nookVault?: { deviceId?: string }
              }
            ).__nookVault?.deviceId,
        ),
      ).toBe(extensionDeviceId)
    }

    const emptyOtpPage = await context.newPage()
    await emptyOtpPage.goto(`${loginServer.origin}/otp`)
    const emptyOtpWidget = emptyOtpPage.locator('#nook-auth-widget')
    const emptyAuthenticatorPickerPromise = context.waitForEvent('page')
    await emptyOtpWidget.getByRole('button', { name: 'Fill 2FA code' }).click()
    const emptyAuthenticatorPicker = await emptyAuthenticatorPickerPromise
    await emptyAuthenticatorPicker.waitForURL(/intent=authenticator-picker/)
    await expect(
      emptyAuthenticatorPicker.getByRole('heading', {
        name: 'Choose a 2FA code',
      }),
    ).toBeVisible()
    await expect(
      emptyAuthenticatorPicker.getByTestId('authenticator-destination'),
    ).toContainText(`Code will be filled on ${loginServer.origin}.`)
    await expect(
      emptyAuthenticatorPicker.getByText('No matching 2FA items.'),
    ).toBeVisible()
    await emptyAuthenticatorPicker.close()
    await emptyOtpPage.close()

    await reopenedVaultPage.getByTestId('add-secret-btn').click()
    await reopenedVaultPage.getByTestId('item-type-login').click()
    await reopenedVaultPage.getByTestId('secret-label').fill(loginServer.origin)
    await reopenedVaultPage
      .getByTestId('login-username')
      .fill('alice@nook.test')
    await reopenedVaultPage
      .getByTestId('secret-value')
      .fill('extension-fill-password')
    await reopenedVaultPage.getByTestId('save-secret-btn').click()
    await expect(
      reopenedVaultPage
        .getByTestId('vault-group-login')
        .getByTestId('secret-row'),
    ).toBeVisible({ timeout: 15_000 })

    await reopenedVaultPage.getByTestId('add-secret-btn').click()
    await reopenedVaultPage.getByTestId('item-type-login').click()
    await reopenedVaultPage.getByTestId('secret-label').fill(loginServer.origin)
    await reopenedVaultPage.getByTestId('login-username').fill('bob@nook.test')
    await reopenedVaultPage
      .getByTestId('secret-value')
      .fill('second-extension-password')
    await reopenedVaultPage.getByTestId('save-secret-btn').click()
    await expect(
      reopenedVaultPage
        .getByTestId('vault-group-login')
        .getByTestId('secret-row'),
    ).toHaveCount(2)

    await reopenedVaultPage.getByTestId('add-secret-btn').click()
    await reopenedVaultPage.getByTestId('item-type-authenticator').click()
    await reopenedVaultPage
      .getByTestId('authenticator-issuer')
      .fill('Nook extension e2e')
    await reopenedVaultPage
      .getByTestId('authenticator-account')
      .fill('alice@nook.test')
    await reopenedVaultPage
      .getByTestId('authenticator-secret')
      .fill('JBSWY3DPEHPK3PXP')
    await reopenedVaultPage.getByTestId('save-secret-btn').click()
    await expect(
      reopenedVaultPage
        .getByTestId('vault-group-authenticator')
        .getByTestId('secret-row'),
    ).toBeVisible({ timeout: 15_000 })

    const fillLoginPage = await context.newPage()
    await fillLoginPage.goto(`${loginServer.origin}/login`)
    const fillWidget = fillLoginPage.locator('#nook-auth-widget')
    await expect(fillWidget).toBeVisible()
    await fillWidget.getByRole('button', { name: 'Continue with Nook' }).click()
    await expect(fillWidget.getByText('alice@nook.test')).toHaveCount(0)
    await expect(fillWidget.getByText('bob@nook.test')).toHaveCount(0)
    const savedLogin = fillWidget.getByRole('button', {
      name: 'Saved login 1',
    })
    await expect(savedLogin).toBeVisible({ timeout: 20_000 })
    await savedLogin.click()
    await expect
      .poll(
        async () =>
          fillLoginPage.evaluate(() => {
            const submittedLogin = (
              window as Window & {
                __nookLoginSubmitted?: {
                  email: string
                  password: string
                }
              }
            ).__nookLoginSubmitted
            return Boolean(submittedLogin) && typeof submittedLogin === 'object'
          }),
        { timeout: 20_000 },
      )
      .toBe(true)
    const submittedLogin = await fillLoginPage.evaluate(
      () =>
        (
          window as Window & {
            __nookLoginSubmitted?: {
              email: string
              password: string
            }
          }
        ).__nookLoginSubmitted,
    )
    expect([
      {
        email: 'alice@nook.test',
        password: 'extension-fill-password',
      },
      {
        email: 'bob@nook.test',
        password: 'second-extension-password',
      },
    ]).toContainEqual(submittedLogin)
    await expect(fillWidget.getByText('Nook Pilot · 3/3')).toBeVisible()
    await expect(fillWidget.getByText('Verifying sign-in')).toBeVisible()
    await expect(
      fillWidget.getByRole('button', { name: 'Saved login 2' }),
    ).toHaveCount(0)
    await expect(
      fillWidget.getByText(
        'Credentials were submitted. Nook is waiting for the site response.',
      ),
    ).toBeVisible()
    await fillLoginPage.close()

    const otpPage = await context.newPage()
    await otpPage.goto(`${loginServer.origin}/otp`)
    const otpWidget = otpPage.locator('#nook-auth-widget')
    await expect(otpWidget.getByText('Fill your 2FA code')).toBeVisible()
    const authenticatorPickerPromise = context.waitForEvent('page')
    await otpWidget.getByRole('button', { name: 'Fill 2FA code' }).click()
    await expect(otpWidget.getByText('Nook extension e2e')).toHaveCount(0)
    await expect(otpWidget.getByText('alice@nook.test')).toHaveCount(0)
    const authenticatorPicker = await authenticatorPickerPromise
    await authenticatorPicker.waitForURL(/intent=authenticator-picker/)
    await expect(
      authenticatorPicker.getByText('Nook extension e2e'),
    ).toBeVisible({ timeout: 20_000 })
    await authenticatorPicker
      .getByRole('button', { name: /Nook extension e2e/ })
      .click()
    await expect(otpPage.locator('[autocomplete="one-time-code"]')).toHaveValue(
      /^\d{6}$/,
    )
    await expect(authenticatorPicker).toBeClosed()
    await expect(otpWidget.getByText('Nook Pilot · 2/3')).toBeVisible()
    await expect(
      otpWidget.getByText(
        'The code is filled. Review the site and submit it manually.',
      ),
    ).toBeVisible()
    await otpPage.close()

    await reopenedVaultPage.getByTestId('header-lock-vault-btn').click()
    await expect(
      reopenedVaultPage.getByTestId('login-local-unlock-step'),
    ).toBeVisible({ timeout: EXTENSION_UNLOCK_TIMEOUT_MS })

    await reopenedVaultPage.getByTestId('unlock-vault-btn').click()

    await expect(
      reopenedVaultPage.getByTestId('passkey-auth-overlay'),
    ).toHaveCount(0)
    await expect(
      reopenedVaultPage.getByTestId('authenticated-shell'),
    ).toBeVisible()
    if (!isHostedSmoke) {
      expect(
        await reopenedVaultPage.evaluate(
          () =>
            (
              window as Window & {
                __nookVault?: { deviceId?: string }
              }
            ).__nookVault?.deviceId,
        ),
      ).toBe(extensionDeviceId)
    }
    await expect
      .poll(async () => {
        const entries = await readPersistedAppLogs(reopenedVaultPage)
        return (entries ?? []).filter(
          (entry) =>
            entry.scope === 'vault' &&
            entry.message === 'extension identity adopted' &&
            entry.data?.includes(extensionDeviceId ?? '') === true,
        ).length
      })
      .toBe(3)
    if (websiteAfterUnlock && websiteCredentialId) {
      await assertWebsitePasskey(websiteAfterUnlock, websiteCredentialId)
      await websiteAfterUnlock.close()
    }
    await attachNookLogsForTest(reopenedVaultPage, testInfo)

    await context.close()
    const restartedContext = await chromium.launchPersistentContext(
      userDataDir,
      {
        headless: false,
        executablePath: chromiumExecutablePath,
        args: [
          `--disable-extensions-except=${extensionDir}`,
          `--load-extension=${extensionDir}`,
        ],
      },
    )
    await restartedContext.addInitScript(installMockPasskeyRuntime)
    try {
      const restartedWorker = await getServiceWorker(restartedContext)
      const restartedExtensionId = new URL(restartedWorker.url()).host
      expect(restartedExtensionId).toBe(extensionId)

      const lockedVaultPage = await restartedContext.newPage()
      await lockedVaultPage.goto(simpleVaultBaseUrl)
      await expect(
        lockedVaultPage.getByTestId('login-local-unlock-step'),
      ).toBeVisible({ timeout: EXTENSION_UNLOCK_TIMEOUT_MS })

      const extensionAuthWindowPromise = restartedContext.waitForEvent('page')
      await lockedVaultPage.getByTestId('unlock-vault-btn').click()
      const extensionAuthWindow = await extensionAuthWindowPromise
      await expect(extensionAuthWindow).toHaveURL(
        `chrome-extension://${restartedExtensionId}/popup/index.html`,
      )
      await expect(
        extensionAuthWindow.getByTestId('extension-device-setup'),
      ).toBeVisible()
      await expect(
        lockedVaultPage.getByTestId('passkey-auth-overlay'),
      ).toHaveCount(0)

      await extensionAuthWindow
        .getByTestId('device-protection-unlock-btn')
        .click()
      await expect(
        extensionAuthWindow.getByTestId('extension-companion-home'),
      ).toBeVisible()
      await expect(
        extensionAuthWindow.getByTestId('stay-as-companion-btn'),
      ).toBeVisible()
      await expect(
        lockedVaultPage.getByTestId('authenticated-shell'),
      ).toBeVisible({ timeout: 15_000 })
      await expect(
        lockedVaultPage.getByTestId('passkey-auth-overlay'),
      ).toHaveCount(0)
    } finally {
      await restartedContext.close()
    }
  } finally {
    await context.close()
    await loginServer.close()
  }
})
