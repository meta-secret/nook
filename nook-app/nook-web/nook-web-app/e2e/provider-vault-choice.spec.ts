import { test, expect, type BrowserContext, type Page } from './fixtures'
import {
  addSecret,
  beginAddSyncProvider,
  clearBrowserVault,
  connectGoogleDriveGenesisDevice,
  createIsolatedContext,
  createLocalVaultOnLogin,
  disableVaultIdleLock,
  expandSettingsSection,
  installGoogleOAuthMock,
  listLocalVaultEntries,
  openStorageSettings,
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

  test('is decided as a whole, and a decision changes the one button', async () => {
    // Browser A keeps a vault in the Nook folder.
    await connectGoogleDriveGenesisDevice(
      deviceA,
      target.pat,
      target.repoName,
      target.stub,
    )
    await disableVaultIdleLock(deviceA)
    await addSecret(deviceA, uniqueSecretKey('identity-choice'), 'kept-by-a')
    await waitForSyncRemoteState(
      target,
      (snapshot) => snapshot.secretIds.length >= 1,
    )
    const [vaultA] = await listLocalVaultEntries(deviceA)
    if (!vaultA?.store_id) throw new Error('browser A lists no vault')

    // Browser B has its own identity and lists the same Nook folder.
    await installSyncRemote(deviceB, target)
    await deviceB.goto('/app/')
    await clearBrowserVault(deviceB)
    await deviceB.reload()
    await createLocalVaultOnLogin(deviceB, 'Mine')
    await disableVaultIdleLock(deviceB)
    await openDriveVaultList(deviceB, target)

    // A's vault is listed under A's identity, which nothing on B opens.
    const identityA = deviceB.getByTestId('provider-identity').filter({
      has: deviceB.locator(
        `[data-testid="provider-vault-row"][data-store-id="${vaultA.store_id}"]`,
      ),
    })
    await expect(identityA).toHaveCount(1)
    await expect(identityA).toHaveAttribute('data-standing', 'unchecked')
    await expect(identityA.getByTestId('provider-vault-identity')).toHaveText(
      /^[a-z]+-[a-z]+-[a-z]+$/,
    )
    const decisions = identityA.getByTestId('provider-identity-decision')
    await expect(decisions).toHaveCount(2)
    await expect(decisions.nth(0)).toHaveAttribute('data-decision', 'leave')
    await expect(decisions.nth(0)).toHaveAttribute('aria-checked', 'true')
    await expect(decisions.nth(1)).toHaveAttribute('data-decision', 'askToJoin')

    // Picking a decision plans it and renames the step's one button; Leave
    // as is takes it back out. Nothing runs until the button is pressed.
    const connect = deviceB.getByTestId('connect-provider-btn')
    await expect(connect).toHaveText(enLocale.auth_storage.connect_and_sync)
    await decisions.nth(1).click()
    await expect(deviceB.getByTestId('provider-identity-plan-row')).toHaveCount(
      1,
    )
    await expect(connect).toHaveText(enLocale.provider_identities.connect_apply)
    await decisions.nth(0).click()
    await expect(deviceB.getByTestId('provider-identity-plan')).toHaveCount(0)
    await expect(connect).toHaveText(enLocale.auth_storage.connect_and_sync)
  })
})
