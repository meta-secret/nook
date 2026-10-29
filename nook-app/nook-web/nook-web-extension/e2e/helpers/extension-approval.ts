import { expect, type Page } from '@playwright/test'

/**
 * A connect page on a browser without a keyring runs the website's own first
 * run: Create identity, then the website's own passkey makes its key (the
 * protect step, or the overlay elsewhere, asks for it). The extension never
 * lends its key; the consent that follows approves the extension as another
 * app of that keyring.
 */
export async function createWebsiteIdentityForConnect(
  vaultPage: Page,
): Promise<void> {
  await vaultPage.getByTestId('first-run-create-identity-btn').click()
  const protect = vaultPage
    .getByTestId('first-run-protect-step')
    .or(vaultPage.getByTestId('passkey-auth-overlay'))
  const consent = vaultPage.getByTestId('extension-connect-consent')
  await expect(protect.or(consent).first()).toBeVisible({ timeout: 30_000 })
  if (!(await consent.isVisible())) {
    const createChoice = vaultPage.getByTestId(
      'device-protection-create-new-choice',
    )
    if (await createChoice.isVisible()) await createChoice.click()
    await vaultPage.getByTestId('device-protection-setup-btn').click()
  }
  await expect(consent).toBeVisible({ timeout: 30_000 })
}

/**
 * Waits for a delivered approval, then for the extension's ready setup.
 * After the extension takes the grant the consent closes at once and the page
 * moves on (the identities, or the first vault's ready step). A failure keeps
 * the consent open with its alert. The in-consent approved notice remains only
 * for an approval the extension did not take, so it is reported by name. The
 * vault's success toast is not a signal: it lasts five seconds and the first
 * vault's ready step renders no status bar for it. The extension's own ready
 * setup, polled next, proves the delivery.
 */
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
          return 'approved-not-delivered'
        }
        const consentOpen = await vaultPage
          .getByTestId('extension-connect-consent')
          .isVisible()
        const alerts = vaultPage.getByRole('alert')
        const alertTexts = await alerts.allTextContents()
        if (!consentOpen && alertTexts.length === 0) return 'approved'
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

  await nameFirstIdentityHere(vaultPage, vaultName)
  await expect.poll(readSetupState).toMatchObject({
    status: 'ready',
    selectedVaultName: vaultName,
    eventCount: expect.any(Number),
  })
}

/**
 * Pairing while the browser has no identity runs first-run setup: once the
 * consent closes, setup offers a sync provider. Keep the identity on this
 * browser the way a person declining a provider would, and name it; its
 * first vault takes the name the extension then selects. A browser that
 * already had an identity goes straight on.
 */
async function nameFirstIdentityHere(
  vaultPage: Page,
  vaultName: string,
): Promise<void> {
  const syncStep = vaultPage.getByTestId('first-run-sync-step')
  const settled = syncStep
    .or(vaultPage.getByTestId('authenticated-shell'))
    .or(vaultPage.getByTestId('identities-workspace'))
  await expect(settled.first()).toBeVisible({ timeout: 30_000 })
  if (!(await syncStep.isVisible())) return
  await vaultPage.getByTestId('first-run-sync-skip').click()
  await vaultPage.getByTestId('first-run-identity-name-input').fill(vaultName)
  await vaultPage.getByTestId('first-run-identity-create-btn').click()
  // A new identity asks about its first vault; one that already has a vault
  // goes straight on.
  const vaultStep = vaultPage.getByTestId('first-run-vault-step')
  await expect(
    vaultStep
      .or(vaultPage.getByTestId('authenticated-shell'))
      .or(vaultPage.getByTestId('identities-workspace'))
      .first(),
  ).toBeVisible({ timeout: 30_000 })
  if (!(await vaultStep.isVisible())) return
  await vaultStep.getByTestId('login-vault-name-input').fill(vaultName)
  await vaultStep.getByTestId('login-create-device-vault-btn').click()
}

/**
 * A vault created while pairing is the browser's first vault; setup ends on
 * the identities hub, which renders no authenticated vault shell. The open
 * vault's row on its card shows that setup has finished.
 */
export async function leaveFirstRunReady(vaultPage: Page): Promise<void> {
  const shell = vaultPage.getByTestId('authenticated-shell')
  const openRow = vaultPage.locator(
    '[data-testid="identity-vault-row"][data-state="open"]',
  )
  await expect(shell.or(openRow).first()).toBeVisible({ timeout: 30_000 })
}
