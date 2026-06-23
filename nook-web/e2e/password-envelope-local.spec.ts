import { expect, test } from '@playwright/test'
import {
  addSecret,
  assertVaultReady,
  clearBrowserVault,
  connectLocalVault,
  openStorageSettings,
  uniqueSecretKey,
  UI_TIMEOUT_MS,
} from './helpers'

/**
 * Local-vault coverage for the password-envelope feature.
 *
 * Exercises everything that does not require a second device or a GitHub
 * provider: set / rotate / remove password, enrollment-code issuance with
 * password verification, QR rendering, and the mutex semantics surfaced
 * through the UI status pill.
 */

test.describe('vault password envelope (local)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await clearBrowserVault(page)
    await page.reload()
    await connectLocalVault(page)
  })

  test('toggles between keys and password unlock modes', async ({ page }) => {
    await assertVaultReady(page)
    await openStorageSettings(page)

    const card = page.getByTestId('vault-password-card')
    const status = page.getByTestId('vault-password-status')
    await expect(card).toBeVisible()
    await expect(status).toContainText('Disabled')

    // 1. Set a password — vault transitions to password unlock mode.
    await page.getByTestId('set-vault-password-btn').click()
    await page.getByTestId('vault-password-input').fill('correct-horse-1')
    await page.getByTestId('vault-password-confirm').fill('correct-horse-1')
    await page.getByTestId('submit-vault-password').click()
    await expect(status).toContainText('Enabled', { timeout: UI_TIMEOUT_MS })
    await expect(page.getByTestId('app-success')).toContainText(
      'unlocks with this password',
      { timeout: UI_TIMEOUT_MS },
    )

    // 2. Rotate. The card now shows "Rotate password" instead of "Set".
    await page.getByTestId('rotate-vault-password-btn').click()
    await page.getByTestId('vault-password-input').fill('rotated-pass-2')
    await page.getByTestId('vault-password-confirm').fill('rotated-pass-2')
    await page.getByTestId('submit-vault-password').click()
    await expect(status).toContainText('Enabled')
    await expect(page.getByTestId('app-success')).toContainText(
      'password updated',
      { timeout: UI_TIMEOUT_MS },
    )

    // 3. Remove — back to keys mode.
    await page.getByTestId('remove-vault-password-btn').click()
    await page.getByTestId('confirm-remove-vault-password').click()
    await expect(status).toContainText('Disabled', { timeout: UI_TIMEOUT_MS })
    await expect(page.getByTestId('app-success')).toContainText(
      'password removed',
      { timeout: UI_TIMEOUT_MS },
    )
  })

  test('rejects short passwords client-side', async ({ page }) => {
    await openStorageSettings(page)
    await page.getByTestId('set-vault-password-btn').click()

    // 3 chars — below the 5-char floor.
    await page.getByTestId('vault-password-input').fill('abc')
    await page.getByTestId('vault-password-confirm').fill('abc')
    await page.getByTestId('submit-vault-password').click()

    const error = page.getByTestId('vault-password-error')
    await expect(error).toBeVisible()
    await expect(error).toContainText('at least 5')
    await expect(page.getByTestId('vault-password-status')).toContainText(
      'Disabled',
    )
  })

  test('rejects mismatched password / confirmation', async ({ page }) => {
    await openStorageSettings(page)
    await page.getByTestId('set-vault-password-btn').click()
    await page.getByTestId('vault-password-input').fill('correct-horse')
    await page.getByTestId('vault-password-confirm').fill('different-typo')
    await page.getByTestId('submit-vault-password').click()

    await expect(page.getByTestId('vault-password-error')).toContainText(
      'do not match',
    )
    await expect(page.getByTestId('vault-password-status')).toContainText(
      'Disabled',
    )
  })

  test('issuing an enrollment code requires re-typing the password', async ({
    page,
    context,
  }) => {
    await openStorageSettings(page)

    // First, set a password so the issue affordance unlocks.
    await page.getByTestId('set-vault-password-btn').click()
    await page.getByTestId('vault-password-input').fill('hunter2-secure')
    await page.getByTestId('vault-password-confirm').fill('hunter2-secure')
    await page.getByTestId('submit-vault-password').click()
    await expect(page.getByTestId('vault-password-status')).toContainText(
      'Enabled',
    )

    // Wrong password is rejected locally — no payload is generated.
    await page.getByTestId('issue-enrollment-code-btn').click()
    await page.getByTestId('issue-code-password-input').fill('wrong-typo-99')
    await page.getByTestId('generate-enrollment-code-btn').click()
    await expect(page.getByTestId('issue-code-error')).toContainText(
      'does not match',
    )
    await expect(page.getByTestId('enrollment-code-text')).toHaveCount(0)

    // Correct password generates a code (a base64url-encoded JSON blob).
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
    await page.getByTestId('set-vault-password-btn').click()
    await page.getByTestId('vault-password-input').fill('temporary-pass')
    await page.getByTestId('vault-password-confirm').fill('temporary-pass')
    await page.getByTestId('submit-vault-password').click()
    await expect(page.getByTestId('vault-password-status')).toContainText(
      'Enabled',
    )

    await page.getByTestId('remove-vault-password-btn').click()
    await page.getByTestId('confirm-remove-vault-password').click()
    await expect(page.getByTestId('vault-password-status')).toContainText(
      'Disabled',
    )

    await page.getByTestId('storage-settings-close').click()
    await assertVaultReady(page)

    const row = page.getByTestId('secret-row').filter({ hasText: key })
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: 'Show secret' }).click()
    await expect(row.getByText(value)).toBeVisible()
  })
})
