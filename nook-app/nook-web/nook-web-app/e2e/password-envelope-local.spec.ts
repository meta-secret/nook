import { expect, test } from './fixtures'
import {
  addSecret,
  addVaultPassword,
  assertVaultReady,
  clearBrowserVault,
  connectLocalVault,
  createIsolatedContext,
  E2E_IDENTITY_PASSPHRASE,
  E2E_SYNC_ONBOARD_PROVIDER,
  approveIdentityJoin,
  issueIdentityEnrollmentCode,
  openVaultAfterIdentityApproval,
  redeemIdentityEnrollmentCode,
  expandSettingsSection,
  expectNoVaultPasswords,
  expectVaultPasswordStatus,
  openStorageSettings,
  revealSecretInRow,
  seedSyncProvidersWhileUnlocked,
  submitOnboardEnrollmentCode,
  enrollmentCodeFromLink,
  localizeAppLinkForE2e,
  uniqueSecretKey,
  parseJson,
  readStringProperty,
  requireRecord,
  openOnboardDevicePanel,
  reloadUnlockLocalVaultWithSync,
  UI_TIMEOUT_MS,
  unlockVaultOnLogin,
  waitForStorageChainIdle,
  waitForSyncRemoteVaultState,
  wipeDeviceIdentity,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  openVaultPage,
} from './helpers'
import { createLocalE2eFileSyncVaultStub } from './file-sync-stub'

