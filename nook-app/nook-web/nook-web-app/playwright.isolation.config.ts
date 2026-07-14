import { defineConfig } from '@playwright/test'

const chromiumExecutablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined

const commonEnvironment = {
  VITE_E2E_EXPOSE_VAULT: 'true',
  VITE_VAULT_IDLE_TIMEOUT_MS: '300000',
  VITE_VAULT_IDLE_WARNING_MS: '0',
}

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/app-isolation.spec.ts',
  timeout: 90_000,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    trace: 'on-first-retry',
    launchOptions: {
      executablePath: chromiumExecutablePath,
    },
  },
  webServer: [
    {
      command: 'bun run dev -- --host 127.0.0.1 --port 5174',
      cwd: '../nook-vault-simple',
      url: 'http://127.0.0.1:5174',
      reuseExistingServer: !process.env.CI,
      env: commonEnvironment,
    },
    {
      command: 'bun run dev -- --host 127.0.0.1 --port 5175',
      cwd: '../nook-vault-sentinel',
      url: 'http://127.0.0.1:5175',
      reuseExistingServer: !process.env.CI,
      env: commonEnvironment,
    },
  ],
  projects: [
    {
      name: 'simple-isolation',
      use: { baseURL: 'http://127.0.0.1:5174' },
    },
    {
      name: 'sentinel-isolation',
      use: { baseURL: 'http://127.0.0.1:5175' },
    },
  ],
})
