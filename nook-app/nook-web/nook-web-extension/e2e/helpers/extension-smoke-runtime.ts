import { companionWasmReady } from './companion-wasm-ready'

await companionWasmReady
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
import type { ExtensionEventLogRecord } from '../../../nook-web-shared/src/extension/lifecycle-runtime-messages'
import {
  attachNookLogsForTest,
  readPersistedAppLogs,
} from '../../../nook-web-app/e2e/helpers'
import { installMockPasskeyRuntime } from '../../../nook-web-app/e2e/passkey-mock'
import {
  belongs_to_simple_vault,
  normalize_simple_vault_base_url,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { SimpleVaultTarget } from '../../src/lib/simple-vault-target'
import { startMockAuthServer } from '../mock-auth'
import { waitForExtensionPairingReady } from './extension-approval'
import {
  readExtensionPersistenceSnapshot,
  readExtensionPairingStorage,
  removeExtensionPairingStorageKeys,
  writeExtensionPairingStorage,
} from './extension-pairing-storage'
import { lockExtensionSession } from './paired-pin-extension'
import { reportExtensionBrowserErrors } from './browser-errors'

export {
  attachNookLogsForTest,
  installMockPasskeyRuntime,
  lockExtensionSession,
  SimpleVaultTarget,
  readPersistedAppLogs,
  readExtensionPersistenceSnapshot,
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
const chromiumExecutablePath = ((v) => (v ? v : ''))(
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim(),
)
export const setupStorageKey = 'nook:extension-setup'
export const pairingGrantStorageKey = 'nook:extension-pairing-grant:store-e2e'
export const syntheticEventLogRecords: ExtensionEventLogRecord[] = [
  {
    eventId: 'event-e2e',
    path: 'events/event-e2e.yaml',
    event: {
      schema_version: 2,
      store_id: 'store-e2e',
      actor_id: `key_${'0'.repeat(64)}`,
      actor_signing_public_key: '0'.repeat(64),
      parents: [],
      created_at: '2026-07-07T00:00:00.000Z',
      key_epoch: 'sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo',
      operations: [{ type: 'vault-cleared' }],
      signature: `ed25519:${'0'.repeat(128)}`,
    },
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
export const simpleVaultBaseUrl = normalize_simple_vault_base_url(
  process.env.NOOK_SIMPLE_VAULT_URL || SimpleVaultTarget.defaultBase(),
)

/**
 * Sentinel origin used to assert Pilot stays off vault-app hosts.
 * Local Playwright Simple Vault (`http://127.0.0.1:5174/`) has no paired
 * Sentinel URL; use the always-excluded production Sentinel host instead.
 */
export function e2eSentinelVaultBaseUrl(): string {
  try {
    return new SimpleVaultTarget(simpleVaultBaseUrl).sentinelBase
  } catch {
    return 'https://sentinel.nokey.sh/'
  }
}

export const isHostedSmoke = process.env.NOOK_EXTENSION_E2E_HOSTED === 'true'
export const extensionApprovalVaultName = isHostedSmoke
  ? 'test-vault'
  : 'Extension approval vault'

export async function startLoginServer() {
  return startMockAuthServer()
}

export async function registerWebsitePasskeyThroughExtension(
  page: Page,
): Promise<string> {
  await page.bringToFront()
  const ceremony = page.evaluate(async () => {
    const credential = await navigator.credentials.create({
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
    })
    if (
      !credential ||
      credential.type !== 'public-key' ||
      typeof credential.id !== 'string' ||
      !('response' in credential)
    ) {
      throw new Error('Website passkey creation did not return a public key')
    }
    return credential.id
  })
  await expect(page.locator('aside[aria-label="Nook passkey"]')).toBeVisible()
  await page.keyboard.press('Enter')
  return ceremony
}

export type WebsitePasskeyAssertionBrowserFlow = {
  page: Page
  credentialId: string
}

enum WebsitePasskeyCompletionKind {
  ExtensionResult = 'extension-result',
  NativeFallback = 'native-fallback',
}

export async function assertWebsitePasskeyThroughExtension({
  page,
  credentialId,
}: WebsitePasskeyAssertionBrowserFlow): Promise<void> {
  await page.bringToFront()
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const mockGetDescriptor = Object.getOwnPropertyDescriptor(
            window,
            '__nookE2ePasskeyMockGet',
          )
          if (
            !mockGetDescriptor ||
            typeof mockGetDescriptor.value !== 'function'
          ) {
            return true
          }
          return navigator.credentials.get !== mockGetDescriptor.value
        }),
      {
        message: 'The extension WebAuthn bridge was not installed.',
        timeout: 15_000,
      },
    )
    .toBe(true)
  const ceremony = page.evaluate<
    {
      id: string
      authenticatorDataLength: number
      signatureLength: number
      completionKind: string
    },
    string
  >(async (id) => {
    enum ExtensionResponseAction {
      Fallback = 'fallback',
      Result = 'result',
      Error = 'error',
    }
    enum ExtensionOutcomeKind {
      Awaiting = 'awaiting',
      ExtensionResult = 'extension-result',
      NativeFallback = 'native-fallback',
      Error = 'error',
      Invalid = 'invalid',
    }
    enum CredentialStateKind {
      Missing = 'missing',
      Present = 'present',
    }
    type ExtensionOutcome =
      | { kind: ExtensionOutcomeKind.Awaiting }
      | {
          kind: ExtensionOutcomeKind.ExtensionResult
          credentialId: string
          authenticatorDataLength: number
          signatureLength: number
        }
      | { kind: ExtensionOutcomeKind.NativeFallback }
      | { kind: ExtensionOutcomeKind.Error }
      | { kind: ExtensionOutcomeKind.Invalid }
    type CredentialState =
      | { kind: CredentialStateKind.Missing }
      | { kind: CredentialStateKind.Present; credential: Credential }
    const decodeBinaryLength = (value: unknown): number => {
      if (typeof value !== 'string' || value.length === 0) return 0
      try {
        const normalized =
          value.replaceAll('-', '+').replaceAll('_', '/') +
          '='.repeat((4 - (value.length % 4)) % 4)
        return atob(normalized).length
      } catch {
        return 0
      }
    }
    const extensionOutcomeState: { value: ExtensionOutcome } = {
      value: { kind: ExtensionOutcomeKind.Awaiting },
    }
    const observeExtensionResponse = (event: MessageEvent) => {
      const data: unknown = event.data
      if (
        !data ||
        typeof data !== 'object' ||
        !('source' in data) ||
        data.source !== 'nook-passkey-extension-v1' ||
        !('action' in data)
      ) {
        return
      }
      if (data.action === ExtensionResponseAction.Fallback) {
        extensionOutcomeState.value = {
          kind: ExtensionOutcomeKind.NativeFallback,
        }
        return
      }
      if (data.action === ExtensionResponseAction.Error) {
        extensionOutcomeState.value = { kind: ExtensionOutcomeKind.Error }
        return
      }
      if (data.action !== ExtensionResponseAction.Result) return
      if (
        !('result' in data) ||
        !data.result ||
        typeof data.result !== 'object'
      ) {
        extensionOutcomeState.value = { kind: ExtensionOutcomeKind.Invalid }
        return
      }
      const result = data.result
      if (
        !('ok' in result) ||
        result.ok !== true ||
        !('credentialId' in result) ||
        typeof result.credentialId !== 'string' ||
        !('authenticatorData' in result) ||
        !('signature' in result) ||
        typeof result.authenticatorData !== 'string' ||
        typeof result.signature !== 'string'
      ) {
        extensionOutcomeState.value = { kind: ExtensionOutcomeKind.Invalid }
        return
      }
      const authenticatorDataLength = decodeBinaryLength(
        result.authenticatorData,
      )
      const signatureLength = decodeBinaryLength(result.signature)
      if (authenticatorDataLength === 0 || signatureLength === 0) {
        extensionOutcomeState.value = { kind: ExtensionOutcomeKind.Invalid }
        return
      }
      extensionOutcomeState.value = {
        kind: ExtensionOutcomeKind.ExtensionResult,
        credentialId: result.credentialId,
        authenticatorDataLength,
        signatureLength,
      }
    }
    window.addEventListener('message', observeExtensionResponse)
    enum AssertionBinaryKind {
      Missing = 'missing',
      Invalid = 'invalid',
      Valid = 'valid',
    }
    enum AssertionBinaryField {
      AuthenticatorData = 'authenticatorData',
      Signature = 'signature',
    }
    type AssertionBinary =
      | { kind: AssertionBinaryKind.Missing }
      | { kind: AssertionBinaryKind.Invalid }
      | { kind: AssertionBinaryKind.Valid; byteLength: number }
    const readArrayBuffer = (value: unknown): AssertionBinary => {
      if (
        typeof value !== 'object' ||
        !value ||
        Object.prototype.toString.call(value) !== '[object ArrayBuffer]' ||
        !('byteLength' in value) ||
        typeof value.byteLength !== 'number'
      ) {
        return { kind: AssertionBinaryKind.Invalid }
      }
      return { kind: AssertionBinaryKind.Valid, byteLength: value.byteLength }
    }
    const readAssertionBinary = (request: {
      source: unknown
      field: AssertionBinaryField
    }): AssertionBinary => {
      const { source, field } = request
      if (!source || typeof source !== 'object') {
        return { kind: AssertionBinaryKind.Missing }
      }
      if (field === AssertionBinaryField.AuthenticatorData) {
        if (!('authenticatorData' in source)) {
          return { kind: AssertionBinaryKind.Missing }
        }
        return readArrayBuffer(source.authenticatorData)
      }
      if (!('signature' in source)) {
        return { kind: AssertionBinaryKind.Missing }
      }
      return readArrayBuffer(source.signature)
    }
    const rawId = Uint8Array.from(
      atob(
        id.replaceAll('-', '+').replaceAll('_', '/') +
          '='.repeat((4 - (id.length % 4)) % 4),
      ),
      (character) => character.charCodeAt(0),
    )
    const credentialValue = await navigator.credentials.get({
      publicKey: {
        challenge: new Uint8Array(32).fill(9),
        rpId: 'localhost',
        allowCredentials: [{ type: 'public-key', id: rawId }],
        userVerification: 'required',
        timeout: 15_000,
      },
    })
    const credentialState: CredentialState = credentialValue
      ? { kind: CredentialStateKind.Present, credential: credentialValue }
      : { kind: CredentialStateKind.Missing }
    window.removeEventListener('message', observeExtensionResponse)
    const extensionOutcome = extensionOutcomeState.value
    switch (extensionOutcome.kind) {
      case ExtensionOutcomeKind.ExtensionResult:
        return {
          id: extensionOutcome.credentialId,
          authenticatorDataLength: extensionOutcome.authenticatorDataLength,
          signatureLength: extensionOutcome.signatureLength,
          completionKind: extensionOutcome.kind,
        }
      case ExtensionOutcomeKind.NativeFallback:
        break
      case ExtensionOutcomeKind.Awaiting:
      case ExtensionOutcomeKind.Error:
      case ExtensionOutcomeKind.Invalid:
        throw new Error(
          `Website passkey assertion did not complete through the extension (${extensionOutcome.kind})`,
        )
    }
    if (credentialState.kind !== CredentialStateKind.Present) {
      throw new Error('Website passkey fallback did not return a credential')
    }
    const credential = credentialState.credential
    if (
      credential.type !== 'public-key' ||
      typeof credential.id !== 'string' ||
      !('response' in credential)
    ) {
      throw new Error(
        'Website native passkey assertion did not return a public key',
      )
    }
    const response = credential.response
    const authenticatorData = readAssertionBinary({
      source: response,
      field: AssertionBinaryField.AuthenticatorData,
    })
    const signature = readAssertionBinary({
      source: response,
      field: AssertionBinaryField.Signature,
    })
    if (
      authenticatorData.kind !== AssertionBinaryKind.Valid ||
      signature.kind !== AssertionBinaryKind.Valid
    ) {
      throw new Error(
        'Website native passkey assertion has no assertion response',
      )
    }
    return {
      id: credential.id,
      authenticatorDataLength: authenticatorData.byteLength,
      signatureLength: signature.byteLength,
      completionKind: extensionOutcome.kind,
    }
  }, credentialId)
  await expect(page.locator('aside[aria-label="Nook passkey"]')).toBeVisible()
  await page.keyboard.press('Enter')
  const result = await ceremony
  expect(result).toMatchObject({
    id: credentialId,
  })
  expect(result.authenticatorDataLength).toBeGreaterThan(0)
  expect(result.signatureLength).toBeGreaterThan(64)
  if (result.completionKind === WebsitePasskeyCompletionKind.ExtensionResult) {
    expect(result.authenticatorDataLength).toBe(37)
  }
}

export async function getServiceWorker(context: BrowserContext) {
  const [serviceWorker] = context.serviceWorkers()
  if (serviceWorker) return serviceWorker
  return await context.waitForEvent('serviceworker', { timeout: 15_000 })
}

export async function launchExtensionContext(userDataDir: string) {
  await mkdir(userDataDir, { recursive: true })
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    ...(chromiumExecutablePath
      ? { executablePath: chromiumExecutablePath }
      : {}),
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
    ],
  })
  reportExtensionBrowserErrors(context)
  return context
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
  await expect(popupPage.getByTestId('extension-toolbar-menu')).toBeVisible()
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
    belongs_to_simple_vault(simpleVaultBaseUrl, url.toString()),
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

export async function removeExtensionStorageKeys(
  context: BrowserContext,
  keys: string[],
) {
  const worker = await getServiceWorker(context)
  await removeExtensionPairingStorageKeys(worker, keys)
}

export async function sendExternalMessage(
  page: Page,
  extensionId: string,
  message: unknown,
) {
  return page.evaluate(
    ({ runtimeId, runtimeMessage }) =>
      new Promise<unknown>((resolve, reject) => {
        chrome.runtime.sendMessage(runtimeId, runtimeMessage, (response) => {
          if (chrome.runtime.lastError?.message) {
            reject(new Error(chrome.runtime.lastError.message))
            return
          }
          resolve(response)
        })
      }),
    { runtimeId: extensionId, runtimeMessage: message },
  )
}
