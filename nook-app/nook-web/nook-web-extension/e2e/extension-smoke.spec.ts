import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
} from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ExtensionPairingApprovedMessage } from '../../nook-web-shared/src/extension/runtime-messages'

type TestServer = {
  origin: string
  close: () => Promise<void>
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
        <head><title>Nook extension e2e login</title></head>
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
  if (typeof address !== 'object' || !address) {
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
  return (
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker', { timeout: 15_000 }))
  )
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

test('opens Simple Vault, renders the site widget, and starts website-driven pairing', async ({
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

  const manifest = JSON.parse(
    await readFile(path.join(extensionDir, 'manifest.json'), 'utf8'),
  ) as { action?: { default_popup?: string } }
  expect(manifest.action?.default_popup).toBeUndefined()

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

  await context.route('https://simple.nokey.sh/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><body><h1>Simple Vault</h1></body></html>',
    }),
  )
  await context.route('https://sentinel.nokey.sh/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<form><input autocomplete="username"><input type="password"></form>',
    }),
  )

  try {
    const worker = await getServiceWorker(context)
    const extensionId = new URL(worker.url()).host

    const loginPage = await context.newPage()
    await loginPage.goto(`${loginServer.origin}/login`)
    const widget = loginPage.locator('#nook-auth-widget')
    await expect(widget).toBeVisible()
    await expect(widget.getByText('Open vault')).toBeVisible()

    const openedVault = context.waitForEvent('page')
    await widget.getByRole('button', { name: 'Open vault' }).click()
    await expect(await openedVault).toHaveURL('https://simple.nokey.sh/')

    const sentinelPage = await context.newPage()
    await sentinelPage.goto('https://sentinel.nokey.sh/')
    await expect(sentinelPage.locator('#nook-auth-widget')).toHaveCount(0)

    const simplePage = await context.newPage()
    await simplePage.goto(
      `https://simple.nokey.sh/extension-connect?extension_id=${extensionId}`,
    )
    const protectionPagePromise = context.waitForEvent('page')
    expect(
      await sendExternalMessage(simplePage, extensionId, {
        type: 'nook:start-extension-pairing',
      }),
    ).toEqual({ ok: true })
    const protectionPage = await protectionPagePromise
    await expect(protectionPage).toHaveURL(
      `chrome-extension://${extensionId}/connect/index.html`,
    )
    await expect(
      protectionPage.getByTestId('protect-browser-access-btn'),
    ).toBeVisible()

    const forgedGrant = {
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
    }
    expect(
      await sendExternalMessage(simplePage, extensionId, forgedGrant),
    ).toEqual({ ok: false, reason: 'invalid-pairing-grant' })

    const approvedGrant: ExtensionPairingApprovedMessage = {
      type: 'nook:extension-pairing-approved',
      payload: {
        vaultType: 'simple',
        deviceId: 'device-e2e',
        deviceLabel: 'Nook Extension - Chromium test profile',
        vaultStoreId: 'store-e2e',
        vaultName: 'Personal',
        approvedAt: '2026-07-07T00:00:00.000Z',
        scopes: ['vault-access', 'password-filling'],
        providers: [],
      },
    }
    expect(
      await sendExternalMessage(simplePage, extensionId, approvedGrant),
    ).toEqual({ ok: true })

    await expect
      .poll(async () => {
        const storage = await readExtensionStorage(context)
        return Boolean(
          storage[pairingGrantStorageKey] && storage[setupStorageKey],
        )
      })
      .toBe(true)
  } finally {
    await context.close()
    await loginServer.close()
  }
})
