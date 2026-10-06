import {
  DeviceAccessProtectionKind,
  NookIdentityMemberLabelKind,
  type NookVaultManager,
  type NookIdentityDirectorySnapshot,
  type NookIdentitySnapshot,
  type NookIdentityMemberSnapshot,
} from '$lib/nook-wasm/nook_wasm'
import { expect, test, type Locator } from '../fixtures'
import { UnlockMethod } from '$lib/components/login/login-unlock-state'
import {
  addVaultPassword,
  connectLocalVault,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  installPasskeyMock,
  prepareTwoProtectedIdentitiesWithoutVault,
  selectLoginUnlockMethod,
} from '../helpers'

const BEAT_MS = 650

test('keeps access reachable in the compact authenticated header', async ({
  page,
}) => {
  await connectLocalVault(page)
  await page.setViewportSize({ width: 320, height: 844 })

  const headerDevicesAccess = page.getByTestId('header-devices-access-btn')
  await expect(headerDevicesAccess).toBeVisible()
  await expect(headerDevicesAccess).toBeInViewport()
  await page.getByTestId('header-mobile-tools-btn').click()
  const mobileTools = page.getByTestId('header-mobile-tools')
  await expect(mobileTools.getByTestId('header-language-select')).toBeVisible()
  await expect(
    mobileTools.getByTestId('header-mobile-theme-toggle-btn'),
  ).toBeVisible()
  await expect(
    mobileTools.getByTestId('header-mobile-help-open-btn'),
  ).toBeVisible()
  await expect(
    mobileTools.getByTestId('header-mobile-lock-vault-btn'),
  ).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    320,
  )
  await page.waitForTimeout(BEAT_MS)
  await page.keyboard.press('Escape')

  await headerDevicesAccess.click()
  await expect(page.getByTestId('devices-access-dashboard')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
})

