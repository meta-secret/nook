import {
  expect,
  test,
  chromium,
  type BrowserContext,
  type Page,
} from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ExtensionPairingApprovedMessage } from '../../nook-web-shared/src/extension/runtime-messages'

type TestServer = {
  origin: string
  close: () => Promise<void>
}

type StoredPasswordSummary = {
  passwordFieldCount?: number
  usernameFieldCount?: number
  formCount?: number
}

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const extensionDir = path.join(rootDir, 'dist')
const chromiumExecutablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined
const setupStorageKey = 'nook:extension-setup'
const pairingGrantStorageKey = 'nook:extension-pairing-grant:store-e2e'

async function startLoginServer(): Promise<TestServer> {
  const server = createServer((request, response) => {
    if (request.url !== '/login') {
      response.writeHead(404)
      response.end('Not found')
      return
    }

    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(`<!doctype html>
      <html>
        <head>
          <title>Nook extension e2e login</title>
        </head>
        <body>
          <main>
            <h1>Sign in</h1>
            <form>
              <label>Email <input autocomplete="username" name="email" type="email" /></label>
              <label>Password <input autocomplete="current-password" name="password" type="password" /></label>
              <button type="submit">Sign in</button>
            </form>
          </main>
        </body>
      </html>`)
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address()
  if (typeof address !== 'object' || address === null) {
    throw new Error('Expected the login server to listen on a TCP port')
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => closeServer(server),
  }
}

function closeServer(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

async function getServiceWorker(context: BrowserContext) {
  const existingWorker = context.serviceWorkers()[0]
  if (existingWorker) {
    return existingWorker
  }

  return context.waitForEvent('serviceworker', { timeout: 15_000 })
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
                  keys: null,
                  callback: (items: Record<string, unknown>) => void,
                ): void
              }
            }
          }
        }

        browserGlobal.chrome.storage.local.get(null, resolve)
      }),
  )
}

async function hasStoredLoginSummary(context: BrowserContext) {
  const storage = await readExtensionStorage(context)
  return Object.values(storage).some((value) => {
    const summary = value as StoredPasswordSummary
    return (
      summary.passwordFieldCount === 1 &&
      summary.usernameFieldCount === 1 &&
      summary.formCount === 1
    )
  })
}

async function storedLoginSummaryCount(context: BrowserContext) {
  const storage = await readExtensionStorage(context)
  return Object.values(storage).filter((value) => {
    const summary = value as StoredPasswordSummary
    return (
      summary.passwordFieldCount === 1 &&
      summary.usernameFieldCount === 1 &&
      summary.formCount === 1
    )
  }).length
}

async function sendRuntimeMessageFromPopup(popupPage: Page, message: unknown) {
  return popupPage.evaluate(
    (runtimeMessage) =>
      new Promise<unknown>((resolve, reject) => {
        const browserGlobal = globalThis as unknown as {
          chrome: {
            runtime: {
              lastError?: { message?: string }
              sendMessage(
                message: unknown,
                callback: (response?: unknown) => void,
              ): void
            }
          }
        }

        browserGlobal.chrome.runtime.sendMessage(runtimeMessage, (response) => {
          if (browserGlobal.chrome.runtime.lastError?.message) {
            reject(new Error(browserGlobal.chrome.runtime.lastError.message))
            return
          }
          resolve(response)
        })
      }),
    message,
  )
}

async function sendPairingGrantFromPopup(popupPage: Page) {
  const message: ExtensionPairingApprovedMessage = {
    type: 'nook:extension-pairing-approved',
    payload: {
      vaultType: 'simple',
      deviceId: 'device-e2e',
      deviceLabel: 'Nook Extension - Chromium test profile',
      vaultStoreId: 'store-e2e',
      vaultName: 'Personal',
      approvedAt: '2026-07-07T00:00:00.000Z',
      scopes: ['vault-access', 'password-filling', 'sync-provider-credentials'],
      providers: [
        {
          id: 'local-e2e',
          type: 'local',
          label: 'This device',
          createdAt: '2026-07-07T00:00:00.000Z',
        },
      ],
    },
  }

  const response = await sendRuntimeMessageFromPopup(popupPage, message)
  if (
    typeof response !== 'object' ||
    response === null ||
    !('ok' in response) ||
    (response as { ok?: unknown }).ok !== true
  ) {
    throw new Error('Pairing grant was not accepted by extension.')
  }
}

