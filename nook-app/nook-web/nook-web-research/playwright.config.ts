import { defineConfig } from '@playwright/test'

const isCi = Boolean(process.env.CI)
const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: isCi,
  retries: isCi ? 1 : 0,
  reporter: isCi ? 'line' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    headless: true,
    launchOptions: {
      ...(chromiumExecutablePath
        ? { executablePath: chromiumExecutablePath }
        : {}),
    },
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'bun run dev -- --host 127.0.0.1 --port 5173',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !isCi,
    timeout: 30_000,
  },
})
