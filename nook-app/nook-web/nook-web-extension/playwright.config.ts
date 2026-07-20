import { defineConfig } from '@playwright/test'

const isCi = !!process.env.CI
const isHostedSmoke = process.env.NOOK_EXTENSION_E2E_HOSTED === 'true'

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: isCi,
  retries: isHostedSmoke ? 0 : isCi ? 2 : 0,
  reporter: isCi ? 'line' : 'list',
  timeout: isHostedSmoke ? 180_000 : isCi ? 90_000 : 60_000,
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
  webServer: isHostedSmoke
    ? undefined
    : {
        command: 'bun run dev -- --host 127.0.0.1 --port 5174',
        cwd: '../nook-vault-simple',
        url: 'http://127.0.0.1:5174',
        reuseExistingServer: !isCi,
        timeout: isCi ? 120_000 : 30_000,
        env: {
          VITE_E2E_EXPOSE_VAULT: 'true',
          VITE_VAULT_IDLE_TIMEOUT_MS: '300000',
          VITE_VAULT_IDLE_WARNING_MS: '0',
        },
      },
})
