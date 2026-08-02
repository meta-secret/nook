import { expect, test } from './fixtures'
import {
  addVaultPassword,
  connectLocalVault,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  installPasskeyMock,
} from './helpers'

test.describe('devices and access dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('nook_e2e_manual_passkey', 'true')
    })
    await installPasskeyMock(page)
  })

  test('is available before any vault and lets the suggestion stay dismissed', async ({
    page,
  }) => {
    await page.goto('/app/')

    await expect(page.getByTestId('devices-access-nudge')).toBeVisible()
    await page.getByTestId('devices-access-nudge-review').click()
    await expect(page.getByTestId('devices-access-back')).toBeFocused()
    await page.getByTestId('devices-access-back').click()
    await expect(page.getByTestId('devices-access-nudge-review')).toBeFocused()

    // Dismissing removes the whole suggestion, so the checkbox never settles
    // into a checked state Playwright could verify with `check()`.
    await page.getByTestId('devices-access-dont-show-again').click()
    await expect(page.getByTestId('devices-access-nudge')).toBeHidden()
    await expect(page.getByTestId('login-devices-access')).toBeFocused()

    await page.getByTestId('login-devices-access').click()
    await expect(page.getByTestId('devices-access-back')).toBeFocused()
    const dashboard = page.getByTestId('devices-access-dashboard')
    await expect(dashboard).toBeVisible()
    await expect(dashboard).toContainText('Not prepared')
    // An unprepared browser previews the chain it is about to build instead of
    // offering evidence it cannot have yet.
    const preview = page.getByTestId('devices-access-chain-preview')
    // Passkey and PIN setup are both still ahead, so the preview promises
    // neither.
    await expect(preview).toContainText('Unlock')
    await expect(preview).not.toContainText('Passkey')
    await expect(preview).toContainText('unlocks')
    await expect(preview).toContainText('Device key')
    await expect(preview).toContainText('opens')
    await expect(preview).toContainText('Vaults')
    await expect(page.getByTestId('devices-access-chain')).toHaveCount(0)
    await expect(
      page.getByTestId('devices-access-prepare-browser'),
    ).toBeVisible()

    await page.getByTestId('device-protection-create-new-choice').click()
    await page
      .getByTestId('device-protection-label-input')
      .fill('Dashboard focus passkey')
    await page.getByTestId('device-protection-setup-btn').click()
    await expect(page.getByTestId('devices-access-node-unlock')).toBeFocused({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await page.getByTestId('devices-access-back').click()
    await expect(page.getByTestId('login-devices-access')).toBeFocused()

    await page.reload()
    await expect(page.getByTestId('devices-access-nudge')).toHaveCount(0)
    await expect(page.getByTestId('login-devices-access')).toBeVisible()
  })

  test('walks the access chain from passkey to device key to vaults', async ({
    page,
  }) => {
    await connectLocalVault(page)
    await expect(page.getByTestId('devices-access-nudge')).toHaveCount(0)
    await addVaultPassword(
      page,
      'Emergency recovery',
      'correct horse battery staple',
    )

    await page.getByTestId('vault-devices-access-tab').click()
    const dashboard = page.getByTestId('devices-access-dashboard')
    await expect(dashboard).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(
      page.getByTestId('devices-access-identity-state'),
    ).toContainText('Identity unlocked')
    await expect(page.getByTestId('devices-access-rail')).toContainText(
      'Passkey · recoverable identity',
    )

    const unlockNode = page.getByTestId('devices-access-node-unlock')
    const deviceKeyNode = page.getByTestId('devices-access-node-device-key')
    const vaultsNode = page.getByTestId('devices-access-node-vaults')
    await expect(page.getByTestId('devices-access-chain')).toContainText(
      'unlocks',
    )
    await expect(unlockNode).toHaveAttribute('aria-selected', 'true')
    await expect(deviceKeyNode).toContainText('This browser')
    await expect(vaultsNode).toContainText('1 of 1')
    // The drawn connector is decorative, so each link's own name has to carry
    // the relation for anyone who never sees the schematic.
    await expect(deviceKeyNode).toHaveAccessibleName(/unlocks/)
    await expect(vaultsNode).toHaveAccessibleName(/opens/)

    // The first link opens selected: one passkey fingerprint, and the same
    // fingerprint on its node, so the relationship and the evidence agree.
    const panel = page.getByTestId('devices-access-panel')
    await expect(panel).toContainText('Passkey · recoverable identity')
    const credentialFingerprint = await page
      .getByTestId('devices-access-credential-id')
      .innerText()
    expect(credentialFingerprint).not.toBe('Unknown')
    await expect(unlockNode).toContainText(credentialFingerprint)
    const aaguidRow = panel.getByText('Authenticator AAGUID', { exact: true })
    await expect(aaguidRow).toBeHidden()
    await page.getByTestId('devices-access-browser-reported').click()
    await expect(aaguidRow).toBeVisible()
    await expect(panel).toContainText('Built into this platform')
    await expect(panel).toContainText('Backed up or synced')
    await expect(panel).toContainText('Nearby device or phone')
    await expect(panel).toContainText('Built into this device')
    await expect(panel).not.toContainText('hybrid, internal')
    await expect(panel).toContainText('01010101-0101-0101-0101-010101010101')

    // Arrow keys walk the chain, and the panel follows the focused link.
    await unlockNode.press('ArrowRight')
    await expect(deviceKeyNode).toBeFocused()
    await expect(deviceKeyNode).toHaveAttribute('aria-selected', 'true')
    await expect(panel).toContainText('Browser device key')
    const deviceIdentifier = await page
      .getByTestId('devices-access-device-id')
      .innerText()
    expect(deviceIdentifier).not.toBe('Unknown')
    await expect(deviceKeyNode).toContainText(deviceIdentifier)
    await expect(panel).toContainText('A backup password is different')

    await deviceKeyNode.press('ArrowRight')
    await expect(vaultsNode).toBeFocused()
    await expect(panel).toContainText('Vaults known to this device key')
    await expect(page.getByTestId('devices-access-vaults')).toContainText(
      'Access verified',
    )
    const vaultIdentifier = panel
      .locator('details')
      .filter({ hasText: 'Vault identifier' })
    await expect(vaultIdentifier.locator('p')).toBeHidden()
    await vaultIdentifier.getByText('Vault identifier', { exact: true }).click()
    await expect(vaultIdentifier.locator('p')).toBeVisible()
    await expect(
      page.getByTestId('devices-access-current-vault'),
    ).toContainText('Emergency recovery')
    const memberDetails = page
      .getByTestId('devices-access-member-details')
      .first()
    await expect(memberDetails.locator('p')).toBeHidden()
    await memberDetails.getByText('Device identifier', { exact: true }).click()
    await expect(memberDetails.locator('p')).toBeVisible()

    await panel.getByRole('button', { name: 'Manage enrolled devices' }).click()
    await expect(
      page.getByTestId('vault-devices-section').locator('button').first(),
    ).toBeFocused()
    await page.getByTestId('vault-devices-access-tab').click()
    await vaultsNode.click()
    await panel.getByRole('button', { name: 'Manage backup passwords' }).click()
    await expect(
      page.getByTestId('vault-unlock-section').locator('button').first(),
    ).toBeFocused()
    await page.getByTestId('vault-devices-access-tab').click()

    await page.getByTestId('devices-access-back').click()
    await expect(page.getByTestId('vault-devices-access-tab')).toBeFocused()
  })

  test('keeps the passkey provider reminder editable and recovers from a failed save', async ({
    page,
  }) => {
    await connectLocalVault(page)
    await page.getByTestId('vault-devices-access-tab').click()
    await expect(page.getByTestId('devices-access-dashboard')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })

    await page
      .getByTestId('devices-access-provider-label')
      .fill('Bitwarden family vault')
    await page.getByTestId('devices-access-provider-save').click()
    await expect(page.getByTestId('devices-access-provider-label')).toHaveValue(
      'Bitwarden family vault',
    )
    await expect(
      page.getByTestId('devices-access-provider-label'),
    ).toBeFocused()

    await page
      .getByTestId('devices-access-provider-label')
      .fill('Proton Pass family vault')
    // The reminder is written before the dashboard re-reads its snapshot, so
    // failing the next snapshot read exercises "saved, but reload failed".
    await page.evaluate(() => {
      const manager = (
        window as Window & {
          __nookVault?: {
            requireManager(): { deviceAccessSnapshotRequest: () => unknown }
          }
        }
      ).__nookVault?.requireManager()
      if (!manager) throw new Error('Vault manager is not exposed')
      const original = manager.deviceAccessSnapshotRequest
      manager.deviceAccessSnapshotRequest = () => {
        manager.deviceAccessSnapshotRequest = original
        throw new Error('Forced dashboard reload failure')
      }
    })
    await page.getByTestId('devices-access-provider-save').click()
    await expect(page.getByTestId('devices-access-retry')).toBeFocused()
    await page.getByTestId('devices-access-retry').click()
    await expect(page.getByTestId('devices-access-provider-label')).toHaveValue(
      'Proton Pass family vault',
    )

    // Selecting another link while the save is re-reading the snapshot unmounts
    // the input the save would have refocused, so focus has to follow the link.
    await page.evaluate(() => {
      const scope = window as Window & {
        __nookVault?: {
          requireManager(): { deviceAccessSnapshotRequest: () => unknown }
        }
        __nookReloadSettled?: boolean
      }
      const manager = scope.__nookVault?.requireManager()
      if (!manager) throw new Error('Vault manager is not exposed')
      scope.__nookReloadSettled = false
      const original = manager.deviceAccessSnapshotRequest
      manager.deviceAccessSnapshotRequest = () => {
        manager.deviceAccessSnapshotRequest = original
        const request = original.call(manager) as {
          resolve: () => Promise<unknown>
        }
        const resolve = request.resolve.bind(request)
        request.resolve = async () => {
          await new Promise((settle) => setTimeout(settle, 750))
          const snapshot = await resolve()
          scope.__nookReloadSettled = true
          return snapshot
        }
        return request
      }
    })
    await page.getByTestId('devices-access-provider-label').fill('1Password')
    await page.getByTestId('devices-access-provider-save').click()
    await page.getByTestId('devices-access-node-vaults').click()
    await page.waitForFunction(
      () =>
        (window as Window & { __nookReloadSettled?: boolean })
          .__nookReloadSettled === true,
    )
    await expect(page.getByTestId('devices-access-node-vaults')).toBeFocused()
  })

  test('a locked browser identity keeps last-known vault access without vault contents', async ({
    page,
  }) => {
    await connectLocalVault(page)
    await page.getByTestId('vault-devices-access-tab').click()
    await expect(page.getByTestId('devices-access-dashboard')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })

    await page.getByTestId('header-lock-vault-btn').click()
    await page.getByTestId('login-devices-access').click()
    await expect(
      page.getByTestId('devices-access-identity-state'),
    ).toContainText('Identity locked')
    await page.getByTestId('devices-access-node-vaults').click()
    await expect(page.getByTestId('devices-access-vaults')).toContainText(
      'Access verified',
    )
    await expect(page.getByTestId('devices-access-current-vault')).toHaveCount(
      0,
    )
  })
})
