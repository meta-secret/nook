import type { Locator, Page } from '@playwright/test'
import { expect, test } from './fixtures'
import {
  connectLocalVault,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  installGoogleOAuthMock,
  installPasskeyMock,
  nameFirstIdentityOnly,
  openIdentitiesPage,
  openVaultRow,
  startFirstRun,
  UI_TIMEOUT_MS,
  waitForGoogleOAuthSignedIn,
} from './helpers'
import {
  E2eSyncProviderId,
  createSyncTarget,
  installSyncRemote,
} from './sync-provider'
import enLocale from '../../../nook-platform/nook-app-common/locales/en.json' with { type: 'json' }

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

    // Locked, the card cannot tell what protects the identity: no checklist.
    await expect(current.getByTestId('identity-protection-toggle')).toHaveCount(
      0,
    )

    // Unlock opens the identity's key without opening a vault; the card
    // offers its protection checklist here too, before any vault opens.
    await current.getByTestId('identity-unlock').click()
    await expect(current).toHaveAttribute('data-status', 'unlocked', {
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(page.getByTestId('login-gate')).toBeVisible()
    await expect(
      current.getByTestId('identity-protection-toggle'),
    ).toContainText('0 of 2 done')
    await current.getByTestId('identity-protection-toggle').click()
    await expect(page.getByTestId('identity-protection-risk')).toContainText(
      'Only this browser has your vaults',
    )
    await current.getByTestId('identity-protection-close').click()
    await current.getByTestId('identity-lock').click()
    await expect(current).toHaveAttribute('data-status', 'locked', {
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })

    // A locked card keeps only its header and vaults: the identity panel and
    // New vault return once the identity is unlocked.
    await expect(current.getByTestId('identity-overview-toggle')).toHaveCount(0)
    await expect(current.getByTestId('identity-new-vault')).toHaveCount(0)
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
    await expect(first.getByTestId('identity-overview-toggle')).toHaveCount(0)

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

/** First run keeps a new identity, Solo, on this browser and skips its first
 * vault; its unlocked card is returned. */
async function soloWithoutVault(page: Page): Promise<Locator> {
  await page.goto('/app/')
  await startFirstRun(page)
  await expect(page.getByTestId('first-run-protect-step')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  const createChoice = page.getByTestId('device-protection-create-new-choice')
  if (await createChoice.isVisible()) await createChoice.click()
  await page.getByTestId('device-protection-setup-btn').click()
  await nameFirstIdentityOnly(page, 'Solo')

  // Kept on this browser, the identity asks about its first vault.
  await expect(page.getByTestId('first-run-vault-step')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await page.getByTestId('first-run-vault-skip').click()

  const solo = card(page, 'Solo')
  await expect(solo).toHaveAttribute('data-status', 'unlocked', {
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  return solo
}

test.describe('an identity without a vault', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('nook_e2e_manual_passkey', 'true')
    })
    await installPasskeyMock(page)
  })

  test('first run can leave the identity without a vault until one is wanted', async ({
    page,
  }) => {
    // It stands on its own card with no vault, not on the first screen.
    const solo = await soloWithoutVault(page)
    await expect(page.getByTestId('first-vault-start')).toHaveCount(0)
    await expect(solo.getByTestId('identity-vault-row')).toHaveCount(0)
    // Its overview and pages open with no vault: they act on the identity.
    await solo.getByTestId('identity-overview-toggle').click()
    const overview = page.getByTestId('identity-overview')
    await expect(overview).toBeVisible()
    await overview.getByTestId('overview-open-devices').click()
    const devicesPage = page.locator(
      '[data-testid="identity-page"][data-page="devices"]',
    )
    await expect(devicesPage.getByTestId('vault-devices-panel')).toBeVisible()
    await expect(page.getByTestId('authenticated-shell')).toHaveCount(0)
    await page.getByTestId('identity-page-back').click()
    await expect(overview).toBeVisible()
    await overview.getByTestId('identity-action-add-sync').click()
    await expect(
      page
        .locator('[data-testid="identity-page"][data-page="sync"]')
        .getByTestId('storage-providers-section'),
    ).toBeVisible()
    await page.getByTestId('identity-page-back').click()
    await expect(overview).toBeVisible()

    // New vault on the card creates one whenever it is wanted.
    await solo.getByTestId('identity-new-vault').click()
    await page.getByTestId('login-vault-name-input').fill('Later')
    await page.getByTestId('login-create-additional-vault-btn').click()
    await expect(
      openVaultRow(page).or(page.getByTestId('vault-panel')).first(),
    ).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  })

  test('adds Google Drive with no vault, and Drive is listed as its provider', async ({
    page,
  }) => {
    const target = createSyncTarget(
      '',
      'vaultless-drive',
      E2eSyncProviderId.File,
    )
    await installSyncRemote(page, target)
    await installGoogleOAuthMock(page, target.pat)
    const solo = await soloWithoutVault(page)

    await solo.getByTestId('identity-overview-toggle').click()
    const overview = page.getByTestId('identity-overview')
    await overview.getByTestId('identity-action-add-sync').click()
    await page.getByTestId('provider-option-oauth-file').click()
    await page.getByTestId('google-sign-in-btn').click()
    await waitForGoogleOAuthSignedIn(page)
    await page.getByTestId('connect-provider-btn').click()

    // Setup ends on the hub, saying the identity is set up and synced; no
    // vault opened for it, and its overview lists Drive.
    await expect(page.getByTestId('identities-hub')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(
      page.getByText(
        enLocale.provider_identities.set_up_here.replace('{identity}', 'Solo'),
      ),
    ).toBeVisible()
    await expect(page.getByTestId('authenticated-shell')).toHaveCount(0)
    await solo.getByTestId('identity-overview-toggle').click()
    await expect(
      overview.getByTestId('identity-panel-provider-oauth-file'),
    ).toBeVisible()
  })
})
