import { expect, test } from './fixtures'
import {
  addVaultPassword,
  clearBrowserVault,
  connectLocalVault,
  disableLoginAutoUnlock,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  expectVaultPasswordStatus,
  openLoginProviderSetup,
  openStorageSettings,
  selectLoginUnlockMethod,
  UI_TIMEOUT_MS,
  unlockVaultOnLogin,
  waitForPersistedAppLog,
  wipeDeviceIdentity,
} from './helpers'

test.describe('login unlock flow (local-first)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/app/')
    await clearBrowserVault(page)
    await page.reload()
    await connectLocalVault(page)
  })

  test('shows local unlock step when vault has backup passwords', async ({
    page,
  }) => {
    await openStorageSettings(page)
    await addVaultPassword(page, 'Work backup', 'work-pass-1')
    await expectVaultPasswordStatus(page, 1, { timeout: UI_TIMEOUT_MS })

    await page.reload()
    await expect(page.getByTestId('login-gate')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await expect(page.getByTestId('login-local-vault-detected')).toBeVisible()
    await expect(page.getByTestId('login-local-unlock-step')).toBeVisible()
    await expect(page.getByTestId('login-unlock-method-keys')).toBeVisible()
    await expect(page.getByTestId('login-unlock-method-password')).toBeVisible()
    await expect(page.getByTestId('login-unlock-method-keys')).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await expect(page.getByTestId('login-password-input')).not.toBeVisible()
  })

  test('unlocks with device keys from local login step', async ({ page }) => {
    await disableLoginAutoUnlock(page)
    await page.reload()
    await expect(page.getByTestId('login-local-unlock-step')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await expect(page.getByTestId('login-unlock-method-keys')).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await page.getByTestId('unlock-vault-btn').click()
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
  })

  test('switches to backup password and shows labelled entry picker', async ({
    page,
  }) => {
    await openStorageSettings(page)
    await addVaultPassword(page, 'Personal', 'personal-pass', {
      expectedCount: 1,
    })
    await addVaultPassword(page, 'Travel', 'travel-pass', { expectedCount: 2 })

    await page.reload()
    await expect(page.getByTestId('login-local-unlock-step')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })

    await selectLoginUnlockMethod(page, 'password')
    await expect(
      page.getByTestId('login-unlock-method-password'),
    ).toHaveAttribute('aria-checked', 'true')
    const entryList = page.getByTestId('login-password-entry-list')
    await expect(
      entryList.getByRole('button', { name: 'Personal' }),
    ).toBeVisible()
    await expect(
      entryList.getByRole('button', { name: 'Travel' }),
    ).toBeVisible()
    await expect(page.getByTestId('login-password-input')).toBeVisible()
  })

  test('unlocks with a selected backup password after explicit lock', async ({
    page,
  }) => {
    await openStorageSettings(page)
    await addVaultPassword(page, 'Recovery', 'recovery-pass-99')

    await page.getByTestId('header-lock-vault-btn').click()
    await expect(page.getByTestId('login-local-unlock-step')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await expect(page.getByTestId('passkey-auth-overlay')).toBeHidden()

    await selectLoginUnlockMethod(page, 'password')
    await page
      .getByTestId('login-password-entry-list')
      .getByRole('button', { name: 'Recovery' })
      .click()
    await page.getByTestId('login-password-input').fill('recovery-pass-99')
    await page.getByTestId('unlock-vault-btn').click()

    await expect(page.getByTestId('passkey-auth-overlay')).toBeHidden()
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await waitForPersistedAppLog(page, {
      scope: 'vault-password',
      level: 'info',
      messageIncludes: 'vault unlocked with password',
    })
  })

  test('unlocks with backup password when device keys are missing', async ({
    page,
  }) => {
    await openStorageSettings(page)
    await addVaultPassword(page, 'Recovery', 'recovery-pass-99')

    await wipeDeviceIdentity(page)
    await page.reload()
    await expect(page.getByTestId('login-gate')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })

    const joinClose = page.getByTestId('join-enrollment-close')
    if (await joinClose.isVisible()) {
      await joinClose.click()
    }

    await unlockVaultOnLogin(page, {
      entryLabel: 'Recovery',
      password: 'recovery-pass-99',
    })
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
  })

  test('hides backup password option when vault has no password entries', async ({
    page,
  }) => {
    await page.reload()
    await expect(page.getByTestId('login-local-unlock-step')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await expect(page.getByTestId('login-unlock-method-fieldset')).toBeVisible()
    await expect(page.getByTestId('login-unlock-method-keys')).toBeVisible()
    await expect(
      page.getByTestId('login-unlock-method-password'),
    ).not.toBeVisible()
  })
})

test.describe('login storage provider setup', () => {
  test('hides local device from sync provider picker on create-vault screen', async ({
    page,
  }) => {
    await page.goto('/app/')
    await clearBrowserVault(page)
    await page.reload()

    await openLoginProviderSetup(page)
    await expect(page.getByTestId('provider-picker-list')).toBeVisible()
    await expect(page.getByTestId('provider-option-local')).toHaveCount(0)
    await expect(page.getByTestId('provider-option-github')).toBeVisible()
  })
})
