import { expect, test } from './fixtures'
import {
  addSecret,
  addVaultPassword,
  assertVaultReady,
  clearBrowserVault,
  connectLocalVaultLegacy,
  E2E_SYNC_ONBOARD_PROVIDER,
  expandSettingsSection,
  expectVaultPasswordStatus,
  openStorageSettings,
  readLocalVaultYamlFromIdb,
  revealSecretInRow,
  seedSyncProvidersWhileUnlocked,
  selectLoginUnlockMethod,
  stubSyncVaultForLocalE2e,
  submitOnboardEnrollmentCode,
  enrollmentCodeFromLink,
  uniqueSecretKey,
  openOnboardDevicePanel,
  UI_TIMEOUT_MS,
  unlockVaultOnLogin,
  waitForStorageChainIdle,
  waitForVaultUnlocked,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
} from './helpers'

test.describe('vault password envelope (local)', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => {
      const text = msg.text()
      if (text.includes('[nook]') || msg.type() === 'error') {
        console.log(`[browser ${msg.type()}] ${text}`)
      }
    })
    await page.goto('/')
    await clearBrowserVault(page)
    await page.reload()
    await connectLocalVaultLegacy(page)
  })

  test('adds backup passwords without replacing device-key unlock', async ({
    page,
  }) => {
    await assertVaultReady(page)
    await openStorageSettings(page)
    await expandSettingsSection(page, 'unlock')

    const card = page.getByTestId('vault-password-card')
    await expect(card).toBeVisible()
    await expectVaultPasswordStatus(page, 'none')

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
    await expectVaultPasswordStatus(page, 'none', { timeout: UI_TIMEOUT_MS })
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
    await expect(page.getByTestId('login-local-vault-detected')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await selectLoginUnlockMethod(page, 'keys')
    await page.getByTestId('unlock-vault-btn').click()
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(page.getByTestId('login-gate')).not.toBeVisible()

    // Simulate lost device keys: wipe identity from nook_db but keep providers.
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.open('nook_db')
          request.onerror = () =>
            reject(request.error ?? new Error('idb open failed'))
          request.onsuccess = () => {
            const db = request.result
            const tx = db.transaction('vault', 'readwrite')
            const store = tx.objectStore('vault')
            store.delete('device_id')
            store.delete('device_identity_wrapped')
            tx.oncomplete = () => {
              db.close()
              resolve()
            }
            tx.onerror = () =>
              reject(tx.error ?? new Error('idb delete failed'))
          }
        }),
    )
    await page.reload()
    await expect(page.getByTestId('login-gate')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await expect(page.getByTestId('login-unlock-method-fieldset')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    // Dismiss the join prompt — backup password is the recovery path here.
    const joinClose = page.getByTestId('join-enrollment-close')
    if (await joinClose.isVisible()) {
      await joinClose.click()
    }
    await unlockVaultOnLogin(page, { password: 'reload-pass' })
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
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
    await expectVaultPasswordStatus(page, 'none')
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
    await expectVaultPasswordStatus(page, 'none')
  })

  test('issuing an enrollment code rejects the wrong password', async ({
    page,
  }) => {
    await openStorageSettings(page)
    await addVaultPassword(page, 'Enrollment test', 'hunter2-secure')
    await expectVaultPasswordStatus(page, 1)

    await seedSyncProvidersWhileUnlocked(page)

    await openOnboardDevicePanel(page)
    await waitForStorageChainIdle(page)
    const entryList = page.getByTestId('onboard-password-entry-list')
    await expect(entryList).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await entryList.getByRole('radio').first().click()
    await page.getByTestId('onboard-password-input').fill('wrong-typo-99')
    await page.getByTestId('onboard-device-submit').click({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(page.getByTestId('onboard-error')).toContainText(
      'does not match',
      { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    await expect(page.getByTestId('onboarding-link-url')).toHaveCount(0)

    // NOTE: We intentionally do not chain a "now try the correct password"
    // assertion onto the same page. The wasm `age` 0.11.3 scrypt decryptor
    // aborts via a `unreachable!()` trap on wrong passwords, and that trap
    // leaves wasm-bindgen's manager borrow in an unusable state until the
    // page is reloaded. The correct-password generate-code happy path is
    // covered by the next test from a fresh page.
  })

  test('issuing an enrollment code with the correct password renders a QR + link', async ({
    page,
    context,
  }) => {
    await openStorageSettings(page)
    await addVaultPassword(page, 'Enrollment test', 'hunter2-secure')
    await expectVaultPasswordStatus(page, 1)

    await seedSyncProvidersWhileUnlocked(page)

    await openOnboardDevicePanel(page)
    const linkInput = await submitOnboardEnrollmentCode(page, 'hunter2-secure')
    await expect(
      page
        .getByTestId('onboard-wizard-generate-step')
        .getByRole('button')
        .first(),
    ).toHaveAttribute('aria-expanded', 'false')
    await expect(linkInput).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    const link = (await linkInput.inputValue()).trim()
    expect(link).toContain('#enroll=')
    const code = enrollmentCodeFromLink(link)
    expect(code.length).toBeGreaterThan(40)
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/)

    const outer = JSON.parse(
      Buffer.from(code, 'base64url').toString('utf8'),
    ) as {
      issued_at: string
      entry_id?: string
      entry_label?: string
      ct?: string
      password?: string
      provider?: unknown
    }
    expect(typeof outer.issued_at).toBe('string')
    expect(Date.parse(outer.issued_at)).not.toBeNaN()
    expect(Math.abs(Date.now() - Date.parse(outer.issued_at))).toBeLessThan(
      60_000,
    )
    expect(outer.entry_id).toBeTruthy()
    expect(outer.entry_label).toBe('Enrollment test')
    expect(outer.ct).toBeTruthy()
    expect(outer.password).toBeUndefined()
    expect(outer.provider).toBeUndefined()

    // The QR/link wraps the raw code so phone cameras open a browser tab.
    const srLink = (await page.getByTestId('onboard-link').textContent())!
    expect(srLink).toBe(link)
    expect(decodeURIComponent(srLink.split('#enroll=')[1]!)).toBe(code)

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
    await expectVaultPasswordStatus(page, 'none', { timeout: UI_TIMEOUT_MS })

    await page.getByTestId('vault-secrets-tab').click()
    await assertVaultReady(page)

    const row = page.getByTestId('secret-row').filter({ hasText: key })
    await expect(row).toBeVisible()
    await revealSecretInRow(row)
    await expect(row.getByText(value)).toBeVisible()
  })
})

test.describe('enrollment link deep link (local)', () => {
  test('opens the app and enrolls from the URL hash in a second tab', async ({
    context,
  }) => {
    const pageA = await context.newPage()
    await pageA.goto('/')
    await clearBrowserVault(pageA)
    await pageA.reload()
    await connectLocalVaultLegacy(pageA)
    const secretKey = uniqueSecretKey('e2e-link')
    await addSecret(pageA, secretKey, 'via-hash-enroll')

    await openStorageSettings(pageA)
    await addVaultPassword(pageA, 'Link test', 'link-pass')
    await seedSyncProvidersWhileUnlocked(pageA)
    const vaultYaml = await readLocalVaultYamlFromIdb(pageA)
    await openOnboardDevicePanel(pageA)
    await submitOnboardEnrollmentCode(pageA, 'link-pass')
    const link = (await pageA.getByTestId('onboard-link').textContent())!.trim()
    expect(link).toContain('#enroll=')

    await stubSyncVaultForLocalE2e(pageA, {
      fileName: E2E_SYNC_ONBOARD_PROVIDER.fileName,
      vaultYaml,
    })

    // Same browser context shares IndexedDB where the local vault file lives.
    const pageB = await context.newPage()
    await stubSyncVaultForLocalE2e(pageB, {
      fileName: E2E_SYNC_ONBOARD_PROVIDER.fileName,
      vaultYaml,
    })
    await pageB.goto(link)
    await expect(pageB.getByTestId('login-gate')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await expect(pageB.getByTestId('enrollment-scan-panel')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await expect(
      pageB.getByTestId('enrollment-password-entry-hint'),
    ).toContainText('Link test')
    await pageB.getByTestId('enrollment-password-input').fill('link-pass')
    await pageB.getByTestId('submit-enrollment-code-btn').click()
    await waitForVaultUnlocked(pageB, ENROLLMENT_UNLOCK_TIMEOUT_MS)
    const row = pageB.getByTestId('secret-row').filter({ hasText: secretKey })
    await expect(row).toBeVisible()

    await pageA.close()
    await pageB.close()
  })
})
