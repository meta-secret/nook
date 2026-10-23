import { expect, test, type Page } from '@playwright/test'
import {
  launchPairedPinExtension,
  saveVaultAuthenticator,
  saveVaultLogin,
} from './helpers/paired-pin-extension'
import { RealSidePanel } from './helpers/real-side-panel'
import { MOCK_AUTH_SECOND_TOTP_SECRET, startMockAuthServer } from './mock-auth'

/**
 * A signed-in settings page opens its "Update authenticator app" dialog as a
 * portal after load, renders the QR code asynchronously, and offers "Enter
 * code manually". The real extension must offer to save that authenticator
 * in the page widget and in the open side panel, and the saved code must
 * pass the dialog's verify step.
 */
const ENROLLED_ACCOUNT = 'alice-2fa@nook.test'
const OLD_PHONE_ACCOUNT = 'alice-old-phone@nook.test'
const ADD_FROM_PAGE = 'Add 2FA from this page'

type SetupDialogVariant = {
  readonly name: string
  readonly query: string
}

type SettingsDialogRequest = {
  readonly page: Page
  readonly url: string
}

async function openUpdateAuthenticatorDialog({
  page,
  url,
}: SettingsDialogRequest): Promise<void> {
  await page.goto(url)
  await expect(page.getByTestId('mock-auth-account-security')).toBeVisible()
  await page.waitForLoadState('networkidle')
  await page.getByTestId('mock-auth-update-authenticator').click()
  await expect(page.getByTestId('mock-auth-setup-qr')).toBeVisible()
}

async function reviewFromWidget(page: Page): Promise<void> {
  const widget = page.locator('#nook-auth-widget')
  const offer = widget.getByRole('button', { name: ADD_FROM_PAGE })
  await expect(offer).toBeVisible({ timeout: 15_000 })
  await offer.click()
  await expect(
    widget.getByRole('heading', {
      name: /Review this authenticator before continuing/,
    }),
  ).toBeVisible({ timeout: 20_000 })
}

