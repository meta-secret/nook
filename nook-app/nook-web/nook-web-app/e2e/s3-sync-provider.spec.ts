import { expect, test, type Page } from './fixtures'
import {
  addSecret,
  connectS3InFirstRun,
  createFirstRunKey,
  createIsolatedContext,
  createKeyringOnS3,
  disableVaultIdleLock,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  joinIdentityThroughCode,
  ManagePage,
  openManagePage,
  openVaultPage,
  revealSecretValue,
  triggerVaultSyncRefresh,
  uniqueS3KeyPrefix,
  uniqueSecretKey,
  waitForSecretOnDevice,
} from './helpers'
import { LocalS3Identity } from '../../nook-web-extension/scripts/local-s3'
import enLocale from '../../../nook-platform/nook-app-common/locales/en.json' with { type: 'json' }

const KEYRING_NAME = 'S3 keyring'
const SECRET_VALUE = 's3-sync-provider-secret-value'

/** The secret a keyring's first vault keeps on S3. */
type KeptSecret = {
  readonly key: string
  readonly value: string
}

/** A fresh app's first run on S3: its passkey, the location with device A's
 * key, a new keyring whose vault takes one secret, then Sync now, so the
 * vault's events are on S3 before another app reads them. */
async function keepSecretOnS3(
  page: Page,
  keyPrefix: string,
): Promise<KeptSecret> {
  await page.goto('/app/')
  await createFirstRunKey(page)
  await connectS3InFirstRun(page, {
    keyPrefix,
    identity: LocalS3Identity.DeviceA,
  })
  await createKeyringOnS3(page, KEYRING_NAME)
  await disableVaultIdleLock(page)
  await openVaultPage(page)
  const secret: KeptSecret = {
    key: uniqueSecretKey('s3-secret'),
    value: SECRET_VALUE,
  }
  await addSecret(page, secret.key, secret.value)
  await triggerVaultSyncRefresh(page)
  return secret
}

// Every test keeps its objects under its own key prefix in the shared local
// bucket, so the tests run in parallel and never see each other's keyrings.
test.describe('S3-compatible storage as the sync provider', () => {
  test('first run creates a keyring on S3, and its vault opens and keeps a secret', async ({
    page,
  }) => {
    const secret = await keepSecretOnS3(page, uniqueS3KeyPrefix('create'))

    expect(await revealSecretValue(page, secret.key)).toBe(secret.value)
  })

  test('an invite carries the S3 connection to another app, which reads the secret through S3', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000)
    const secret = await keepSecretOnS3(page, uniqueS3KeyPrefix('invite'))
    const joinerContext = await createIsolatedContext(browser)
    try {
      const joiner = await joinerContext.newPage()

      await joinIdentityThroughCode({
        member: page,
        joiner,
        expectedMembers: 2,
      })

      await waitForSecretOnDevice(joiner, secret.key)
      expect(await revealSecretValue(joiner, secret.key)).toBe(secret.value)
    } finally {
      await joinerContext.close()
    }
  })

  test('another app on the same S3 location asks to join, is approved, and reads the secret', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000)
    const keyPrefix = uniqueS3KeyPrefix('request')
    const secret = await keepSecretOnS3(page, keyPrefix)
    const joinerContext = await createIsolatedContext(browser)
    try {
      const joiner = await joinerContext.newPage()
      await joiner.goto('/app/')
      await createFirstRunKey(joiner)

      // Its own key on the same location lists a keyring it is not a
      // member of; asking to join writes the request there.
      await connectS3InFirstRun(joiner, {
        keyPrefix,
        identity: LocalS3Identity.DeviceB,
      })
      const listed = joiner.locator(
        '[data-testid="setup-identity"][data-setup="requestToJoin"]',
      )
      await expect(listed).toBeVisible({
        timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
      })
      await listed.getByTestId('setup-identity-join').click()
      const joinStep = joiner.getByTestId('first-run-join-step')
      await expect(joinStep).toBeVisible({
        timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
      })

      // The member reads the request from S3 and approves it. The request
      // leaves its list once the approval is synchronized to S3.
      await openManagePage(page, ManagePage.Devices)
      const syncNow = page.getByTestId('identity-sync-now-btn')
      await expect(syncNow).toBeEnabled({
        timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
      })
      await syncNow.click()
      const request = page.getByTestId('identity-join-request')
      await expect(request).toBeVisible({
        timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
      })
      const approve = request.getByTestId('identity-join-request-approve')
      await expect(approve).toBeEnabled({
        timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
      })
      await approve.click()
      await expect(request).toHaveCount(0, {
        timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
      })

      // Check again reads the approval; setup then saves S3 and opens the
      // vault the approval granted.
      await joiner.getByTestId('first-run-join-check').click()
      await expect(joinStep).toHaveCount(0, {
        timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
      })
      await disableVaultIdleLock(joiner)
      await openVaultPage(joiner)
      await waitForSecretOnDevice(joiner, secret.key)
      expect(await revealSecretValue(joiner, secret.key)).toBe(secret.value)
    } finally {
      await joinerContext.close()
    }
  })

  test('a key with no access to the bucket stays on the form and says what to check', async ({
    page,
  }) => {
    await page.goto('/app/')
    await createFirstRunKey(page)

    await connectS3InFirstRun(page, {
      keyPrefix: uniqueS3KeyPrefix('refused'),
      identity: LocalS3Identity.NoAccess,
    })

    const alert = page.getByTestId('s3-connection-error')
    await expect(alert).toHaveAttribute('data-failure', 'access-denied', {
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(alert).toHaveText(enLocale.errors.s3_key_access_denied)
    // Nothing is staged: the form stays, and no location lists.
    await expect(page.getByTestId('first-run-s3-setup')).toBeVisible()
    await expect(page.getByTestId('first-run-s3-location')).toHaveCount(0)
  })
})