test('walk the access chain from passkey to app to vaults', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('nook_e2e_manual_passkey', 'true')
  })
  await installPasskeyMock(page)
  await connectLocalVault(page)
  await addVaultPassword(page, 'Travel recovery', 'demo recovery passphrase')

  await page.getByTestId('header-lock-vault-btn').click()
  await expect(page.getByTestId('login-local-vault-detected')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  const identityContext = page.getByTestId('login-vault-identity-context')
  await expect(
    identityContext.getByTestId('login-vault-linked-identities'),
  ).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  await expect(identityContext).toContainText('Current browser')
  await page.waitForTimeout(BEAT_MS)

  await selectLoginUnlockMethod(page, UnlockMethod.Password)
  await page
    .getByTestId('login-password-entry-list')
    .getByRole('button', { name: 'Travel recovery' })
    .click()
  await page
    .getByTestId('login-password-input')
    .fill('demo recovery passphrase')
  await page.getByTestId('unlock-vault-btn').click()
  await expect(page.getByTestId('vault-admin-panel')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await expect(page.getByTestId('vault-devices-access-tab')).toHaveCount(0)
  await page.getByTestId('header-devices-access-btn').click()
  await expect(page).toHaveURL(/\/devices-access$/)
  const dashboard = page.getByTestId('devices-access-dashboard')
  await expect(dashboard).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  await page.getByTestId('devices-access-unlock-identity').click()
  await page.getByTestId('device-protection-unlock-btn').click()
  const identityRail = page.getByTestId('devices-access-identity-rail')
  const identityOptions = page.getByTestId('devices-access-identity-option')
  const keyInventory = page.getByTestId('devices-access-key-inventory')
  const keyRows = page.getByTestId('devices-access-key-row')
  await expect(identityRail).toBeVisible()
  await expect(identityOptions).toHaveCount(1)
  await expect(identityOptions).toHaveAttribute('data-selected', 'true')
  await expect(keyInventory).toBeVisible()
  await expect(keyRows).toHaveCount(1)
  await expect(keyRows.nth(0)).toHaveAttribute('data-kind', 'protector')
  const appsGroup = page.getByTestId('devices-access-apps-group')
  const app = appsGroup.getByTestId('devices-access-app')
  await expect(app).toHaveCount(1)
  await expect(keyInventory).toContainText('Passkey')
  const listPasskeyFacts = page.getByTestId('devices-access-passkey-facts')
  const keeperFact = listPasskeyFacts.locator('[data-kind="keeper"]')
  const passkeyIdFact = listPasskeyFacts.locator('[data-kind="fingerprint"]')
  const supportingFacts = listPasskeyFacts.locator(
    '[data-priority="supporting"]',
  )
  await expect(keeperFact).toHaveAttribute('data-priority', 'primary')
  await expect(keeperFact).toContainText('Stored with')
  await expect(passkeyIdFact).toHaveAttribute('data-priority', 'secondary')
  await expect(passkeyIdFact).toContainText('Passkey ID')
  await expect(passkeyIdFact).toContainText('passkey_')
  await expect(supportingFacts).toHaveCount(2)
  await expect(listPasskeyFacts).toContainText('First recorded by Nook')
  await expect(listPasskeyFacts).toContainText('Last used')
  await expect(
    keyInventory.getByText('Passkey · recoverable identity', { exact: true }),
  ).toHaveCount(0)
  await expect(appsGroup).toContainText('Apps')
  await expect(app).toContainText('Nook in this browser')
  await expect(
    keyInventory.getByRole('button', { name: 'Add app', exact: true }),
  ).toHaveCount(0)
  await expect(
    keyInventory.getByText(
      'Another Nook installation must request identity enrollment before it can be added.',
      { exact: true },
    ),
  ).toHaveCount(0)
  await expect(page.getByTestId('devices-access-app-id')).not.toBeVisible()
  await expect(
    page.getByTestId('devices-access-relationship-details'),
  ).toHaveCount(0)

  await expect(page.getByTestId('devices-access-add-identity')).toBeEnabled()
  await page.getByTestId('devices-access-add-identity').click()
  await expect(
    page.getByTestId('devices-access-add-identity-flow'),
  ).toBeVisible()
  await page.waitForTimeout(BEAT_MS)
  await page.getByTestId('devices-access-cancel-add-identity').click()
  await expect(keyInventory).toBeVisible()
  await page.waitForTimeout(BEAT_MS)

  await page.getByTestId('devices-access-layout-graph').click()
  await expect(keyInventory).toHaveCount(0)
  await expect(page.getByTestId('devices-access-identity-state')).toContainText(
    'Identity unlocked',
  )
  const browse = page.getByRole('navigation', { name: 'Browse by' })
  await expect(
    browse.getByRole('button', { name: 'Identity', exact: true }),
  ).toHaveCount(1)
  await expect(
    browse.getByRole('button', { name: 'Vault', exact: true }),
  ).toHaveCount(1)
  await expect(browse.getByRole('list')).toHaveCount(0)
  const chain = page.getByTestId('devices-access-chain')
  const graphPasskeyCard = page.getByTestId('devices-access-passkey-card')
  await expect(graphPasskeyCard).toContainText('Passkey ID')
  await expect(graphPasskeyCard).toContainText('passkey_')
  await expect(graphPasskeyCard).toContainText('Stored with')
  await expect(graphPasskeyCard).toContainText('First recorded by Nook')
  await expect(graphPasskeyCard).toContainText('Last used')
  await expect(chain).toContainText('App')
  await expect(chain).toContainText('Identity')
  await expect(chain).toContainText('Vaults')
  await expect(page.getByTestId('devices-access-strength-vaults')).toHaveCount(
    1,
  )
  await page.setViewportSize({ width: 240, height: 844 })
  await expect
    .poll(() =>
      chain.evaluate((element) => {
        const protection = element.querySelector(
          'article[aria-label*="Passkey"]',
        )
        if (!(protection instanceof HTMLElement)) return false

        const bridgeBounds = element.getBoundingClientRect()
        const protectionBounds = protection.getBoundingClientRect()
        const title = protection.querySelector('.node-heading strong')
        if (!(title instanceof HTMLElement)) return false
        return (
          protectionBounds.left >= bridgeBounds.left &&
          protectionBounds.right <= bridgeBounds.right &&
          title.scrollWidth <= title.clientWidth
        )
      }),
    )
    .toBe(true)
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.waitForTimeout(BEAT_MS)

  await page.getByTestId('devices-access-layout-list').click()
  await page.getByTestId('devices-access-rename-passkey').click()
  await page
    .getByTestId('devices-access-passkey-name-input')
    .fill('Personal devices passkey')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(keyInventory).toContainText('Personal devices passkey')
  await page.waitForTimeout(BEAT_MS)

  await page.getByTestId('devices-access-layout-graph').click()
  await expect(page.getByTestId('devices-access-passkey-card')).toContainText(
    'Personal devices passkey',
  )
  await expect(chain.getByRole('article', { name: /App: App/ })).toBeVisible()
  await page.waitForTimeout(BEAT_MS)

  await expect(
    page.getByTestId('devices-access-strength-vaults'),
  ).toContainText('Verified way in')
  await page.waitForTimeout(BEAT_MS)

  await page.getByTestId('devices-access-perspective-vaults').click()
  await expect(
    page.getByRole('heading', {
      name: /Verified identity access to Test vault: 1/,
    }),
  ).toBeVisible()
  await expect(chain).toContainText('Selected vault')
  await expect(chain).toContainText('App')
  await page.waitForTimeout(BEAT_MS)

  await page.getByTestId('header-lock-vault-btn').click()
  // Locking from /devices-access keeps that URL, so login opens Access directly.
  await expect(page).toHaveURL(/\/devices-access$/)
  await page.goto('/devices-access')
  await expect(page.getByTestId('devices-access-dashboard')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await page.getByTestId('devices-access-layout-graph').click()
  await expect(page.getByTestId('devices-access-identity-state')).toContainText(
    'Identity locked',
  )
  await expect(
    page.getByTestId('devices-access-strength-vaults'),
  ).toContainText('Verified way in')
  await page.waitForTimeout(BEAT_MS)
})

test('switch protected identities before creating a vault', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('nook_e2e_manual_passkey', 'true')
  })
  await installPasskeyMock(page)
  await prepareTwoProtectedIdentitiesWithoutVault(page)

  const identityOptions = page.getByTestId('devices-access-identity-option')
  const personalIdentity = identityOptions.filter({ hasText: 'Identity 1' })
  await personalIdentity.click()
  await page.waitForTimeout(BEAT_MS)
  await page.getByTestId('devices-access-use-identity').click()

  const loginDashboard = page
    .getByTestId('login-gate')
    .getByTestId('devices-access-dashboard')
  await expect(loginDashboard).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await expect(
    loginDashboard.getByTestId('devices-access-identity-protection-flow'),
  ).toBeVisible()
  await page.waitForTimeout(BEAT_MS)

  await page.getByTestId('device-protection-unlock-btn').click()
  await expect(personalIdentity).toHaveAttribute('data-selected', 'true', {
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await expect(page.getByTestId('devices-access-key-inventory')).toBeVisible()
  await page.waitForTimeout(BEAT_MS)
})

