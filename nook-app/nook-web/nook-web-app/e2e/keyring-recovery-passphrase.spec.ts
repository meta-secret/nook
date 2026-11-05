import type { Locator } from '@playwright/test'
import { expect, test, type Page } from './fixtures'
import {
  connectS3InFirstRun,
  createFirstRunKey,
  createIsolatedContext,
  disableVaultIdleLock,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  keepSecretOnS3,
  ManagePage,
  openManagePage,
  openVaultPage,
  revealSecretValue,
  uniqueS3KeyPrefix,
  UI_TIMEOUT_MS,
  waitForSecretOnDevice,
} from './helpers'
import type { S3KeptKeyring } from './helpers'
import { LocalS3Identity } from '../../nook-web-extension/scripts/local-s3'

const KEYRING_NAME = 'Recovered keyring'
const PASSPHRASE_LABEL = 'Paper in the safe'
const SECRET_VALUE = 'keyring-recovery-secret-value'

/** The only device of a keyring on S3, before it is lost. */
function keptKeyring(keyPrefix: string): S3KeptKeyring {
  return { keyPrefix, keyringName: KEYRING_NAME, secretValue: SECRET_VALUE }
}

/** On the Keys page, add a recovery passphrase: name it, keep Standard,
 * read the words shown once, and type them back. The words are returned
 * as they were written down. */
async function addRecoveryPassphrase(page: Page): Promise<string> {
  await openManagePage(page, ManagePage.Keys)
  await page.getByTestId('recovery-passphrase-add').click()
  await page.getByTestId('recovery-passphrase-label').fill(PASSPHRASE_LABEL)
  await page.getByTestId('recovery-passphrase-strength-standard').click()
  await page.getByTestId('recovery-passphrase-generate').click()
  const words = page.getByTestId('recovery-passphrase-word')
  await expect(words).toHaveCount(4, { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  const written = (await words.allTextContents()).map((word) => word.trim())
  await page.getByTestId('recovery-passphrase-written').click()
  await expect(words).toHaveCount(0)
  await page
    .getByTestId('recovery-passphrase-confirm-words')
    .fill(written.join(' '))
  await page.getByTestId('recovery-passphrase-confirm').click()
  await expect(page.getByTestId('recovery-passphrase')).toContainText(
    PASSPHRASE_LABEL,
    { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
  )
  return written.join(' ')
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
  test('with every device lost, the words bring the keyring and its vault back', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000)
    const keyPrefix = uniqueS3KeyPrefix('recovery-words')
    const secret = await keepSecretOnS3(page, keptKeyring(keyPrefix))
    const words = await addRecoveryPassphrase(page)
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
      ).toContainText(PASSPHRASE_LABEL, {
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

      // The words written down join this device; the keyring's vault opens
      // with the secret kept before the loss.
      await device.getByTestId('first-run-recover-words').fill(words)
      await device.getByTestId('first-run-recover-submit').click()
      await expect(step).toHaveCount(0, {
        timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
      })
      await disableVaultIdleLock(device)
      await openVaultPage(device)
      await waitForSecretOnDevice(device, secret.key)
      expect(await revealSecretValue(device, secret.key)).toBe(secret.value)

      // The device list says the passphrase let this device in.
      await openManagePage(device, ManagePage.Devices)
      await expect(device.getByTestId('device-recovered-by')).toContainText(
        PASSPHRASE_LABEL,
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
