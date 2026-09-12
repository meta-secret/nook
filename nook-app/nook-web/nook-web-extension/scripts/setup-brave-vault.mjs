#!/usr/bin/env node
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** @typedef {import('playwright').BrowserContext} BrowserContext */
/** @typedef {import('playwright').Page} Page */
/** @typedef {{ status?: string, pairedVaults?: string[], selectedVaultName?: string }} StoredExtensionSetup */
/** @typedef {StoredExtensionSetup | string | number | boolean | string[]} ExtensionStorageValue */

const require = createRequire(import.meta.url)
const extensionRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
const appModules = path.join(extensionRoot, 'node_modules')
const playwrightPath = [
  path.join(appModules, 'playwright'),
  path.join(extensionRoot, '../nook-web-app/node_modules/playwright'),
].find((candidate) => {
  try {
    require.resolve(candidate)
    return true
  } catch {
    return false
  }
})
if (!playwrightPath) {
  throw new Error(
    'Playwright is missing. Run `cd nook-app/nook-web/nook-web-app && bun install --frozen-lockfile` first.',
  )
}

const { chromium } = require(playwrightPath)

const SETUP_STORAGE_KEY = 'nook:extension-setup'
const TIMEOUT_MS = 45_000
const cdpUrl = process.env.NOOK_EXTENSION_SETUP_CDP_URL
const extensionId = process.env.NOOK_EXTENSION_SETUP_EXTENSION_ID
const simpleVaultUrl = process.env.NOOK_SIMPLE_VAULT_URL
const pin = process.env.NOOK_EXTENSION_SETUP_PIN || '123456'
const vaultName = process.env.NOOK_EXTENSION_SETUP_VAULT_NAME || 'test'

if (!cdpUrl || !extensionId || !simpleVaultUrl) {
  throw new Error(
    'NOOK_EXTENSION_SETUP_CDP_URL, NOOK_EXTENSION_SETUP_EXTENSION_ID, and NOOK_SIMPLE_VAULT_URL are required',
  )
}
const requiredSimpleVaultUrl = simpleVaultUrl

/** @param {string} baseUrl @param {string} candidateUrl */
function belongsToSimpleVault(baseUrl, candidateUrl) {
  const base = new URL(baseUrl)
  base.hash = ''
  base.search = ''
  base.pathname = `${base.pathname.replace(/\/+$/, '')}/`
  const candidate = new URL(candidateUrl)
  return (
    candidate.origin === base.origin &&
    candidate.pathname.startsWith(base.pathname)
  )
}

/** @param {BrowserContext} context */
async function getServiceWorker(context) {
  const [serviceWorker] = context.serviceWorkers()
  if (serviceWorker) return serviceWorker
  return await context.waitForEvent('serviceworker', { timeout: TIMEOUT_MS })
}