test.describe('Authenticator setup dialog on a settings page', () => {
  test.describe.configure({ timeout: 240_000 })

  test('the open side panel offers the async QR and the saved code verifies, beside an existing authenticator', async ({
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')
    const mockAuth = await startMockAuthServer()
    const paired = await launchPairedPinExtension(testInfo, {
      vaultName: 'Setup dialog vault',
    })
    try {
      await saveVaultLogin(
        paired.vaultPage,
        mockAuth.origin,
        ENROLLED_ACCOUNT,
        'extension-fill-password',
      )
      await saveVaultAuthenticator(
        paired.vaultPage,
        'Mock Auth',
        OLD_PHONE_ACCOUNT,
        MOCK_AUTH_SECOND_TOTP_SECRET,
        mockAuth.origin,
      )
      // Open the real side panel beside the tab, then keep it open while
      // the same tab moves to the settings page, as a user would.
      const page = await paired.context.newPage()
      await page.goto(`${mockAuth.origin}/otp`)
      await page
        .locator('#nook-auth-widget')
        .getByRole('button', { name: 'Fill 2FA code' })
        .click()
      const sidePanel = await RealSidePanel.attach(paired.userDataDir)
      try {
        const panel = sidePanel.page
        await panel.getByTestId('authenticator-cancel').click()
        await expect(panel.getByTestId('authenticator-picker')).toHaveCount(0)

        const settings: SettingsDialogRequest = {
          page,
          url: `${mockAuth.origin}/settings/user`,
        }
        await openUpdateAuthenticatorDialog(settings)
        const widget = page.locator('#nook-auth-widget')
        await expect(
          widget.getByRole('button', { name: ADD_FROM_PAGE }),
        ).toBeVisible({ timeout: 15_000 })

        const panelOffer = panel.getByTestId('side-panel-add-authenticator')
        await expect(panelOffer).toBeVisible({ timeout: 15_000 })
        await panelOffer.click()
        await expect(
          panel.getByTestId('side-panel-add-authenticator-status'),
        ).toHaveAttribute('data-status', 'started')
        await expect(
          widget.getByRole('heading', {
            name: /Review this authenticator before continuing/,
          }),
        ).toBeVisible({ timeout: 20_000 })
        await expect(
          widget.getByRole('textbox', { name: 'Service' }),
        ).toHaveValue('Mock Auth')
        await expect(
          widget.getByRole('textbox', { name: 'Account' }),
        ).toHaveValue(ENROLLED_ACCOUNT)
        await widget
          .getByRole('button', { name: 'Continue enrollment' })
          .click()
        await expect(
          widget.getByText('Authenticator saved to your vault.'),
        ).toBeVisible({ timeout: 20_000 })

        // Nook vetoes code fill on account-management routes such as this
        // settings page, so the saved authenticator proves itself on the
        // site's two-factor challenge, which verifies the code it fills.
        await page.goto(`${mockAuth.origin}/2fa/verify`)
        const code = page.getByTestId('mock-auth-2fa-code')
        await expect(code).toBeVisible()
        const rows = panel
          .getByTestId('side-panel-item')
          .filter({ has: panel.getByRole('button', { name: /2FA code/ }) })
        await expect(rows.filter({ hasText: OLD_PHONE_ACCOUNT })).toBeVisible({
          timeout: 15_000,
        })
        const enrolledRow = rows.filter({ hasText: ENROLLED_ACCOUNT })
        await enrolledRow.getByTestId('side-panel-fill').click()
        await expect(code).toHaveValue(/^\d{6}$/)
        await page.getByRole('button', { name: 'Verify' }).click()
        await expect(page.getByTestId('mock-auth-2fa-accepted')).toBeVisible()
      } finally {
        await sidePanel.detach()
      }
    } finally {
      await paired.context.close()
      await mockAuth.close()
    }
  })

  const widgetVariants: readonly SetupDialogVariant[] = [
    { name: 'inline svg', query: 'qr=svg' },
    { name: 'canvas', query: 'qr=canvas' },
    // showModal() puts the dialog in the top layer and the page under it inert.
    { name: 'native modal dialog', query: 'qr=svg&dialog=native' },
  ]
  for (const variant of widgetVariants) {
    test(`the page widget reads the QR from a ${variant.name}`, async ({
      browserName,
    }, testInfo) => {
      test.skip(
        browserName !== 'chromium',
        'Chrome extensions require Chromium',
      )
      const mockAuth = await startMockAuthServer()
      const paired = await launchPairedPinExtension(testInfo, {
        vaultName: `Setup dialog ${variant.name} vault`,
      })
      try {
        const page = await paired.context.newPage()
        const settings: SettingsDialogRequest = {
          page,
          url: `${mockAuth.origin}/settings/user?${variant.query}`,
        }
        await openUpdateAuthenticatorDialog(settings)
        await reviewFromWidget(page)
        const widget = page.locator('#nook-auth-widget')
        await expect(
          widget.getByRole('textbox', { name: 'Service' }),
        ).toHaveValue('Mock Auth')
        await expect(
          widget.getByRole('textbox', { name: 'Account' }),
        ).toHaveValue(ENROLLED_ACCOUNT)
        await expect(widget.getByText(/JBSWY3DPEHPK3PXP/)).toHaveCount(0)
      } finally {
        await paired.context.close()
        await mockAuth.close()
      }
    })
  }

  test('the page widget reads the key that Enter code manually reveals', async ({
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')
    const mockAuth = await startMockAuthServer()
    const paired = await launchPairedPinExtension(testInfo, {
      vaultName: 'Setup dialog manual key vault',
    })
    try {
      const page = await paired.context.newPage()
      const settings: SettingsDialogRequest = {
        page,
        url: `${mockAuth.origin}/settings/user?qr=svg`,
      }
      await openUpdateAuthenticatorDialog(settings)
      await page.getByTestId('mock-auth-enter-code-manually').click()
      await expect(page.getByTestId('mock-auth-setup-key')).toBeVisible()
      await expect(page.getByTestId('mock-auth-setup-qr')).toHaveCount(0)
      await reviewFromWidget(page)
      const widget = page.locator('#nook-auth-widget')
      await expect(
        widget.getByRole('textbox', { name: 'Service' }),
      ).toHaveValue(new URL(mockAuth.origin).hostname)
      await widget.getByRole('button', { name: 'Continue enrollment' }).click()
      await expect(
        widget.getByText('Authenticator saved to your vault.'),
      ).toBeVisible({ timeout: 20_000 })
    } finally {
      await paired.context.close()
      await mockAuth.close()
    }
  })
})
