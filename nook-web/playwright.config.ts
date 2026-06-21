import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'

const rootDir = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(rootDir, '.env.test.local') })

/** Fast GitHub sync in e2e — production default stays 10s via app code. */
process.env.VITE_VAULT_SYNC_INTERVAL_MS ??= '1000'
process.env.NOOK_GITHUB_POLL_MS ??= '2500'

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  globalTeardown: './e2e/global-teardown.ts',
  timeout: process.env.CI ? 120_000 : 60_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
    actionTimeout: 5_000,
  },
  webServer: {
    command: 'bun run dev -- --host 127.0.0.1 --port 5173',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: {
      VITE_VAULT_SYNC_INTERVAL_MS: process.env.VITE_VAULT_SYNC_INTERVAL_MS,
      NOOK_GITHUB_POLL_MS: process.env.NOOK_GITHUB_POLL_MS,
    },
  },
})
