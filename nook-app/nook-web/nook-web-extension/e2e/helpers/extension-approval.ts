import { expect, type Page } from '@playwright/test'

/**
 * Waits for a delivered approval, then for the extension's ready setup.
 * After the extension takes the grant the consent closes at once and the
 * vault announces the approval in its success toast. The in-consent approved
 * notice remains only for an approval the extension did not take, so it is
 * reported as such rather than as ready.
 */
export async function waitForExtensionPairingReady(
  vaultPage: Page,
  readSetupState: () => Promise<unknown>,
  vaultName: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const consentOpen = await vaultPage
          .getByTestId('extension-connect-consent')
          .isVisible()
        if (
          !consentOpen &&
          (await vaultPage.getByTestId('app-success').isVisible())
        ) {
          return 'approved'
        }
        if (
          await vaultPage.getByTestId('extension-connect-approved').isVisible()
        ) {
          return 'approved-not-delivered'
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

/**
 * A vault created while pairing is the browser's first vault, so its
 * first-run "ready" screen (with the sync offer) follows the approval.
 * Leave it the way a person declining the offer would.
 */
export async function leaveFirstRunReady(vaultPage: Page): Promise<void> {
  const shell = vaultPage.getByTestId('authenticated-shell')
  const ready = vaultPage.getByTestId('first-run-backup-step')
  await expect(shell.or(ready).first()).toBeVisible({ timeout: 30_000 })
  if (await ready.isVisible()) {
    await vaultPage.getByTestId('first-run-backup-skip').click()
  }
}
