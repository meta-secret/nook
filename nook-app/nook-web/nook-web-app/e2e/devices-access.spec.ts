import { expect, test } from './fixtures'
import {
  DeviceAccessProtectionKind,
  NookDeviceAccessTextKind,
  type NookVaultManager,
} from '$app-wasm'
import {
  addVaultPassword,
  attachNookLogsForTest,
  connectLocalVault,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  installPasskeyMock,
} from './helpers'

enum PreviewTextKind {
  Missing = 'missing',
  Present = 'present',
}

type DeviceAccessSnapshotRequestOwner = Pick<
  NookVaultManager,
  'device_access_snapshot_request'
>

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
    await expect(page).toHaveURL(/\/devices-access$/)
    await expect(page.getByTestId('devices-access-back')).toBeFocused()
    const dashboard = page.getByTestId('devices-access-dashboard')
    await expect(dashboard).toBeVisible()
    await expect(dashboard).toContainText('Not prepared')
    // An unprepared browser previews the same three bands it will populate
    // instead of offering evidence it cannot have yet.
    const preview = page.getByTestId('devices-access-chain-preview')
    await expect(preview).toContainText('My browser')
    await expect(preview).toContainText('My identities')
    await expect(preview).toContainText('Vault access')
    await expect(preview).toContainText('unlocks')
    await expect(preview).toContainText('opens')
    // DOM order matters here; innerText applies the micro-label's visual
    // uppercase transform and would make the source-case labels unsearchable.
    const previewTextState = await preview.evaluate((element, kind) => {
      const text = element.textContent
      return typeof text === 'string'
        ? { kind: kind.Present, text }
        : { kind: kind.Missing }
    }, PreviewTextKind)
    if (previewTextState.kind === PreviewTextKind.Missing) {
      throw new Error('Devices & access preview has no text content')
    }
    const previewText = previewTextState.text
    expect(previewText.indexOf('No local identity')).toBeLessThan(
      previewText.indexOf('My browser'),
    )
    expect(previewText.indexOf('My browser')).toBeLessThan(
      previewText.indexOf('Vault access'),
    )
    await expect(preview).not.toContainText('Passkey')
    await expect(preview).toContainText('No local identity')
    await expect(preview).toContainText('No local vaults yet')
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
    await page.getByTestId('devices-access-perspective-vaults').click()
    await expect(
      page.getByRole('heading', { name: 'No vault selected', exact: true }),
    ).toBeVisible()
    await expect(dashboard).toContainText(
      'Create or connect a vault, or select one from the Vault menu',
    )
    await page.getByTestId('devices-access-perspective-identities').click()
    await page.getByTestId('devices-access-node-vaults').click()
    await expect(dashboard).toContainText(
      'Create or connect a vault to see its access here',
    )
    await expect(dashboard).not.toContainText(
      'prepare this browser identity first',
    )
    await page.getByTestId('devices-access-back').click()
    await expect(page.getByTestId('login-devices-access')).toBeFocused()

    await page.reload()
    await expect(page.getByTestId('devices-access-nudge')).toHaveCount(0)
    await expect(page.getByTestId('login-devices-access')).toBeVisible()
  })

  test('after creating a passkey vault shows the access dependency graph', async ({
    page,
  }) => {
    await connectLocalVault(page)
    await page.getByTestId('vault-devices-access-tab').click()
    const dashboard = page.getByTestId('devices-access-dashboard')
    await expect(dashboard).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    const bridge = page.getByTestId('devices-access-chain')
    await expect(bridge).toContainText('Passkey')
    await expect(bridge).toContainText('Passkey · recoverable identity')
    await expect(bridge).toContainText('App key')
    await expect(bridge).toContainText('Vaults')
    await expect(bridge).toContainText('Test vault')
    await expect(bridge.locator('.svelte-flow__edge')).not.toHaveCount(0)
    await expect(
      bridge.getByRole('article', {
        name: /Passkey: Passkey · recoverable identity. Unlocks this app key/,
      }),
    ).toBeVisible()
    await expect(bridge.getByRole('article', { name: /App key/ })).toBeVisible()
    await expect(
      bridge.getByRole('article', { name: /Vault access/ }),
    ).toBeVisible()
    const panel = page.getByTestId('devices-access-panel')
    await expect(panel).toContainText('Passkey · recoverable identity')
    await expect(
      page.getByTestId('devices-access-credential-id'),
    ).not.toHaveText('Unknown')
  })

  test('uses the wide canvas with a persistent identity rail and key inventory', async ({
    page,
  }) => {
    await connectLocalVault(page)
    await page.setViewportSize({ width: 1440, height: 900 })

    const shell = page.getByTestId('app-shell-content')
    const vaultShellWidth = await shell.evaluate(
      (element) => element.getBoundingClientRect().width,
    )

    await page.getByTestId('vault-devices-access-tab').click()
    const dashboard = page.getByTestId('devices-access-dashboard')
    await expect(dashboard).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })

    const accessShellWidth = await shell.evaluate(
      (element) => element.getBoundingClientRect().width,
    )
    expect(accessShellWidth).toBeGreaterThan(vaultShellWidth + 200)

    const browse = page.getByRole('navigation', { name: 'Browse by' })
    await expect(
      browse.getByRole('button', { name: 'Identity', exact: true }),
    ).toHaveCount(1)
    await expect(
      browse.getByRole('button', { name: 'Vault', exact: true }),
    ).toHaveCount(1)
    await expect(browse.getByRole('list')).toHaveCount(0)

    const identityHeading = page.getByRole('heading', {
      name: 'This identity holds DEKs for 1 vault.',
      exact: true,
    })
    const browseBottom = await browse.evaluate(
      (element) => element.getBoundingClientRect().bottom,
    )
    const headingTop = await identityHeading.evaluate(
      (element) => element.getBoundingClientRect().top,
    )
    expect(browseBottom).toBeLessThan(headingTop)

    const identityRail = page.getByTestId('devices-access-identity-rail')
    const keyInventory = page.getByTestId('devices-access-key-inventory')
    const keyRows = page.getByTestId('devices-access-key-row')
    await expect(identityRail).toBeVisible()
    await expect(
      page.getByTestId('devices-access-identity-option'),
    ).toHaveCount(1)
    await expect(keyInventory).toBeVisible()
    await expect(keyRows).toHaveCount(2)
    await expect(keyRows.nth(0)).toHaveAttribute('data-kind', 'protector')
    await expect(keyRows.nth(1)).toHaveAttribute('data-kind', 'app-key')
    await expect(keyInventory).toContainText('Passkey')
    await expect(keyInventory).toContainText('App key')

    const bridge = page.getByTestId('devices-access-chain')
    await expect(bridge.getByRole('article', { name: /App key/ })).toBeVisible()
    await page.getByTestId('devices-access-node-device-key').click()
    await expect(page.getByTestId('devices-access-panel')).toContainText(
      'App key',
    )

    await page.getByTestId('devices-access-perspective-vaults').click()
    await expect(browse.getByRole('list')).toHaveCount(1)
    await expect(
      browse.getByRole('button', { name: /Test vault.*App keys: 1/ }),
    ).toBeVisible()
  })

  test('walks the access chain from passkey to app key to vaults', async ({
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
    await expect(page.getByTestId('devices-access-chain')).toContainText(
      'Passkey · recoverable identity',
    )
    await expect(
      page.getByTestId('devices-access-perspective-identities'),
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(
      page.getByRole('heading', {
        name: 'This identity holds DEKs for 1 vault.',
        exact: true,
      }),
    ).toBeVisible()

    const unlockNode = page.getByTestId('devices-access-node-unlock')
    const deviceKeyNode = page.getByTestId('devices-access-node-device-key')
    const vaultsNode = page.getByTestId('devices-access-node-vaults')
    const bridge = page.getByTestId('devices-access-chain')
    await expect(bridge).toContainText('App key')
    await expect(bridge).toContainText('Passkey')
    await expect(bridge).toContainText('Identity')
    await expect(bridge).toContainText('Vaults')
    await expect(bridge.locator('.svelte-flow__edge')).not.toHaveCount(0)
    await expect(bridge.getByRole('article', { name: /App key/ })).toBeVisible()
    await expect(
      bridge.getByRole('article', {
        name: /Passkey: Passkey · recoverable identity. Unlocks this app key/,
      }),
    ).toBeVisible()
    await expect(
      bridge.getByRole('article', {
        name: /Identity.*Identity unlocked/,
      }),
    ).toBeVisible()
    await expect(
      bridge.getByRole('article', { name: /Vault access/ }),
    ).toBeVisible()
    await expect(unlockNode).toHaveAttribute('aria-selected', 'true')
    await expect(unlockNode).toContainText('Passkey')
    await expect(deviceKeyNode).toContainText('App key')
    await expect(vaultsNode).toContainText('Vault access')
    const strengthVaults = page.getByTestId('devices-access-strength-vaults')
    await expect(strengthVaults).toHaveCount(1)
    await expect(strengthVaults).toContainText('Verified way in')

    const identityRail = page.getByTestId('devices-access-identity-rail')
    const identityOptions = page.getByTestId('devices-access-identity-option')
    const identityKeys = page.getByTestId('devices-access-key-inventory')
    const keyRows = page.getByTestId('devices-access-key-row')
    await expect(identityRail).toBeVisible()
    await expect(identityOptions).toHaveCount(1)
    await expect(identityOptions.filter({ hasText: 'Personal' })).toContainText(
      '2 keys',
    )
    await expect(identityKeys).toBeVisible()
    await expect(keyRows).toHaveCount(2)
    await expect(identityKeys).toContainText('Passkey')
    await expect(identityKeys).toContainText('App key')

    await expect(page.getByTestId('devices-access-add-identity')).toBeDisabled()
    await expect(identityRail).toContainText(
      'Another identity needs its own protected app key',
    )
    await expect(bridge).toBeVisible()

    await page.setViewportSize({ width: 390, height: 844 })
    await expect(identityRail).toBeVisible()
    await expect(identityKeys).toBeVisible()
    await expect(
      bridge.getByRole('img', {
        name: /This identity holds the DEK for Test vault/i,
      }),
    ).toHaveCount(1)
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true)
    await page.setViewportSize({ width: 240, height: 844 })
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true)
    await expect
      .poll(() =>
        bridge.evaluate((element) => {
          const protection = element.querySelector(
            'article[aria-label*="Passkey"]',
          )
          if (!(protection instanceof HTMLElement)) return false

          const bridgeBounds = element.getBoundingClientRect()
          const protectionBounds = protection.getBoundingClientRect()
          return (
            protectionBounds.left >= bridgeBounds.left &&
            protectionBounds.right <= bridgeBounds.right
          )
        }),
      )
      .toBe(true)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByTestId('devices-access-perspective-vaults').click()
    await expect(
      page.getByRole('button', {
        name: /Test vault.*App keys: 1/,
      }),
    ).toBeVisible()
    await expect(
      bridge.getByRole('img', {
        name: /Test vault was opened by this app key/,
      }),
    ).toHaveCount(1)
    await expect(
      bridge.getByRole('article', {
        name: /App key: App key\. Test vault was opened by this app key/i,
      }),
    ).toBeVisible()
    await expect(bridge).not.toContainText('This browser')
    await expect(bridge).not.toContainText('Identity reference')
    await page.getByTestId('devices-access-perspective-identities').click()
    await page.setViewportSize({ width: 1440, height: 900 })

    // The first link opens selected: one passkey fingerprint, and the same
    // fingerprint on its node, so the relationship and the evidence agree.
    const panel = page.getByTestId('devices-access-panel')
    await expect(panel).toContainText('Passkey · recoverable identity')
    const credentialFingerprint = await page
      .getByTestId('devices-access-credential-id')
      .innerText()
    expect(credentialFingerprint).not.toBe('Unknown')
    await expect(panel).toContainText(credentialFingerprint)
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

    // Arrow keys follow the map's visible order, and the panel follows focus.
    await unlockNode.press('ArrowRight')
    await expect(deviceKeyNode).toBeFocused()
    await expect(deviceKeyNode).toHaveAttribute('aria-selected', 'true')

    await deviceKeyNode.press('ArrowRight')
    await expect(vaultsNode).toBeFocused()
    await expect(vaultsNode).toHaveAttribute('aria-selected', 'true')
    await expect(panel).toContainText('Vaults known to this app key')
    await expect(strengthVaults).toContainText('Verified way in')
    await expect(
      bridge.getByRole('article', { name: /Vault access/ }),
    ).toHaveCount(1)

    await vaultsNode.press('ArrowLeft')
    await expect(deviceKeyNode).toBeFocused()
    await expect(panel).toContainText('App key')
    const deviceIdentifier = await page
      .getByTestId('devices-access-device-id')
      .innerText()
    expect(deviceIdentifier).not.toBe('Unknown')
    await expect(panel).toContainText(deviceIdentifier)
    await expect(panel).toContainText('A backup password is different')

    await deviceKeyNode.press('ArrowLeft')
    await expect(unlockNode).toBeFocused()
    await unlockNode.press('ArrowLeft')
    await expect(vaultsNode).toBeFocused()
    await expect(panel).toContainText('Vaults known to this app key')
    await expect(page.getByTestId('devices-access-vaults')).toContainText(
      'Access verified',
    )
    const vaultIdentifier = panel
      .locator('details')
      .filter({ hasText: 'Vault identifier' })
    await expect(vaultIdentifier.locator('p')).toBeHidden()
    await vaultIdentifier.getByText('Vault identifier', { exact: true }).click()
    await expect(vaultIdentifier.locator('p')).toBeVisible()
    const fullVaultIdentifier = await vaultIdentifier.locator('p').innerText()
    await expect(strengthVaults).not.toContainText(fullVaultIdentifier)
    await expect(
      page.getByTestId('devices-access-current-vault'),
    ).toContainText('Emergency recovery')
    const memberDetails = page
      .getByTestId('devices-access-member-details')
      .first()
    await expect(memberDetails.locator('p')).toBeHidden()
    await memberDetails.getByText('App key identifier', { exact: true }).click()
    await expect(memberDetails.locator('p')).toBeVisible()

    await panel.getByRole('button', { name: 'Manage enrolled devices' }).click()
    await expect(
      page.getByTestId('vault-devices-section').locator('button').first(),
    ).toBeFocused()
    await page.getByTestId('vault-devices-access-tab').click()
    await page.getByTestId('devices-access-back').click()
    await expect(page.getByTestId('vault-devices-access-tab')).toBeFocused()
    await page.getByTestId('vault-devices-access-tab').click()
    // Remount after leaving Access invalidates the earlier vaultsNode locator.
    await expect(page.getByTestId('devices-access-dashboard')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    const remountedVaultsNode = page.getByTestId('devices-access-node-vaults')
    await expect(remountedVaultsNode).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await remountedVaultsNode.click()
    await page
      .getByTestId('devices-access-panel')
      .getByRole('button', { name: 'Manage backup passwords' })
      .click()
    await expect(
      page.getByTestId('vault-unlock-section').locator('button').first(),
    ).toBeFocused()
    const accessTabFromBackupPasswords = page.getByTestId(
      'vault-devices-access-tab',
    )
    await expect(accessTabFromBackupPasswords).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await accessTabFromBackupPasswords.click({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await page.getByTestId('devices-access-back').click()
    await expect(accessTabFromBackupPasswords).toBeFocused()
  })

  test('keeps localized evidence tabs inside a narrow viewport', async ({
    page,
  }) => {
    await connectLocalVault(page)
    await page.getByTestId('vault-devices-access-tab').click()
    await page.setViewportSize({ width: 320, height: 844 })
    await page.getByTestId('header-language-select').click()
    await page.getByTestId('header-language-option-ru').click()

    await expect(page.getByTestId('devices-access-node-unlock')).toBeVisible()
    await expect(
      page.getByTestId('devices-access-node-device-key'),
    ).toBeVisible()
    await expect(page.getByTestId('devices-access-node-vaults')).toBeVisible()
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true)
  })

  test('names PIN protection without inventing a credential identifier', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem('nook_e2e_passkey_mode', 'unavailable')
    })
    await page.goto('/app/')
    await page.getByTestId('login-devices-access').click()
    await page.getByTestId('device-protection-create-new-choice').click()
    await page
      .getByTestId('device-protection-label-input')
      .fill('Unavailable passkey')
    await page.getByTestId('device-protection-setup-btn').click()
    await expect(page.getByTestId('device-protection-error')).toBeVisible()
    await page.getByTestId('device-protection-pin-input').fill('123456')
    await page.getByTestId('device-protection-pin-confirm').fill('123456')
    await page.getByTestId('device-protection-pin-setup-btn').click()

    const unlockNode = page.getByTestId('devices-access-node-unlock')
    const panel = page.getByTestId('devices-access-panel')
    await expect(unlockNode).toBeFocused()
    await expect(panel).toContainText('PIN or passphrase')
    await expect(panel).toContainText('Known only to you')
    await expect(panel).not.toContainText('Unknown')
    await expect(panel).not.toContainText('Named by you')
  })

  test('does not classify an unnamed passkey as user-named', async ({
    page,
  }) => {
    await connectLocalVault(page)
    await page.evaluate((unknownTextKind) => {
      if (!('__nookVault' in window)) {
        throw new Error('Vault runtime is not exposed')
      }
      const vault = (
        window as Window & {
          __nookVault: {
            requireManager(): DeviceAccessSnapshotRequestOwner
          }
        }
      ).__nookVault
      const manager = vault.requireManager()
      const managerPrototype = Reflect.getPrototypeOf(
        manager,
      ) as DeviceAccessSnapshotRequestOwner
      manager.device_access_snapshot_request = () => {
        const request =
          managerPrototype.device_access_snapshot_request.call(manager)
        const resolve = request.resolve.bind(request)
        request.resolve = async () => {
          const snapshot = await resolve()
          return new Proxy(snapshot, {
            get(target, property) {
              if (property === 'passkeyName' || property === 'providerLabel') {
                return {
                  kind: unknownTextKind,
                  free(): void {
                    // Browser fixture values do not own WASM memory.
                  },
                }
              }
              const value = Reflect.get(target, property, target)
              return typeof value === 'function' ? value.bind(target) : value
            },
          })
        }
        return request
      }
    }, NookDeviceAccessTextKind.Unknown)

    await page.getByTestId('vault-devices-access-tab').click()
    const panel = page.getByTestId('devices-access-panel')
    await expect(panel).toContainText('Unnamed passkey', {
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(panel).not.toContainText('Named by you')
  })

  test('attributes a companion session to its paired device', async ({
    page,
  }) => {
    await connectLocalVault(page)
    await page.evaluate((companionProtection) => {
      if (!('__nookVault' in window)) {
        throw new Error('Vault runtime is not exposed')
      }
      const vault = (
        window as Window & {
          __nookVault: {
            requireManager(): DeviceAccessSnapshotRequestOwner
          }
        }
      ).__nookVault
      const manager = vault.requireManager()
      const managerPrototype = Reflect.getPrototypeOf(
        manager,
      ) as DeviceAccessSnapshotRequestOwner
      manager.device_access_snapshot_request = () => {
        const request =
          managerPrototype.device_access_snapshot_request.call(manager)
        const resolve = request.resolve.bind(request)
        request.resolve = async () => {
          const snapshot = await resolve()
          return new Proxy(snapshot, {
            get(target, property) {
              if (property === 'protection') return companionProtection
              const value = Reflect.get(target, property, target)
              return typeof value === 'function' ? value.bind(target) : value
            },
          })
        }
        return request
      }
    }, DeviceAccessProtectionKind.CompanionSession)

    await page.getByTestId('vault-devices-access-tab').click()
    const bridge = page.getByTestId('devices-access-chain')
    await expect(bridge).toContainText('Paired device identity', {
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(bridge).toContainText('Paired-device identity')
    await expect(bridge).toContainText('Reported by paired device')
    await expect(bridge).not.toContainText('This browser')
    const deviceKeyNode = page.getByTestId('devices-access-node-device-key')
    await deviceKeyNode.click()
    const panel = page.getByTestId('devices-access-panel')
    await expect(panel).toContainText('Paired device identity', {
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(panel).not.toContainText('My browser')
    await page.getByTestId('devices-access-node-unlock').click()
    await expect(panel).not.toContainText('Named by you')
    await page.getByTestId('devices-access-node-vaults').click()
    await expect(panel).toContainText('Vaults known to this app key')
  })

  test('keeps known vaults visible after identity recovery reset', async ({
    page,
  }, testInfo) => {
    await connectLocalVault(page)
    await page.getByTestId('vault-devices-access-tab').click()
    await page.getByTestId('devices-access-node-vaults').click()
    await expect(
      page.getByTestId('devices-access-strength-vaults'),
    ).toContainText('Test vault', { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })

    // Enter recovery through the same locked-state UI as production. This
    // quiesces the active vault before its protected identity is forgotten.
    await page.getByTestId('vault-secrets-tab').click()
    await expect(page.getByTestId('vault-panel')).toBeVisible()
    await page.getByTestId('header-lock-vault-btn').click()
    await page.evaluate(() => {
      localStorage.setItem('nook_e2e_passkey_mode', 'cancel')
    })
    await page.reload()
    const recoveryOverlay = page.getByTestId('passkey-auth-overlay')
    const unlock = page.getByTestId('unlock-vault-btn')
    await expect
      .poll(
        async () => {
          if (await recoveryOverlay.isVisible()) return 'overlay'
          if (await unlock.isVisible()) return 'unlock'
          return 'waiting'
        },
        { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
      )
      .not.toBe('waiting')
    if (!(await recoveryOverlay.isVisible())) await unlock.click()
    await expect(recoveryOverlay).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await attachNookLogsForTest(page, testInfo)
    try {
      page.once('dialog', (dialog) => dialog.accept())
      await page.getByTestId('device-protection-recovery-btn').click()
      await expect(
        page.getByTestId('device-protection-use-existing-choice'),
      ).toHaveText('Authenticate')
      await page.evaluate(() => {
        history.replaceState(history.state, '', '/devices-access')
        window.dispatchEvent(new PopStateEvent('popstate'))
      })

      await expect(page.getByTestId('login-gate')).toBeVisible({
        timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
      })
      const passkeyOverlay = page.getByTestId('passkey-auth-overlay')
      try {
        await expect(passkeyOverlay).toBeVisible({ timeout: 5_000 })
        await page.getByTestId('passkey-auth-overlay-dismiss').click()
        await expect(passkeyOverlay).toBeHidden()
      } catch {
        // Identity metadata is already gone; unlock overlay may never appear.
      }
      const loginDevicesAccess = page.getByTestId('login-devices-access')
      if (await loginDevicesAccess.isVisible()) {
        await loginDevicesAccess.click()
      } else {
        await expect(page.getByTestId('devices-access-dashboard')).toBeVisible({
          timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
        })
      }
      const preview = page.getByTestId('devices-access-chain-preview')
      await expect(preview).toContainText(
        'Known vaults remain on this browser',
        { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
      )
      await expect(
        page.getByTestId('devices-access-preview-vaults'),
      ).toContainText('Test vault')
      await expect(
        page.getByTestId('devices-access-preview-vaults'),
      ).toContainText('Access not yet verified')
      await expect(preview).toContainText('not verified')
      await expect(preview).not.toContainText('opens')
      await expect(preview).not.toContainText('No local vaults yet')
    } finally {
      // Recovery intentionally disposes the active WASM identity. Its logs
      // were attached above while IndexedDB was still readable; always leave
      // the origin so the shared fixture does not reopen the reset store.
      await page.goto('about:blank').catch(() => {})
    }
  })

  test('never claims access to a vault this app key has not opened', async ({
    page,
  }) => {
    await connectLocalVault(page)
    await page.getByTestId('vault-devices-access-tab').click()
    const vaultsNode = page.getByTestId('devices-access-node-vaults')
    await expect(
      page.getByTestId('devices-access-strength-vaults'),
    ).toHaveCount(1, {
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })

    // Verified access is descriptive metadata written after an unlock succeeds.
    // Removing it leaves the vault registered on this browser with nothing
    // proving this app key ever opened it, which is how a locally cached
    // vault from another identity arrives.
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.open('nook_db')
          request.onerror = () => reject(request.error)
          request.onsuccess = () => {
            const db = request.result
            const transaction = db.transaction('vault', 'readwrite')
            const store = transaction.objectStore('vault')
            const profileRequest = store.get('device_access_profile')
            profileRequest.onsuccess = () => {
              const raw = profileRequest.result
              if (typeof raw !== 'string') {
                reject(new Error('Device access profile is missing'))
                return
              }
              const profile = JSON.parse(raw) as { verifiedVaults: unknown[] }
              profile.verifiedVaults = []
              store.put(JSON.stringify(profile), 'device_access_profile')
            }
            transaction.onerror = () => reject(transaction.error)
            transaction.oncomplete = () => {
              db.close()
              resolve()
            }
          }
        }),
    )

    // The dashboard reads the snapshot when it mounts, so leave and come back.
    await page.getByTestId('vault-secrets-tab').click()
    await page.getByTestId('vault-devices-access-tab').click()

    const chain = page.getByTestId('devices-access-chain')
    await expect(chain).toContainText('0 vaults')
    await expect(
      page.getByTestId('devices-access-strength-vaults'),
    ).toHaveCount(0)
    await expect(page.getByRole('heading', { name: /0 vaults/ })).toBeVisible()

    await vaultsNode.click()
    const panel = page.getByTestId('devices-access-panel')
    await expect(panel).toContainText('Vaults known to this app key')
    const vaults = page.getByTestId('devices-access-vaults')
    await expect(vaults).toContainText('Access not yet verified')
    await expect(vaults).not.toContainText('Access verified')
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
    await page.getByTestId('devices-access-node-vaults').click()
    await expect(
      page.getByTestId('devices-access-strength-vaults'),
    ).not.toContainText('Bitwarden family vault')

    await page.getByTestId('devices-access-node-unlock').click()
    await page
      .getByTestId('devices-access-provider-label')
      .fill('Proton Pass family vault')
    // The reminder is written before the dashboard re-reads its snapshot, so
    // failing the next snapshot read exercises "saved, but reload failed".
    await page.evaluate(() => {
      const manager = (
        window as Window & {
          __nookVault?: {
            requireManager(): DeviceAccessSnapshotRequestOwner
          }
        }
      ).__nookVault?.requireManager()
      if (!manager) throw new Error('Vault manager is not exposed')
      manager.device_access_snapshot_request = () => {
        Reflect.deleteProperty(manager, 'device_access_snapshot_request')
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
          requireManager(): DeviceAccessSnapshotRequestOwner
        }
        __nookReloadSettled?: boolean
      }
      const manager = scope.__nookVault?.requireManager()
      if (!manager) throw new Error('Vault manager is not exposed')
      scope.__nookReloadSettled = false
      manager.device_access_snapshot_request = () => {
        Reflect.deleteProperty(manager, 'device_access_snapshot_request')
        const request = manager.device_access_snapshot_request()
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
    await addVaultPassword(page, 'Travel recovery', 'demo recovery passphrase')
    await page.getByTestId('vault-devices-access-tab').click()
    await expect(page.getByTestId('devices-access-dashboard')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    // Wait for persisted passkey evidence — Identity unlocked alone can appear
    // from the in-memory session before the wrapped app key is durable, and
    // locking then leaves Access on the Missing-protection preview.
    const bridge = page.getByTestId('devices-access-chain')
    await expect(bridge).toContainText('Passkey · recoverable identity', {
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(
      page.getByTestId('devices-access-identity-state'),
    ).toContainText('Identity unlocked', {
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(
      page.getByTestId('devices-access-credential-id'),
    ).not.toHaveText('Unknown')

    await page.getByTestId('header-lock-vault-btn').click()
    // Locking from /devices-access keeps that URL, so login opens Access directly.
    await expect(page).toHaveURL(/\/devices-access$/)
    await expect(
      page.getByTestId('devices-access-identity-state'),
    ).toContainText('Identity locked', {
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(
      page.getByTestId('devices-access-identity-card'),
    ).toHaveAttribute('data-identity-state', 'Locked')
    await page.getByTestId('devices-access-node-vaults').click()
    await expect(page.getByTestId('devices-access-vaults')).toContainText(
      'Access verified',
    )
    await expect(page.getByTestId('devices-access-current-vault')).toHaveCount(
      0,
    )
  })
})
