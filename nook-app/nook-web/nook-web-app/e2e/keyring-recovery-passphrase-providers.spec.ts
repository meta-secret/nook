import { expect, test, type Page } from './fixtures'
import {
  addRecoveryPassphrase,
  addSecret,
  clearBrowserVault,
  connectGoogleDriveGenesisDevice,
  connectLocalVault,
  connectS3OnRecoveryScreen,
  createIsolatedContext,
  disableVaultIdleLock,
  installGoogleOAuthMock,
  installPasskeyMock,
  keepSecretOnS3,
  openLoginProviderSetup,
  openStoreId,
  openVaultPage,
  readSecretOfVault,
  recoverListedKeyringWithWords,
  syncKeyringNow,
  uniqueS3KeyPrefix,
  uniqueSecretKey,
  waitForGoogleOAuthSignedIn,
} from './helpers'
import type { KeptVault } from './helpers'
import { LocalS3Identity } from '../../nook-web-extension/scripts/local-s3'
import {
  installLocalFolderPickerMock,
  localFolderSnapshot,
  waitForLocalFolderEventRecords,
  type LocalFolderRecord,
} from './local-folder-mock'
import { connectLocalFolderProviderFromSettings } from './local-folder-vaults'
import {
  E2eSyncProviderId,
  connectSyncGenesisDevice,
  createSyncTarget,
  installSyncRemote,
  waitForSyncRemoteState,
} from './sync-provider'

const SECRET_VALUE = 'keyring-recovery-provider-secret-value'

/** A fresh browser after every device is lost: nothing of the keyring is
 * here, and the recovery screen's provider picker is open. */
async function openRecoveryScreen(device: Page): Promise<void> {
  await device.goto('/app/')
  await clearBrowserVault(device)
  await device.reload()
  await openLoginProviderSetup(device)
}

/** The vault open on the lost browser, with a secret it keeps. */
async function keepSecret(page: Page, flow: string): Promise<KeptVault> {
  await disableVaultIdleLock(page)
  await openVaultPage(page)
  const kept: KeptVault = {
    storeId: await openStoreId(page),
    key: uniqueSecretKey(flow),
    value: SECRET_VALUE,
  }
  await addSecret(page, kept.key, kept.value)
  return kept
}

/** The identity log events a folder snapshot holds. */
function identityLogEvents(records: readonly LocalFolderRecord[]): number {
  return records.filter((record) =>
    /^meta-secret-nook\/idn_[^/]+\/log\/events\//.test(record.path),
  ).length
}