type PasskeyGroupFilter = {
  readonly has: Locator
}

type ExtensionAssociationDemoRequest = {
  readonly protection: DeviceAccessProtectionKind
  readonly missingProtection: DeviceAccessProtectionKind
  readonly labelKind: NookIdentityMemberLabelKind
}

type ExtensionAssociationDemoDescriptors = {
  readonly appId: PropertyDescriptor
  readonly currentBrowser: PropertyDescriptor
  readonly localProtection: PropertyDescriptor
  readonly protectionAssociation: PropertyDescriptor
  readonly labelKind: PropertyDescriptor
}

test('shows independent browser and extension passkeys with local-only rename', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('nook_e2e_manual_passkey', 'true')
  })
  await installPasskeyMock(page)
  await connectLocalVault(page)
  const request: ExtensionAssociationDemoRequest = {
    protection: DeviceAccessProtectionKind.PasskeyAntiHacker,
    missingProtection: DeviceAccessProtectionKind.Missing,
    labelKind: NookIdentityMemberLabelKind.Known,
  }
  // Presentation-only snapshot seam: real browser setup supplies native handles.
  // This demo does not execute extension handoff; domain and ABI tests cover it.
  await page.evaluate((request: ExtensionAssociationDemoRequest) => {
    const vault = window.__nookVault
    if (!vault) throw new Error('Vault runtime is unavailable')
    const admission = vault.admitManager()
    if (admission.isErr()) throw new Error('Browser manager is unavailable')

    class ExtensionAssociationDemo {
      private readonly read: NookVaultManager['identity_directory_snapshot_request']

      constructor(private readonly manager: NookVaultManager) {
        this.read = manager.identity_directory_snapshot_request.bind(manager)
      }

      install(): void {
        this.manager.identity_directory_snapshot_request = () =>
          this.snapshotRequest()
      }

      private snapshotRequest(): ReturnType<
        NookVaultManager['identity_directory_snapshot_request']
      > {
        const snapshotRequest = this.read()
        const resolve = snapshotRequest.resolve.bind(snapshotRequest)
        snapshotRequest.resolve = async () => this.directory(await resolve())
        return snapshotRequest
      }

      private directory(
        snapshot: NookIdentityDirectorySnapshot,
      ): NookIdentityDirectorySnapshot {
        const readIdentity = snapshot.identity.bind(snapshot)
        snapshot.identity = (index) => this.identity(readIdentity(index))
        return snapshot
      }

      private identity(identity: NookIdentitySnapshot): NookIdentitySnapshot {
        const readMembers = identity.members.bind(identity)
        identity.members = () => this.members(readMembers)
        return identity
      }

      private members(
        readMembers: NookIdentitySnapshot['members'],
      ): NookIdentityMemberSnapshot[] {
        const browserMembers = readMembers()
        const peerMembers = readMembers()
        for (const member of peerMembers) {
          const descriptors: ExtensionAssociationDemoDescriptors = {
            appId: { value: 'demo_extension_app' },
            currentBrowser: { value: false },
            localProtection: { value: request.missingProtection },
            protectionAssociation: { value: request.protection },
            labelKind: { value: request.labelKind },
          }
          Object.defineProperties(member, descriptors)
          member.label = () => 'Nook Extension'
          member.associated_passkey_name = () => 'Extension passkey'
          member.associated_passkey_fingerprint = () => 'passkey_extension_demo'
        }
        return [...browserMembers, ...peerMembers]
      }
    }
    new ExtensionAssociationDemo(admission.value).install()
  }, request)

  await page.getByTestId('header-devices-access-btn').click()
  const inventory = page.getByTestId('devices-access-key-inventory')
  await expect(inventory).toBeVisible()
  const groupFilter: PasskeyGroupFilter = {
    has: page.getByTestId('devices-access-key-row'),
  }
  const rows = inventory.locator('li').filter(groupFilter)
  await expect(rows).toHaveCount(2)
  const browserRow = rows.nth(0)
  const extensionRow = rows.nth(1)
  for (const row of [browserRow, extensionRow]) {
    await expect(row.getByTestId('devices-access-key-row')).toHaveAttribute(
      'data-kind',
      'protector',
    )
    await expect(row.getByTestId('devices-access-app')).toHaveCount(1)
  }
  await expect(browserRow).toContainText('Nook in this browser')
  await expect(extensionRow).toContainText('Extension passkey')
  await expect(extensionRow).toContainText('Nook Extension')
  const browserFingerprint = browserRow.locator('[data-kind="fingerprint"]')
  const extensionFingerprint = extensionRow.locator('[data-kind="fingerprint"]')
  await expect(browserFingerprint).toContainText('passkey_')
  await expect(extensionFingerprint).toContainText('passkey_extension_demo')
  expect(await browserFingerprint.textContent()).not.toBe(
    await extensionFingerprint.textContent(),
  )
  await expect(
    browserRow.getByTestId('devices-access-rename-passkey'),
  ).toHaveCount(1)
  await expect(
    extensionRow.getByTestId('devices-access-rename-passkey'),
  ).toHaveCount(0)
  await expect(page.getByTestId('devices-access-unlock-identity')).toHaveCount(
    0,
  )
  await page.waitForTimeout(BEAT_MS)
})
