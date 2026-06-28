import { expect, test } from '@playwright/test'
import {
  createLocalVaultOnLogin,
  DEFAULT_LOCAL_VAULT_PASSWORD,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  openLegacyProviderSetup,
  UI_TIMEOUT_MS,
  waitForEngine,
} from './helpers'

test.describe('vault connect flow', () => {
  test('creates local vault with master password and opens vault', async ({
    page,
  }) => {
    await page.goto('/')

    await expect(page.getByTestId('login-create-vault-form')).toBeVisible()
    await createLocalVaultOnLogin(page)

    await expect(page.getByTestId('vault-panel')).toBeVisible()
    await expect(page.getByTestId('login-gate')).not.toBeVisible()
  })

  test('shows error when github mode has no pat', async ({ page }) => {
    await page.goto('/')

    await openLegacyProviderSetup(page)
    await page.getByTestId('provider-option-github').click()
    const connectButton = await waitForEngine(page)
    await connectButton.click()

    await expect(page.getByTestId('vault-error')).toContainText(
      'Enter a GitHub personal access token',
    )
  })

  test('create vault button stays disabled until passwords match', async ({
    page,
  }) => {
    await page.goto('/')

    const createBtn = page.getByTestId('login-create-vault-btn')
    await expect(createBtn).toBeDisabled()
    await page.getByTestId('login-create-password-input').fill('short')
    await expect(createBtn).toBeDisabled()
    await page
      .getByTestId('login-create-password-confirm')
      .fill('different-password-1')
    await expect(createBtn).toBeDisabled()
    await page.getByTestId('login-create-password-input').fill('valid-password-1')
    await page
      .getByTestId('login-create-password-confirm')
      .fill('valid-password-1')
    await expect(createBtn).toBeEnabled()
  })

  test('shows login gate on first visit', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByTestId('login-gate')).toBeVisible()
    await expect(page.getByTestId('login-create-vault-form')).toBeVisible()
    await expect(page.getByTestId('login-legacy-provider-setup-link')).toBeVisible()
    await expect(page.getByTestId('login-enrollment-toggle')).toBeVisible()
    await expect(
      page.getByTestId('login-unlock-method-fieldset'),
    ).not.toBeVisible()
    await expect(page.getByTestId('vault-panel')).not.toBeVisible()
    await expect(page.getByTestId('product-intro')).toBeVisible()
    await expect(page.getByTestId('github-source-link')).toHaveAttribute(
      'href',
      'https://github.com/meta-secret/nook',
    )
  })

  test('opens help page from header', async ({ page }) => {
    await page.goto('/')

    await page.getByTestId('help-open-btn').click()
    await expect(page.getByTestId('help-page')).toBeVisible()
    await expect(page.getByTestId('help-navigation')).toBeVisible()
    await expect(page.getByTestId('help-section-decentralized')).toBeVisible()
    await expect(page.getByTestId('help-section-join')).toBeVisible()
    await page.getByTestId('help-navigation').selectOption('device-keys')
    await expect(page.getByTestId('help-section-device-keys')).toBeVisible()
    await page.getByTestId('help-close-btn').click()
    await expect(page.getByTestId('login-gate')).toBeVisible()
  })

  test('add provider from storage settings while connected', async ({
    page,
  }) => {
    await page.goto('/')
    await createLocalVaultOnLogin(page)
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })

    await page.getByTestId('vault-settings-tab').click()
    await expect(page.getByTestId('settings-providers-list')).toBeVisible()
    await page.getByTestId('add-provider-btn').click()
    await expect(page.getByTestId('provider-picker-list')).toBeVisible()
    await page.getByTestId('provider-option-github').click()
    await expect(page.getByTestId('github-token-setup')).toBeVisible()
    await page.getByTestId('cancel-add-provider-btn').click()
    await expect(page.getByTestId('provider-picker-list')).toBeVisible()
    await page.getByTestId('cancel-add-provider-btn').click()
    await expect(page.getByTestId('settings-providers-list')).toBeVisible()
  })

  test('unlock local vault with master password after reload', async ({
    page,
  }) => {
    await page.goto('/')
    await createLocalVaultOnLogin(page)
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })

    await page.reload()
    await expect(page.getByTestId('login-local-vault-detected')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await page.getByTestId('login-master-password-input').fill(DEFAULT_LOCAL_VAULT_PASSWORD)
    await page.getByTestId('unlock-vault-btn').click()
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
  })

  test('removes a saved provider from vault settings', async ({ page }) => {
    await page.goto('/')
    await createLocalVaultOnLogin(page)
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })

    await page.getByTestId('vault-settings-tab').click()
    const localProvider = page.getByTestId('settings-provider-local')
    await expect(localProvider).toBeVisible()

    const providerId = await localProvider.evaluate((el) => {
      const row = el.closest('li')
      const removeBtn = row?.querySelector('[data-testid^="remove-provider-"]')
      return removeBtn
        ?.getAttribute('data-testid')
        ?.replace('remove-provider-', '')
    })
    expect(providerId).toBeTruthy()

    page.once('dialog', (dialog) => dialog.accept())
    await page.getByTestId(`remove-provider-${providerId}`).click()

    await expect(page.getByTestId('login-gate')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await expect(page.getByTestId('login-local-vault-detected')).toBeVisible()
    await expect(page.getByTestId('settings-provider-local')).toHaveCount(0)
  })
})
