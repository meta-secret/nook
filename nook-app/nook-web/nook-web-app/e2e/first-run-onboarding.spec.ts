import { expect, test } from './fixtures'
import {
  answerPasskeyPrompt,
  clearBrowserVault,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  UI_TIMEOUT_MS,
} from './helpers'

test.describe('first-run onboarding', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/app/')
    await clearBrowserVault(page)
    await page.reload()
    await expect(page.getByTestId('first-vault-start')).toBeVisible({
      timeout: UI_TIMEOUT_MS * 2,
    })
  })

  test('renders the first screen from the bundled locale catalogs', async ({
    page,
  }) => {
    const start = page.getByTestId('first-vault-start')
    // Without the e2e auto-passkey, a fresh browser has no identity yet.
    await clearBrowserVault(page)
    await page.evaluate(() => {
      localStorage.setItem('nook_e2e_manual_passkey', 'true')
    })
    await page.reload()
    await expect(start).toBeVisible({ timeout: UI_TIMEOUT_MS * 2 })
    // The first screen stands alone: no hub hero, no identity card yet.
    await expect(page.getByTestId('identities-hero')).toHaveCount(0)
    await expect(start).toContainText('Local-first password & secret manager')
    await expect(start.getByRole('heading', { level: 1 })).toHaveText(
      'Keep your passwords in a vault that belongs to you',
    )
    await expect(start).toContainText(
      'Runs locally on this device — no Nook account, no master password, and no central server.',
    )
    await expect(
      start.getByTestId('first-run-create-identity-btn'),
    ).toContainText('Create your private vault')
    await expect(
      start.getByTestId('first-run-create-identity-btn'),
    ).toHaveAccessibleDescription(
      'Unlocks with Face ID, Touch ID, or a security key — nothing to memorize',
    )
    await expect(start).not.toContainText(/keyring/i)
    const returning = start.getByRole('region', {
      name: 'Already use Nook? Open your vault here',
    })
    await expect(
      returning.getByRole('button', { name: 'I have an invite link' }),
    ).toHaveAccessibleDescription('From another Nook device')
    await expect(
      returning.getByRole('button', { name: 'I have a backup' }),
    ).toHaveAccessibleDescription(
      'Restore from your cloud with a passkey or recovery words',
    )
    await expect(
      start.getByRole('button', { name: 'Check a passkey' }),
    ).toBeEnabled()
    await expect(start.getByText('How Nook works')).toBeVisible()

    await page.getByTestId('header-language-select').click()
    await page.getByTestId('header-language-option-ru').click()

    await expect(start.getByRole('heading', { level: 1 })).toHaveText(
      'Храните пароли в сейфе, который принадлежит только вам',
    )
    await expect(
      start.getByRole('region', {
        name: 'Уже пользуетесь Nook? Откройте свой сейф здесь',
      }),
    ).toBeVisible()
    await expect(start).toContainText(
      'Работает локально на этом устройстве — без аккаунта Nook, мастер-пароля и центрального сервера.',
    )
    await expect(start).not.toContainText(/связк/i)
    await expect(
      page.getByTestId('first-run-create-identity-btn'),
    ).toContainText('Создать личный сейф')
  })

  test('offers neither Sentinel nor an unrestricted join on the first screen', async ({
    page,
  }) => {
    await expect(page.getByTestId('first-vault-start')).toBeVisible()
    await expect(page.getByTestId('get-started-path-sentinel')).toHaveCount(0)
    await expect(page.getByTestId('get-started-path-join')).toHaveCount(0)
    await expect(page.getByTestId('login-enrollment-toggle')).toHaveCount(0)
  })

  test('sets up a passkey and keeps the vault on this device', async ({
    page,
  }) => {
    // Joining is its own screen; Back returns to creating the identity.
    await page.getByTestId('login-join-identity-btn').click()
    await expect(page.getByTestId('join-this-device')).toBeVisible()
    await expect(page.getByTestId('join-this-device')).not.toContainText(
      /keyring/i,
    )
    await expect(page.getByTestId('enrollment-code-input')).toBeVisible()
    await page.getByTestId('join-back').click()
    await expect(page.getByTestId('first-vault-start')).toBeVisible()

    // The passkey makes the key; no vault exists until the identity is settled.
    await page
      .getByRole('button', { name: 'Create your private vault' })
      .click()
    const protect = page.getByTestId('first-run-protect-step')
    await expect(protect).toBeVisible()
    await expect(protect).toContainText(
      'Unlock your vault with this device’s passkey',
    )
    await expect(protect).not.toContainText(/keyring/i)
    await answerPasskeyPrompt(page)
    const storage = page.getByTestId('first-run-storage-step')
    await expect(storage).toContainText('Passkey ready')
    await expect(storage).toContainText(
      'Your vault always runs locally here first. Choose whether to sync encrypted copies to your other devices.',
    )
    await expect(storage).not.toContainText(/keyring/i)
    await expect(page.getByTestId('first-run-google-sign-in')).toHaveCount(0)
    await expect(page.getByTestId('vault-panel')).toHaveCount(0)

    // Kept on this browser, the identity is named (an empty name takes the
    // suggested one); its first vault is then the person's choice.
    await storage.getByRole('button', { name: 'On this device' }).click()
    await expect(page.getByTestId('first-run-name-step')).toContainText(
      'One keyring lets your passkey open multiple vaults — like Personal and Work — and share them across your devices.',
    )
    await page.getByTestId('first-run-identity-create-btn').click()
    const vaultStep = page.getByTestId('first-run-vault-step')
    await expect(vaultStep).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(page.getByTestId('vault-panel')).toHaveCount(0)
    await vaultStep.getByTestId('login-vault-name-input').fill('Personal')
    await vaultStep.getByTestId('login-create-device-vault-btn').click()
    await expect(
      page
        .getByTestId('identity-vault-row')
        .or(page.getByTestId('vault-panel'))
        .first(),
    ).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  })
})
