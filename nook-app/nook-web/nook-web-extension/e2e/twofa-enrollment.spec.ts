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
            payload: grant,
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

  test('captures a settings-page QR only after consent and cancels without saving', async ({
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

    const mockAuth = await startMockAuthServer()
    const paired = await launchPairedPinExtension(testInfo, {
      vaultName: 'Enrollment QR vault',
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
          name: /Review this authenticator before saving/,
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

      await widget
        .getByRole('button', { name: 'Add 2FA from this page' })
        .click()
      await expect(
        widget.getByRole('button', { name: 'Save authenticator' }),
      ).toBeVisible({ timeout: 20_000 })
      await widget.getByRole('button', { name: 'Save authenticator' }).click()
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
      await otpWidget.getByRole('button', { name: 'Fill 2FA code' }).click()
      await otpWidget.getByRole('button', { name: 'Saved 2FA 1' }).click()
      await expect(
        otpPage.locator('[autocomplete="one-time-code"]'),
      ).toHaveValue(/^\d{6}$/)
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
      await paired.vaultPage.getByTestId('add-secret-btn').click()
      await paired.vaultPage.getByTestId('item-type-authenticator').click()
      await paired.vaultPage
        .getByTestId('authenticator-issuer')
        .fill('Mock Auth')
      await paired.vaultPage
        .getByTestId('authenticator-account')
        .fill('alice-2fa@nook.test')
      await paired.vaultPage
        .getByTestId('authenticator-secret')
        .fill('JBSWY3DPEHPK3PXP')
      await paired.vaultPage.getByTestId('save-secret-btn').click()
      await expect(
        paired.vaultPage
          .getByTestId('vault-group-authenticator')
          .getByTestId('secret-row'),
      ).toBeVisible({ timeout: 15_000 })

      const backupPage = await paired.context.newPage()
      await backupPage.goto(`${mockAuth.origin}/totp/backup-codes`)
      const widget = backupPage.locator('#nook-auth-widget')
      await expect(
        widget.getByRole('button', { name: 'Save backup codes' }),
      ).toBeVisible({ timeout: 15_000 })

      await widget.getByRole('button', { name: 'Save backup codes' }).click()
      await expect(
        widget.getByText('Review, edit, or remove codes before saving.'),
      ).toBeVisible({ timeout: 15_000 })
      await expect(widget.getByText('A1B2-C3D4-E5F6')).toBeVisible()

      await widget.getByRole('button', { name: 'Cancel' }).click()
      await expect(
        widget.getByRole('button', { name: 'Save backup codes' }),
      ).toBeVisible()

      await widget.getByRole('button', { name: 'Save backup codes' }).click()
      await expect(widget.getByText('A1B2-C3D4-E5F6')).toBeVisible({
        timeout: 15_000,
      })
      await widget
        .getByRole('button', { name: 'Save backup codes' })
        .last()
        .click()
      await expect(
        widget.getByRole('button', { name: 'Replace existing codes' }),
      ).toBeVisible({ timeout: 15_000 })
      await widget
        .getByRole('button', { name: 'Replace existing codes' })
        .click()
      await expect(
        widget.getByText('Backup codes saved to the selected authenticator.'),
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
    } finally {
      await paired.context.close()
      await mockAuth.close()
    }
  })
})
