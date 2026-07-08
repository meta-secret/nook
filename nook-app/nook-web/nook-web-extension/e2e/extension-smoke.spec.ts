import { expect, test, chromium, type BrowserContext } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

type TestServer = {
  origin: string
  close: () => Promise<void>
}

type StoredPasswordSummary = {
  passwordFieldCount?: number
  usernameFieldCount?: number
  formCount?: number
}

type SeededExtensionSetupState = {
  status: 'ready'
  deviceLabel: string
  pairedVaults: string[]
  selectedVaultName: string
  syncStatus: string
}

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const extensionDir = path.join(rootDir, 'dist')
const setupStorageKey = 'nook:extension-setup'

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

async function writeExtensionSetupState(
  context: BrowserContext,
  setupState: SeededExtensionSetupState,
) {
  const worker = await getServiceWorker(context)
  await worker.evaluate(
    ([storageKey, state]) =>
      new Promise<void>((resolve) => {
        const browserGlobal = globalThis as unknown as {
          chrome: {
            storage: {
              local: {
                set(items: Record<string, unknown>, callback: () => void): void
              }
            }
          }
        }

        browserGlobal.chrome.storage.local.set({ [storageKey]: state }, resolve)
      }),
    [setupStorageKey, setupState] as const,
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

test('loads the extension and scans a login form from the popup', async ({
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

  const loginServer = await startLoginServer()
  const userDataDir = testInfo.outputPath('chromium-profile')
  await mkdir(userDataDir, { recursive: true })

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
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

    const serviceWorker = await getServiceWorker(context)
    const extensionId = new URL(serviceWorker.url()).host
    expect(extensionId).not.toHaveLength(0)

    const popupPage = await context.newPage()
    await popupPage.goto(`chrome-extension://${extensionId}/popup/index.html`)
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
    await popupPage.getByTestId('set-up-extension-btn').click()
    await expect(popupPage.getByTestId('extension-setup-state')).toHaveText(
      'protecting',
    )
    await expect(popupPage.getByText('Passkey setup pending')).toBeVisible()

    await writeExtensionSetupState(context, {
      status: 'ready',
      deviceLabel: 'Nook Extension - Chromium test profile',
      pairedVaults: ['Personal'],
      selectedVaultName: 'Personal',
      syncStatus: 'Idle',
    })
    await popupPage.reload()
    await expect(popupPage.getByTestId('extension-setup-state')).toHaveText(
      'ready',
    )
    await expect(popupPage.getByText('Personal')).toBeVisible()

    await loginPage.bringToFront()
    await popupPage.evaluate(() => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="scan-active-tab"]')
        ?.click()
    })

    await expect(popupPage.getByTestId('password-field-count')).toHaveText('1')
    await expect(popupPage.getByTestId('username-field-count')).toHaveText('1')
    await expect(popupPage.getByTestId('form-count')).toHaveText('1')
    await expect(
      popupPage.getByText('Nook found password fields'),
    ).toBeVisible()
    await expect(popupPage.getByTestId('suggested-password')).toContainText(
      /[A-Za-z0-9]/,
    )
  } finally {
    await context.close()
    await loginServer.close()
  }
})
