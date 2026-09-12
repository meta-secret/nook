import { expect, type Page } from '@playwright/test'

export async function waitForExtensionPairingReady(
  vaultPage: Page,
  readSetupState: () => Promise<unknown>,
  vaultName: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        if (
          await vaultPage.getByTestId('extension-connect-approved').isVisible()
        ) {
          return 'approved'
        }
        const alerts = vaultPage.getByRole('alert')
        const alertTexts = await alerts.allTextContents()
        const alertText = ((...[v = 'pending']) => v)(alertTexts.at(-1))
        if (alertTexts.length === 0) return alertText
        const rejectionReason = ((...[v = '']) => v)(
          await alerts
            .last()
            .getAttribute('data-extension-pairing-rejection-reason'),
        )
        return rejectionReason ? `${alertText} [${rejectionReason}]` : alertText
      },
      { timeout: 15_000 },
    )
    .toBe('approved')

  await expect.poll(readSetupState).toMatchObject({
    status: 'ready',
    selectedVaultName: vaultName,
    eventCount: expect.any(Number),
  })
}