test.describe('vault password envelope (local)', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => {
      const text = msg.text()
      if (text.includes('[nook]') || msg.type() === 'error') {
        console.log(`[browser ${msg.type()}] ${text}`)
      }
    })
    await page.goto('/app/')
    await clearBrowserVault(page)
    await page.reload()
    await connectLocalVault(page)
  })

  test('adds backup passwords without replacing device-key unlock', async ({
    page,
  }) => {
    await assertVaultReady(page)
    await openStorageSettings(page)
    await expandSettingsSection(page, 'unlock')

    const card = page.getByTestId('vault-password-card')
    await expect(card).toBeVisible()
    await expectNoVaultPasswords(page)

    // 1. Set a backup password — device keys still unlock the vault.
    await addVaultPassword(page, 'Primary password', 'correct-horse-1')
    await expectVaultPasswordStatus(page, 1, { timeout: UI_TIMEOUT_MS })
    await expect(page.getByTestId('app-success')).toContainText(
      'Vault password set',
      { timeout: UI_TIMEOUT_MS },
    )

    // 2. Rotate.
    await page.getByTestId('rotate-vault-password-btn').click()
    await page.getByTestId('vault-password-input').fill('rotated-pass-2')
    await page.getByTestId('vault-password-confirm').fill('rotated-pass-2')
    await page.getByTestId('submit-vault-password').click()
    await expectVaultPasswordStatus(page, 1)
    await expect(page.getByTestId('app-success')).toContainText(
      'password updated',
      { timeout: UI_TIMEOUT_MS },
    )

    // 3. Remove backup password — vault still unlocks with device keys.
    await page.getByTestId('remove-vault-password-btn').click()
    await page.getByTestId('confirm-remove-vault-password').click()
    await expectNoVaultPasswords(page, { timeout: UI_TIMEOUT_MS })
    await expect(page.getByTestId('app-success')).toContainText(
      'password removed',
      { timeout: UI_TIMEOUT_MS },
    )
  })

  test('unlock vault with device keys after reload when backup password exists', async ({
    page,
  }) => {
    await openStorageSettings(page)
    await addVaultPassword(page, 'Reload test', 'reload-pass')
    await expectVaultPasswordStatus(page, 1, { timeout: UI_TIMEOUT_MS })

    await page.reload()
    await unlockVaultOnLogin(page)
    await expect(page.getByTestId('vault-admin-panel')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(page).toHaveURL(/\/identity\/passwords$/)
    await expect(page.getByTestId('login-gate')).not.toBeVisible()

    // Simulate lost device keys: wipe identity from nook_db but keep providers.
    await wipeDeviceIdentity(page)
    await page.reload()
    await expect(page.getByTestId('login-gate')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await expect(page.getByTestId('card-password-unlock-open')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    // Dismiss the join prompt — backup password is the recovery path here.
    const joinClose = page.getByTestId('join-enrollment-close')
    if (await joinClose.isVisible()) {
      await joinClose.click()
    }
    await unlockVaultOnLogin(page, { password: 'reload-pass' })
    await expect(page.getByTestId('vault-admin-panel')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await expect(page).toHaveURL(/\/identity\/passwords$/)
  })

  test('rejects short passwords client-side', async ({ page }) => {
    await openStorageSettings(page)
    await expandSettingsSection(page, 'unlock')
    await page.getByTestId('set-vault-password-btn').click()
    await page.getByTestId('vault-password-label').fill('Short test')

    // 3 chars — below the 5-char floor.
    await page.getByTestId('vault-password-input').fill('abc')
    await page.getByTestId('vault-password-confirm').fill('abc')
    await page.getByTestId('submit-vault-password').click()

    const error = page.getByTestId('vault-password-error')
    await expect(error).toBeVisible()
    await expect(error).toContainText('at least 5')
    await expectNoVaultPasswords(page)
  })

  test('rejects mismatched password / confirmation', async ({ page }) => {
    await openStorageSettings(page)
    await expandSettingsSection(page, 'unlock')
    await page.getByTestId('set-vault-password-btn').click()
    await page.getByTestId('vault-password-label').fill('Mismatch test')
    await page.getByTestId('vault-password-input').fill('correct-horse')
    await page.getByTestId('vault-password-confirm').fill('different-typo')
    await page.getByTestId('submit-vault-password').click()

    await expect(page.getByTestId('vault-password-error')).toContainText(
      'do not match',
    )
    await expectNoVaultPasswords(page)
  })

  test('issuing an identity code rejects a short passphrase', async ({
    page,
  }) => {
    await seedSyncProvidersWhileUnlocked(page)

    await openOnboardDevicePanel(page)
    await waitForStorageChainIdle(page)
    await page.getByTestId('onboard-passphrase-input').fill('short')
    await page.getByTestId('onboard-device-submit').click({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(page.getByTestId('onboard-error')).toContainText(
      'at least 8 characters',
      { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    await expect(page.getByTestId('onboarding-link-url')).toHaveCount(0)
  })

  test('issuing an identity code renders a QR + link that names no vault', async ({
    page,
    context,
  }) => {
    await seedSyncProvidersWhileUnlocked(page)

    await openOnboardDevicePanel(page)
    const linkInput = await submitOnboardEnrollmentCode(
      page,
      E2E_IDENTITY_PASSPHRASE,
    )
    await expect(linkInput).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    const link = (await linkInput.inputValue()).trim()
    expect(link).toContain('#enroll=')
    const code = enrollmentCodeFromLink(link)
    expect(code.length).toBeGreaterThan(40)
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/)

    const outer = requireRecord(
      parseJson(Buffer.from(code, 'base64url').toString('utf8')),
      'enrollment link payload',
    )
    const issuedAt = readStringProperty(
      outer,
      'issued_at',
      'enrollment link payload',
    )
    expect(Date.parse(issuedAt)).not.toBeNaN()
    expect(Math.abs(Date.now() - Date.parse(issuedAt))).toBeLessThan(60_000)
    expect(outer.entry_id).toBeTruthy()
    expect(outer.entry_label).toEqual({ state: 'unlabeled' })
    expect(outer.ct).toBeTruthy()
    expect(Object.hasOwn(outer, 'password')).toBe(false)
    expect(Object.hasOwn(outer, 'provider')).toBe(false)
    expect(Object.hasOwn(outer, 'vault_name')).toBe(false)
    await expect(page.getByTestId('onboard-passphrase-display')).toHaveText(
      E2E_IDENTITY_PASSPHRASE,
    )

    // The QR/link wraps the raw code so phone cameras open a browser tab.
    const srLink = await page.getByTestId('onboard-link').textContent()
    if (typeof srLink !== 'string') {
      throw new Error('onboarding link text was not available.')
    }
    expect(srLink).toBe(link)
    const enrollmentLinkCode = srLink.split('#enroll=')[1]
    if (typeof enrollmentLinkCode !== 'string') {
      throw new Error('enrollment link code was not available.')
    }
    expect(decodeURIComponent(enrollmentLinkCode)).toBe(code)

    // The UI surfaces the timestamp as audit info next to the QR.
    await expect(page.getByText('Issued')).toBeVisible()

    // Copy-to-clipboard button copies the onboarding URL.
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.getByTestId('copy-onboard-link-btn').click()
    await expect(page.getByTestId('copy-onboard-link-btn')).toContainText(
      'Link copied',
    )
  })

  test('removing the password while a secret exists keeps the secret', async ({
    page,
  }) => {
    const key = uniqueSecretKey('e2e-pw-keep')
    const value = 'should-survive-mode-toggle'

    await addSecret(page, key, value)

    await openStorageSettings(page)
    await addVaultPassword(page, 'Temporary', 'temporary-pass')
    await expectVaultPasswordStatus(page, 1)

    await page.getByTestId('remove-vault-password-btn').click()
    await page.getByTestId('confirm-remove-vault-password').click()
    await expectNoVaultPasswords(page, { timeout: UI_TIMEOUT_MS })

    await openVaultPage(page)
    await assertVaultReady(page)

    const row = page.getByTestId('secret-row').filter({ hasText: key })
    await expect(row).toBeVisible()
    await revealSecretInRow(row)
    await expect(row.getByText(value)).toBeVisible()
  })
})

test.describe('enrollment link deep link (local)', () => {
  test('joins the identity from the URL hash and opens its vault after approval', async ({
    browser,
    context,
  }) => {
    const pageA = await context.newPage()
    await pageA.goto('/app/')
    await clearBrowserVault(pageA)
    await pageA.reload()
    await connectLocalVault(pageA)
    const secretKey = uniqueSecretKey('e2e-link')
    await addSecret(pageA, secretKey, 'via-hash-enroll')

    // Shared file-sync stub so app B sees the logs app A flushed.
    const stub = createLocalE2eFileSyncVaultStub(
      '',
      E2E_SYNC_ONBOARD_PROVIDER.fileName,
    )
    await reloadUnlockLocalVaultWithSync(pageA, stub)
    await waitForSyncRemoteVaultState(
      stub,
      (snapshot) => snapshot.secretIds.length >= 1,
    )

    const issued = await issueIdentityEnrollmentCode(pageA)
    await expect.poll(() => stub.getIdentityEventFileCount()).toBeGreaterThan(0)

    const contextB = await createIsolatedContext(browser)
    const pageB = await contextB.newPage()
    await stub.install(pageB, {
      fileName: E2E_SYNC_ONBOARD_PROVIDER.fileName,
    })
    await pageB.goto(localizeAppLinkForE2e(pageA, issued.link))
    await expect(pageB.getByTestId('login-gate')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await redeemIdentityEnrollmentCode(pageB, issued.passphrase)

    await approveIdentityJoin(pageA, 2)
    await openVaultAfterIdentityApproval(pageB)
    const row = pageB.getByTestId('secret-row').filter({ hasText: secretKey })
    await expect(row).toBeVisible()

    await pageA.close()
    await contextB.close()
  })

  test('empty browser without auto-passkey shows onboarding, not create vault', async ({
    browser,
    context,
  }) => {
    const pageA = await context.newPage()
    await pageA.goto('/app/')
    await clearBrowserVault(pageA)
    await pageA.reload()
    await connectLocalVault(pageA)
    const secretKey = uniqueSecretKey('e2e-link-manual')
    await addSecret(pageA, secretKey, 'via-hash-enroll-manual')

    const stub = createLocalE2eFileSyncVaultStub(
      '',
      E2E_SYNC_ONBOARD_PROVIDER.fileName,
    )
    await reloadUnlockLocalVaultWithSync(pageA, stub)
    await waitForSyncRemoteVaultState(
      stub,
      (snapshot) => snapshot.secretIds.length >= 1,
    )

    const issued = await issueIdentityEnrollmentCode(pageA)
    const link = issued.link

    // Fresh empty browser: deferred-passkey create landing must not win over
    // `#enroll=` onboarding (production path; e2e normally auto-creates passkeys).
    const contextB = await createIsolatedContext(browser)
    await contextB.addInitScript(() => {
      localStorage.setItem('nook_e2e_manual_passkey', 'true')
    })
    const pageB = await contextB.newPage()
    await stub.install(pageB, {
      fileName: E2E_SYNC_ONBOARD_PROVIDER.fileName,
    })
    await pageB.goto(localizeAppLinkForE2e(pageA, link))

    await expect(pageB.getByTestId('login-gate')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await expect(pageB.getByTestId('join-this-device')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await expect(pageB.getByTestId('login-create-vault-chooser')).toHaveCount(0)
    await expect(pageB.getByTestId('passkey-auth-overlay')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await expect(pageB.getByTestId('join-link-received')).toBeVisible()
    await expect(pageB.getByTestId('login-vault-name-input')).toHaveCount(0)

    await pageB.getByTestId('device-protection-create-new-choice').click()
    await pageB.getByTestId('device-protection-setup-btn').click()
    await expect(pageB.getByTestId('passkey-auth-overlay')).toBeHidden({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await redeemIdentityEnrollmentCode(pageB, issued.passphrase)
    await approveIdentityJoin(pageA, 2)
    await openVaultAfterIdentityApproval(pageB)
    const row = pageB.getByTestId('secret-row').filter({ hasText: secretKey })
    await expect(row).toBeVisible()

    await pageA.close()
    await pageB.close()
    await contextB.close()
  })
})
