import { expect, type Page } from '@playwright/test'
import { E2E_OAUTH_ONBOARD_PROVIDER } from './auth-providers'
import {
  AuthenticatedWorkspaceObservation,
  AuthenticatedWorkspaceState,
} from './authenticated-workspace'
import { keepVaultIdleLockDisabled } from './device-enrollment'
import { ENROLLMENT_UNLOCK_TIMEOUT_MS, UI_TIMEOUT_MS } from './environment'
import {
  installGoogleOAuthMock,
  waitForGoogleOAuthSignedIn,
  waitForVaultOperationsIdle,
} from './vault-runtime'

export type DeviceProtectionAuthorizationObservation = {
  readonly overlayVisible: boolean
  readonly unlockReady: boolean
  readonly pickerVisible: boolean
  readonly lockedAccessVisible: boolean
  readonly authorizeReady: boolean
  readonly vaultAuthenticated: boolean
  readonly workspaceUnlocked: boolean
}

export enum DeviceProtectionAuthorizationGateState {
  Overlay = 'overlay',
  Unlock = 'unlock',
  Picker = 'picker',
  LockedAccess = 'locked-access',
  Authorize = 'authorize',
  Unlocked = 'unlocked',
  Waiting = 'waiting',
  Error = 'error',
}

export type DeviceProtectionPostUnlockObservation = {
  readonly loginGateVisible: boolean
  readonly authenticatedShellVisible: boolean
  readonly vaultAuthenticated: boolean
  readonly overlayVisible: boolean
  readonly authorizeReady: boolean
  readonly unlockReady: boolean
  readonly pickerVisible: boolean
  readonly errorVisible: boolean
}

export function deviceProtectionAuthenticatedSurface(
  workspaceUnlocked: boolean,
  vaultAuthenticated: boolean,
  consentVisible: boolean,
): boolean {
  return workspaceUnlocked || (vaultAuthenticated && consentVisible)
}

export class DeviceProtectionPostUnlockGate {
  constructor(
    private readonly observation: DeviceProtectionPostUnlockObservation,
  ) {}

  state(): DeviceProtectionAuthorizationGateState {
    if (this.observation.vaultAuthenticated) {
      return DeviceProtectionAuthorizationGateState.Unlocked
    }
    if (
      new AuthenticatedWorkspaceObservation({
        authenticatedShellVisible: this.observation.authenticatedShellVisible,
        loginGateVisible: this.observation.loginGateVisible,
      }).state() === AuthenticatedWorkspaceState.Unlocked
    ) {
      return DeviceProtectionAuthorizationGateState.Unlocked
    }
    if (this.observation.errorVisible) {
      return DeviceProtectionAuthorizationGateState.Error
    }
    if (this.observation.authorizeReady) {
      return DeviceProtectionAuthorizationGateState.Authorize
    }
    return DeviceProtectionAuthorizationGateState.Waiting
  }
}

export function deviceProtectionAuthorizationGateState({
  overlayVisible,
  unlockReady,
  pickerVisible,
  lockedAccessVisible,
  authorizeReady,
  vaultAuthenticated,
  workspaceUnlocked,
}: DeviceProtectionAuthorizationObservation): DeviceProtectionAuthorizationGateState {
  if (vaultAuthenticated || workspaceUnlocked) {
    return DeviceProtectionAuthorizationGateState.Unlocked
  }
  if (overlayVisible) return DeviceProtectionAuthorizationGateState.Overlay
  if (unlockReady) return DeviceProtectionAuthorizationGateState.Unlock
  if (pickerVisible) return DeviceProtectionAuthorizationGateState.Picker
  if (lockedAccessVisible) {
    return DeviceProtectionAuthorizationGateState.LockedAccess
  }
  if (authorizeReady) return DeviceProtectionAuthorizationGateState.Authorize
  return DeviceProtectionAuthorizationGateState.Waiting
}

/** Observe a disposable login control in one browser turn. */
export function deviceProtectionButtonReady(testId: string): boolean {
  const button = document.querySelector(`[data-testid="${testId}"]`)
  if (!(button instanceof HTMLButtonElement)) return false
  const style = window.getComputedStyle(button)
  return (
    button.getClientRects().length > 0 &&
    style.visibility !== 'hidden' &&
    style.visibility !== 'collapse' &&
    !button.disabled
  )
}

