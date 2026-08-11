import type { Page, Route } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ChromeMessage } from './static-chrome-stub'

const DEMO_BEAT_MS = 900
const demoDir = path.dirname(fileURLToPath(import.meta.url))
const extensionDist = path.resolve(demoDir, '../../../nook-web-extension/dist')

export async function demoBeat(page: Page): Promise<void> {
  await page.waitForTimeout(DEMO_BEAT_MS)
}

export async function loadPilotMessages(): Promise<
  Record<string, ChromeMessage>
> {
  return JSON.parse(
    await readFile(
      path.join(extensionDist, '_locales/en/messages.json'),
      'utf8',
    ),
  ) as Record<string, ChromeMessage>
}

export async function injectPilotAutofill(page: Page): Promise<void> {
  const companionWasmResponse: Parameters<Route['fulfill']>[0] = {
    path: path.join(extensionDist, 'content/nook_companion_wasm_bg.wasm'),
    contentType: 'application/wasm',
  }
  await page.route('**/content/nook_companion_wasm_bg.wasm', async (route) =>
    route.fulfill(companionWasmResponse),
  )
  await page.addScriptTag({
    path: path.join(extensionDist, 'content/autofill.js'),
    type: 'module',
  })
}
