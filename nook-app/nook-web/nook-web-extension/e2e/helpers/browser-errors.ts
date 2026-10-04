import type { BrowserContext } from '@playwright/test'

const discoveryDiagnosticMessages: ReadonlySet<string> = new Set([
  'extension discovery: worker received',
  'extension discovery: worker admitted',
  'extension discovery: worker completed',
  'extension discovery: worker responded',
  'extension discovery: worker completion rejected',
  'extension discovery: offscreen received',
  'extension discovery: offscreen admitted',
  'extension discovery: offscreen completed',
  'extension discovery: offscreen responded',
  'extension discovery: offscreen completion rejected',
  'extension discovery: offscreen readiness rejected',
])

/** Keep content-script failures in hosted logs even without trace artifacts. */
export function reportExtensionBrowserErrors(context: BrowserContext): void {
  context.on('weberror', (event) => {
    console.error('[extension e2e browser error]', event.error())
  })
  context.on('console', (message) => {
    if (discoveryDiagnosticMessages.has(message.text())) {
      console.info(Date.now(), message.text())
    }
    if (message.type() === 'error') {
      console.error('[extension e2e console error]', message.text())
    }
  })
}
