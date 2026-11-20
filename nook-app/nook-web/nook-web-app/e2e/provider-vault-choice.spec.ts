import { test, expect, type BrowserContext, type Page } from './fixtures'
import {
  addSecret,
  beginAddSyncProvider,
  clearBrowserVault,
  createFirstRunKey,
  createIsolatedContext,
  createLocalVaultOnLogin,
  disableVaultIdleLock,
  expandSettingsSection,
  installGoogleOAuthMock,
  listLocalVaultEntries,
  openIdentityPanel,
  openLoginProviderSetup,
  openStorageSettings,
  openVaultPage,
  openVaultRow,
  uniqueSecretKey,
  waitForGoogleOAuthSignedIn,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
} from './helpers'
import {
  E2eSyncProviderId,
  createSyncTarget,
  installSyncRemote,
  waitForSyncRemoteState,
  type LocalFileSyncE2eTarget,
} from './sync-provider'
import enLocale from '../../../nook-platform/nook-app-common/locales/en.json' with { type: 'json' }

/** Open the Google Drive setup from settings and sign in, stopping at the
 * Connect & sync step where the Nook folder's vaults are listed. */
async function openDriveVaultList(page: Page, target: LocalFileSyncE2eTarget) {
  await installGoogleOAuthMock(page, target.pat)
  await openStorageSettings(page)
  await expandSettingsSection(page, 'storage')
  await beginAddSyncProvider(page)
  await page.getByTestId('provider-option-oauth-file').click()
  await page.getByTestId('google-sign-in-btn').click()
  await waitForGoogleOAuthSignedIn(page)
  await expect(page.getByTestId('google-drive-vaults')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
}

test.describe('an identity another browser keeps in the Nook folder', () => {
  test.setTimeout(180_000)

  let contextA: BrowserContext
  let contextB: BrowserContext
  let deviceA: Page
  let deviceB: Page
  let target: LocalFileSyncE2eTarget

  test.beforeAll(async ({ browser }) => {
    contextA = await createIsolatedContext(browser)
    contextB = await createIsolatedContext(browser)
    deviceA = await contextA.newPage()
    deviceB = await contextB.newPage()
    target = createSyncTarget('', 'identity-choice', E2eSyncProviderId.File)
  })

  test.afterAll(async () => {
    await deviceA?.close()
    await deviceB?.close()
    await contextA?.close()
    await contextB?.close()
  })

  test('lists the signed name and offers the action for the current keyring', async ({
    browser,
  }) => {
    const createdName = 'Travel keyring'
    const renamedName = 'Shared travel keyring'

    // Browser A names its fresh keyring directly on Drive.
    await installSyncRemote(deviceA, target)
    await installGoogleOAuthMock(deviceA, target.pat)
    await deviceA.goto('/vault')
    await clearBrowserVault(deviceA)
    await deviceA.reload()
    await createFirstRunKey(deviceA)
    await deviceA.getByTestId('first-run-google-sign-in').click()
    await deviceA.getByTestId('first-run-create-new-identity').click()
    await deviceA.getByTestId('first-run-identity-name-input').fill(createdName)
    await deviceA.getByTestId('first-run-identity-create-btn').click()
    await expect(openVaultRow(deviceA)).toContainText(
      enLocale.workspace.first_identity.vault_label,
      { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    await disableVaultIdleLock(deviceA)
    await openVaultPage(deviceA)
    await addSecret(deviceA, uniqueSecretKey('identity-choice'), 'kept-by-a')
    await waitForSyncRemoteState(
      target,
      (snapshot) => snapshot.secretIds.length >= 1,
    )
    const [vaultA] = await listLocalVaultEntries(deviceA)
    if (!vaultA?.store_id) throw new Error('browser A lists no vault')

    const freshContext = await createIsolatedContext(browser)
    try {
      const reader = await freshContext.newPage()
      await installSyncRemote(reader, target)
      await installGoogleOAuthMock(reader, target.pat)
      await reader.goto('/vault')
      await openLoginProviderSetup(reader)
      await reader.getByTestId('provider-option-oauth-file').click()
      await reader.getByTestId('google-sign-in-btn').click()
      await waitForGoogleOAuthSignedIn(reader)
      const card = reader.getByTestId('provider-identity')
      await expect(card).toHaveAttribute('data-standing', 'unchecked')
      await expect(card.getByTestId('provider-vault-identity')).toHaveText(
        createdName,
      )
      await expect(card.getByTestId('provider-identity-facts')).toHaveText(
        /^[a-z]+-[a-z]+-[a-z]+$/,
      )
    } finally {
      await freshContext.close()
    }

    await openIdentityPanel(deviceA)
    await deviceA.getByTestId('identity-overview-rename').click()
    await deviceA.getByTestId('identity-rename-input').fill(renamedName)
    await deviceA.getByTestId('identity-rename-save').click()
    await expect(deviceA.getByTestId('identity-rename-input')).toHaveCount(0)
    await expect(deviceA.getByTestId('identity-card-label')).toHaveText(
      renamedName,
    )

    // Browser B has its own identity and lists the same Nook folder.
    await installSyncRemote(deviceB, target)
    await deviceB.goto('/app/')
    await clearBrowserVault(deviceB)
    await deviceB.reload()
    await createLocalVaultOnLogin(deviceB, 'Mine')
    await disableVaultIdleLock(deviceB)
    await deviceB.setViewportSize({ width: 1440, height: 900 })
    await openDriveVaultList(deviceB, target)

    // A's identity is listed once; B's passkey is not a member of it, so
    // its one action asks to join. Nothing is planned or decided.
    const identityA = deviceB.getByTestId('setup-identity')
    await expect(identityA).toHaveCount(1)
    const cardWidth = await identityA.evaluate(
      (card) => card.getBoundingClientRect().width,
    )
    expect(cardWidth).toBeLessThanOrEqual(512)
    await expect(identityA).toHaveAttribute('data-setup', 'requestToJoin')
    await expect(identityA.getByTestId('provider-vault-identity')).toHaveText(
      renamedName,
    )
    await expect(identityA.getByTestId('provider-identity-facts')).toHaveText(
      /^[a-z]+-[a-z]+-[a-z]+$/,
    )
    await expect(
      identityA.getByTestId('provider-identity-standing'),
    ).toHaveText(enLocale.first_run.identity_not_member)
    const devices = identityA.getByTestId('provider-keyring-devices')
    const deviceSummary = devices.locator(':scope > summary')
    await expect(deviceSummary).toHaveText(
      enLocale.provider_vaults.devices_disclosure.replace('{count}', '1'),
    )
    await expect(devices).not.toHaveAttribute('open', '')
    await deviceSummary.press('Enter')
    await expect(devices.getByRole('listitem')).toHaveCount(1)
    const device = devices.getByRole('listitem')
    await expect(device).toContainText(/[0-9a-f]{16}$/)
    await expect(device.getByRole('button')).toHaveCount(0)
    const vaults = identityA.getByTestId('provider-keyring-vaults')
    const vaultSummary = vaults.locator(':scope > summary')
    await expect(vaultSummary).toHaveText(
      enLocale.provider_vaults.vaults_disclosure.replace('{count}', '1'),
    )
    await expect(vaults).not.toHaveAttribute('open', '')
    await vaultSummary.press('Space')
    await expect(vaults.getByRole('listitem')).toHaveCount(1)
    await expect(
      vaults.getByText(vaultA.store_id, { exact: true }),
    ).toBeVisible()
    await expect(vaults).toContainText(
      enLocale.provider_vaults.vault_name_unavailable,
    )
    await expect(vaults.getByRole('list').getByRole('button')).toHaveCount(0)
    await expect(
      identityA.getByTestId('provider-identity-find-passkey'),
    ).toHaveText(enLocale.provider_vaults.reveal_details)
    await expect(identityA.getByTestId('setup-identity-join')).toHaveCount(1)
    await expect(deviceB.getByTestId('provider-identity-decision')).toHaveCount(
      0,
    )

    // Or the identity in use is saved there as a new identity.
    const create = deviceB.getByTestId('connect-provider-btn')
    await expect(create).toContainText(enLocale.first_run.sync_create_title)
    await expect(create).toContainText(
      enLocale.provider_identities.new_identity_detail.replace(
        '{identity}',
        'Mine',
      ),
    )
  })
})
