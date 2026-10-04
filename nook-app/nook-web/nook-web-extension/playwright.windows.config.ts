import { defineConfig, type PlaywrightTestConfig } from '@playwright/test'
import sharedConfig from './playwright.config'

type WindowsOutputDirectoryConfig = Pick<PlaywrightTestConfig, 'outputDir'>

class WindowsExtensionConfig {
  constructor(private readonly environment: NodeJS.ProcessEnv) {}

  buildOutputDirectory(): WindowsOutputDirectoryConfig {
    const outputDir = this.environment.PLAYWRIGHT_OUTPUT_DIR
    switch (outputDir) {
      case undefined:
        return {}
      default:
        return { outputDir }
    }
  }

  static readonly value: PlaywrightTestConfig = {
    ...sharedConfig,
    workers: 1,
    ...new WindowsExtensionConfig(process.env).buildOutputDirectory(),
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
