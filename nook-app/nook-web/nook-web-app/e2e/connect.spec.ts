import { expect, test } from './fixtures'
import {
  createLocalVaultOnLogin,
  dismissSyncConflictIfVisible,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  expectAppLogMilestones,
  openLoginProviderSetup,
  reloadUnlockWithSyncProvider,
  UI_TIMEOUT_MS,
  waitForPersistedAppLog,
} from './helpers'

test.describe('vault connect flow', () => {
  test('creates local vault with device keys and opens vault', async ({
    page,
  }) => {
    await page.goto('/app/')

    await expect(page.getByTestId('login-create-vault-chooser')).toBeVisible()
    await createLocalVaultOnLogin(page)

    await expectAppLogMilestones(page, [
      {
        scope: 'wasm-connect',
        level: 'info',
        messageIncludes: 'connect complete',
      },
      {
        scope: 'vault',
        level: 'info',
        messageIncludes: 'vault session unlocked',
      },
      {
        scope: 'vault-local',
        level: 'info',
        messageIncludes: 'local vault created',
      },
    ])

    await expect(page.getByTestId('vault-panel')).toBeVisible()
    await expect(page.getByTestId('login-gate')).not.toBeVisible()
    await expect(page.getByTestId('local-only-vault-warning')).toBeVisible()
    await expect(page.getByTestId('local-only-vault-warning')).toHaveAttribute(
      'data-folded',
      'true',
    )
    await expect(
      page.getByTestId('local-only-warning-details'),
    ).not.toBeVisible()
    await page.getByTestId('local-only-warning-toggle').click()
    await expect(page.getByTestId('local-only-warning-details')).toBeVisible()
    await expect(page.getByTestId('local-only-vault-warning')).toHaveAttribute(
      'data-folded',
      'false',
    )
  })

  test('github setup keeps sync step locked until token is entered', async ({
    page,
  }) => {
    await page.goto('/app/')

    await openLoginProviderSetup(page)
    await page.getByTestId('provider-option-github').click()
    await expect(page.getByTestId('github-setup-connection-step')).toBeVisible()
    await expect(page.getByTestId('github-setup-sync-step')).toBeVisible()
    await expect(page.getByTestId('connect-provider-btn')).not.toBeVisible()
  })

  test('keeps creation and import as separate first-vault workflows', async ({
    page,
  }) => {
    await page.goto('/app/')

    await expect(page.getByTestId('login-create-vault-chooser')).toBeVisible()
    await expect(page.getByTestId('get-started-path-chooser')).toBeVisible()
    await expect(page.getByTestId('get-started-path-simple')).toBeVisible()
    await expect(page.getByTestId('get-started-path-nexus')).toBeVisible()
    await expect(page.getByTestId('get-started-path-join')).toBeVisible()
    await expect(page.getByTestId('login-vault-name-input')).toHaveCount(0)
    await expect(page.getByTestId('login-path-cloud')).toBeVisible()
    await expect(page.getByTestId('replication-mode-select')).toHaveCount(0)

    await page.getByTestId('get-started-path-simple').click()
    await expect(page.getByTestId('create-vault-wizard-create')).toBeVisible()
    await expect(page.getByTestId('login-path-cloud')).toBeVisible()
    await expect(page.getByTestId('login-vault-name-input')).toBeVisible()
    await expect(
      page.getByTestId('login-create-device-vault-btn'),
    ).toBeVisible()
    await expect(
      page.getByTestId('login-create-device-vault-btn'),
    ).toBeDisabled()
    await expect(page.getByTestId('login-connect-storage-btn')).toBeVisible()
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

  test('shows login gate on first visit', async ({ page }) => {
    await page.goto('/app/')

    await expect(page.getByTestId('login-gate')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(page.getByTestId('login-create-vault-chooser')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(page.getByTestId('vault-panel')).not.toBeVisible()
  })

  test('opens help page from header', async ({ page }) => {
    await page.goto('/app/')

    await expect(page.getByTestId('help-open-btn')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await page.getByTestId('help-open-btn').click({
      noWaitAfter: true,
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(page.getByTestId('help-page')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(page.getByTestId('help-navigation')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(page.getByTestId('help-section-local-first')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(page.getByTestId('help-section-join')).toBeVisible()
    await page.getByTestId('help-navigation').selectOption('sync')
    await expect(page.getByTestId('help-section-sync')).toBeVisible()
    const diagram = page.getByTestId('help-diagram-local-first')
    await expect(diagram).toBeVisible()
    await expect(diagram.locator('svg')).toBeVisible({ timeout: 10_000 })
    await expect(diagram).not.toContainText('flowchart TB')
    await page.getByTestId('help-close-btn').click({
      noWaitAfter: true,
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(page.getByTestId('login-gate')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
  })

  test('add provider from storage settings while connected', async ({
    page,
  }) => {
    await page.goto('/app/')
    await createLocalVaultOnLogin(page)
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })

    await page.getByTestId('vault-admin-tab').click()
    await expect(page.getByTestId('vault-admin-panel')).toBeVisible()
    await page
      .getByTestId('storage-providers-section')
      .getByRole('button')
      .first()
      .click()
    await expect(page.getByTestId('sync-providers-empty')).toBeVisible()
    await page.getByTestId('add-provider-btn').click()
    await expect(page.getByTestId('provider-picker-list')).toBeVisible()
    await expect(page.getByTestId('provider-option-local')).toHaveCount(0)
    await page.getByTestId('provider-option-github').click()
    await expect(page.getByTestId('github-token-setup')).toBeVisible()
    await page.getByTestId('cancel-add-provider-btn').click()
    await expect(page.getByTestId('provider-picker-list')).toBeVisible()
    await page.getByTestId('cancel-add-provider-btn').click()
    await expect(page.getByTestId('sync-providers-empty')).toBeVisible()
  })

  test('returns to vault login after passkey authorization on reload', async ({
    page,
  }) => {
    await page.goto('/app/')
    await createLocalVaultOnLogin(page)
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })

    await page.evaluate(() => {
      localStorage.setItem('nook_e2e_manual_passkey', 'true')
    })
    await page.reload()
    await expect(page.getByTestId('device-protection-unlock-btn')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await page.getByTestId('device-protection-unlock-btn').click()
    await expect(page.getByTestId('login-gate')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await expect(page.getByTestId('vault-panel')).not.toBeVisible()
  })

  test('stays locked after reload when user locked the vault', async ({
    page,
  }) => {
    await page.goto('/app/')
    await createLocalVaultOnLogin(page)
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })

    await page.getByTestId('header-lock-vault-btn').click()
    await expect(page.getByTestId('device-protection-unlock-btn')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })

    await waitForPersistedAppLog(page, {
      scope: 'vault-session',
      level: 'info',
      messageIncludes: 'vault locked',
    })

    await page.reload()
    await expect(page.getByTestId('login-gate')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await expect(page.getByTestId('vault-panel')).not.toBeVisible()
  })

  test('removes a saved sync provider from vault settings', async ({
    page,
  }) => {
    await page.goto('/app/')
    await createLocalVaultOnLogin(page)
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })

    await reloadUnlockWithSyncProvider(page, {
      providers: [
        {
          id: 'e2e-sync-drive',
          label: 'Google Drive (e2e)',
          fileName: 'nook-e2e-remove.yaml',
          accessToken: 'ya29.e2e_stub_access_token',
        },
      ],
    })

    await dismissSyncConflictIfVisible(page)
    await page.getByTestId('vault-admin-tab').click()
    await expect(page.getByTestId('vault-admin-panel')).toBeVisible()
    await page
      .getByTestId('storage-providers-section')
      .getByRole('button')
      .first()
      .click()
    const driveProvider = page.getByTestId('settings-provider-oauth-file')
    await expect(driveProvider).toBeVisible()

    const removeBtn = page.getByTestId('remove-provider-e2e-sync-drive')
    await expect(removeBtn).toBeEnabled({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })

    page.once('dialog', (dialog) => dialog.accept())
    await removeBtn.click()

    await expect(page.getByTestId('login-gate')).not.toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await expect(page.getByTestId('connected-badge')).toBeVisible()
    await expect(page.getByTestId('settings-provider-oauth-file')).toHaveCount(
      0,
    )
    await expect(page.getByTestId('sync-providers-empty')).toBeVisible()
  })
})