test('loads the extension and scans a login form from the popup', async ({
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

  const loginServer = await startLoginServer()
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
    const loginPage = await context.newPage()
    await loginPage.goto(`${loginServer.origin}/login`)
    await expect(loginPage.getByLabel('Email')).toBeVisible()
    await expect(loginPage.getByLabel('Password')).toBeVisible()

    await expect
      .poll(() => hasStoredLoginSummary(context), {
        message: 'content script stores the login form summary',
      })
      .toBe(true)

    await context.route('https://sentinel.nokey.sh/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<form><input autocomplete="username"><input type="password"></form>',
      }),
    )
    const sentinelPage = await context.newPage()
    await sentinelPage.goto('https://sentinel.nokey.sh/')
    await sentinelPage.waitForTimeout(300)
    expect(await storedLoginSummaryCount(context)).toBe(1)

    const serviceWorker = await getServiceWorker(context)
    const extensionId = new URL(serviceWorker.url()).host
    expect(extensionId).not.toHaveLength(0)

    const popupPage = await context.newPage()
    await popupPage.goto(`chrome-extension://${extensionId}/popup/index.html`)
    await expect(popupPage.locator('html')).toHaveAttribute('lang', 'en')
    await expect(
      popupPage.getByRole('heading', { name: 'Nook', exact: true }),
    ).toBeVisible()
    await expect(popupPage.getByTestId('extension-setup-state')).toHaveText(
      'not set up',
    )
    await expect(
      popupPage.getByText('separate passkey-protected extension device'),
    ).toBeVisible()
    await expect(popupPage.getByTestId('set-up-extension-btn')).toBeVisible()

    const forgedSentinelResponse = await sendRuntimeMessageFromPopup(
      popupPage,
      {
        type: 'nook:extension-pairing-approved',
        payload: {
          vaultType: 'sentinel',
          deviceId: 'sentinel-device-e2e',
          deviceLabel: 'Forged Sentinel device',
          vaultStoreId: 'sentinel-store-e2e',
          vaultName: 'Sentinel safe',
          approvedAt: '2026-07-07T00:00:00.000Z',
          scopes: ['vault-access'],
          providers: [],
        },
      },
    )
    expect(forgedSentinelResponse).toEqual({
      ok: false,
      reason: 'invalid-pairing-grant',
    })
    expect(
      (await readExtensionStorage(context))[
        'nook:extension-pairing-grant:sentinel-store-e2e'
      ],
    ).toBeUndefined()

    await sendPairingGrantFromPopup(popupPage)
    await expect
      .poll(async () => {
        const storage = await readExtensionStorage(context)
        return Boolean(
          storage[pairingGrantStorageKey] && storage[setupStorageKey],
        )
      })
      .toBe(true)

    await popupPage.reload()
    await expect(popupPage.getByTestId('extension-setup-state')).toHaveText(
      'ready',
    )
    await expect(popupPage.getByText('Personal')).toBeVisible()
    await expect(popupPage.getByText('1 sync provider granted')).toBeVisible()
    await expect(
      popupPage.getByRole('button', { name: 'Scan active tab' }),
    ).toBeVisible()
    await expect(popupPage.getByText('Password fields')).toBeVisible()
    await expect(popupPage.getByText('Login fields')).toBeVisible()
    await expect(popupPage.getByText('Forms')).toBeVisible()

    await popupPage.evaluate(() => {
      localStorage.setItem('nook_locale', 'ru')
    })
    await popupPage.reload()
    await expect(popupPage.locator('html')).toHaveAttribute('lang', 'ru')
    await expect(
      popupPage.getByRole('button', { name: 'Сканировать активную вкладку' }),
    ).toBeVisible()
    await expect(popupPage.getByText('Поля пароля')).toBeVisible()
    await expect(popupPage.getByText('Поля логина')).toBeVisible()
    await expect(popupPage.getByText('Формы')).toBeVisible()

    await loginPage.bringToFront()
    await popupPage.evaluate(() => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="scan-active-tab"]')
        ?.click()
    })

    await expect(popupPage.getByTestId('password-field-count')).toHaveText('1')
    await expect(popupPage.getByTestId('username-field-count')).toHaveText('1')
    await expect(popupPage.getByTestId('form-count')).toHaveText('1')
    await expect(popupPage.getByText('Nook нашел поля пароля')).toBeVisible()
    await expect(popupPage.getByText('Предложенный пароль')).toBeVisible()
    await expect(popupPage.getByTestId('suggested-password')).toContainText(
      /[A-Za-z0-9]/,
    )
  } finally {
    await context.close()
    await loginServer.close()
  }
})
