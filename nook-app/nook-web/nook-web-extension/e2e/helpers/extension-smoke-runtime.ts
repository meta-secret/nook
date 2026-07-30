import {
  chromium,
  expect,
  type BrowserContext,
  type Page,
} from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ExtensionPairingApprovedMessage } from '../../../nook-web-shared/src/extension/runtime-messages'
import {
  attachNookLogsForTest,
  readPersistedAppLogs,
} from '../../../nook-web-app/e2e/helpers'
import { installMockPasskeyRuntime } from '../../../nook-web-app/e2e/passkey-mock'
import {
  belongsToSentinelVault,
  belongsToSimpleVault,
  DEFAULT_SIMPLE_VAULT_URL,
  sentinelVaultBaseUrl,
  normalizeSimpleVaultBaseUrl,
  simpleVaultUrl,
} from '../../src/lib/simple-vault-target'
import { startMockAuthServer } from '../mock-auth'
import { waitForExtensionPairingReady } from './extension-approval'
import {
  readExtensionPairingStorage,
  writeExtensionPairingStorage,
} from './extension-pairing-storage'
import { lockExtensionSession } from './paired-pin-extension'

export {
  attachNookLogsForTest,
  belongsToSentinelVault,
  belongsToSimpleVault,
  installMockPasskeyRuntime,
  lockExtensionSession,
  sentinelVaultBaseUrl,
  readPersistedAppLogs,
  simpleVaultUrl,
  waitForExtensionPairingReady,
}
export type { ExtensionPairingApprovedMessage }

export const EXTENSION_UNLOCK_TIMEOUT_MS = 30_000

export async function advanceCreateVaultWizardToFinalStep(page: Page) {
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

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
)
export const extensionDir =
  process.env.NOOK_EXTENSION_E2E_DIR || path.join(rootDir, 'dist')
const chromiumExecutablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim() ?? ''
export const setupStorageKey = 'nook:extension-setup'
export const pairingGrantStorageKey = 'nook:extension-pairing-grant:store-e2e'
export const syntheticEventLogRecords = [
  {
    eventId: 'event-e2e',
    path: 'events/event-e2e.yaml',
    event: { schema_version: 1 },
  },
]
export const connectedSetupState = {
  status: 'ready',
  deviceLabel: 'Nook Extension - Chromium test profile',
  pairedVaults: ['Personal'],
  selectedVaultStoreId: 'store-e2e',
  selectedVaultName: 'Personal',
  syncProviderCount: 0,
  eventCount: 1,
  eventLogHeads: ['event-e2e'],
  lastLocalSyncAt: '2026-07-07T00:00:00.000Z',
}
export const simpleVaultBaseUrl = normalizeSimpleVaultBaseUrl(
  process.env.NOOK_SIMPLE_VAULT_URL || DEFAULT_SIMPLE_VAULT_URL,
)
export const isHostedSmoke = process.env.NOOK_EXTENSION_E2E_HOSTED === 'true'
export const extensionApprovalVaultName = isHostedSmoke
  ? 'test-vault'
  : 'Extension approval vault'

export async function startLoginServer() {
  return startMockAuthServer()
}

export async function registerWebsitePasskey(page: Page): Promise<string> {
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

export async function assertWebsitePasskey(
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

export async function getServiceWorker(context: BrowserContext) {
  return (
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker', { timeout: 15_000 }))
  )
}

export async function launchExtensionContext(userDataDir: string) {
  await mkdir(userDataDir, { recursive: true })
  return chromium.launchPersistentContext(userDataDir, {
    headless: false,
    ...(chromiumExecutablePath
      ? { executablePath: chromiumExecutablePath }
      : {}),
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
    ],
  })
}

export async function setupPasskeyExtensionPopup(
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

export async function openSimpleVaultConnection(
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

export async function readExtensionStorage(context: BrowserContext) {
  const worker = await getServiceWorker(context)
  return readExtensionPairingStorage(worker)
}

export async function writeExtensionStorage(
  page: Page,
  items: Record<string, unknown>,
) {
  await writeExtensionPairingStorage(page, items)
}

export async function sendExternalMessage(
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
