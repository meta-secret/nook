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

  test('offers one action for it, and the step saves the identity in use', async () => {
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

    // A's identity is listed once; B's passkey is not a member of it, so
    // its one action asks to join. Nothing is planned or decided.
    const identityA = deviceB.getByTestId('setup-identity')
    await expect(identityA).toHaveCount(1)
    await expect(identityA).toHaveAttribute('data-setup', 'requestToJoin')
    await expect(identityA.getByTestId('provider-vault-identity')).toHaveText(
      /^[a-z]+-[a-z]+-[a-z]+$/,
    )
    await expect(
      identityA.getByTestId('provider-identity-standing'),
    ).toHaveText(enLocale.first_run.identity_not_member)
    await expect(identityA.getByTestId('setup-identity-join')).toHaveCount(1)
    await expect(deviceB.getByTestId('provider-identity-decision')).toHaveCount(
      0,
    )

    // The step's one button saves the identity in use there.
    await expect(deviceB.getByTestId('connect-provider-btn')).toHaveText(
      enLocale.provider_identities.save_here.replace('{identity}', 'Mine'),
    )
  })
})
