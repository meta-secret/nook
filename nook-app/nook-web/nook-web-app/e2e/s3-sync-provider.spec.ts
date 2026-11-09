import { expect, test, type Page } from './fixtures'
import {
  addS3FromProtection,
  answerPasskeyPromptBeforeJoin,
  clearBrowserVault,
  connectS3InFirstRun,
  createFirstRunKey,
  createIsolatedContext,
  disableVaultIdleLock,
  E2E_IDENTITY_PASSPHRASE,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  expectIdentityMembers,
  joinIdentityThroughCode,
  keepSecretOnS3,
  keepIdentityWithoutVault,
  localizeAppLinkForE2e,
  ManagePage,
  openIdentityPanel,
  openManagePage,
  openOnboardDevicePanel,
  openVaultAfterIdentityJoin,
  openVaultPage,
  redeemIdentityEnrollmentCode,
  revealSecretValue,
  submitOnboardEnrollmentCode,
  uniqueS3KeyPrefix,
  UI_TIMEOUT_MS,
  waitForSecretOnDevice,
} from './helpers'
import type { S3KeptKeyring } from './helpers'
import {
  LocalS3Identity,
  localS3Credentials,
} from '../../nook-web-extension/scripts/local-s3'
import enLocale from '../../../nook-platform/nook-app-common/locales/en.json' with { type: 'json' }

const KEYRING_NAME = 'S3 keyring'
const SECRET_VALUE = 's3-sync-provider-secret-value'

/** The keyring this spec keeps on S3 under `keyPrefix`, with its secret. */
function keptKeyring(keyPrefix: string): S3KeptKeyring {
  return { keyPrefix, keyringName: KEYRING_NAME, secretValue: SECRET_VALUE }
}

/** Issue an invite whose S3 provider gives the new device `keyChoice`, the
 * value of one of the invite's key chips. */
async function issueS3Invite(page: Page, keyChoice: string): Promise<string> {
  await openOnboardDevicePanel(page)
  const clear = page.getByTestId('onboard-clear-code-btn')
  if (await clear.isVisible()) await clear.click()
  const chip = page.getByTestId(`onboard-key-option-${keyChoice}`)
  await chip.click({ timeout: UI_TIMEOUT_MS })
  await expect(chip).toHaveAttribute('aria-checked', 'true')
  await submitOnboardEnrollmentCode(page, E2E_IDENTITY_PASSPHRASE)
  const link = (await page.getByTestId('onboard-link').textContent()) || ''
  expect(link).toContain('#enroll=')
  return localizeAppLinkForE2e(page, link.trim())
}

