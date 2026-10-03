import { defineConfig } from '@playwright/test'
import sharedConfig from './playwright.config'

export default defineConfig(sharedConfig, {
  workers: 2,
  reporter: [
    ['line'],
    ['html', { open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  use: {
    channel: 'msedge',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {},
  },
})
