import { expect, test } from '@playwright/test'
import {
  addSecret,
  addVaultPassword,
  assertVaultReady,
  clearBrowserVault,
  connectLocalVault,
  expandSettingsSection,
  openStorageSettings,
  uniqueSecretKey,
  UI_TIMEOUT_MS,
  unlockVaultOnLogin,
  waitForVaultUnlocked,
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
    await connectLocalVault(page)
  })

  test('adds backup passwords without replacing device-key unlock', async ({
    page,
  }) => {
    await assertVaultReady(page)
    await openStorageSettings(page)
    await expandSettingsSection(page, 'unlock')

    const card = page.getByTestId('vault-password-card')
    const status = page.getByTestId('vault-password-status')
    await expect(card).toBeVisible()
    await expect(status).toContainText('None')

    // 1. Set a backup password — device keys still unlock the vault.
    await addVaultPassword(page, 'Primary password', 'correct-horse-1')
    await expect(status).toContainText('1 password', { timeout: UI_TIMEOUT_MS })
    await expect(page.getByTestId('app-success')).toContainText(
      'Device keys still unlock',
      { timeout: UI_TIMEOUT_MS },
    )

    // 2. Rotate.
    await page.getByTestId('rotate-vault-password-btn').click()
    await page.getByTestId('vault-password-input').fill('rotated-pass-2')
    await page.getByTestId('vault-password-confirm').fill('rotated-pass-2')
    await page.getByTestId('submit-vault-password').click()
    await expect(status).toContainText('1 password')
    await expect(page.getByTestId('app-success')).toContainText(
      'password updated',
      { timeout: UI_TIMEOUT_MS },
    )

    // 3. Remove backup password — vault still unlocks with device keys.
    await page.getByTestId('remove-vault-password-btn').click()
    await page.getByTestId('confirm-remove-vault-password').click()
    await expect(status).toContainText('None', { timeout: UI_TIMEOUT_MS })
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
    await expect(page.getByTestId('vault-password-status')).toContainText(
      '1 password',
      { timeout: UI_TIMEOUT_MS },
    )

    await page.reload()
    // Single saved provider auto-unlocks with device keys — no password prompt.
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await expect(page.getByTestId('login-gate')).not.toBeVisible()

    // Simulate lost device keys: wipe identity from nook_db but keep providers.
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.open('nook_db', 1)
          request.onerror = () =>
            reject(request.error ?? new Error('idb open failed'))
          request.onsuccess = () => {
            const db = request.result
            const tx = db.transaction('vault', 'readwrite')
            const store = tx.objectStore('vault')
            store.delete('device_id')
            store.delete('device_identity_secret')
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
    await expect(page.getByTestId('vault-password-status')).toContainText(
      'None',
    )
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
    await expect(page.getByTestId('vault-password-status')).toContainText(
      'None',
    )
  })

  test('issuing an enrollment code rejects the wrong password', async ({
    page,
  }) => {
    await openStorageSettings(page)
    await addVaultPassword(page, 'Enrollment test', 'hunter2-secure')
    await expect(page.getByTestId('vault-password-status')).toContainText(
      '1 password',
    )

    await page.getByTestId('issue-enrollment-code-btn').click()
    await page.getByTestId('issue-code-password-input').fill('wrong-typo-99')
    await page.getByTestId('generate-enrollment-code-btn').click()
    await expect(page.getByTestId('issue-code-error')).toContainText(
      'does not match',
    )
    await expect(page.getByTestId('enrollment-code-text')).toHaveCount(0)

    // NOTE: We intentionally do not chain a "now try the correct password"
    // assertion onto the same page. The wasm `age` 0.11.3 scrypt decryptor
    // aborts via a `unreachable!()` trap on wrong passwords, and that trap
    // leaves wasm-bindgen's manager borrow in an unusable state until the
    // page is reloaded. The correct-password generate-code happy path is
    // covered by the next test from a fresh page.
  })

  test('issuing an enrollment code with the correct password renders a QR + code', async ({
    page,
    context,
  }) => {
    await openStorageSettings(page)
    await addVaultPassword(page, 'Enrollment test', 'hunter2-secure')
    await expect(page.getByTestId('vault-password-status')).toContainText(
      '1 password',
    )

    await page.getByTestId('issue-enrollment-code-btn').click()
    await page.getByTestId('issue-code-password-input').fill('hunter2-secure')
    await page.getByTestId('generate-enrollment-code-btn').click()
    const codeText = page.getByTestId('enrollment-code-text')
    await expect(codeText).toBeVisible({ timeout: UI_TIMEOUT_MS })
    const code = (await codeText.inputValue()).trim()
    expect(code.length).toBeGreaterThan(40)
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/)

    // The code decodes to the expected payload shape: v=1, local provider,
    // the password, and an informational `issued_at` timestamp (audit
    // metadata only — there is no `expires_at`).
    const json = JSON.parse(
      Buffer.from(code, 'base64url').toString('utf8'),
    ) as {
      v: number
      provider: { type: string }
      password: string
      issued_at: string
      expires_at?: unknown
    }
    expect(json.v).toBe(1)
    expect(json.provider.type).toBe('local')
    expect(json.password).toBe('hunter2-secure')
    expect(typeof json.issued_at).toBe('string')
    expect(Date.parse(json.issued_at)).not.toBeNaN()
    // Recently issued (within the last 60 seconds).
    expect(Math.abs(Date.now() - Date.parse(json.issued_at))).toBeLessThan(
      60_000,
    )
    expect(json.expires_at).toBeUndefined()

    // The QR/link wraps the raw code so phone cameras open a browser tab.
    const link = (await page.getByTestId('enrollment-code-link').textContent())!
    expect(link).toContain('#enroll=')
    expect(decodeURIComponent(link.split('#enroll=')[1]!)).toBe(code)

    // The UI surfaces the timestamp as audit info next to the code.
    await expect(page.getByTestId('enrollment-code-issued-ago')).toBeVisible()

    // Copy-to-clipboard button works.
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.getByTestId('copy-enrollment-code-btn').click()
    await expect(page.getByTestId('copy-enrollment-code-btn')).toContainText(
      'Copied',
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
    await expect(page.getByTestId('vault-password-status')).toContainText(
      '1 password',
    )

    await page.getByTestId('remove-vault-password-btn').click()
    await page.getByTestId('confirm-remove-vault-password').click()
    await expect(page.getByTestId('vault-password-status')).toContainText(
      'None',
    )

    await page.getByTestId('vault-secrets-tab').click()
    await assertVaultReady(page)

    const row = page.getByTestId('secret-row').filter({ hasText: key })
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: 'Show secret' }).click()
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
    await connectLocalVault(pageA)
    const secretKey = uniqueSecretKey('e2e-link')
    await addSecret(pageA, secretKey, 'via-hash-enroll')

    await openStorageSettings(pageA)
    await addVaultPassword(pageA, 'Link test', 'link-pass')
    await pageA.getByTestId('issue-enrollment-code-btn').click()
    await pageA.getByTestId('issue-code-password-input').fill('link-pass')
    await pageA.getByTestId('generate-enrollment-code-btn').click()
    const link = (await pageA
      .getByTestId('enrollment-code-link')
      .textContent())!.trim()
    expect(link).toContain('#enroll=')

    const pageB = await context.newPage()
    await pageB.goto(link)
    await waitForVaultUnlocked(pageB)
    const row = pageB.getByTestId('secret-row').filter({ hasText: secretKey })
    await expect(row).toBeVisible()

    await pageA.close()
    await pageB.close()
  })
})
