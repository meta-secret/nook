import type { Locator } from '@playwright/test'
import { expect, test, type Page } from './fixtures'
import {
  addRecoveryPassphrase,
  addSecret,
  connectS3InFirstRun,
  createFirstRunKey,
  createIsolatedContext,
  disableVaultIdleLock,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  keepSecretOnS3,
  ManagePage,
  openIdentitiesPage,
  openManagePage,
  openStoreId,
  openVaultPage,
  readSecretOfVault,
  RECOVERY_PASSPHRASE_LABEL,
  triggerVaultSyncRefresh,
  uniqueS3KeyPrefix,
  uniqueSecretKey,
  UI_TIMEOUT_MS,
} from './helpers'
import type { KeptVault, S3KeptKeyring } from './helpers'
import { LocalS3Identity } from '../../nook-web-extension/scripts/local-s3'

const KEYRING_NAME = 'Recovered keyring'
const SECRET_VALUE = 'keyring-recovery-secret-value'
const LATER_VAULT_NAME = 'Vault added later'
const LATER_SECRET_VALUE = 'keyring-recovery-later-secret-value'

/** The only device of a keyring on S3, before it is lost. */
function keptKeyring(keyPrefix: string): S3KeptKeyring {
  return { keyPrefix, keyringName: KEYRING_NAME, secretValue: SECRET_VALUE }
}

/** After the passphrase exists, the keyring gets a second Simple vault with
 * its own secret. Opening the Devices page registers it with the keyring,
 * which grants its key to every member, the recovery passphrase too; Sync
 * now puts that grant on S3. */
async function addVaultAfterPassphrase(
  page: Page,
  first: string,
): Promise<KeptVault> {
  await openIdentitiesPage(page)
  await page.getByTestId('identity-new-vault').click()
  await expect(page.getByTestId('login-new-vault-panel')).toBeVisible()
  await page.getByTestId('login-vault-name-input').fill(LATER_VAULT_NAME)
  await page.getByTestId('login-create-additional-vault-btn').click()
  await expect
    .poll(() => openStoreId(page), { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
    .not.toBe(first)
  const storeId = await openStoreId(page)
  await disableVaultIdleLock(page)
  await openVaultPage(page)
  const later: KeptVault = {
    storeId,
    key: uniqueSecretKey('recovery-later'),
    value: LATER_SECRET_VALUE,
  }
  await addSecret(page, later.key, later.value)
  await triggerVaultSyncRefresh(page)
  await openManagePage(page, ManagePage.Devices)
  const syncNow = page.getByTestId('identity-sync-now-btn')
  await expect(syncNow).toBeEnabled({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  await syncNow.click()
  await expect(syncNow).toBeEnabled({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  return later
}

/** A new device after every device is lost: its own passkey, then the same
 * S3 location with another key, which lists the keyring it is not in. */
async function listKeyringOnNewDevice(
  device: Page,
  keyPrefix: string,
): Promise<Locator> {
  await device.goto('/app/')
  await createFirstRunKey(device)
  await connectS3InFirstRun(device, {
    keyPrefix,
    identity: LocalS3Identity.DeviceB,
  })
  const listed = device.locator(
    '[data-testid="setup-identity"][data-setup="requestToJoin"]',
  )
  await expect(listed).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  return listed
}

// Every test keeps its objects under its own key prefix in the shared local
// bucket, so the tests run in parallel and never see each other's keyrings.
test.describe('keyring recovery passphrase', () => {
  test('with every device lost, the words bring the keyring and all its vaults back', async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000)
    const keyPrefix = uniqueS3KeyPrefix('recovery-words')
    const secret = await keepSecretOnS3(page, keptKeyring(keyPrefix))
    const first: KeptVault = { storeId: await openStoreId(page), ...secret }
    const words = await addRecoveryPassphrase(page)
    const later = await addVaultAfterPassphrase(page, first.storeId)
    // From here the first device is lost: the new one reaches the keyring
    // only through S3 and the written-down words.

    const newContext = await createIsolatedContext(browser)
    try {
      const device = await newContext.newPage()
      const listed = await listKeyringOnNewDevice(device, keyPrefix)
      await listed.getByTestId('setup-identity-recover').click()
      const step = device.getByTestId('first-run-recover-step')
      await expect(step).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
      await expect(
        device.getByTestId('first-run-recover-passphrase-label'),
      ).toContainText(RECOVERY_PASSPHRASE_LABEL, {
        timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
      })

      // Words of the list that are not this passphrase's are refused, and
      // nothing joins.
      const typed = words.split(' ')
      const wrong = [...typed.slice(1), ...typed.slice(0, 1)].join(' ')
      await device.getByTestId('first-run-recover-words').fill(wrong)
      await device.getByTestId('first-run-recover-submit').click()
      await expect(
        device.getByTestId('first-run-recover-words-message'),
      ).not.toBeEmpty({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
      await expect(step).toBeVisible()

      // The words written down join this device. Both Simple vaults open,
      // the one added after the passphrase too, each with its secret.
      await device.getByTestId('first-run-recover-words').fill(words)
      await device.getByTestId('first-run-recover-submit').click()
      await expect(step).toHaveCount(0, {
        timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
      })
      expect(await readSecretOfVault(device, first)).toBe(first.value)
      expect(await readSecretOfVault(device, later)).toBe(later.value)

      // The device list says the passphrase let this device in.
      await openManagePage(device, ManagePage.Devices)
      await expect(device.getByTestId('device-recovered-by')).toContainText(
        RECOVERY_PASSPHRASE_LABEL,
        { timeout: UI_TIMEOUT_MS },
      )
    } finally {
      await newContext.close()
    }
  })

  test('a removed passphrase no longer recovers the keyring', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000)
    const keyPrefix = uniqueS3KeyPrefix('recovery-removed')
    await keepSecretOnS3(page, keptKeyring(keyPrefix))
    await addRecoveryPassphrase(page)

    await page.getByTestId('recovery-passphrase-remove').click()
    await page.getByTestId('recovery-passphrase-remove-confirm-btn').click()
    await expect(page.getByTestId('recovery-passphrase')).toHaveCount(0, {
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })

    const newContext = await createIsolatedContext(browser)
    try {
      const device = await newContext.newPage()
      const listed = await listKeyringOnNewDevice(device, keyPrefix)
      await expect(listed.getByTestId('setup-identity-join')).toBeVisible()
      await expect(listed.getByTestId('setup-identity-recover')).toHaveCount(0)
    } finally {
      await newContext.close()
    }
  })
})
