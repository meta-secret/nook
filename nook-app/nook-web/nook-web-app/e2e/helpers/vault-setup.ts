import { expect, type Page } from '@playwright/test'
import { ENROLLMENT_UNLOCK_TIMEOUT_MS } from './environment'
import { disableVaultIdleLock, waitForStorageChainIdle } from './vault-runtime'

export async function createLocalVaultOnLogin(
  page: Page,
  vaultName = 'Test vault',
  readyTestId = 'vault-panel',
) {
  const chooser = page.getByTestId('login-create-vault-chooser')
  await expect(chooser).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })

  const finalStep = page.getByTestId('create-vault-wizard-create')
  if (!(await finalStep.isVisible())) {
    const simplePath = page.getByTestId('get-started-path-simple')
    await expect(simplePath).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await simplePath.click()
    await expect(finalStep).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
  }

  const nameInput = page.getByTestId('login-vault-name-input')
  await expect(nameInput).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await expect(nameInput).toBeEnabled({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await nameInput.fill(vaultName, { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })

  const createButton = page.getByTestId('login-create-device-vault-btn')
  await expect(createButton).toBeEnabled({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await createButton.click({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })

  // Deferred passkey: empty create may show the top-right overlay first.
  const passkeyOverlay = page.getByTestId('passkey-auth-overlay')
  const readySurface = page.getByTestId(readyTestId)
  const vaultError = page.getByTestId('vault-error')
  await expect
    .poll(
      async () =>
        (await passkeyOverlay.isVisible()) ||
        (await readySurface.isVisible()) ||
        (await vaultError.isVisible()),
      { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    .toBe(true)
  if (await vaultError.isVisible()) {
    throw new Error(
      `Local vault creation failed: ${await vaultError.innerText()}`,
    )
  }
  if (await passkeyOverlay.isVisible()) {
    const createChoice = page.getByTestId('device-protection-create-new-choice')
    if (await createChoice.isVisible()) {
      await createChoice.click({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
    }
    const setupBtn = page.getByTestId('device-protection-setup-btn')
    const unlockBtn = page.getByTestId('device-protection-unlock-btn')
    if (await setupBtn.isVisible()) {
      await setupBtn.click({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
    } else if (await unlockBtn.isVisible()) {
      await unlockBtn.click({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
    }
  }

  await expect(readySurface).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await disableVaultIdleLock(page)
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            !(
              window as Window & {
                __nookVault?: { isVerifying?: boolean }
              }
            ).__nookVault?.isVerifying,
        ),
      { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    .toBe(true)
  await waitForStorageChainIdle(page)
  await disableVaultIdleLock(page)
}
