import type { BrowserContext } from '@playwright/test'

/** Keep content-script failures in hosted logs even without trace artifacts. */
export function reportExtensionBrowserErrors(context: BrowserContext): void {
  context.on('weberror', (event) => {
    console.error('[extension e2e browser error]', event.error())
  })
  context.on('console', (message) => {
    if (message.type() === 'error') {
      console.error('[extension e2e console error]', message.text())
    }
  })
}
