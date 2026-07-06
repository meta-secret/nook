/**
 * Shared Playwright `test` for Nook e2e.
 *
 * Extends the base test with an auto fixture that attaches the app's persisted
 * logs (`window.__nookLog`, same envelope as `/app-logs`) to every test result.
 * On failure it also prints the log tail. Specs get this for free by importing
 * `test`/`expect` from here instead of `@playwright/test`. Attaches
 * `nook-app-logs.json` (canonical `nook.app-logs.v1` envelope — agents must
 * read this when diagnosing a test).
 *
 * For mid-flow or explicit export, use `fetchAppLogs(page)` (`/app-logs`) or
 * `dumpNookLogs(page)` from `./helpers`. See `.cortex/references/logging.md`.
 *
 * To capture more detail for a post-mortem, lower the persistence level and
 * re-run (e.g. `VITE_LOG_LEVEL=debug` for the dev server, or set
 * `localStorage.nook_log_level` before the flow).
 */
import { test as base, expect } from '@playwright/test'
import { attachNookLogsForTest } from './helpers'
import { installMockPasskeyRuntime } from './passkey-mock'

export const test = base.extend<{ nookAppLogs: void }>({
  nookAppLogs: [
    async ({ page, context }, use, testInfo) => {
      await context.addInitScript(installMockPasskeyRuntime)
      await use()
      const targetPages = [page, ...context.pages()].filter(
        (candidate, index, pages) => {
          if (pages.indexOf(candidate) !== index) return false
          try {
            const url = candidate.url()
            return !!url && url !== 'about:blank'
          } catch {
            return false
          }
        },
      )
      for (const targetPage of targetPages) {
        await attachNookLogsForTest(targetPage, testInfo, {
          print: testInfo.status !== testInfo.expectedStatus,
        })
      }
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
