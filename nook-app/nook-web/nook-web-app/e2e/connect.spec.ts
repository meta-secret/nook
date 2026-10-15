import { expect, test } from './fixtures'
import { VaultAccessStatus } from '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm.js'
import {
  openIdentitiesPage,
  authorizeDeviceProtection,
  createLocalVaultOnLogin,
  dismissSyncConflictIfVisible,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  expectAppLogMilestones,
  flushNookLogPersistQueue,
  openLoginProviderSetup,
  readPersistedAppLogs,
  reloadUnlockWithSyncProvider,
  UI_TIMEOUT_MS,
  waitForPersistedAppLog,
  waitForVaultOperationsIdle,
  waitForVaultSyncIdle,
  openManagePage,
  ManagePage,
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
        scope: 'vault-session',
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
    // A reload replaces the WASM manager while retaining the encrypted local
    // projection. Unlocking must restore vault crypto from that cache before
    // the default secret-page query runs.
    await page.reload()
    await authorizeDeviceProtection(page)
    await expect(page.getByTestId('vault-panel')).toBeVisible()
    await flushNookLogPersistQueue(page)
    const logs = await readPersistedAppLogs(page)
    expect(
      logs.some(
        (entry) =>
          entry.scope === 'vault-sync' &&
          entry.data?.includes('Vault crypto not initialized'),
      ),
    ).toBeFalsy()
    await expect(page.getByTestId('login-gate')).not.toBeVisible()
    // The vault page offers the browser extension; the identity's card
    // names its single next step, which opens Sync.
    await expect(page.getByTestId('vault-extension-install')).toBeVisible()
    await openIdentitiesPage(page)
    const health = page.getByTestId('identity-card-health')
    await expect(health).toContainText('No cloud copy yet')
    await health.click()
    await expect(page.getByTestId('storage-providers-section')).toBeVisible()
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
    await expect(page.getByTestId('first-vault-start')).toBeVisible()
    await expect(page.getByTestId('get-started-path-sentinel')).toHaveCount(0)
    await expect(page.getByTestId('get-started-path-join')).toHaveCount(0)
    await expect(page.getByTestId('replication-mode-select')).toHaveCount(0)

    // Creating and restoring share the first screen as separate actions.
    await page.getByTestId('login-vault-name-input').fill('Workflow vault')
    await expect(
      page.getByTestId('login-create-device-vault-btn'),
    ).toBeEnabled()
    await expect(page.getByTestId('login-path-cloud')).toBeVisible()
    await page.getByTestId('login-connect-storage-btn').click()
    await expect(page.getByTestId('login-provider-setup')).toBeVisible()
    await expect(page.getByTestId('first-vault-start')).not.toBeVisible()
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

    await openManagePage(page, ManagePage.Sync)
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
    await authorizeDeviceProtection(page)
    await expect
      .poll(
        () => page.evaluate(() => Boolean(window.__nookVault?.isAuthenticated)),
        { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
      )
      .toBe(true)
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
    await openManagePage(page, ManagePage.Sync)
    const driveProvider = page.getByTestId('settings-provider-oauth-file')
    await expect(driveProvider).toBeVisible()

    const removeBtn = page.getByTestId('remove-provider-e2e-sync-drive')
    await expect(removeBtn).toBeEnabled({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    // An in-flight periodic sync reads the provider snapshot; removing a row
    // while it runs lets that read restore the previous provider set.
    await waitForVaultSyncIdle(page)
    await waitForVaultOperationsIdle(page)

    page.once('dialog', (dialog) => dialog.accept())
    await removeBtn.click()

    await expect(page.getByTestId('login-gate')).not.toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await expect(page.getByTestId('identity-page')).toBeVisible()
    await expect(page.getByTestId('settings-provider-oauth-file')).toHaveCount(
      0,
    )
    await expect(page.getByTestId('sync-providers-empty')).toBeVisible()
  })
})
