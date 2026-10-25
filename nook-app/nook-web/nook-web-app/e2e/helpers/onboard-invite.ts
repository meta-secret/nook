import { expect, type Page } from '@playwright/test'
import { ENROLLMENT_UNLOCK_TIMEOUT_MS, UI_TIMEOUT_MS } from './environment'
import { assertVaultReady, dismissSyncConflictIfVisible } from './settings-auth'
import {
  forceVaultQuiescentForE2e,
  waitForVaultOperationsIdle,
} from './vault-runtime'
import { openAddDevice } from './workspace-navigation'

/** Options for issuing a device invite from the add-device flow. */
export type OnboardEnrollmentOptions = {
  /** The authorized account a Google Drive or iCloud invite names. Without
   * one, the first account with write access is picked. */
  readonly inviteAccount?: string
}

/**
 * Google Drive and iCloud invites name one account from the provider's own
 * sharing list; other providers show no list. Pick the account before the
 * invite is issued.
 */
export async function pickOnboardInviteAccount(
  page: Page,
  options?: OnboardEnrollmentOptions,
) {
  const panel = page
    .getByTestId('onboard-device-panel')
    .getByTestId('authorized-accounts')
  if (!(await panel.isVisible())) return
  const list = panel.getByTestId('authorized-accounts-list')
  const failure = panel
    .getByTestId('authorized-accounts-error')
    .or(panel.getByTestId('authorized-accounts-empty'))
  await expect(list.or(failure)).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  if (await failure.isVisible()) {
    throw new Error(
      `Authorized accounts unavailable: ${(await failure.innerText()).trim()}`,
    )
  }
  const account = options?.inviteAccount
  const picker = account
    ? panel.getByTestId(`authorized-account-pick-${account}`)
    : panel.locator('[data-testid^="authorized-account-pick-"]:enabled').first()
  await picker.click()
  await expect(picker).toHaveAttribute('aria-checked', 'true')
}

/**
 * Issue an identity enrollment code with a one-time passphrase and return the
 * onboarding link input locator. The joining app enters the same passphrase.
 */
export async function submitOnboardEnrollmentCode(
  page: Page,
  passphrase: string,
  options?: OnboardEnrollmentOptions,
) {
  await assertVaultReady(page)
  await waitForVaultOperationsIdle(page)
  await forceVaultQuiescentForE2e(page)
  await expect(page.getByTestId('onboard-device-panel')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await dismissSyncConflictIfVisible(page)
  await expect(page.getByTestId('onboard-device-submit')).toBeEnabled({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await pickOnboardInviteAccount(page, options)
  await page.getByTestId('onboard-passphrase-input').fill(passphrase)
  await page.getByTestId('onboard-device-submit').click()

  const linkInput = page.getByTestId('onboarding-link-url')
  const generating = page.getByTestId('onboard-generating')
  const error = page.getByTestId('onboard-error')
  await expect(linkInput.or(error).or(generating)).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  if (await error.isVisible()) {
    throw new Error(
      `Onboard enrollment failed: ${((...[v = 'unknown error']) => v)((await error.textContent())?.trim())}`,
    )
  }
  await expect(linkInput).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  return linkInput
}

/** Raw enrollment payload from a full onboarding URL or hash link. */
export function enrollmentCodeFromLink(link: string): string {
  const trimmed = link.trim()
  const hashIndex = trimmed.indexOf('#enroll=')
  if (hashIndex >= 0) {
    return decodeURIComponent(trimmed.slice(hashIndex + '#enroll='.length))
  }
  return trimmed
}

/** Exercise a generated public app link against the Playwright preview host. */
export function localizeAppLinkForE2e(page: Page, link: string): string {
  const previewUrl = new URL(page.url())
  const appUrl = new URL(link)
  appUrl.protocol = previewUrl.protocol
  appUrl.host = previewUrl.host
  return appUrl.toString()
}

/** Open the add-device flow with sync timers paused for e2e. */
export async function openOnboardDevicePanel(page: Page) {
  await assertVaultReady(page)
  await waitForVaultOperationsIdle(page)
  await forceVaultQuiescentForE2e(page)
  await openAddDevice(page)
  // With a cloud copy the invite form shows; without one, step one asks
  // for a sync provider.
  await expect(
    page
      .getByTestId('onboard-device-panel')
      .or(page.getByTestId('onboard-no-identity-mount'))
      .first(),
  ).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
}
