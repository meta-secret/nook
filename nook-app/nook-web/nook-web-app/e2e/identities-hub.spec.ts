import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import {
  connectLocalVault,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  installPasskeyMock,
  openIdentitiesPage,
  UI_TIMEOUT_MS,
} from './helpers'

const WORK_PIN = '246810'

function card(page: Page, label: string) {
  return page.getByTestId('identity-card').filter({
    has: page.getByTestId('identity-card-label').getByText(label, {
      exact: true,
    }),
  })
}

async function identityCreationPending(page: Page): Promise<boolean> {
  const pending = await page.evaluate(() => {
    const vault = window.__nookVault
    if (!vault)
      return { ok: false as const, error: 'Vault runtime is not exposed' }
    const manager = vault.admitManager()
    return manager.isErr()
      ? { ok: false as const, error: manager.error.translationKey }
      : {
          ok: true as const,
          value: manager.value.local_identity_creation_pending,
        }
  })
  if (!pending.ok) throw new Error(pending.error)
  return pending.value
}

/** Name a new identity and reach its key step. */
async function startNewIdentity(page: Page, name: string): Promise<void> {
  await openIdentitiesPage(page)
  await page.getByTestId('identity-new').click()
  await expect(page.getByTestId('new-identity-name')).toBeVisible()
  await page.getByTestId('new-identity-name-input').fill(name)
  await page.getByTestId('new-identity-continue').click()
  await expect(page.getByTestId('new-identity-key')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await expect(page.getByTestId('new-identity-preview')).toContainText(name)
}

/** Give the identity a PIN, as a browser without passkeys would. */
async function protectWithPin(page: Page): Promise<void> {
  await page.evaluate(() => {
    localStorage.setItem('nook_e2e_passkey_mode', 'unavailable')
  })
  await page.getByTestId('device-protection-setup-btn').click()
  await expect(page.getByTestId('device-protection-pin-input')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await page.getByTestId('device-protection-pin-input').fill(WORK_PIN)
  await page.getByTestId('device-protection-pin-confirm').fill(WORK_PIN)
  await page.getByTestId('device-protection-pin-setup-btn').click()
  await page.evaluate(() => {
    localStorage.removeItem('nook_e2e_passkey_mode')
  })
}

test.describe('identities hub', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('nook_e2e_manual_passkey', 'true')
    })
    await installPasskeyMock(page)
    await connectLocalVault(page)
  })

  test('locks and unlocks the identity on its card', async ({ page }) => {
    await openIdentitiesPage(page)
    const current = page.locator('[data-testid="identity-card"]').first()
    await expect(current).toHaveAttribute('data-status', 'unlocked')
    await page.getByTestId('header-lock-vault-btn').click()
    await expect(page.getByTestId('login-gate')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await expect(current).toHaveAttribute('data-status', 'locked', {
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(current.getByTestId('identity-vault-row')).toBeVisible()

    // Unlock opens the identity's key without opening a vault.
    await current.getByTestId('identity-unlock').click()
    await expect(current).toHaveAttribute('data-status', 'unlocked', {
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(page.getByTestId('login-gate')).toBeVisible()
    await current.getByTestId('identity-lock').click()
    await expect(current).toHaveAttribute('data-status', 'locked', {
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })

    // Overview and Manage wait for the identity to be unlocked.
    await expect(current.getByTestId('identity-overview-toggle')).toBeDisabled()
    await current.getByTestId('identity-unlock').click()
    await expect(current).toHaveAttribute('data-status', 'unlocked', {
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await current.getByTestId('identity-overview-toggle').click()
    await expect(page.getByTestId('identity-overview')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(page).toHaveURL(/\/identity$/)
  })

  test('creates a PIN identity and switches between both identities', async ({
    page,
  }) => {
    await startNewIdentity(page, 'Work')
    await protectWithPin(page)
    await expect(page.getByTestId('new-identity-ready')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await page.getByTestId('new-identity-later').click()

    await expect(page.getByTestId('identity-card')).toHaveCount(2, {
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    const work = card(page, 'Work')
    const first = page.getByTestId('identity-card').filter({
      hasNot: page
        .getByTestId('identity-card-label')
        .getByText('Work', { exact: true }),
    })
    await expect(work).toHaveAttribute('data-status', 'unlocked')
    await expect(work.getByTestId('identity-card-keys')).toContainText('PIN')
    await expect(first).toHaveAttribute('data-status', 'inactive')
    // An identity not in use offers only to switch to it.
    await expect(first.getByTestId('identity-manage')).toHaveCount(0)

    // The first identity unlocks with its own passkey.
    await first.getByTestId('identity-use').click()
    await expect(first).toHaveAttribute('data-status', 'unlocked', {
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(work).toHaveAttribute('data-status', 'inactive')

    // Back to Work: a PIN identity asks for its PIN on its card.
    await work.getByTestId('identity-use').click()
    await expect(work).toHaveAttribute('data-status', 'locked', {
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    // Work has no vaults: its card carries New vault, not a storage sheet
    // or a flat list of this browser's vaults.
    await expect(page.getByTestId('login-access-sheet')).toHaveCount(0)
    await expect(page.getByTestId('login-vault-picker')).toHaveCount(0)
    await work.getByTestId('identity-unlock').click()
    await work.getByTestId('card-pin-input').fill(WORK_PIN)
    await work.getByTestId('card-pin-submit').click()
    await expect(work).toHaveAttribute('data-status', 'unlocked', {
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(work.getByTestId('card-pin-unlock')).toHaveCount(0)
  })

  test('drops a prepared identity when its key step is left', async ({
    page,
  }) => {
    await startNewIdentity(page, 'Cancelled')
    await page.evaluate(() => {
      localStorage.setItem('nook_e2e_passkey_mode', 'delayed-cancel')
    })
    await page.getByTestId('device-protection-setup-btn').click()
    await page.getByTestId('new-identity-back').click()
    await expect(page.getByTestId('new-identity-name')).toBeVisible()
    await expect.poll(() => identityCreationPending(page)).toBe(false)
    await page.evaluate(() => {
      localStorage.removeItem('nook_e2e_passkey_mode')
    })
    await page.getByTestId('new-identity-cancel').click()
    await expect(page.getByTestId('identity-card')).toHaveCount(1, {
      timeout: UI_TIMEOUT_MS,
    })
  })
})
