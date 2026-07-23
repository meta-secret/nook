import { expect, test } from '@playwright/test'
import { launchPairedPinExtension } from './helpers/paired-pin-extension'
import { startMockAuthServer } from './mock-auth'

async function listExtensionAuthenticators(
  context: Awaited<ReturnType<typeof launchPairedPinExtension>>['context'],
): Promise<Array<{ issuer: string; account: string }>> {
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker', { timeout: 45_000 }))
  return worker.evaluate(async () => {
    await new Promise<unknown>((resolve) => {
      globalThis.chrome.runtime.sendMessage(
        { type: 'nook:ensure-extension-session-runtime' },
        resolve,
      )
    })
    const grants = await new Promise<
      Array<{
        vaultStoreId: string
        deviceId: string
        devicePublicKey: string
        deviceSigningPublicKey: string
      }>
    >((resolve) => {
      globalThis.chrome.storage.local.get(undefined, (items) => {
        const paired = Object.entries(items)
          .filter(([key]) => key.startsWith('nook:extension-pairing-grant:'))
          .map(([, value]) => value as Record<string, unknown>)
          .filter(
            (value) =>
              typeof value.vaultStoreId === 'string' &&
              typeof value.deviceId === 'string' &&
              typeof value.devicePublicKey === 'string' &&
              typeof value.deviceSigningPublicKey === 'string' &&
              Array.isArray(value.scopes) &&
              value.scopes.includes('password-filling'),
          )
          .map((value) => ({
            vaultStoreId: value.vaultStoreId as string,
            deviceId: value.deviceId as string,
            devicePublicKey: value.devicePublicKey as string,
            deviceSigningPublicKey: value.deviceSigningPublicKey as string,
          }))
        resolve(paired)
      })
    })
    const accounts: Array<{ issuer: string; account: string }> = []
    for (const grant of grants) {
      const response = (await new Promise<unknown>((resolve) => {
        globalThis.chrome.runtime.sendMessage(
          {
            type: 'nook:extension-session-list-authenticators',
            payload: { ...grant, query: '' },
          },
          resolve,
        )
      })) as {
        ok?: boolean
        accounts?: Array<{ issuer?: string; account?: string }>
      }
      if (!response?.ok || !Array.isArray(response.accounts)) continue
      for (const account of response.accounts) {
        if (
          typeof account.issuer === 'string' &&
          typeof account.account === 'string'
        ) {
          accounts.push({ issuer: account.issuer, account: account.account })
        }
      }
    }
    return accounts
  })
}

