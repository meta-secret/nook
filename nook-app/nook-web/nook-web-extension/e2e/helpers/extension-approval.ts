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
        const alerts = await vaultPage.getByRole('alert').allTextContents()
        return alerts.at(-1) ?? 'pending'
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
