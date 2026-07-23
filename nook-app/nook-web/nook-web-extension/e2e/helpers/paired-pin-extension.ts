import {
  chromium,
  expect,
  type BrowserContext,
  type Page,
  type TestInfo,
} from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { installMockPasskeyRuntime } from '../../../nook-web-app/e2e/passkey-mock'
import {
  belongsToSimpleVault,
  normalizeSimpleVaultBaseUrl,
} from '../../src/lib/simple-vault-target'
import { MOCK_AUTH_DEFAULT_PIN } from '../mock-auth'
import {
  ensurePinProtectedPopup,
  installForcePinDeviceProtection,
} from './pin-device'
import { waitForExtensionPairingReady } from './extension-approval'

/** Local Simple Vault from playwright webServer / test-e2e.sh. */
const LOCAL_E2E_SIMPLE_VAULT_URL = 'http://127.0.0.1:5174/'

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
)
const extensionDir =
  process.env.NOOK_EXTENSION_E2E_DIR || path.join(rootDir, 'dist')
const chromiumExecutablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined
const setupStorageKey = 'nook:extension-setup'
const EXTENSION_TIMEOUT_MS = 45_000

export type PairedPinExtension = {
  context: BrowserContext
  extensionId: string
  popupPage: Page
  vaultPage: Page
  simpleVaultBaseUrl: string
  vaultName: string
}

async function getServiceWorker(context: BrowserContext) {
  return (
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker', {
      timeout: EXTENSION_TIMEOUT_MS,
    }))
  )
}

export async function exerciseConcurrentSessionStatus(
  context: BrowserContext,
  requestCount = 24,
): Promise<void> {
  const worker = await getServiceWorker(context)
  await worker.evaluate(async (count) => {
    const requests = Array.from(
      { length: count },
      () =>
        new Promise<void>((resolve, reject) => {
          globalThis.chrome.runtime.sendMessage(
            { type: 'nook:extension-session-status' },
            (response) => {
              const error = globalThis.chrome.runtime.lastError?.message
              if (error) {
                reject(new Error(error))
                return
              }
              if (response?.ok !== true) {
                reject(
                  new Error(
                    response?.error ?? 'Concurrent session status failed.',
                  ),
                )
                return
              }
              resolve()
            },
          )
        }),
    )
    await Promise.all(requests)
  }, requestCount)
}

async function readExtensionStorage(context: BrowserContext) {
  const worker = await getServiceWorker(context)
  return worker.evaluate(
    () =>
      new Promise<Record<string, unknown>>((resolve) => {
        globalThis.chrome.storage.local.get(undefined, resolve)
      }),
  )
}

async function advanceCreateVaultWizardToFinalStep(page: Page) {
  const chooser = page.getByTestId('login-create-vault-chooser')
  await expect(chooser).toBeVisible({ timeout: EXTENSION_TIMEOUT_MS })

  const finalStep = page.getByTestId('create-vault-wizard-create')
  if (await finalStep.isVisible()) return

  const simplePath = page.getByTestId('get-started-path-simple')
  await expect(simplePath).toBeVisible({ timeout: EXTENSION_TIMEOUT_MS })
  await simplePath.click()
  await expect(finalStep).toBeVisible({ timeout: EXTENSION_TIMEOUT_MS })
  const nameInput = page.getByTestId('login-vault-name-input')
  if (!(await nameInput.inputValue()).trim()) {
    await nameInput.fill('Mock auth vault', {
      timeout: EXTENSION_TIMEOUT_MS,
    })
  }
}

export async function launchPairedPinExtension(
  testInfo: TestInfo,
  options?: { vaultName?: string; pin?: string },
): Promise<PairedPinExtension> {
  const vaultName = options?.vaultName ?? 'Mock auth vault'
  const pin = options?.pin ?? MOCK_AUTH_DEFAULT_PIN
  const simpleVaultBaseUrl = normalizeSimpleVaultBaseUrl(
    process.env.NOOK_EXTENSION_E2E_SIMPLE_VAULT_URL ||
      process.env.NOOK_SIMPLE_VAULT_URL ||
      LOCAL_E2E_SIMPLE_VAULT_URL,
  )

  const userDataDir = testInfo.outputPath('chromium-profile-pin')
  await mkdir(userDataDir, { recursive: true })

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    executablePath: chromiumExecutablePath,
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
    ],
  })
  // Vault pages need a WebAuthn mock so LoginGate can boot under Chromium e2e.
  // Extension pages then force-hide PublicKeyCredential to take the PIN path.
  await context.addInitScript(installMockPasskeyRuntime)
  await context.addInitScript(installForcePinDeviceProtection)

  const worker = await getServiceWorker(context)
  const extensionId = new URL(worker.url()).host
  const popupPage = await context.newPage()
  await popupPage.goto(`chrome-extension://${extensionId}/popup/index.html`)
  await ensurePinProtectedPopup(popupPage, pin)

  const openedConnectPage = context.waitForEvent('page')
  await popupPage.getByTestId('connect-simple-vault-btn').click()
  const simplePage = await openedConnectPage
  await expect(simplePage).toHaveURL((url) =>
    belongsToSimpleVault(simpleVaultBaseUrl, url.toString()),
  )

  const consent = simplePage.getByTestId('extension-connect-consent')
  const chooser = simplePage.getByTestId('login-create-vault-chooser')
  const invalidConnect = simplePage.getByTestId('extension-connect-invalid')
  await expect(chooser.or(consent).or(invalidConnect)).toBeVisible({
    timeout: EXTENSION_TIMEOUT_MS,
  })
  if (await invalidConnect.isVisible()) {
    throw new Error(
      `Extension connect request was rejected at ${simplePage.url()}`,
    )
  }

  if (!(await consent.isVisible())) {
    await advanceCreateVaultWizardToFinalStep(simplePage)
    await simplePage.getByTestId('login-vault-name-input').fill(vaultName)
    await simplePage.getByTestId('login-create-device-vault-btn').click()
    await expect(consent).toBeVisible({ timeout: EXTENSION_TIMEOUT_MS })
  }
  await simplePage.getByTestId('approve-extension-device-btn').click()
  await waitForExtensionPairingReady(
    simplePage,
    async () => {
      const storage = await readExtensionStorage(context)
      return storage[setupStorageKey]
    },
    vaultName,
  )

  await simplePage.getByRole('button', { name: 'Done' }).click()
  await expect(simplePage.getByTestId('authenticated-shell')).toBeVisible({
    timeout: EXTENSION_TIMEOUT_MS,
  })

  return {
    context,
    extensionId,
    popupPage,
    vaultPage: simplePage,
    simpleVaultBaseUrl,
    vaultName,
  }
}

