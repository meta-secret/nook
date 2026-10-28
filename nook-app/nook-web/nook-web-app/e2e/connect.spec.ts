import { expect, test } from './fixtures'
import { ExtensionConnectStepKind } from '../../nook-web-shared/src/extension/extension-connect-progress'
import { VaultAccessStatus } from '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm.js'
import {
  beginAddSyncProvider,
  openOpenVaultPanel,
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
  waitForVaultInitialized,
  waitForVaultSyncIdle,
  openIdentityPanel,
  openManagePage,
  ManagePage,
  expectLoginGateAfterLoad,
} from './helpers'

test.describe('vault connect flow', () => {
  test('creates local vault with device keys and opens vault', async ({
    page,
  }) => {
    await page.goto('/app/')

    await waitForVaultInitialized(page)
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
    // The open vault's panel offers the browser extension; the identity's
    // card offers its protection checklist, whose open step opens Sync.
    await openOpenVaultPanel(page)
    await expect(page.getByTestId('vault-extension-install')).toBeVisible()
    const protection = page.getByTestId('identity-protection-toggle')
    await expect(protection).toContainText('0 of 2 done')
    await protection.click()
    await expect(page.getByTestId('identity-protection-risk')).toContainText(
      'Only this browser has your vaults',
    )
    await page.getByTestId('identity-protection-action').click()
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

    await waitForVaultInitialized(page)
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

  test('the connect route owns create and join and reports its steps to the extension', async ({
    page,
  }) => {
    // The extension opens its connect route with no start choice; the page
    // opens one runtime port to the extension id in the URL, named with the
    // side panel's connect id, and reports where it is. This browser has no
    // vault, so it offers create or join.
    await page.addInitScript(() => {
      const steps: unknown[] = []
      const connected: string[] = []
      const port = {
        postMessage: (step: unknown) => steps.push(step),
        disconnect: () => connected.push('disconnected'),
        onDisconnect: { addListener: () => {} },
      }
      Object.assign(window, {
        __nookConnectSteps: steps,
        __nookConnectedTo: connected,
        chrome: {
          runtime: {
            connect: (extensionId: string, info: { readonly name: string }) => {
              connected.push(`${extensionId}/${info.name}`)
              return port
            },
          },
        },
      })
    })
    const connect = new URLSearchParams({
      device_id: 'side-panel-device',
      device_public_key: 'age1sidepanel',
      device_signing_public_key: 'side-panel-signing-key',
      extension_id: 'side-panel-extension',
      device_label: 'Nook Extension',
      nonce: 'side-panel-nonce',
      connect_id: 'side-panel-connect',
      scopes: 'vault-access,password-filling',
    })
    await page.goto(`/extension-connect?${connect}`)
    await waitForVaultInitialized(page)
    await expect(page.getByTestId('first-vault-start')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await expect(page.getByTestId('login-vault-name-input')).toHaveValue('')
    await expect(page.getByTestId('login-join-identity-btn')).toBeVisible()
    await expect
      .poll(() =>
        page.evaluate((): unknown => Reflect.get(window, '__nookConnectSteps')),
      )
      .toEqual([
        { kind: ExtensionConnectStepKind.Opened },
        { kind: ExtensionConnectStepKind.Choosing },
      ])
    expect(
      await page.evaluate((): unknown =>
        Reflect.get(window, '__nookConnectedTo'),
      ),
    ).toEqual(['side-panel-extension/side-panel-connect'])
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

    // Without a provider, Sync opens from the identity panel's "Add a sync
    // provider", so the picker is already open.
    await openManagePage(page, ManagePage.Sync)
    await beginAddSyncProvider(page)
    await expect(page.getByTestId('provider-picker-list')).toBeVisible()
    await expect(page.getByTestId('provider-option-local')).toHaveCount(0)
    await page.getByTestId('provider-option-github').click()
    await expect(page.getByTestId('github-token-setup')).toBeVisible()
    // Adding a provider is its own page: Back leaves it unsaved.
    await page.getByTestId('identity-page-back').click()
    await expect(page.getByTestId('provider-picker-list')).toHaveCount(0)
    await openIdentityPanel(page)
    await expect(
      page.getByTestId('identity-panel-provider-github'),
    ).toHaveCount(0)
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
    await expectLoginGateAfterLoad(page)
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
