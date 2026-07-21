import { expect, test } from './fixtures'
import { VaultAccessStatus } from '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm.js'
import {
  authorizeDeviceProtection,
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
    await expect(page.getByTestId('extension-install-setup')).toBeVisible()
    await expect(page.getByTestId('extension-install-setup')).toHaveAttribute(
      'data-status',
      'not_installed',
    )
    await expect(page.getByTestId('extension-install-setup-cta')).toBeVisible()
    await expect(page.getByTestId('vault-security-guide')).toBeVisible()
    await expect(page.getByTestId('vault-security-guide')).toHaveAttribute(
      'data-folded',
      'true',
    )
    await expect(page.getByTestId('vault-security-guide')).toHaveAttribute(
      'data-recommendations',
      '2',
    )
    await expect(page.getByTestId('security-guide-details')).not.toBeVisible()
    await page.getByTestId('security-guide-toggle').click()
    await expect(page.getByTestId('security-guide-details')).toBeVisible()
    await expect(page.getByTestId('security-guide-sync-provider')).toBeVisible()
    await expect(page.getByTestId('security-guide-device')).toBeVisible()
    await expect(page.getByTestId('vault-security-guide')).toHaveAttribute(
      'data-folded',
      'false',
    )
    await page.getByTestId('security-guide-add-device').click()
    await expect(page.getByTestId('onboard-device-panel')).toBeVisible()
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
    await expect(page.getByTestId('get-started-path-sentinel')).toBeVisible()
    await expect(page.getByTestId('get-started-path-join')).toHaveCount(0)
    await expect(page.getByTestId('login-path-cloud')).toBeVisible()
    await expect(page.getByTestId('replication-mode-select')).toHaveCount(0)

    await page.getByTestId('get-started-path-simple').click()
    await expect(page.getByTestId('create-vault-wizard-create')).toBeVisible()
    await page.getByTestId('login-vault-name-input').fill('Workflow vault')
    await expect(page.getByTestId('login-path-cloud')).toHaveCount(0)
    await expect(
      page.getByTestId('login-create-device-vault-btn'),
    ).toBeVisible()
    await expect(
      page.getByTestId('login-create-device-vault-btn'),
    ).toBeEnabled()
    await page.getByTestId('create-vault-wizard-back').click()
    await expect(page.getByTestId('get-started-path-chooser')).toBeVisible()
    await expect(page.getByTestId('login-connect-storage-btn')).toBeVisible()
    await page.getByTestId('login-connect-storage-btn').click()
    await expect(page.getByTestId('login-provider-setup')).toBeVisible()
    await expect(
      page.getByTestId('create-vault-wizard-create'),
    ).not.toBeVisible()
    await expect(page.getByTestId('vault-panel')).not.toBeVisible()
    await expect(page.getByTestId('github-source-link')).toHaveAttribute(
      'href',
      'https://github.com/meta-secret/nook',
    )
  })

  test('does not create a new vault when open existing finds an empty provider', async ({
    page,
  }) => {
    await page.goto('/app/')
    await openLoginProviderSetup(page)

    const blocked = await page.evaluate(async (status: VaultAccessStatus) => {
      const vault = (
        window as Window & {
          __nookVault?: {
            handleRemoteVaultAssessStatus: (
              status: VaultAccessStatus,
            ) => Promise<boolean>
          }
        }
      ).__nookVault
      if (!vault) {
        throw new Error('E2E vault state is not exposed')
      }
      return vault.handleRemoteVaultAssessStatus(status)
    }, VaultAccessStatus.RemoteMissing)

    expect(blocked).toBe(true)
    await expect(page.getByTestId('vault-error')).toContainText(
      'No existing vault was found in this provider',
    )
    await expect(page.getByTestId('provider-picker-list')).toBeVisible()
    await expect(page.getByTestId('vault-panel')).toHaveCount(0)
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

  test('unlocks the vault after passkey authorization on reload', async ({
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
    await expect(page.getByTestId('login-gate')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await expect(page.getByTestId('passkey-auth-overlay')).toBeHidden()
    await authorizeDeviceProtection(page)
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await expect(page.getByTestId('login-gate')).not.toBeVisible()
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
    await expect(page.getByTestId('login-gate')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await expect(page.getByTestId('passkey-auth-overlay')).toBeHidden()

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
