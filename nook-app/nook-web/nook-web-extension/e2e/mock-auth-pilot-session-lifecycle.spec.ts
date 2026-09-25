import { expect, test } from '@playwright/test'
import {
  launchPairedPinExtension,
  lockExtensionSession,
  saveVaultLogin,
} from './helpers/paired-pin-extension'
import { ensurePinProtectedPopup } from './helpers/pin-device'
import { startMockAuthServer } from './mock-auth'

test.describe('PIN Pilot session lifecycle', () => {
  test.describe.configure({ timeout: 180_000 })

  test('returns to the site after Pilot unlock and waits for a fresh Continue click', async ({
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
      await expect(widget.getByText('Ready to sign in')).toBeVisible()
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
          'Unlock Nook in the Nook tab, return to the site, then select Continue with Nook again.',
        ),
      ).toBeVisible()

      const originalAuthTab = await paired.context.newPage()
      await originalAuthTab.goto(
        `chrome-extension://${paired.extensionId}/popup/index.html`,
      )
      await expect(
        originalAuthTab.getByTestId('device-protection-pin-unlock-btn'),
      ).toBeVisible()
      await expect(originalAuthTab).toHaveURL(
        `chrome-extension://${paired.extensionId}/popup/index.html`,
      )
      const pilotAuthTabPromise = paired.context.waitForEvent('page')
      await widget.getByRole('button', { name: 'Continue with Nook' }).click()
      const authTab = await pilotAuthTabPromise
      await expect(authTab).toHaveURL(
        `chrome-extension://${paired.extensionId}/popup/index.html?intent=pilot-auth`,
      )
      await expect(originalAuthTab).toHaveURL(
        `chrome-extension://${paired.extensionId}/popup/index.html`,
      )
      await expect(authTab.getByTestId('extension-device-setup')).toBeVisible()
      await expect(
        authTab.getByTestId('device-protection-pin-unlock-btn'),
      ).toBeVisible()
      await expect(loginPage.getByTestId('mock-auth-success')).toHaveCount(0)
      await expect(loginPage.locator('input[name="username"]')).toHaveValue('')
      await expect(loginPage.locator('input[name="password"]')).toHaveValue('')

      await ensurePinProtectedPopup(authTab)
      await expect(authTab.getByTestId('extension-toolbar-menu')).toBeVisible()
      await expect(
        authTab.getByText(
          'Return to the site and select Continue with Nook again to retry.',
        ),
      ).toBeVisible()
      await expect(loginPage.getByTestId('mock-auth-success')).toHaveCount(0)
      await expect(loginPage.locator('input[name="username"]')).toHaveValue('')
      await expect(loginPage.locator('input[name="password"]')).toHaveValue('')

      await widget.getByRole('button', { name: 'Continue with Nook' }).click()
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
        reopenedAuthTab.getByTestId('companion-description'),
      ).toHaveText(
        'Your protected browser identity can use secrets from Mock auth reopen vault.',
      )
      await expect(
        reopenedAuthTab.getByTestId('device-protection-pin-unlock-btn'),
      ).toHaveCount(0)
    } finally {
      await paired.context.close()
    }
  })
})