// On the recovery screen every sync provider lists the one keyring it holds
// when a recovery passphrase can open it, and its words let a fresh browser
// in: Google Drive through its Nook folder list, the others through the
// keyring choice their discovery shows.
test.describe('recovering a keyring with its passphrase on every sync provider', () => {
  test.setTimeout(240_000)

  test('Google Drive', async ({ page, browser }) => {
    const target = createSyncTarget(
      '',
      'recovery-words-drive',
      E2eSyncProviderId.File,
    )
    // The Nook folder holds another keyring too: the recovered one must
    // open its own vault, not the folder's list of keyrings.
    await connectGoogleDriveGenesisDevice(
      page,
      target.pat,
      target.repoName,
      target.stub,
    )
    await keepSecret(page, 'recovery-drive-other')
    await waitForSyncRemoteState(
      target,
      (snapshot) => snapshot.secretIds.length >= 1,
    )
    await connectGoogleDriveGenesisDevice(
      page,
      target.pat,
      target.repoName,
      target.stub,
    )
    const kept = await keepSecret(page, 'recovery-drive')
    await waitForSyncRemoteState(
      target,
      (snapshot) => snapshot.secretIds.length >= 2,
    )
    const words = await addRecoveryPassphrase(page)
    await syncKeyringNow(page)

    const newContext = await createIsolatedContext(browser)
    try {
      const device = await newContext.newPage()
      await installSyncRemote(device, target)
      await installGoogleOAuthMock(device, target.pat)
      await openRecoveryScreen(device)
      await device.getByTestId('provider-option-oauth-file').click()
      await device.getByTestId('google-sign-in-btn').click()
      await waitForGoogleOAuthSignedIn(device)
      await recoverListedKeyringWithWords(
        device,
        kept,
        device.getByTestId('connect-provider-btn'),
        words,
      )
      expect(await readSecretOfVault(device, kept)).toBe(kept.value)
    } finally {
      await newContext.close()
    }
  })

  test('S3', async ({ page, browser }) => {
    const keyPrefix = uniqueS3KeyPrefix('recovery-words-s3')
    const secret = await keepSecretOnS3(page, {
      keyPrefix,
      keyringName: 'S3 keyring',
      secretValue: SECRET_VALUE,
    })
    const kept: KeptVault = { storeId: await openStoreId(page), ...secret }
    const words = await addRecoveryPassphrase(page)
    await syncKeyringNow(page)

    const newContext = await createIsolatedContext(browser)
    try {
      const device = await newContext.newPage()
      await openRecoveryScreen(device)
      await connectS3OnRecoveryScreen(device, {
        keyPrefix,
        identity: LocalS3Identity.DeviceB,
      })
      await recoverListedKeyringWithWords(
        device,
        kept,
        device.getByTestId('remote-vault-choice-apply'),
        words,
      )
      expect(await readSecretOfVault(device, kept)).toBe(kept.value)
    } finally {
      await newContext.close()
    }
  })

  test('GitHub', async ({ page, browser }) => {
    const target = createSyncTarget(
      '',
      'recovery-words-github',
      E2eSyncProviderId.GitHub,
    )
    await connectSyncGenesisDevice(page, target)
    const kept = await keepSecret(page, 'recovery-github')
    await waitForSyncRemoteState(
      target,
      (snapshot) => snapshot.secretIds.length >= 1,
    )
    const words = await addRecoveryPassphrase(page)
    await syncKeyringNow(page)

    const newContext = await createIsolatedContext(browser)
    try {
      const device = await newContext.newPage()
      await installSyncRemote(device, target)
      await openRecoveryScreen(device)
      await device.getByTestId('provider-option-github').click()
      await expect(device.getByTestId('github-token-setup')).toBeVisible()
      await device.getByTestId('github-repo-input').fill(target.repoName)
      await device.getByTestId('github-pat-input').fill(target.pat)
      await device.getByTestId('connect-provider-btn').click()
      await recoverListedKeyringWithWords(
        device,
        kept,
        device.getByTestId('remote-vault-choice-apply'),
        words,
      )
      expect(await readSecretOfVault(device, kept)).toBe(kept.value)
    } finally {
      await newContext.close()
    }
  })

  test('local folder', async ({ page, browser }) => {
    await installPasskeyMock(page)
    await installLocalFolderPickerMock(page)
    await page.goto('/app/')
    await clearBrowserVault(page)
    await page.reload()
    await connectLocalVault(page)
    await connectLocalFolderProviderFromSettings(page)
    const kept = await keepSecret(page, 'recovery-folder')
    await waitForLocalFolderEventRecords(page)
    const logged = identityLogEvents(await localFolderSnapshot(page))
    const words = await addRecoveryPassphrase(page)
    await syncKeyringNow(page)
    // The passphrase reaches the folder as one more identity log event.
    await expect
      .poll(async () => identityLogEvents(await localFolderSnapshot(page)), {
        timeout: 30_000,
      })
      .toBeGreaterThan(logged)
    const folder = await localFolderSnapshot(page)

    const newContext = await createIsolatedContext(browser)
    try {
      const device = await newContext.newPage()
      // The new browser picks the same folder: its picker mock starts from
      // the lost browser's files, then keeps its own writes across reloads.
      await device.addInitScript((records: LocalFolderRecord[]) => {
        const key = '__nookE2eLocalFolderFiles'
        if (!sessionStorage.getItem(key))
          sessionStorage.setItem(key, JSON.stringify(records))
      }, folder)
      await installLocalFolderPickerMock(device)
      await openRecoveryScreen(device)
      await device.getByTestId('provider-option-local-folder').click()
      await device.getByTestId('login-choose-local-folder-btn').click()
      await device.getByTestId('login-connect-local-folder-btn').click()
      await recoverListedKeyringWithWords(
        device,
        kept,
        device.getByTestId('remote-vault-choice-apply'),
        words,
      )
      expect(await readSecretOfVault(device, kept)).toBe(kept.value)
    } finally {
      await newContext.close()
    }
  })
})
