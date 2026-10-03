import { defineConfig, type PlaywrightTestConfig } from '@playwright/test'
import sharedConfig from './playwright.config'

type WindowsOutputDirectoryConfig = Pick<PlaywrightTestConfig, 'outputDir'>

class WindowsResearchConfig {
  constructor(private readonly environment: NodeJS.ProcessEnv) {}

  buildOutputDirectory(): WindowsOutputDirectoryConfig {
    const outputDir = this.environment.PLAYWRIGHT_OUTPUT_DIR
    switch (typeof outputDir) {
      case 'string':
        return { outputDir }
      default:
        return {}
    }
  }

  static readonly value: PlaywrightTestConfig = {
    ...sharedConfig,
    workers: 2,
    ...new WindowsResearchConfig(process.env).buildOutputDirectory(),
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
