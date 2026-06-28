import dotenv from 'dotenv'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'

const rootDir = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(rootDir, '.env.test.local') })

/** Fast GitHub sync in e2e — production default stays 30s via app code. */
process.env.VITE_VAULT_SYNC_INTERVAL_MS ??= '1000'
process.env.NOOK_GITHUB_POLL_MS ??= '3000'

const isCi = !!process.env.CI
const distDir = path.join(rootDir, 'dist')

/** IndexedDB-only specs — safe to fan out (each test gets an isolated browser context). */
const LOCAL_SPECS = [
  'connect.spec.ts',
  'local-vault.spec.ts',
  'login-unlock-flow.spec.ts',
  'onboard-providers.spec.ts',
  'password-envelope-local.spec.ts',
  'shell-height.spec.ts',
  'bip39-seed-phrase.spec.ts',
  'sync-provider-connect.spec.ts',
  'sync-conflict-resolution.spec.ts',
  'sync-fanout.spec.ts',
  'legal-pages.spec.ts',
  'multi-device-local.spec.ts',
] as const

/** Real GitHub API specs — serial within the project; one repo per container via NOOK_GITHUB_E2E_REPO. */
const GITHUB_SPECS = [
  'github-vault.spec.ts',
  'multi-device-github.spec.ts',
  'password-envelope-github.spec.ts',
  'fresh-vault-passwords.spec.ts',
  'provider-switch-passwords.spec.ts',
  'remote-vault-recovery-github.spec.ts',
] as const

const specPaths = (files: readonly string[]) =>
  files.map((file) => path.join('**', file))

/** CI runs e2e after `ci:main:parallel` — serve production dist (no Vite dev optimizer). */
const usePreviewServer = isCi && fs.existsSync(distDir)
const webServerCommand = usePreviewServer
  ? 'bun run preview -- --host 127.0.0.1 --port 5173'
  : 'bun run dev -- --host 127.0.0.1 --port 5173'

if (isCi) {
  console.log(
    `[e2e] webServer: ${usePreviewServer ? 'preview (dist/)' : 'dev (dist missing)'}`,
  )
}

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: isCi,
  retries: isCi ? 2 : 0,
  globalTimeout: isCi ? 45 * 60_000 : undefined,
  globalTeardown: './e2e/global-teardown.ts',
  timeout: isCi ? 120_000 : 60_000,
  reporter: isCi ? 'line' : 'list',
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
    actionTimeout: 5_000,
  },
  webServer: {
    command: webServerCommand,
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !isCi,
    timeout: isCi ? 120_000 : 30_000,
    // Do not set stdout/stderr to 'pipe' — an undrained pipe can block Vite with no visible output.
    env: usePreviewServer
      ? { VITE_E2E_EXPOSE_VAULT: 'true' }
      : {
          VITE_VAULT_SYNC_INTERVAL_MS: process.env.VITE_VAULT_SYNC_INTERVAL_MS,
          NOOK_GITHUB_POLL_MS: process.env.NOOK_GITHUB_POLL_MS,
          VITE_E2E_EXPOSE_VAULT: 'true',
        },
  },
  projects: [
    {
      name: 'local',
      testMatch: specPaths(LOCAL_SPECS),
      fullyParallel: true,
      workers: isCi ? 2 : undefined,
    },
    {
      name: 'github',
      testMatch: specPaths(GITHUB_SPECS),
      fullyParallel: false,
      workers: 1,
    },
  ],
})
