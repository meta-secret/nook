import { chromium, type BrowserContext, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  flushNookLogPersistQueue,
  readPersistedAppLogs,
} from '../../nook-web-app/e2e/helpers/app-logs'

const BRAVE_EXECUTABLE =
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'

const extensionDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../dist',
)

/** The scenario's Brave window, its extension id, and every console line
 * and page error its pages printed, in order. */
export type DevBrowser = {
  readonly context: BrowserContext
  readonly extensionId: string
  readonly popupUrl: string
  readonly consoleLines: string[]
}

/** Record each page's console messages and uncaught errors, prefixed with
 * the page's URL, as they happen. */
function recordConsole(context: BrowserContext): string[] {
  const lines: string[] = []
  context.on('console', (message) => {
    const page = message.page()
    const source = page ? page.url() : 'worker'
    lines.push(`[${message.type()}] ${source} ${message.text()}`)
  })
  context.on('weberror', (failure) => {
    const page = failure.page()
    const source = page ? page.url() : 'worker'
    const error = failure.error()
    const detail = error.stack ? error.stack : error.message
    lines.push(`[pageerror] ${source} ${detail}`)
  })
  return lines
}

/**
 * Passkeys are unavailable while a scenario drives the browser, so the web
 * vault and the extension both protect their keys with a PIN, which the
 * script can type and a person can type later. The vault page reads an
 * unavailable credential store as "no passkeys"; extension pages read a
 * missing PublicKeyCredential the same way.
 */
function withoutPasskeys(): void {
  if (globalThis.location.protocol === 'chrome-extension:') {
    Object.defineProperty(globalThis, 'PublicKeyCredential', {
      configurable: true,
      get() {
        return
      },
    })
    return
  }
  const unavailable = async () => {
    throw new Error(
      'PASSKEY_UNAVAILABLE: passkeys are unavailable in this browser profile',
    )
  }
  Object.defineProperty(navigator, 'credentials', {
    configurable: true,
    value: { create: unavailable, get: unavailable },
  })
}

/** Open Brave on the scenario's profile with the localhost extension, as a
 * visible window the script drives. */
export async function launchDevBrowser(): Promise<DevBrowser> {
  const profile = process.env.NOOK_SCENARIO_PROFILE
  if (!profile) {
    throw new Error('NOOK_SCENARIO_PROFILE names the scenario Brave profile.')
  }
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: BRAVE_EXECUTABLE,
    headless: false,
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  })
  const consoleLines = recordConsole(context)
  await context.addInitScript(withoutPasskeys)
  const [known] = context.serviceWorkers()
  const worker = known ? known : await context.waitForEvent('serviceworker')
  const extensionId = new URL(worker.url()).host
  return {
    context,
    extensionId,
    popupUrl: `chrome-extension://${extensionId}/popup/index.html`,
    consoleLines,
  }
}

/**
 * When a scenario stops: its console lines, then each Nook page's persisted
 * app logs (the vault's and the extension's own), written to `outputPath`
 * and their tail printed, so the failure reads from the app's own record.
 */
export async function reportLogs(
  browser: DevBrowser,
  outputPath: (name: string) => string,
): Promise<void> {
  const sections = [`# Console\n${browser.consoleLines.join('\n')}`]
  for (const page of browser.context.pages()) {
    const url = page.url()
    if (
      !url.startsWith('https://localhost:5173') &&
      !url.startsWith('chrome-extension://')
    ) {
      continue
    }
    await flushNookLogPersistQueue(page)
    const entries = await readPersistedAppLogs(page)
    sections.push(
      `# App logs: ${url}\n${entries.map((entry) => JSON.stringify(entry)).join('\n')}`,
    )
  }
  const report = sections.join('\n\n')
  await writeFile(outputPath('logs.txt'), report)
  console.error(
    `${report.split('\n').slice(-80).join('\n')}\n\nFull logs: ${outputPath('logs.txt')}`,
  )
}

/** The scenario's first tab, reused for the vault. */
export async function firstPage(browser: DevBrowser): Promise<Page> {
  const [page] = browser.context.pages()
  return page ? page : await browser.context.newPage()
}
