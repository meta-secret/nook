import type { Page } from '@playwright/test'
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
  saveAuthProvidersInBrowser,
  unselectedAuthProviderSeedScope,
} from './helpers'

type IdentityDirectorySnapshotRequestOwner = Pick<
  NookVaultManager,
  'identity_directory_snapshot_request'
>

async function openRelationshipGraph(page: Page): Promise<void> {
  const graphView = page.getByTestId('devices-access-layout-graph')
  await expect(graphView).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await graphView.click()
}

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
    await expect(page.getByTestId('devices-access-no-identities')).toBeVisible()
    await expect(page.getByTestId('devices-access-chain')).toHaveCount(0)
    await expect(
      page.getByTestId('devices-access-prepare-browser'),
    ).toHaveCount(0)
    const addIdentity = page.getByTestId('devices-access-add-identity')
    await expect(addIdentity).toBeEnabled()
    const generationBeforeAdd = await page.evaluate(() =>
      localStorage.getItem('nook-local-data-storage-generation'),
    )
    await addIdentity.click()
    await expect(
      page.getByTestId('devices-access-add-identity-flow'),
    ).toBeVisible()
    expect(
      await page.evaluate(() =>
        localStorage.getItem('nook-local-data-storage-generation'),
      ),
    ).toBe(generationBeforeAdd)

    await page
      .getByTestId('device-protection-label-input')
      .fill('Dashboard focus passkey')
    await page.evaluate(() => {
      const credentials = navigator.credentials
      const createCredential = credentials.create.bind(credentials)
      credentials.create = async (options) => {
        await new Promise((resolve) => window.setTimeout(resolve, 250))
        return createCredential(options)
      }
    })
    await page.getByTestId('device-protection-setup-btn').click()
    await expect(
      page.getByTestId('devices-access-cancel-add-identity'),
    ).toBeDisabled()
    await expect(page.getByTestId('devices-access-key-inventory')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(
      page.getByTestId('devices-access-identity-option'),
    ).toHaveCount(1)
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
    await page.getByTestId('devices-access-layout-graph').click()
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
    await expect(page.getByText('Inspect access evidence')).toHaveCount(0)
    await expect(page.getByText('What your browser reported')).toHaveCount(0)
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

    const identityRail = page.getByTestId('devices-access-identity-rail')
    const keyInventory = page.getByTestId('devices-access-key-inventory')
    const keyRows = page.getByTestId('devices-access-key-row')
    const relationshipDetails = page.getByTestId(
      'devices-access-relationship-details',
    )
    const listView = page.getByTestId('devices-access-layout-list')
    const graphView = page.getByTestId('devices-access-layout-graph')
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
    await expect(listView).toHaveAttribute('aria-pressed', 'true')
    await expect(graphView).toHaveAttribute('aria-pressed', 'false')
    await expect(relationshipDetails).toHaveCount(0)

    await graphView.click()
    await expect(keyInventory).toHaveCount(0)
    await expect(relationshipDetails).toBeVisible()
    await expect(listView).toHaveAttribute('aria-pressed', 'false')
    await expect(graphView).toHaveAttribute('aria-pressed', 'true')

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

    const bridge = page.getByTestId('devices-access-chain')
    await expect(bridge.getByRole('article', { name: /App key/ })).toBeVisible()

    await page.getByTestId('devices-access-perspective-vaults').click()
    await listView.click()
    await expect(keyInventory).toBeVisible()
    await expect(relationshipDetails).toHaveCount(0)
    await expect(keyRows.nth(1).getByRole('button')).toHaveCount(0)

    await graphView.click()
    await page.getByTestId('devices-access-perspective-vaults').click()
    await expect(browse.getByRole('list')).toHaveCount(1)
    await expect(
      browse.getByRole('button', { name: /Test vault.*App keys: 1/ }),
    ).toBeVisible()
  })

  test('creates a second protected identity and switches between both identities', async ({
    page,
  }) => {
    await connectLocalVault(page)
    await page.getByTestId('vault-devices-access-tab').click()
    await saveAuthProvidersInBrowser(
      page,
      {
        providers: [
          {
            id: 'personal-remote-provider',
            type: 'github',
            label: 'Personal remote provider',
            githubRepo: 'personal-vault',
            githubPat: 'github_pat_personal_identity',
          },
        ],
      },
      unselectedAuthProviderSeedScope(),
    )
    const identityOptions = page.getByTestId('devices-access-identity-option')
    await expect(identityOptions).toHaveCount(1)

    await page.getByTestId('devices-access-add-identity').click()
    await page.evaluate(() => {
      localStorage.setItem('nook_e2e_passkey_mode', 'cancel')
    })
    await page
      .getByTestId('device-protection-label-input')
      .fill('Cancelled identity passkey')
    await page.getByTestId('device-protection-setup-btn').click()
    await expect(
      page.getByTestId('devices-access-add-identity-flow'),
    ).toBeVisible()
    await expect(page.getByTestId('device-protection-error')).toBeVisible()
    await expect(identityOptions).toHaveCount(1)
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem('nook_vault_session_locked'),
      ),
    ).toBeNull()
    await page.evaluate(() => {
      localStorage.setItem('nook_e2e_passkey_mode', 'unavailable')
    })
    await page
      .getByTestId('device-protection-label-input')
      .fill('Work identity passkey')
    await page.getByTestId('device-protection-setup-btn').click()
    await expect(page.getByTestId('device-protection-pin-input')).toBeVisible()
    await page.getByTestId('device-protection-pin-input').fill('246810')
    await page.getByTestId('device-protection-pin-confirm').fill('246810')
    await page.getByTestId('device-protection-pin-setup-btn').click()
    await page.evaluate(() => {
      localStorage.removeItem('nook_e2e_passkey_mode')
    })

    await expect(identityOptions).toHaveCount(2, {
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem('nook_vault_session_locked'),
      ),
    ).toBe('true')
    const personalIdentity = identityOptions.filter({ hasText: 'Personal' })
    const workIdentity = identityOptions.filter({ hasText: 'Identity 2' })
    await expect(workIdentity).toHaveAttribute('data-selected', 'true')
    await expect(
      page.getByTestId('devices-access-key-inventory'),
    ).toContainText('PIN or passphrase')

    await personalIdentity.click()
    const generationBeforeActivation = await page.evaluate(() =>
      localStorage.getItem('nook-local-data-storage-generation'),
    )
    await page.getByTestId('devices-access-use-identity').click()
    expect(
      await page.evaluate(() =>
        localStorage.getItem('nook-local-data-storage-generation'),
      ),
    ).toBe(generationBeforeActivation)
    await page
      .getByTestId('devices-access-identity-protection-flow')
      .getByRole('button', { name: 'Cancel', exact: true })
      .click()
    await page.getByTestId('devices-access-back').click()
    await expect(page.getByTestId('login-local-vault-detected')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await page.getByTestId('unlock-vault-btn').click()
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await page.getByTestId('vault-devices-access-tab').click()
    await expect(personalIdentity).toHaveAttribute('data-selected', 'true', {
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(
      page.getByTestId('devices-access-key-inventory'),
    ).toContainText('Passkey')
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as Window & {
                __nookVault?: { providers: Array<{ id: string }> }
              }
            ).__nookVault?.providers.some(
              (provider) => provider.id === 'personal-remote-provider',
            ) ?? false,
        ),
      )
      .toBe(true)

    await page.getByTestId('devices-access-rename-passkey').click()
    await page
      .getByTestId('devices-access-passkey-name-input')
      .fill('Must stay with Personal')
    await workIdentity.click()
    await expect(
      page.getByTestId('devices-access-passkey-name-input'),
    ).toHaveCount(0)
    const lockVault = page.getByTestId('header-lock-vault-btn')
    await expect(lockVault).toBeVisible()
    // Locking replaces the authenticated shell synchronously. Dispatch from
    // the DOM so Playwright does not retry the already-completed click after
    // its target disappears during that same action.
    await lockVault.evaluate((button) => button.click())
    await expect(
      page.getByTestId('login-gate').getByTestId('devices-access-dashboard'),
    ).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
    const dashboardVaultIsAuthenticated = () =>
      page.evaluate(() =>
        '__nookVault' in window
          ? (
              window as Window & {
                __nookVault: { readonly isAuthenticated: boolean }
              }
            ).__nookVault.isAuthenticated
          : false,
      )
    expect(await dashboardVaultIsAuthenticated()).toBe(false)
    await workIdentity.click()
    await expect(workIdentity).toHaveAttribute('data-selected', 'true')
    await page.getByTestId('devices-access-use-identity').click()
    await expect(
      page.getByTestId('devices-access-identity-protection-flow'),
    ).toBeVisible()
    expect(await dashboardVaultIsAuthenticated()).toBe(false)
    await page.getByTestId('device-protection-pin-unlock-input').fill('246810')
    await page.getByTestId('device-protection-pin-unlock-btn').click()
    await expect(workIdentity).toHaveAttribute('data-selected', 'true', {
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(
      page.getByTestId('devices-access-identity-protection-flow'),
    ).toHaveCount(0)
    expect(await dashboardVaultIsAuthenticated()).toBe(false)
    await expect(page.getByTestId('devices-access-key-inventory')).toBeVisible()
  })

  test('cancels staged identity creation when leaving the dashboard', async ({
    page,
  }) => {
    await connectLocalVault(page)
    await page.getByTestId('vault-devices-access-tab').click()
    await page.getByTestId('devices-access-add-identity').click()
    await expect(
      page.getByTestId('devices-access-add-identity-flow'),
    ).toBeVisible()

    await page.getByTestId('devices-access-back').click()
    await expect(page.getByTestId('devices-access-dashboard')).toHaveCount(0)
    expect(
      await page.evaluate(() => {
        if (!('__nookVault' in window)) {
          throw new Error('Vault runtime is not exposed')
        }
        return (
          window as Window & {
            __nookVault: {
              requireManager(): {
                readonly local_identity_creation_pending: boolean
              }
            }
          }
        ).__nookVault.requireManager().local_identity_creation_pending
      }),
    ).toBe(false)

    await page.getByTestId('vault-devices-access-tab').click()
    await expect(
      page.getByTestId('devices-access-identity-option'),
    ).toHaveCount(1)
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
    await expect(
      page.getByTestId('devices-access-relationship-details'),
    ).toHaveCount(0)

    await page.getByTestId('devices-access-layout-graph').click()
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
    const strengthVaults = page.getByTestId('devices-access-strength-vaults')
    await expect(strengthVaults).toHaveCount(1)
    await expect(strengthVaults).toContainText('Verified way in')

    await expect(page.getByTestId('devices-access-add-identity')).toBeEnabled()
    await expect(bridge).toBeVisible()

    await page.setViewportSize({ width: 390, height: 844 })
    await expect(identityRail).toBeVisible()
    await expect(identityKeys).toHaveCount(0)
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

    await expect(page.getByText('Inspect access evidence')).toHaveCount(0)
    await expect(page.getByText('What your browser reported')).toHaveCount(0)

    await expect(strengthVaults).toContainText('Verified way in')
    await expect(
      bridge.getByRole('article', { name: /Vault access/ }),
    ).toHaveCount(1)
    await page.getByTestId('devices-access-back').click()
    await expect(page.getByTestId('vault-devices-access-tab')).toBeFocused()
  })

  test('keeps the localized graph inside a narrow viewport', async ({
    page,
  }) => {
    await connectLocalVault(page)
    await page.getByTestId('vault-devices-access-tab').click()
    await openRelationshipGraph(page)
    await page.setViewportSize({ width: 320, height: 844 })
    await page.getByTestId('header-language-select').click()
    await page.getByTestId('header-language-option-ru').click()

    const bridge = page.getByTestId('devices-access-chain')
    await expect(bridge.getByRole('article')).toHaveCount(4)
    for (const article of await bridge.getByRole('article').all()) {
      await expect(article).toBeVisible()
    }
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
    await page.getByTestId('devices-access-add-identity').click()
    await page
      .getByTestId('device-protection-label-input')
      .fill('Unavailable passkey')
    await page.getByTestId('device-protection-setup-btn').click()
    await expect(page.getByTestId('device-protection-error')).toBeVisible()
    await page.getByTestId('device-protection-pin-input').fill('123456')
    await page.getByTestId('device-protection-pin-confirm').fill('123456')
    await page.getByTestId('device-protection-pin-setup-btn').click()

    const inventory = page.getByTestId('devices-access-key-inventory')
    await expect(inventory).toContainText('PIN or passphrase')
    await expect(page.getByTestId('devices-access-rename-passkey')).toHaveCount(
      0,
    )
    await expect(page.getByTestId('devices-access-credential-id')).toHaveCount(
      0,
    )
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
            requireManager(): IdentityDirectorySnapshotRequestOwner
          }
        }
      ).__nookVault
      const manager = vault.requireManager()
      const managerPrototype = Reflect.getPrototypeOf(
        manager,
      ) as IdentityDirectorySnapshotRequestOwner
      manager.identity_directory_snapshot_request = () => {
        const request =
          managerPrototype.identity_directory_snapshot_request.call(manager)
        const resolve = request.resolve.bind(request)
        request.resolve = async () => {
          const snapshot = await resolve()
          return new Proxy(snapshot, {
            get(target, property) {
              if (property === 'deviceAccess') {
                return () => {
                  const access = target.deviceAccess()
                  return new Proxy(access, {
                    get(accessTarget, accessProperty) {
                      if (
                        accessProperty === 'passkeyName' ||
                        accessProperty === 'providerLabel'
                      ) {
                        return {
                          kind: unknownTextKind,
                          free(): void {
                            // Browser fixture values do not own WASM memory.
                          },
                        }
                      }
                      const value = Reflect.get(
                        accessTarget,
                        accessProperty,
                        accessTarget,
                      )
                      return typeof value === 'function'
                        ? value.bind(accessTarget)
                        : value
                    },
                  })
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
    const inventory = page.getByTestId('devices-access-key-inventory')
    await expect(inventory).toContainText('Unnamed passkey', {
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(
      page.getByTestId('devices-access-rename-passkey'),
    ).toBeVisible()
    await expect(page.getByText('What your browser reported')).toHaveCount(0)
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
            requireManager(): IdentityDirectorySnapshotRequestOwner
          }
        }
      ).__nookVault
      const manager = vault.requireManager()
      const managerPrototype = Reflect.getPrototypeOf(
        manager,
      ) as IdentityDirectorySnapshotRequestOwner
      manager.identity_directory_snapshot_request = () => {
        const request =
          managerPrototype.identity_directory_snapshot_request.call(manager)
        const resolve = request.resolve.bind(request)
        request.resolve = async () => {
          const snapshot = await resolve()
          return new Proxy(snapshot, {
            get(target, property) {
              if (property === 'deviceAccess') {
                return () => {
                  const access = target.deviceAccess()
                  return new Proxy(access, {
                    get(accessTarget, accessProperty) {
                      if (accessProperty === 'protection') {
                        return companionProtection
                      }
                      const value = Reflect.get(
                        accessTarget,
                        accessProperty,
                        accessTarget,
                      )
                      return typeof value === 'function'
                        ? value.bind(accessTarget)
                        : value
                    },
                  })
                }
              }
              const value = Reflect.get(target, property, target)
              return typeof value === 'function' ? value.bind(target) : value
            },
          })
        }
        return request
      }
    }, DeviceAccessProtectionKind.CompanionSession)

    await page.getByTestId('vault-devices-access-tab').click()
    await openRelationshipGraph(page)
    const bridge = page.getByTestId('devices-access-chain')
    await expect(bridge).toContainText('Paired device identity', {
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(bridge).toContainText('Paired-device identity')
    await expect(bridge).toContainText('Reported by paired device')
    await expect(bridge).not.toContainText('This browser')
    await expect(page.getByTestId('devices-access-panel')).toHaveCount(0)
  })

  test('keeps known vaults visible after identity recovery reset', async ({
    page,
  }, testInfo) => {
    await connectLocalVault(page)
    await page.getByTestId('vault-devices-access-tab').click()
    await openRelationshipGraph(page)
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
      ).toHaveText('Authenticate', {
        timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
      })
      await page.evaluate(() => {
        history.replaceState(history.state, '', '/devices-access')
        window.dispatchEvent(new PopStateEvent('popstate'))
      })

      await expect(page.getByTestId('login-gate')).toBeVisible({
        timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
      })
      const passkeyOverlay = page.getByTestId('passkey-auth-overlay')
      const passkeyOverlayAppeared = await passkeyOverlay
        .waitFor({ state: 'visible', timeout: 5_000 })
        .then(() => true)
        .catch(() => false)
      if (passkeyOverlayAppeared) {
        await page.getByTestId('passkey-auth-overlay-dismiss').click()
        await expect(passkeyOverlay).toBeHidden()
      }
      const loginDevicesAccess = page.getByTestId('login-devices-access')
      if (await loginDevicesAccess.isVisible()) {
        await loginDevicesAccess.click()
      } else {
        await expect(page.getByTestId('devices-access-dashboard')).toBeVisible({
          timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
        })
      }
      await expect(
        page.getByTestId('devices-access-no-identities'),
      ).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
      await expect(
        page.getByTestId('devices-access-add-identity'),
      ).toBeEnabled()
      await expect(
        page.getByTestId('devices-access-prepare-browser'),
      ).toHaveCount(0)
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
    await openRelationshipGraph(page)
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
            const keyringRequest = store.get('local_identity_keyring_v1')
            keyringRequest.onsuccess = () => {
              const keyringRaw = keyringRequest.result
              if (typeof keyringRaw !== 'string') {
                reject(new Error('Local identity keyring is missing'))
                return
              }
              const keyring = JSON.parse(keyringRaw) as {
                entries: Array<{ appId: string }>
              }
              const appId = keyring.entries[0]?.appId
              if (!appId) {
                reject(new Error('Local identity keyring has no app key'))
                return
              }
              const profileKey = `device_access_profile:${appId}`
              const profileRequest = store.get(profileKey)
              profileRequest.onsuccess = () => {
                const raw = profileRequest.result
                if (typeof raw !== 'string') {
                  reject(new Error('Device access profile is missing'))
                  return
                }
                const profile = JSON.parse(raw) as { verifiedVaults: string[] }
                profile.verifiedVaults = []
                store.put(JSON.stringify(profile), profileKey)
              }
              profileRequest.onerror = () => reject(profileRequest.error)
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
    await openRelationshipGraph(page)

    const chain = page.getByTestId('devices-access-chain')
    await expect(chain).toContainText('0 vaults')
    await expect(
      page.getByTestId('devices-access-strength-vaults'),
    ).toHaveCount(0)
    await expect(page.getByRole('heading', { name: /0 vaults/ })).toBeVisible()

    await expect(chain).not.toContainText('Verified way in')
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
    await openRelationshipGraph(page)
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
    await page.getByTestId('header-lock-vault-btn').click()
    // Locking from /devices-access keeps that URL, so login opens Access directly.
    await expect(page).toHaveURL(/\/devices-access$/)
    await openRelationshipGraph(page)
    await expect(
      page.getByTestId('devices-access-identity-state'),
    ).toContainText('Identity locked', {
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(
      page.getByTestId('devices-access-identity-card'),
    ).toHaveAttribute('data-identity-state', 'Locked')
    await expect(
      page.getByTestId('devices-access-strength-vaults'),
    ).toContainText('Verified way in')
    await expect(page.getByText('Inspect access evidence')).toHaveCount(0)
  })
})
