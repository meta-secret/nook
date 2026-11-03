import { defineConfig } from '@playwright/test'

/**
 * Dev scenarios: each drives a real Brave window through a setup a person
 * would otherwise click by hand, against the running dev servers (Vite on
 * https://localhost:5173 and the local S3 server), and leaves its profile
 * for `task extension:scenario` to reopen as an ordinary browser.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '*.scenario.ts',
  retries: 0,
  reporter: 'list',
  timeout: 300_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: 'https://localhost:5173',
    actionTimeout: 30_000,
    trace: 'retain-on-failure',
  },
})
