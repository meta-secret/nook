import type { Page, Route } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ChromeMessage } from './static-chrome-stub'
import { parseJson, requireMessageRecord } from '../helpers'
import { Effect } from 'effect'

const DEMO_BEAT_MS = 900
const demoDir = path.dirname(fileURLToPath(import.meta.url))
const extensionDist = path.resolve(demoDir, '../../../nook-web-extension/dist')

export async function demoBeat(page: Page): Promise<void> {
  await page.waitForTimeout(DEMO_BEAT_MS)
}

export async function loadPilotMessages(): Promise<
  Record<string, ChromeMessage>
> {
  return requireMessageRecord(
    parseJson(
      await readFile(
        path.join(extensionDist, '_locales/en/messages.json'),
        'utf8',
      ),
    ),
    'pilot localized messages',
  )
}

export async function injectPilotAutofill(page: Page): Promise<void> {
  page.on('pageerror', (error) =>
    console.error('Pilot demo page error', error.message),
  )
  page.on('console', (message) => {
    if (message.type() === 'error')
      console.error('Pilot demo browser error', message.text())
  })
  const companionWasmResponse: Parameters<Route['fulfill']>[0] = {
    path: path.join(extensionDist, 'content/nook_companion_wasm_bg.wasm'),
    contentType: 'application/wasm',
  }
  await page.route('**/content/nook_companion_wasm_bg.wasm', async (route) =>
    route.fulfill(companionWasmResponse),
  )
  await page.addScriptTag({
    content: await Effect.runPromise(
      Effect.try(() =>
        execFileSync(
          'bun',
          [
            'build',
            path.join(demoDir, 'pilot-companion-runtime.ts'),
            '--target=browser',
            '--format=esm',
          ],
          { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
        ),
      ),
    ),
    type: 'module',
  })
  await page.addScriptTag({
    path: path.join(extensionDist, 'content/autofill.js'),
    type: 'module',
  })
}