/** Open the admin surface that owns sync providers and passwords. */
export async function openStorageSettings(page: Page) {
  await keepVaultIdleLockDisabled(page)
  await assertVaultReady(page)
  await waitForVaultOperationsIdle(page)
  const adminTab = page.getByTestId('vault-admin-tab')
  await expect
    .poll(
      async () => {
        try {
          await expect(adminTab).toBeVisible({ timeout: UI_TIMEOUT_MS })
          await expect(adminTab).toBeEnabled({ timeout: UI_TIMEOUT_MS })
          await adminTab.click({ timeout: UI_TIMEOUT_MS })
          return await page.getByTestId('vault-admin-panel').isVisible()
        } catch {
          return false
        }
      },
      { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    .toBe(true)
  await expect(page.getByTestId('vault-admin-panel')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await expect(page.getByTestId('vault-panel')).not.toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
}

/** Add and connect a GitHub sync provider from vault settings (vault must be unlocked). */
export async function connectGithubSyncProviderFromSettings(
  page: Page,
  repoName: string,
  pat = 'ghp_test_token',
  options?: { expectConflict?: boolean },
) {
  await openStorageSettings(page)
  await expandSettingsSection(page, 'storage')
  await page.getByTestId('add-provider-btn').first().click()
  await page.getByTestId('provider-option-github').click()
  await expect(page.getByTestId('github-token-setup')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await page.getByTestId('github-repo-input').fill(repoName)
  await page.getByTestId('github-pat-input').fill(pat)
  await page.getByTestId('connect-provider-btn').click()
  await waitForVaultOperationsIdle(page, ENROLLMENT_UNLOCK_TIMEOUT_MS)
  if (!options?.expectConflict) {
    await expect(
      page.getByTestId('vault-sync-conflict-dialog'),
    ).not.toBeVisible({ timeout: UI_TIMEOUT_MS })
  }
}

export const SETTINGS_SECTION_TEST_IDS = {
  storage: 'storage-providers-section',
  unlock: 'vault-unlock-section',
  import: 'vault-import-export-section',
  devices: 'vault-devices-section',
} as const

export type SettingsSection = keyof typeof SETTINGS_SECTION_TEST_IDS

/** Expand one vault settings accordion section (only one open at a time). */
export async function expandSettingsSection(
  page: Page,
  section: SettingsSection,
) {
  const targetTab =
    section === 'devices'
      ? page.getByTestId('vault-settings-tab')
      : page.getByTestId('vault-admin-tab')
  const targetPanel =
    section === 'devices'
      ? page.getByTestId('storage-settings-panel')
      : page.getByTestId('vault-admin-panel')
  if (!(await targetPanel.isVisible())) {
    await targetTab.click({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
    await expect(targetPanel).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
  }
  const sectionEl = page.getByTestId(SETTINGS_SECTION_TEST_IDS[section])
  await expect(sectionEl).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  const toggle = sectionEl.getByRole('button').first()
  await expect(toggle).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  if (
    (await toggle.getAttribute('aria-expanded', {
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })) !== 'true'
  ) {
    await toggle.click({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  }
}

/** Add and connect a local sync provider from vault settings (vault must be unlocked). */
export async function connectGoogleDriveSyncProviderFromSettings(
  page: Page,
  fileName: string,
  accessToken = E2E_OAUTH_ONBOARD_PROVIDER.accessToken,
  options?: { expectConflict?: boolean },
) {
  await installGoogleOAuthMock(page, accessToken)
  await openStorageSettings(page)
  await expandSettingsSection(page, 'storage')
  await page.getByTestId('add-provider-btn').first().click()
  await page.getByTestId('provider-option-oauth-file').click()
  await expect(page.getByTestId('google-oauth-setup')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await page.getByTestId('drive-file-input').fill(fileName)
  await page.getByTestId('google-sign-in-btn').click()
  await waitForGoogleOAuthSignedIn(page)
  await page.getByTestId('connect-provider-btn').click()
  await waitForVaultOperationsIdle(page, ENROLLMENT_UNLOCK_TIMEOUT_MS)
  if (!options?.expectConflict) {
    await expect(
      page.getByTestId('vault-sync-conflict-dialog'),
    ).not.toBeVisible({ timeout: UI_TIMEOUT_MS })
  }
}

export async function assertVaultReady(page: Page) {
  await expect(page.getByTestId('authenticated-shell')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
}
