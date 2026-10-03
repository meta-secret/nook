import { defineConfig, type PlaywrightTestConfig } from '@playwright/test'
import sharedConfig from './playwright.isolation.config'

class WindowsIsolationConfig {
  static readonly value: PlaywrightTestConfig = {
    ...sharedConfig,
    workers: 2,
    outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR,
    reporter: [['line'], ['html', { open: 'never' }], ['json']],
    use: {
      ...sharedConfig.use,
      channel: 'msedge',
      trace: 'retain-on-failure',
      screenshot: 'only-on-failure',
      launchOptions: {},
    },
    webServer: [
      {
        command:
          'bun x --no-install vite preview --host 127.0.0.1 --port 5174 --strictPort',
        cwd: '../nook-vault-simple',
        url: 'http://127.0.0.1:5174',
        reuseExistingServer: false,
        timeout: 120_000,
      },
      {
        command:
          'bun x --no-install vite preview --host 127.0.0.1 --port 5175 --strictPort',
        cwd: '../nook-vault-sentinel',
        url: 'http://127.0.0.1:5175',
        reuseExistingServer: false,
        timeout: 120_000,
      },
    ],
  }
}

export default defineConfig(WindowsIsolationConfig.value)