/** @param {BrowserContext} context */
async function readExtensionStorage(context) {
  const worker = await getServiceWorker(context)
  return worker.evaluate(async () => {
    /** @returns {Promise<IDBDatabase>} */
    const openDatabase = () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('nook_extension', 1)
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains('pairing')) {
            request.result.createObjectStore('pairing')
          }
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    let database = await openDatabase()
    if (!database.objectStoreNames.contains('pairing')) {
      database.close()
      /** @type {Promise<true>} */
      const deletion = new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase('nook_extension')
        request.onsuccess = () => resolve(true)
        request.onerror = () => reject(request.error)
        request.onblocked = () =>
          reject(new Error('Unable to repair extension pairing storage.'))
      })
      await deletion
      database = await openDatabase()
    }
    try {
      const transaction = database.transaction('pairing', 'readonly')
      const store = transaction.objectStore('pairing')
      /** @type {Promise<IDBValidKey[]>} */
      const keysRequest = new Promise((resolve, reject) => {
        const request = store.getAllKeys()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const keys = await keysRequest
      /** @type {Promise<ExtensionStorageValue[]>} */
      const valuesRequest = new Promise((resolve, reject) => {
        const request = store.getAll()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const values = await valuesRequest
      return Object.fromEntries(
        keys.map((key, index) => [String(key), values[index]]),
      )
    } finally {
      database.close()
    }
  })
}

/** @param {Page} page */
async function advanceCreateVaultWizardToFinalStep(page) {
  const chooser = page.getByTestId('login-create-vault-chooser')
  await chooser.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  const finalStep = page.getByTestId('create-vault-wizard-create')
  if (await finalStep.isVisible()) return

  const simplePath = page.getByTestId('get-started-path-simple')
  await simplePath.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await simplePath.click()
  await finalStep.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const nameInput = page.getByTestId('login-vault-name-input')
  if (!(await nameInput.inputValue()).trim()) {
    await nameInput.fill(vaultName, { timeout: TIMEOUT_MS })
  }
}

/** @param {Page} popupPage */
async function ensurePinProtectedPopup(popupPage) {
  const companionHome = popupPage.getByTestId('extension-toolbar-menu')
  if (await companionHome.isVisible().catch(() => false)) {
    return
  }

  const pinUnlock = popupPage.getByTestId('device-protection-pin-unlock-btn')
  if (await pinUnlock.isVisible().catch(() => false)) {
    await popupPage.getByTestId('device-protection-pin-unlock-input').fill(pin)
    await pinUnlock.click()
    await companionHome.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
    return
  }

  await popupPage
    .getByTestId('extension-device-setup')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await popupPage.getByTestId('device-protection-create-new-choice').click()
  await popupPage.getByTestId('device-protection-setup-btn').click()
  await popupPage
    .getByTestId('device-protection-pin-input')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await popupPage.getByTestId('device-protection-pin-input').fill(pin)
  await popupPage.getByTestId('device-protection-pin-confirm').fill(pin)
  await popupPage.getByTestId('device-protection-pin-setup-btn').click()
  await companionHome.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
}

/** @param {BrowserContext} context @param {Page} popupPage */
async function createAndApproveVault(context, popupPage) {
  const openedConnectPage = context.waitForEvent('page', {
    timeout: TIMEOUT_MS,
  })
  await popupPage.getByTestId('connect-simple-vault-btn').click()
  const simplePage = await openedConnectPage
  if (!belongsToSimpleVault(requiredSimpleVaultUrl, simplePage.url())) {
    throw new Error(
      `Expected Simple Vault connect page under ${requiredSimpleVaultUrl}, got ${simplePage.url()}`,
    )
  }

  const consent = simplePage.getByTestId('extension-connect-consent')
  const approved = simplePage.getByTestId('extension-connect-approved')
  const authenticated = simplePage.getByTestId('authenticated-shell')

  if (await approved.isVisible().catch(() => false)) {
    await simplePage.getByRole('button', { name: 'Done' }).click()
    await authenticated.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
    return simplePage
  }

  if (!(await consent.isVisible().catch(() => false))) {
    await advanceCreateVaultWizardToFinalStep(simplePage)
    await simplePage.getByTestId('login-vault-name-input').fill(vaultName)
    await simplePage.getByTestId('login-create-device-vault-btn').click()
    await consent.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  }

  await simplePage.getByTestId('approve-extension-device-btn').click()
  await approved.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await simplePage.getByRole('button', { name: 'Done' }).click()
  await authenticated.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  return simplePage
}

async function main() {
  const browser = await chromium.connectOverCDP(cdpUrl)
  const context = browser.contexts()[0]
  if (!context) {
    throw new Error('Brave CDP connection did not expose a browser context')
  }

  // Force the extension popup onto the PIN fallback (no OS passkey ceremony).
  await context.addInitScript(() => {
    Object.defineProperty(window, 'PublicKeyCredential', {
      configurable: true,
      get: () => false,
    })
  })

  await getServiceWorker(context)
  const storage = await readExtensionStorage(context)
  const setup = storage[SETUP_STORAGE_KEY]
  if (
    setup &&
    typeof setup === 'object' &&
    'status' in setup &&
    setup.status === 'ready' &&
    'pairedVaults' in setup &&
    Array.isArray(setup.pairedVaults) &&
    setup.pairedVaults.length > 0
  ) {
    const [firstPairedVault] = setup.pairedVaults
    const selectedVaultName =
      'selectedVaultName' in setup &&
      typeof setup.selectedVaultName === 'string'
        ? setup.selectedVaultName
        : firstPairedVault
    console.log('already_paired=true')
    console.log(
      `Brave profile is already paired with vault "${selectedVaultName}". Leaving Brave open.`,
    )
    return
  }

  const popupPage = await context.newPage()
  await popupPage.goto(`chrome-extension://${extensionId}/popup/index.html`)
  await ensurePinProtectedPopup(popupPage)
  await createAndApproveVault(context, popupPage)

  await Promise.race([
    (async () => {
      for (;;) {
        const next = await readExtensionStorage(context)
        const nextSetup = next[SETUP_STORAGE_KEY]
        if (
          nextSetup &&
          typeof nextSetup === 'object' &&
          'status' in nextSetup &&
          nextSetup.status === 'ready'
        ) {
          return
        }
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
    })(),
    new Promise((_, reject) =>
      setTimeout(
        () =>
          reject(new Error('Timed out waiting for extension pairing storage')),
        TIMEOUT_MS,
      ),
    ),
  ])

  console.log('already_paired=false')
  console.log(
    `Created and approved Simple Vault "${vaultName}" with PIN device protection.`,
  )
}

try {
  await main()
  // CDP keeps the event loop alive; exit without browser.close() so Brave stays up.
  process.exit(0)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