/** A fresh app opens the invite link on its own clean store. */
async function openInviteOnFreshApp(joiner: Page, link: string): Promise<void> {
  await joiner.goto('/app/')
  await clearBrowserVault(joiner)
  await joiner.goto(link)
  await expect(joiner.getByTestId('join-this-device')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
}

// Every test keeps its objects under its own key prefix in the shared local
// bucket, so the tests run in parallel and never see each other's keyrings.
test.describe('S3-compatible storage as the sync provider', () => {
  test('first run creates a keyring on S3, and its vault opens and keeps a secret', async ({
    page,
  }) => {
    const secret = await keepSecretOnS3(
      page,
      keptKeyring(uniqueS3KeyPrefix('create')),
    )

    expect(await revealSecretValue(page, secret.key)).toBe(secret.value)
  })

  test('an invite carries the S3 connection to another app, which reads the secret through S3', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000)
    const secret = await keepSecretOnS3(
      page,
      keptKeyring(uniqueS3KeyPrefix('invite')),
    )
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

  test('an invite can leave the S3 key to the new device or carry a saved spare key', async ({
    page,
    browser,
  }) => {
    test.setTimeout(300_000)
    const secret = await keepSecretOnS3(
      page,
      keptKeyring(uniqueS3KeyPrefix('keys')),
    )
    const deviceB = localS3Credentials(LocalS3Identity.DeviceB)

    // Add key on the invite page opens the Sync page with that provider's
    // Add key form; the spare is saved beside the key in use.
    await openOnboardDevicePanel(page)
    await page.locator('[data-testid^="onboard-add-key-"]').click()
    const form = page.getByTestId('s3-add-key-form')
    await expect(form).toBeVisible({ timeout: UI_TIMEOUT_MS })
    await form
      .getByTestId('s3-add-key-access-key-id-input')
      .fill(deviceB.accessKeyId)
    await form
      .getByTestId('s3-add-key-secret-access-key-input')
      .fill(deviceB.secretAccessKey)
    await form.getByTestId('s3-add-key-save').click()
    await expect(form).toHaveCount(0, { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
    await expect(
      page.getByTestId(`s3-remove-key-${deviceB.accessKeyId}`),
    ).toBeVisible()

    // An invite with no key: the new device enters its own before joining.
    const keylessLink = await issueS3Invite(page, 'joiner')
    const keylessContext = await createIsolatedContext(browser)
    try {
      const joiner = await keylessContext.newPage()
      await openInviteOnFreshApp(joiner, keylessLink)
      await joiner
        .getByTestId('enrollment-password-input')
        .fill(E2E_IDENTITY_PASSPHRASE)
      await joiner.getByTestId('submit-enrollment-code-btn').click()
      const keys = joiner.getByTestId('join-provider-keys')
      await answerPasskeyPromptBeforeJoin(joiner, keys)
      await expect(keys).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
      // The location is named; no key from the invite is on screen.
      await expect(keys.getByTestId('join-provider-key-label')).toContainText(
        'nook-dev',
      )
      await expect(keys).not.toContainText(deviceB.secretAccessKey)
      await keys
        .getByTestId('join-s3-access-key-id-input')
        .fill(deviceB.accessKeyId)
      await keys
        .getByTestId('join-s3-secret-access-key-input')
        .fill(deviceB.secretAccessKey)
      await redeemIdentityEnrollmentCode(joiner, E2E_IDENTITY_PASSPHRASE)
      await openVaultAfterIdentityJoin(joiner)
      await waitForSecretOnDevice(joiner, secret.key)
      expect(await revealSecretValue(joiner, secret.key)).toBe(secret.value)
    } finally {
      await keylessContext.close()
    }
    await expectIdentityMembers(page, 2)

    // An invite carrying the saved spare key joins with no key typed, and
    // the new device signs with that key.
    const spareLink = await issueS3Invite(page, `saved:${deviceB.accessKeyId}`)
    const spareContext = await createIsolatedContext(browser)
    try {
      const joiner = await spareContext.newPage()
      await openInviteOnFreshApp(joiner, spareLink)
      await redeemIdentityEnrollmentCode(joiner, E2E_IDENTITY_PASSPHRASE)
      await expect(joiner.getByTestId('join-provider-keys')).toHaveCount(0)
      await openVaultAfterIdentityJoin(joiner)
      await waitForSecretOnDevice(joiner, secret.key)
      expect(await revealSecretValue(joiner, secret.key)).toBe(secret.value)
      await openManagePage(joiner, ManagePage.Sync)
      await expect(joiner.getByTestId('s3-key-row').first()).toContainText(
        deviceB.accessKeyId,
        { timeout: UI_TIMEOUT_MS },
      )
    } finally {
      await spareContext.close()
    }
  })

  test('another app on the same S3 location asks to join, is approved, and reads the secret', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000)
    const keyPrefix = uniqueS3KeyPrefix('request')
    const secret = await keepSecretOnS3(page, keptKeyring(keyPrefix))
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
    await expect(alert).toHaveText(enLocale.errors.s3_key_access_denied, {
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    // Nothing is staged: the form stays, and no location lists.
    await expect(page.getByTestId('first-run-s3-setup')).toBeVisible()
    await expect(page.getByTestId('first-run-s3-location')).toHaveCount(0)
  })

  test('S3 added later from the protection checklist stays listed after a reload and unlock', async ({
    page,
  }) => {
    // A keyring kept on this browser only, with no vault, then S3 from its
    // card's "Set up this keyring" checklist.
    const card = await keepIdentityWithoutVault(page, KEYRING_NAME)
    await addS3FromProtection(page, {
      keyPrefix: uniqueS3KeyPrefix('protect'),
      identity: LocalS3Identity.DeviceA,
    })
    const protection = card.getByTestId('identity-protection-toggle')
    await expect(protection).toContainText('1 of 3 done', {
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await openIdentityPanel(page)
    const s3Row = page
      .getByTestId('identity-overview')
      .getByTestId('identity-panel-provider-s3')
    await expect(s3Row).toBeVisible()

    // A reload locks the keyring (e2e skips its automatic passkey unlock, as a
    // person's browser asks first); unlocking it from its card reads its
    // providers again, so S3 is still there.
    await page.evaluate(() => {
      localStorage.setItem('nook_e2e_manual_passkey', 'true')
    })
    await page.reload()
    await expect(card).toHaveAttribute('data-status', 'locked', {
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await card.getByTestId('identity-unlock').click()
    await expect(card).toHaveAttribute('data-status', 'unlocked', {
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(protection).toContainText('1 of 3 done')
    await openIdentityPanel(page)
    await expect(s3Row).toBeVisible()
  })
})
