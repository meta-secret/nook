import type { BrowserContext, Page } from '@playwright/test'

async function reportIsolatedWorldErrors(page: Page): Promise<void> {
  const session = await page.context().newCDPSession(page)
  session.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
    const { text, exception } = exceptionDetails
    if (exception && 'description' in exception) {
      console.error(
        '[extension e2e isolated-world error]',
        exception.description,
      )
      return
    }
    console.error('[extension e2e isolated-world error]', text)
  })
  await session.send('Runtime.enable')
}

/** Keep content-script failures in hosted logs even without trace artifacts. */
export function reportExtensionBrowserErrors(context: BrowserContext): void {
  context.on('page', (page) => {
    void reportIsolatedWorldErrors(page).catch((error) => {
      console.error('[extension e2e error observer failed]', error)
    })
  })
  context.on('weberror', (event) => {
    console.error('[extension e2e browser error]', event.error())
  })
  context.on('console', (message) => {
    if (message.type() === 'error') {
      console.error('[extension e2e console error]', message.text())
    }
  })
}
