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
  UI_TIMEOUT_MS,
  unlockVaultOnLogin,
  unlockWithCardPassword,
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

  test('offers the backup password on the locked identity card', async ({
    page,
  }) => {
    await openStorageSettings(page)
    await addVaultPassword(page, 'Work backup', 'work-pass-1')
    await expectVaultPasswordStatus(page, 1, { timeout: UI_TIMEOUT_MS })

    await disableLoginAutoUnlock(page)
    await page.reload()
    await expect(page.getByTestId('login-gate')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    const card = page.getByTestId('identity-card').first()
    await expect(card.getByTestId('identity-vault-row')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await expect(card.getByTestId('identity-unlock')).toBeVisible()
    await expect(page.getByTestId('card-password-input')).toHaveCount(0)
    // The vault's row opens its panel, which offers the passphrase.
    await card.getByTestId('identity-vault-row').first().click()
    await expect(page.getByTestId('vault-panel-passphrase')).toBeVisible()
    await expect(page.getByTestId('card-password-input')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
  })

  test('unlocks with PRF-enabled device keys from local login step', async ({
    page,
  }) => {
    await disableLoginAutoUnlock(page)
    await page.reload()
    const vaultRow = page.getByTestId('identity-vault-row').first()
    await expect(vaultRow).toBeVisible({ timeout: UI_TIMEOUT_MS })
    const prfEnabledAfterReload = await page.evaluate(async () => {
      const credential: unknown = await navigator.credentials.get({
        publicKey: {
          challenge: new Uint8Array([1]),
          extensions: { prf: { eval: { first: new Uint8Array([2]) } } },
        },
      })
      if (typeof credential !== 'object' || Object(credential) !== credential) {
        throw new Error('Expected a public-key credential.')
      }
      const methodValue: unknown = Object.getOwnPropertyDescriptor(
        credential,
        'getClientExtensionResults',
      )?.value
      if (typeof methodValue !== 'function') {
        throw new Error('Expected a public-key extension result method.')
      }
      type CredentialMethod = {
        call: (thisArg: unknown, ...args: never[]) => unknown
      }
      const method: CredentialMethod = methodValue
      const extensionResults: unknown = method.call(credential)
      if (
        typeof extensionResults !== 'object' ||
        Object(extensionResults) !== extensionResults
      ) {
        throw new Error('Expected public-key extension results.')
      }
      const prf: unknown = Object.getOwnPropertyDescriptor(
        extensionResults,
        'prf',
      )?.value
      if (typeof prf !== 'object' || Object(prf) !== prf) return false
      const enabled: unknown = Object.getOwnPropertyDescriptor(
        prf,
        'enabled',
      )?.value
      return typeof enabled === 'boolean' ? enabled : false
    })
    expect(prfEnabledAfterReload).toBe(true)
    await unlockVaultOnLogin(page)
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
  })

  test('lets the card choose between labelled backup passwords', async ({
    page,
  }) => {
    await openStorageSettings(page)
    await addVaultPassword(page, 'Personal', 'personal-pass', {
      expectedCount: 1,
    })
    await addVaultPassword(page, 'Travel', 'travel-pass', { expectedCount: 2 })

    await disableLoginAutoUnlock(page)
    await page.reload()
    const open = page.getByTestId('identity-vault-row').first()
    await expect(open).toBeVisible({ timeout: UI_TIMEOUT_MS })
    await open.click()
    const entries = page.getByTestId('card-password-entry')
    await expect(entries.locator('option')).toHaveText(['Personal', 'Travel'])
    await expect(page.getByTestId('card-password-input')).toBeVisible()
  })

  test('unlocks with a selected backup password after explicit lock', async ({
    page,
  }) => {
    await openStorageSettings(page)
    await addVaultPassword(page, 'Recovery', 'recovery-pass-99')

    await page.getByTestId('header-lock-vault-btn').click()
    await expect(page.getByTestId('login-gate')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await expect(page.getByTestId('passkey-auth-overlay')).toBeHidden()

    await unlockWithCardPassword(page, { password: 'recovery-pass-99' })

    await expect(page.getByTestId('passkey-auth-overlay')).toBeHidden()
    await expect(page.getByTestId('vault-admin-panel')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(page).toHaveURL(/\/identity\/passwords$/)
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
    await expect
      .poll(() =>
        page.evaluate(() =>
          ((v) => (v ? v : ''))(
            (
              window as Window & {
                __nookVault?: { deviceId?: string }
              }
            ).__nookVault?.deviceId,
          ),
        ),
      )
      .toBe('')

    const joinClose = page.getByTestId('join-enrollment-close')
    if (await joinClose.isVisible()) {
      await joinClose.click()
    }

    await unlockVaultOnLogin(page, { password: 'recovery-pass-99' })
    await expect(page.getByTestId('vault-admin-panel')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(page).toHaveURL(/\/identity\/passwords$/)
  })

  test('says so when the vault has no passphrase', async ({ page }) => {
    await disableLoginAutoUnlock(page)
    await page.reload()
    const open = page.getByTestId('identity-vault-row').first()
    await expect(open).toBeVisible({ timeout: UI_TIMEOUT_MS })
    await open.click()
    await expect(page.getByTestId('card-password-caption')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await expect(page.getByTestId('card-password-input')).toHaveCount(0)
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