test.describe('Browser 2FA enrollment', () => {
  test.describe.configure({ timeout: 180_000 })

  test('cancels QR preview without vault write', async ({
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

    const mockAuth = await startMockAuthServer()
    const paired = await launchPairedPinExtension(testInfo, {
      vaultName: 'Enrollment QR cancel vault',
    })
    try {
      const enrollPage = await paired.context.newPage()
      await enrollPage.goto(`${mockAuth.origin}/totp/enroll`)
      await expect(enrollPage.getByTestId('mock-auth-totp-qr')).toBeVisible()

      const widget = enrollPage.locator('#nook-auth-widget')
      await expect(
        widget.getByRole('button', { name: 'Add 2FA from this page' }),
      ).toBeVisible({ timeout: 15_000 })

      await widget
        .getByRole('button', { name: 'Add 2FA from this page' })
        .click()
      await expect(
        widget.getByRole('heading', {
          name: /Review this authenticator before continuing/,
        }),
      ).toBeVisible({ timeout: 20_000 })
      await expect(widget.getByText(/Service:/)).toBeVisible()
      await expect(widget.getByText(/Account:/)).toBeVisible()
      await expect(widget.getByText(mockAuth.origin)).toBeVisible()
      await expect(widget.getByText(/JBSWY3DPEHPK3PXP/)).toHaveCount(0)

      await widget.getByRole('button', { name: 'Cancel' }).click()
      await expect(
        widget.getByRole('button', { name: 'Add 2FA from this page' }),
      ).toBeVisible()
      expect(await listExtensionAuthenticators(paired.context)).toEqual([])
    } finally {
      await paired.context.close()
      await mockAuth.close()
    }
  })

  test('stages QR, fills verify, encrypts only after Sufficient evidence', async ({
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

    const mockAuth = await startMockAuthServer()
    const paired = await launchPairedPinExtension(testInfo, {
      vaultName: 'Enrollment ceremony vault',
    })
    try {
      const enrollPage = await paired.context.newPage()
      await enrollPage.goto(`${mockAuth.origin}/totp/enroll`)
      const widget = enrollPage.locator('#nook-auth-widget')
      await expect(
        widget.getByRole('button', { name: 'Add 2FA from this page' }),
      ).toBeVisible({ timeout: 15_000 })

      await widget
        .getByRole('button', { name: 'Add 2FA from this page' })
        .click()
      await expect(
        widget.getByRole('button', { name: 'Continue enrollment' }),
      ).toBeVisible({ timeout: 20_000 })
      await widget.getByRole('button', { name: 'Continue enrollment' }).click()
      await expect(
        widget.getByText(/Verification code filled|Complete verification/i),
      ).toBeVisible({ timeout: 20_000 })
      expect(await listExtensionAuthenticators(paired.context)).toEqual([])

      await enrollPage.getByTestId('mock-auth-enroll-continue-verify').click()
      await expect(
        enrollPage.getByTestId('mock-auth-enroll-otp-input'),
      ).toBeVisible({ timeout: 10_000 })
      await expect(
        enrollPage.getByTestId('mock-auth-enroll-otp-input'),
      ).toHaveValue(/^\d{6}$/, { timeout: 15_000 })

      await enrollPage.getByRole('button', { name: 'Verify' }).click()
      await expect(enrollPage.getByTestId('mock-auth-success')).toHaveText(
        'Authentication complete',
        { timeout: 20_000 },
      )
      await expect(
        widget.getByText('Authenticator saved to your vault.'),
      ).toBeVisible({ timeout: 20_000 })

      await expect
        .poll(async () => listExtensionAuthenticators(paired.context), {
          timeout: 15_000,
        })
        .toEqual([
          {
            issuer: 'Mock Auth',
            account: 'alice-2fa@nook.test',
          },
        ])

      const otpPage = await paired.context.newPage()
      await otpPage.goto(`${mockAuth.origin}/otp`)
      const otpWidget = otpPage.locator('#nook-auth-widget')
      const authenticatorPickerPromise = paired.context.waitForEvent('page')
      await otpWidget.getByRole('button', { name: 'Fill 2FA code' }).click()
      const authenticatorPicker = await authenticatorPickerPromise
      await authenticatorPicker.waitForURL(/intent=authenticator-picker/)
      await authenticatorPicker
        .getByRole('button', { name: /Mock Auth/ })
        .click()
      await expect(
        otpPage.locator('[autocomplete="one-time-code"]'),
      ).toHaveValue(/^\d{6}$/)
      await expect(authenticatorPicker).toBeClosed()
    } finally {
      await paired.context.close()
      await mockAuth.close()
    }
  })

  test('reviews backup codes with replace semantics and no automatic save', async ({
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

    const mockAuth = await startMockAuthServer()
    const paired = await launchPairedPinExtension(testInfo, {
      vaultName: 'Enrollment backup vault',
    })
    try {
      const enrollPage = await paired.context.newPage()
      await enrollPage.goto(`${mockAuth.origin}/totp/enroll`)
      const enrollWidget = enrollPage.locator('#nook-auth-widget')
      await expect(
        enrollWidget.getByRole('button', { name: 'Add 2FA from this page' }),
      ).toBeVisible({ timeout: 15_000 })
      await enrollWidget
        .getByRole('button', { name: 'Add 2FA from this page' })
        .click()
      await expect(
        enrollWidget.getByRole('button', { name: 'Continue enrollment' }),
      ).toBeVisible({ timeout: 20_000 })
      await enrollWidget
        .getByRole('button', { name: 'Continue enrollment' })
        .click()
      await expect(
        enrollWidget.getByText(
          /Verification code filled|Complete verification/i,
        ),
      ).toBeVisible({ timeout: 20_000 })
      await enrollPage.getByTestId('mock-auth-enroll-continue-verify').click()
      await expect(
        enrollPage.getByTestId('mock-auth-enroll-otp-input'),
      ).toHaveValue(/^\d{6}$/, { timeout: 15_000 })
      await enrollPage.getByRole('button', { name: 'Verify' }).click()
      await expect(enrollPage.getByTestId('mock-auth-success')).toHaveText(
        'Authentication complete',
        { timeout: 20_000 },
      )
      await expect(
        enrollWidget.getByText('Authenticator saved to your vault.'),
      ).toBeVisible({ timeout: 20_000 })
      await expect
        .poll(async () => listExtensionAuthenticators(paired.context), {
          timeout: 15_000,
        })
        .toEqual([
          {
            issuer: 'Mock Auth',
            account: 'alice-2fa@nook.test',
          },
        ])

      const backupPage = await paired.context.newPage()
      await backupPage.goto(`${mockAuth.origin}/totp/backup-codes`)
      const widget = backupPage.locator('#nook-auth-widget')
      await expect(
        widget.getByRole('button', { name: 'Save backup codes' }),
      ).toBeVisible({ timeout: 15_000 })

      // CTA opens the review UI; the confirm control reuses the same label.
      await widget.getByRole('button', { name: 'Save backup codes' }).click()
      await expect(widget.locator('textarea')).toBeVisible({ timeout: 15_000 })
      await widget.getByRole('button', { name: 'Save backup codes' }).click()

      const replaceButton = widget.getByRole('button', {
        name: 'Replace existing codes',
      })
      const authenticatorChoice = widget.getByRole('button', {
        name: 'Saved 2FA 1',
      })
      await expect(replaceButton.or(authenticatorChoice)).toBeVisible({
        timeout: 15_000,
      })
      if (await authenticatorChoice.isVisible()) {
        await authenticatorChoice.click()
      }
      await expect(replaceButton).toBeVisible({ timeout: 15_000 })
      await expect(
        widget.getByRole('button', { name: 'Save backup codes' }),
      ).toHaveCount(0)

      await replaceButton.click()
      await expect(
        widget.getByText(/backup codes saved|резервные коды сохранены/i),
      ).toBeVisible({ timeout: 20_000 })
    } finally {
      await paired.context.close()
      await mockAuth.close()
    }
  })
})
