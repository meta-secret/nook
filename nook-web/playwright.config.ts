import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'

const rootDir = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(rootDir, '.env.test.local') })

/** Fast GitHub sync in e2e — production default stays 30s via app code. */
process.env.VITE_VAULT_SYNC_INTERVAL_MS ??= '1000'
process.env.NOOK_GITHUB_POLL_MS ??= '3000'

/** IndexedDB-only specs — safe to fan out (each test gets an isolated browser context). */
const LOCAL_SPECS = [
  'connect.spec.ts',
  'local-vault.spec.ts',
  'login-unlock-flow.spec.ts',
  'onboard-providers.spec.ts',
  'password-envelope-local.spec.ts',
  'shell-height.spec.ts',
  'bip39-seed-phrase.spec.ts',
] as const

/** Real GitHub API specs — serial within the project; share one CI repo via helpers. */
const GITHUB_SPECS = [
  'github-vault.spec.ts',
  'multi-device-github.spec.ts',
  'password-envelope-github.spec.ts',
  'fresh-vault-passwords.spec.ts',
  'provider-switch-passwords.spec.ts',
] as const

const specPaths = (files: readonly string[]) =>
  files.map((file) => path.join('**', file))

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  globalTimeout: process.env.CI ? 45 * 60_000 : undefined,
  globalTeardown: './e2e/global-teardown.ts',
  timeout: process.env.CI ? 120_000 : 60_000,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
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
    timeout: process.env.CI ? 120_000 : 30_000,
    env: {
      VITE_VAULT_SYNC_INTERVAL_MS: process.env.VITE_VAULT_SYNC_INTERVAL_MS,
      NOOK_GITHUB_POLL_MS: process.env.NOOK_GITHUB_POLL_MS,
    },
  },
  projects: [
    {
      name: 'local',
      testMatch: specPaths(LOCAL_SPECS),
      fullyParallel: true,
      workers: process.env.CI ? 4 : undefined,
    },
    {
      name: 'github',
      testMatch: specPaths(GITHUB_SPECS),
      fullyParallel: false,
      workers: 1,
      dependencies: ['local'],
    },
  ],
})
