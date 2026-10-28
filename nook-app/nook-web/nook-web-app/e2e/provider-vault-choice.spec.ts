import { test, expect, type BrowserContext, type Page } from './fixtures'
import {
  addSecret,
  addVaultPassword,
  beginAddSyncProvider,
  clearBrowserVault,
  connectGoogleDriveGenesisDevice,
  createIsolatedContext,
  createLocalVaultOnLogin,
  disableVaultIdleLock,
  expandSettingsSection,
  installGoogleOAuthMock,
  listLocalVaultEntries,
  ManagePage,
  openManagePage,
  openVaultPage,
  openStorageSettings,
  revealSecretValue,
  uniqueSecretKey,
  waitForGoogleOAuthSignedIn,
  waitForSecretOnDevice,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  UI_TIMEOUT_MS,
} from './helpers'
import {
  E2eSyncProviderId,
  createSyncTarget,
  installSyncRemote,
  waitForSyncRemoteState,
  type LocalFileSyncE2eTarget,
} from './sync-provider'
import enLocale from '../../../nook-platform/nook-app-common/locales/en.json' with { type: 'json' }

const BACKUP_PASSWORD = 'correct horse battery staple vault'

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

test.describe('vaults another identity keeps in the Nook folder', () => {
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
    target = createSyncTarget('', 'vault-choice', E2eSyncProviderId.File)
  })

  test.afterAll(async () => {
    await deviceA?.close()
    await deviceB?.close()
    await contextA?.close()
    await contextB?.close()
  })

  test('merges a vault opened with its backup password into the open vault', async () => {
    // Browser A keeps a vault with a backup password in the account's folder.
    await connectGoogleDriveGenesisDevice(
      deviceA,
      target.pat,
      target.repoName,
      target.stub,
    )
    await disableVaultIdleLock(deviceA)
    const sharedKey = uniqueSecretKey('vault-choice-shared')
    const sharedValue = 'came-in-through-the-merge'
    await addSecret(deviceA, sharedKey, sharedValue)
    await addVaultPassword(deviceA, 'Recovery', BACKUP_PASSWORD)
    await waitForSyncRemoteState(
      target,
      (snapshot) => snapshot.secretIds.length >= 1,
    )
    const [vaultA] = await listLocalVaultEntries(deviceA)
    if (!vaultA?.store_id) throw new Error('browser A lists no vault')

    // Browser B has its own identity and a vault with its own records.
    await installSyncRemote(deviceB, target)
    await deviceB.goto('/app/')
    await clearBrowserVault(deviceB)
    await deviceB.reload()
    await createLocalVaultOnLogin(deviceB, 'Mine')
    await disableVaultIdleLock(deviceB)
    await addSecret(deviceB, uniqueSecretKey('vault-choice-own'), 'stays-mine')

    await openDriveVaultList(deviceB, target)
    const row = deviceB.locator(
      `[data-testid="provider-vault-row"][data-store-id="${vaultA.store_id}"]`,
    )
    // B's keys cannot open A's vault, but its backup password can; with
    // records of its own, B is offered a merge first.
    await expect(row).toHaveAttribute('data-access', 'backupPassword')
    await expect(row.getByTestId('provider-vault-use-instead')).toHaveCount(0)
    await expect(row.getByTestId('provider-vault-import')).toBeVisible()
    // A's identity is named by three words, and its public control log on
    // Drive says how many devices and vaults it has; nothing is decrypted.
    const identity = deviceB
      .getByTestId('provider-identity')
      .filter({ has: row })
    await expect(identity.getByTestId('provider-vault-identity')).toHaveText(
      /^Identity [a-z]+-[a-z]+-[a-z]+$/,
    )
    await expect(
      identity.getByTestId('provider-vault-identity-log'),
    ).toContainText([
      enLocale.provider_vaults.devices.replace('{count}', '1'),
      enLocale.provider_vaults.identity_vaults.replace('{count}', '1'),
      /^Newest device added /,
    ])

    await row.getByTestId('provider-vault-merge').click()
    // Choosing an action swaps Connect & sync for that action's button.
    await expect(deviceB.getByTestId('connect-provider-btn')).toHaveCount(0)
    await deviceB.getByTestId('provider-vault-action-btn').click()
    const password = deviceB.getByTestId('provider-vault-merge-password')
    const merge = deviceB.getByTestId('provider-vault-merge-confirm-btn')
    await expect(merge).toBeDisabled()
    // A wrong password opens nothing and says so.
    await password.fill('not the backup password')
    await merge.click()
    await expect(deviceB.getByTestId('google-oauth-error')).toContainText(
      enLocale.provider_vaults.merge_failed.replace(
        '{id}',
        vaultA.store_id.slice('store_'.length, 'store_'.length + 8),
      ),
      { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    await password.fill(BACKUP_PASSWORD)
    await merge.click()
    await expect(
      deviceB.getByTestId('provider-vault-merge-confirm'),
    ).toHaveCount(0, { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
    await expect(deviceB.getByTestId('app-success')).toContainText(
      enLocale.provider_vaults.merged.replace('{count}', '1'),
      { timeout: UI_TIMEOUT_MS },
    )

    await openVaultPage(deviceB)
    await waitForSecretOnDevice(deviceB, sharedKey)
    expect(await revealSecretValue(deviceB, sharedKey)).toBe(sharedValue)
  })
})

/** Pull the providers' events and refresh the open vault's access requests. */
async function syncAccessRequests(page: Page) {
  const failure = await page.evaluate(async () => {
    const vault = window.__nookVault
    if (!vault) return 'vault-unavailable'
    const synchronized = await vault.manualSync()
    if (synchronized.isErr()) return synchronized.error.translationKey
    const roster = await vault.hydrateMultiDeviceState()
    return roster.isErr() ? roster.error.translationKey : ''
  })
  expect(failure).toBe('')
}

test.describe('a vault nothing on this device opens', () => {
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
    target = createSyncTarget('', 'vault-access', E2eSyncProviderId.File)
  })

  test.afterAll(async () => {
    await deviceA?.close()
    await deviceB?.close()
    await contextA?.close()
    await contextB?.close()
  })

  test('is requested, approved by a member, then merges with this device key', async () => {
    // Browser A keeps a vault without a backup password.
    await connectGoogleDriveGenesisDevice(
      deviceA,
      target.pat,
      target.repoName,
      target.stub,
    )
    await disableVaultIdleLock(deviceA)
    const sharedKey = uniqueSecretKey('vault-access-shared')
    const sharedValue = 'came-in-after-approval'
    await addSecret(deviceA, sharedKey, sharedValue)
    await waitForSyncRemoteState(
      target,
      (snapshot) => snapshot.secretIds.length >= 1,
    )
    const [vaultA] = await listLocalVaultEntries(deviceA)
    if (!vaultA?.store_id) throw new Error('browser A lists no vault')

    await installSyncRemote(deviceB, target)
    await deviceB.goto('/app/')
    await clearBrowserVault(deviceB)
    await deviceB.reload()
    await createLocalVaultOnLogin(deviceB, 'Mine')
    await disableVaultIdleLock(deviceB)
    await addSecret(deviceB, uniqueSecretKey('vault-access-own'), 'stays-mine')

    await openDriveVaultList(deviceB, target)
    const row = deviceB.locator(
      `[data-testid="provider-vault-row"][data-store-id="${vaultA.store_id}"]`,
    )
    // Nothing here opens it: its identity offers only a passkey hunt and
    // a join, which requests access to each of its vaults.
    await expect(row).toHaveAttribute('data-access', 'locked')
    await expect(row.getByTestId('provider-vault-merge')).toHaveCount(0)
    await expect(row.getByTestId('provider-vault-import')).toHaveCount(0)
    await deviceB
      .getByTestId('provider-identity')
      .filter({ has: row })
      .getByTestId('provider-identity-ask-to-join')
      .click()
    await expect(row).toHaveAttribute('data-access', 'requested', {
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })

    // A member of the vault sees the request on its Devices page.
    await syncAccessRequests(deviceA)
    await openManagePage(deviceA, ManagePage.Devices)
    const request = deviceA.getByTestId('vault-access-request')
    await expect(request).toHaveCount(1, {
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await request.getByTestId('vault-access-request-approve').click()
    await expect(deviceA.getByTestId('app-success')).toContainText(
      enLocale.devices_card.access_granted_toast,
      { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    await expect(deviceA.getByTestId('vault-access-request')).toHaveCount(0)

    // Listed again, the vault opens with B's own key and merges.
    await deviceB.getByTestId('identity-page-back').click()
    await openDriveVaultList(deviceB, target)
    await expect(row).toHaveAttribute('data-access', 'granted', {
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await row.getByTestId('provider-vault-merge').click()
    await deviceB.getByTestId('provider-vault-action-btn').click()
    await expect(
      deviceB.getByTestId('provider-vault-merge-password'),
    ).toHaveCount(0)
    await deviceB.getByTestId('provider-vault-merge-confirm-btn').click()
    await expect(deviceB.getByTestId('app-success')).toContainText(
      enLocale.provider_vaults.merged.replace('{count}', '1'),
      { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    await openVaultPage(deviceB)
    await waitForSecretOnDevice(deviceB, sharedKey)
    expect(await revealSecretValue(deviceB, sharedKey)).toBe(sharedValue)
  })
})
