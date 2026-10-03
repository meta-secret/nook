import { defineConfig, type PlaywrightTestConfig } from '@playwright/test'
import sharedConfig from './playwright.config'

class WindowsExtensionConfig {
  static readonly value: PlaywrightTestConfig = {
    ...sharedConfig,
    workers: 1,
    outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR,
    reporter: [['line'], ['html', { open: 'never' }], ['json']],
    use: {
      ...sharedConfig.use,
      channel: 'msedge',
      trace: 'retain-on-failure',
      screenshot: 'only-on-failure',
      launchOptions: {},
    },
    // Persistent extension contexts use the installed Edge executable supplied
    // through PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH by the native Windows Task.
    webServer: {
      command:
        'bun x --no-install vite preview --host 127.0.0.1 --port 5174 --strictPort',
      cwd: '../nook-vault-simple',
      url: 'http://127.0.0.1:5174',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  }
}

export default defineConfig(WindowsExtensionConfig.value)