export async function saveVaultLogin(
  vaultPage: Page,
  websiteOrigin: string,
  username: string,
  password: string,
): Promise<void> {
  await vaultPage.getByTestId('add-secret-btn').click()
  await vaultPage.getByTestId('item-type-login').click()
  await vaultPage.getByTestId('secret-label').fill(websiteOrigin)
  await vaultPage.getByTestId('login-username').fill(username)
  await vaultPage.getByTestId('secret-value').fill(password)
  await vaultPage.getByTestId('save-secret-btn').click()
  await expect(
    vaultPage.getByTestId('vault-group-login').getByTestId('secret-row').last(),
  ).toBeVisible({ timeout: 15_000 })
}

export async function saveVaultAuthenticator(
  vaultPage: Page,
  issuer: string,
  account: string,
  secret: string,
): Promise<void> {
  await vaultPage.getByTestId('add-secret-btn').click()
  await vaultPage.getByTestId('item-type-authenticator').click()
  await vaultPage.getByTestId('authenticator-issuer').fill(issuer)
  await vaultPage.getByTestId('authenticator-account').fill(account)
  await vaultPage.getByTestId('authenticator-secret').fill(secret)
  await vaultPage.getByTestId('save-secret-btn').click()
  await expect(
    vaultPage
      .getByTestId('vault-group-authenticator')
      .getByTestId('secret-row')
      .last(),
  ).toBeVisible({ timeout: 15_000 })
}

/** Force-lock the extension device session (same path as idle expiry). */
export async function lockExtensionSession(
  context: BrowserContext,
): Promise<void> {
  const worker = await getServiceWorker(context)
  const result = await worker.evaluate(async () => {
    await new Promise<{ ok?: boolean }>((resolve) => {
      globalThis.chrome.runtime.sendMessage(
        { type: 'nook:ensure-extension-session-runtime' },
        (response) => resolve(response ?? {}),
      )
    })
    const activeSessionRequests = Array.from(
      { length: 24 },
      () =>
        new Promise<void>((resolve) => {
          globalThis.chrome.runtime.sendMessage(
            { type: 'nook:extension-session-status' },
            () => {
              void globalThis.chrome.runtime.lastError
              resolve()
            },
          )
        }),
    )
    const lockResult = await new Promise<{
      ok?: boolean
      error?: string
      reason?: string
    }>((resolve) => {
      globalThis.chrome.runtime.sendMessage(
        { type: 'nook:extension-session-lock' },
        (response) => resolve(response ?? { ok: false, error: 'no-response' }),
      )
    })
    await Promise.all(activeSessionRequests)
    return lockResult
  })
  if (result?.ok !== true) {
    throw new Error(
      `Failed to lock extension session: ${result?.error ?? result?.reason ?? 'unknown'}`,
    )
  }
  // Offscreen teardown is async after the lock ack.
  await new Promise((resolve) => setTimeout(resolve, 500))
}

export async function unlockExtensionPopupPin(
  context: BrowserContext,
  extensionId: string,
  pin = MOCK_AUTH_DEFAULT_PIN,
): Promise<void> {
  const popupPage = await context.newPage()
  try {
    await popupPage.goto(`chrome-extension://${extensionId}/popup/index.html`)
    await expect(
      popupPage
        .getByTestId('device-protection-pin-unlock-btn')
        .or(popupPage.getByTestId('extension-companion-home')),
    ).toBeVisible({ timeout: 45_000 })
    await ensurePinProtectedPopup(popupPage, pin)
  } finally {
    await popupPage.close()
  }
}
