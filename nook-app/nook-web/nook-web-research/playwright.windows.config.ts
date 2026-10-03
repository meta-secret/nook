import { defineConfig, type PlaywrightTestConfig } from '@playwright/test'
import sharedConfig from './playwright.config'

class WindowsResearchConfig {
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
    webServer: {
      command:
        'bun x --no-install vite preview --host 127.0.0.1 --port 5173 --strictPort',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  }
}

export default defineConfig(WindowsResearchConfig.value)
