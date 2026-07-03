/**
 * Shared Playwright `test` for Nook e2e.
 *
 * Extends the base test with an auto fixture that, on failure, dumps and
 * attaches the app's persisted logs (`window.__nookLog`, backed by the WASM
 * logger). Specs get this for free by importing `test`/`expect` from here
 * instead of `@playwright/test`. Attaches `nook-app-logs.json` (canonical
 * `nook.app-logs.v1` envelope — agents must read this on failure).
 *
 * For mid-flow or explicit export, use `fetchAppLogs(page)` (`/app-logs`) or
 * `dumpNookLogs(page)` from `./helpers`. See `.cortex/references/logging.md`.
 *
 * To capture more detail for a post-mortem, lower the persistence level and
 * re-run (e.g. `VITE_LOG_LEVEL=debug` for the dev server, or set
 * `localStorage.nook_log_level` before the flow).
 */
import { test as base, expect } from '@playwright/test'
import { captureNookLogsOnFailure } from './helpers'
import { installMockPasskeyRuntime } from './passkey-mock'

export const test = base.extend<{ nookLogsOnFailure: void }>({
  nookLogsOnFailure: [
    async ({ page, context }, use, testInfo) => {
      await context.addInitScript(installMockPasskeyRuntime)
      await use()
      if (testInfo.status === testInfo.expectedStatus) return
      // Multi-context specs may leave the default page on about:blank.
      let url: string
      try {
        url = page.url()
      } catch {
        return
      }
      if (!url || url === 'about:blank') return
      await captureNookLogsOnFailure(page, testInfo)
    },
    { auto: true },
  ],
})

export { expect }
export type {
  Browser,
  BrowserContext,
  Locator,
  Page,
  Route,
  TestInfo,
} from '@playwright/test'
