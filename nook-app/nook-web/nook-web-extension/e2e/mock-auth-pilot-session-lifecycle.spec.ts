import { expect, test } from '@playwright/test'
import {
  launchPairedPinExtension,
  lockExtensionSession,
  saveVaultLogin,
  waitForExtensionPopupEntrySurface,
} from './helpers/paired-pin-extension'
import { ensurePinProtectedPopup } from './helpers/pin-device'
import { startMockAuthServer } from './mock-auth'

test.describe('PIN Pilot session lifecycle', () => {
  test.describe.configure({ timeout: 180_000 })

  test('reports an extension popup initialization failure as soon as it is visible', async ({
    page,
  }) => {
    await page.setContent(`
      <main data-testid="extension-device-setup">
        <p role="alert" data-testid="extension-runtime-error">
          Runtime unavailable
        </p>
      </main>
    `)

    await expect(waitForExtensionPopupEntrySurface(page)).rejects.toThrow(
      'Extension popup failed to initialize: Runtime unavailable',
    )
  })

  test('a locked Sign in becomes Unlock, opens the Nook side panel, and signs in once unlocked', async ({
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

    const mockAuth = await startMockAuthServer()
    const paired = await launchPairedPinExtension(testInfo, {
      vaultName: 'Mock auth lock vault',
    })
    try {
      await saveVaultLogin(
        paired.vaultPage,
        mockAuth.origin,
        'alice@nook.test',
        'extension-fill-password',
      )

      await lockExtensionSession(paired.context)

      const loginPage = await paired.context.newPage()
      await loginPage.goto(`${mockAuth.origin}/plain/login`)
      const widget = loginPage.locator('#nook-auth-widget')
      // A locked vault offers Unlock in place of Sign in.
      await expect(widget.getByText('Unlock Nook to continue')).toBeVisible()
      await expect(
        widget.getByTestId('nook-auth-gate-vault-status'),
      ).toHaveAttribute('data-state', 'vault-locked')
      await expect(
        widget.getByTestId('nook-auth-gate-vault-status'),
      ).toHaveText('locked')
      await expect(
        widget.getByTestId('nook-auth-gate-vault-status'),
      ).toHaveAttribute('role', 'status')
      await expect(
        widget.getByTestId('nook-auth-gate-vault-status'),
      ).toHaveAttribute('aria-live', 'polite')
      await expect(
        widget.getByText(
          'Nook is locked. Unlock it in the Nook side panel, then fill your login there.',
        ),
      ).toBeVisible()
      await expect(widget.getByRole('button', { name: 'Sign in' })).toHaveCount(
        0,
      )

      const [worker] = paired.context.serviceWorkers()
      if (!worker) throw new Error('The extension service worker is missing.')
      const openSidePanels = () =>
        worker.evaluate(
          async () =>
            (
              await chrome.runtime.getContexts({
                contextTypes: [chrome.runtime.ContextType.SIDE_PANEL],
              })
            ).length,
        )
      expect(await openSidePanels()).toBe(0)
      const pagesBeforeUnlock = paired.context.pages().length
      await widget.getByRole('button', { name: 'Unlock' }).click()
      // Chrome admits the page click as the gesture that opens the side panel.
      await expect.poll(openSidePanels).toBe(1)
      expect(paired.context.pages()).toHaveLength(pagesBeforeUnlock)
      await expect(loginPage.getByTestId('mock-auth-success')).toHaveCount(0)
      await expect(loginPage.locator('input[name="username"]')).toHaveValue('')
      await expect(loginPage.locator('input[name="password"]')).toHaveValue('')

      const unlockPage = await paired.context.newPage()
      await unlockPage.goto(
        `chrome-extension://${paired.extensionId}/popup/index.html`,
      )
      await ensurePinProtectedPopup(unlockPage)
      await expect(
        unlockPage.getByTestId('extension-toolbar-menu'),
      ).toBeVisible()
      await unlockPage.close()

      await widget.getByRole('button', { name: 'Sign in' }).click()
      await expect(loginPage.getByTestId('mock-auth-success')).toHaveText(
        'Authentication complete',
        { timeout: 20_000 },
      )
    } finally {
      await paired.context.close()
      await mockAuth.close()
    }
  })

  test('closing and reopening the auth tab keeps the live lease unlocked', async ({
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

    const paired = await launchPairedPinExtension(testInfo, {
      vaultName: 'Mock auth reopen vault',
    })
    try {
      const extensionId = paired.extensionId
      const originalAuthTab = await paired.context.newPage()
      await originalAuthTab.goto(
        `chrome-extension://${extensionId}/popup/index.html`,
      )
      await expect(
        originalAuthTab.getByTestId('extension-toolbar-menu'),
      ).toBeVisible()

      await originalAuthTab.close()

      const reopenedAuthTab = await paired.context.newPage()
      await reopenedAuthTab.goto(
        `chrome-extension://${extensionId}/popup/index.html`,
      )
      await expect(
        reopenedAuthTab.getByTestId('extension-toolbar-menu'),
      ).toBeVisible()
      await expect(
        reopenedAuthTab.locator(
          '[data-testid="companion-vault"][data-default="true"]',
        ),
      ).toContainText('Mock auth reopen vault')
      await expect(
        reopenedAuthTab.getByTestId('device-protection-pin-unlock-btn'),
      ).toHaveCount(0)
    } finally {
      await paired.context.close()
    }
  })
})
