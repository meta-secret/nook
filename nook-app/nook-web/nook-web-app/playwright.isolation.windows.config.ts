import { defineConfig, type PlaywrightTestConfig } from '@playwright/test'
import sharedConfig from './playwright.isolation.config'

type WindowsOutputDirectoryConfig = Pick<PlaywrightTestConfig, 'outputDir'>

class WindowsIsolationConfig {
  constructor(private readonly environment: NodeJS.ProcessEnv) {}

  buildOutputDirectory(): WindowsOutputDirectoryConfig {
    const outputDir = this.environment.PLAYWRIGHT_OUTPUT_DIR
    if (typeof outputDir === 'string') return { outputDir }
    return {}
  }

  static readonly value: PlaywrightTestConfig = {
    ...sharedConfig,
    workers: 2,
    ...new WindowsIsolationConfig(process.env).buildOutputDirectory(),
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
