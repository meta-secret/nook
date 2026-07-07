import { defineConfig } from '@playwright/test'

const isCi = !!process.env.CI

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: isCi,
  retries: isCi ? 2 : 0,
  reporter: isCi ? 'line' : 'list',
  timeout: isCi ? 90_000 : 60_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    actionTimeout: 5_000,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium-extension',
    },
  ],
})
