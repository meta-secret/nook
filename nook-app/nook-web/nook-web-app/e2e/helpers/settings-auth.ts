import { expect, type Page } from '@playwright/test'
import type { ProviderLoadOptions } from '$lib/vault/providers.svelte'
import { parseVaultYamlSnapshot, type VaultYamlSnapshot } from '../vault-yaml'
import { E2E_OAUTH_ONBOARD_PROVIDER } from './auth-providers'
import {
  AuthenticatedWorkspaceObservation,
  AuthenticatedWorkspaceState,
  type AuthenticatedWorkspaceVisibility,
} from './authenticated-workspace'
import {
  dismissJoinEnrollmentDialog,
  keepVaultIdleLockDisabled,
} from './device-enrollment'
import {
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  UI_TIMEOUT_MS,
  sleep,
} from './environment'
import {
  beginAddSyncProvider,
  ManagePage,
  openAddDevice,
  openManagePage,
} from './workspace-navigation'
import { readLocalVaultYamlFromIdb } from './local-sync'
import {
  disableVaultIdleLock,
  forceVaultQuiescentForE2e,
  installGoogleOAuthMock,
  waitForGoogleOAuthSignedIn,
  waitForVaultOperationsIdle,
} from './vault-runtime'

/** The locked hub asks for a vault: a hint over the identity cards, or the
 * plain vault list when no identity card lists the vaults. */
export function vaultChoice(page: Page) {
  return page
    .locator(
      '[data-testid="login-choose-vault-hint"], [data-testid="login-vault-picker"]',
    )
    .first()
}

/** A vault row to unlock: on an identity card, or in the plain vault list. */
export function vaultChoiceOption(page: Page, storeId?: string) {
  const selector = storeId
    ? `[data-testid="identity-vault-row"][data-store-id="${storeId}"], [data-testid="login-vault-option"][data-store-id="${storeId}"]`
    : '[data-testid="identity-vault-row"][data-state="available"], [data-testid="login-vault-option"]'
  return page.locator(selector).first()
}

export type DeviceProtectionAuthorizationObservation = {
  readonly overlayVisible: boolean
  readonly unlockReady: boolean
  readonly pickerVisible: boolean
  readonly authorizeReady: boolean
  readonly vaultAuthenticated: boolean
  readonly workspaceUnlocked: boolean
}

export enum DeviceProtectionAuthorizationGateState {
  Overlay = 'overlay',
  Unlock = 'unlock',
  Picker = 'picker',
  Authorize = 'authorize',
  Unlocked = 'unlocked',
  Open = 'open',
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
  /** The vault panel offers to open the unlocked vault. */
  readonly openReady: boolean
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
    // Unlocking beside the card keeps the hub up until the vault is opened.
    if (this.observation.openReady) {
      return DeviceProtectionAuthorizationGateState.Open
    }
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

/** Open the sync providers page (the admin surface that owns providers). */
export async function openStorageSettings(page: Page) {
  await keepVaultIdleLockDisabled(page)
  await assertVaultReady(page)
  await waitForVaultOperationsIdle(page)
  await expect
    .poll(
      async () => {
        try {
          await openManagePage(page, ManagePage.Sync)
          return await page.getByTestId('vault-admin-panel').isVisible()
        } catch {
          return false
        }
      },
      { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    .toBe(true)
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
  await beginAddSyncProvider(page)
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

const SETTINGS_SECTION_PAGES: Record<SettingsSection, ManagePage> = {
  storage: ManagePage.Sync,
  unlock: ManagePage.Passwords,
  import: ManagePage.Import,
  devices: ManagePage.Devices,
}

/** Open the management page that owns one former settings section. */
export async function expandSettingsSection(
  page: Page,
  section: SettingsSection,
) {
  await openManagePage(page, SETTINGS_SECTION_PAGES[section])
  await expect(
    page.getByTestId(SETTINGS_SECTION_TEST_IDS[section]),
  ).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
}

export async function addVaultPassword(
  page: Page,
  label: string,
  password: string,
  options?: { expectedCount?: number },
) {
  const [expectedCount = 1] = [options?.expectedCount]
  await expandSettingsSection(page, 'unlock')
  await page.getByTestId('set-vault-password-btn').click()
  await page.getByTestId('vault-password-label').fill(label)
  await page.getByTestId('vault-password-input').fill(password)
  await page.getByTestId('vault-password-confirm').fill(password)
  await page.getByTestId('submit-vault-password').click()
  await expect(page.getByTestId('app-success')).toContainText(/passphrase/i, {
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await waitForVaultOperationsIdle(page)
  await waitForStableLocalVaultState(
    page,
    (snapshot) => snapshot.hasPasswordEnvelope,
    { timeoutMs: ENROLLMENT_UNLOCK_TIMEOUT_MS, stableReads: 2 },
  )
  await expectVaultPasswordStatus(page, expectedCount, {
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
}

/** Rotate the active backup password and wait for a new envelope in local IDB. */
export async function rotateVaultPassword(page: Page, password: string) {
  await expandSettingsSection(page, 'unlock')
  await page.getByTestId('rotate-vault-password-btn').click()
  await page.getByTestId('vault-password-input').fill(password)
  await page.getByTestId('vault-password-confirm').fill(password)
  await page.getByTestId('submit-vault-password').click()
  const success = page.getByTestId('app-success')
  const error = page.getByTestId('vault-password-error')
  await expect(success.or(error)).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  if (await error.isVisible()) {
    throw new Error(`Password rotation failed: ${await error.innerText()}`)
  }
  await expect(success).toContainText(/passphrase/i)
  await expectVaultPasswordStatus(page, 1, {
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
}

/** Poll local vault YAML until predicate holds for several consecutive reads. */
export async function waitForStableLocalVaultState(
  page: Page,
  predicate: (snapshot: VaultYamlSnapshot) => boolean,
  options?: {
    timeoutMs?: number
    intervalMs?: number
    stableReads?: number
  },
): Promise<VaultYamlSnapshot> {
  const [timeoutMs = ENROLLMENT_UNLOCK_TIMEOUT_MS] = [options?.timeoutMs]
  // IndexedDB read via page.evaluate — small round-trip, still much cheaper than network.
  const [intervalMs = 150] = [options?.intervalMs]
  const [stableReads = 3] = [options?.stableReads]
  const deadline = Date.now() + timeoutMs
  let consecutive = 0
  let lastError = 'local vault missing'

  while (Date.now() < deadline) {
    const yaml = await readLocalVaultYamlFromIdb(page)
    if (yaml.trim()) {
      const snapshot = parseVaultYamlSnapshot(yaml)
      if (predicate(snapshot)) {
        consecutive += 1
        if (consecutive >= stableReads) {
          return snapshot
        }
      } else {
        consecutive = 0
        lastError = `predicate not satisfied (secrets=${snapshot.secretIds.length}, passwords=${snapshot.hasPasswordEnvelope})`
      }
    } else {
      consecutive = 0
    }
    await sleep(intervalMs)
  }

  throw new Error(`Timed out waiting for stable local vault YAML: ${lastError}`)
}

/** Match the vault password badge copy. */
export async function dismissSyncConflictIfVisible(page: Page) {
  const dialog = page.getByTestId('vault-sync-conflict-dialog')
  if (!(await dialog.isVisible())) return
  await page.getByTestId('sync-conflict-keep-local-btn').click()
  await expect(dialog).not.toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
}

export async function expectVaultPasswordStatus(
  page: Page,
  count: number,
  options?: { timeout?: number },
) {
  await expandSettingsSection(page, 'unlock')
  const status = page
    .getByTestId('vault-unlock-section')
    .getByTestId('vault-password-status')
  const [timeout = UI_TIMEOUT_MS] = [options?.timeout]
  if (count === 1) {
    await expect(status).toContainText(/1 (passphrase|item)/, { timeout })
    return
  }
  await expect(status).toContainText(
    new RegExp(`${count} (passphrases|items)`),
    {
      timeout,
    },
  )
}

export async function expectNoVaultPasswords(
  page: Page,
  options?: { timeout?: number },
) {
  await expandSettingsSection(page, 'unlock')
  const status = page
    .getByTestId('vault-unlock-section')
    .getByTestId('vault-password-status')
  await expect(status).toContainText('None', {
    timeout: ((...[v = UI_TIMEOUT_MS]) => v)(options?.timeout),
  })
}

/**
 * Issue an identity enrollment code with a one-time passphrase and return the
 * onboarding link input locator. The joining app enters the same passphrase.
 */
export async function submitOnboardEnrollmentCode(
  page: Page,
  passphrase: string,
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

/** Reconnect after reload — unlock via login gate when auto-unlock is off. */
export async function reconnectSyncVault(page: Page) {
  await page.goto('/app/')
  await dismissSyncConflictIfVisible(page)
  await dismissJoinEnrollmentDialog(page)

  const vaultReady = async () =>
    (await page.getByTestId('vault-panel').isVisible()) ||
    (await page.getByTestId('secret-row').count()) > 0

  await expect(
    page.getByTestId('login-gate').or(page.getByTestId('vault-panel')),
  ).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })

  if (await vaultReady()) {
    await disableVaultIdleLock(page)
    return
  }

  await unlockVaultOnLogin(page)
  await expect
    .poll(async () => vaultReady(), {
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    .toBe(true)
  await disableVaultIdleLock(page)
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
  await beginAddSyncProvider(page)
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

/** An open vault session shows the vault shell, the hub, an identity page,
 * or the add-device flow. */
export async function assertVaultReady(page: Page) {
  await expect(
    page
      .getByTestId('authenticated-shell')
      .or(page.getByTestId('identity-page'))
      .or(page.getByTestId('add-device-page'))
      .or(page.getByTestId('identities-workspace'))
      .first(),
  ).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
}

export async function revealSecretInRow(
  row: import('@playwright/test').Locator,
) {
  const toggle = row.getByTestId('secret-row-toggle')
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click()
  }
  const revealButton = row.getByTestId('reveal-secret-btn')
  await expect(revealButton).toBeVisible({ timeout: UI_TIMEOUT_MS })
  if ((await revealButton.getAttribute('aria-pressed')) !== 'true') {
    await revealButton.click()
  }
  await expect(revealButton).toHaveAttribute('aria-pressed', 'true', {
    timeout: UI_TIMEOUT_MS,
  })
}

/** Observe whether a vault row can be clicked to unlock, in one browser turn. */
function vaultRowReady(storeId: string): boolean {
  const selector = storeId
    ? `[data-testid="identity-vault-row"][data-store-id="${storeId}"], [data-testid="login-vault-option"][data-store-id="${storeId}"]`
    : '[data-testid="identity-vault-row"][data-state="available"], [data-testid="login-vault-option"]'
  const row = document.querySelector(selector)
  if (!(row instanceof HTMLButtonElement)) return false
  return row.getClientRects().length > 0 && !row.disabled
}

/**
 * Authorize the wrapped device identity after an explicit or idle lock.
 * A locked hub unlocks from a vault row: the identity's passkey, then the
 * vault opens. An in-workspace authorization prompt is answered directly.
 */
export async function authorizeDeviceProtection(
  page: Page,
  opts?: { storeId?: string },
) {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const vault = window.__nookVault
          return Boolean(vault && !vault.isInitializing)
        }),
      { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    .toBe(true)
  await keepVaultIdleLockDisabled(page)
  const storeId = ((...[v = '']) => v)(opts?.storeId)
  const overlay = page.getByTestId('passkey-auth-overlay')
  const loginGate = page.getByTestId('login-gate')
  const vaultPicker = vaultChoice(page)
  const button = page.getByTestId('device-protection-unlock-btn')

  const isAuthenticatedWorkspace = async () => {
    // Read both surfaces in one browser turn. Separate locator calls can
    // straddle Svelte's access-gate transition and observe a mixed frame
    // (shell from the new state, gate from the old state) indefinitely under
    // a busy worker.
    const probe = await page.evaluate(() => {
      // The vault shell, or an identity page or the add-device flow, which
      // open outside it.
      const shell = document.querySelector(
        '[data-testid="authenticated-shell"], [data-testid="identity-page"], [data-testid="add-device-page"]',
      )
      const gate = document.querySelector('[data-testid="login-gate"]')
      return {
        visibility: {
          authenticatedShellVisible: Boolean(
            shell && shell.getClientRects().length > 0,
          ),
          loginGateVisible: Boolean(gate && gate.getClientRects().length > 0),
        } satisfies AuthenticatedWorkspaceVisibility,
      }
    })
    return (
      new AuthenticatedWorkspaceObservation(probe.visibility).state() ===
      AuthenticatedWorkspaceState.Unlocked
    )
  }

  const authorizeButtonReady = async () => {
    return page.evaluate(
      deviceProtectionButtonReady,
      'device-protection-unlock-btn',
    )
  }

  const authorizationGateState = async () => {
    const observation: DeviceProtectionAuthorizationObservation = {
      overlayVisible: await overlay.isVisible(),
      unlockReady: await page.evaluate(vaultRowReady, storeId),
      pickerVisible: await vaultPicker.isVisible(),
      authorizeReady: await authorizeButtonReady(),
      vaultAuthenticated: await page.evaluate(() =>
        Boolean(window.__nookVault?.isAuthenticated),
      ),
      workspaceUnlocked: await isAuthenticatedWorkspace(),
    }
    return deviceProtectionAuthorizationGateState(observation)
  }

  const authenticatedSurface = async () =>
    deviceProtectionAuthenticatedSurface(
      await isAuthenticatedWorkspace(),
      await page.evaluate(() => Boolean(window.__nookVault?.isAuthenticated)),
      await page.getByTestId('approve-extension-device-btn').isVisible(),
    )

  // Wait for a vault row, an authorization prompt, or true auth.
  await expect
    .poll(
      async () => {
        return authorizationGateState()
      },
      { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    .not.toBe('waiting')

  const initialState = await authorizationGateState()
  if (initialState === DeviceProtectionAuthorizationGateState.Unlocked) {
    await waitForVaultOperationsIdle(page)
    return
  }

  if (initialState === DeviceProtectionAuthorizationGateState.Authorize) {
    await button.click()
    await expect(loginGate).toBeHidden({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect
      .poll(authenticatedSurface, { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
      .toBe(true)
    await waitForVaultOperationsIdle(page)
    return
  }

  if (!(await overlay.isVisible())) {
    await openVaultPanelAndUnlock(page, storeId)
  }
  let lastPostUnlockObservationText = 'unavailable'
  let firstVisibleVaultError = ''
  const postUnlockDeadline = Date.now() + ENROLLMENT_UNLOCK_TIMEOUT_MS
  const observePostUnlock = async () => {
    const observation = await page.evaluate(() => {
      const isVisible = (testId: string) => {
        const element = document.querySelector(`[data-testid="${testId}"]`)
        if (!(element instanceof HTMLElement)) return false
        return (
          element.getClientRects().length > 0 &&
          window.getComputedStyle(element).visibility !== 'hidden'
        )
      }
      const isEnabled = (testId: string) => {
        const element = document.querySelector(`[data-testid="${testId}"]`)
        if (!(element instanceof HTMLButtonElement)) return false
        return (
          isVisible(testId) &&
          !element.disabled &&
          element.getAttribute('aria-disabled') !== 'true'
        )
      }
      const visibleVaultError = document.querySelector(
        '[data-testid="vault-error"]',
      )
      return {
        loginGateVisible: isVisible('login-gate'),
        authenticatedShellVisible:
          isVisible('authenticated-shell') ||
          isVisible('identity-page') ||
          isVisible('add-device-page'),
        vaultAuthenticated: window.__nookVault?.isAuthenticated === true,
        overlayVisible: isVisible('passkey-auth-overlay'),
        authorizeReady: isEnabled('device-protection-unlock-btn'),
        unlockReady: isEnabled('identity-vault-row'),
        openReady: isEnabled('vault-panel-open'),
        pickerVisible:
          isVisible('login-vault-picker') ||
          isVisible('login-choose-vault-hint'),
        errorVisible: isVisible('vault-error'),
        errorText:
          visibleVaultError instanceof HTMLElement && isVisible('vault-error')
            ? visibleVaultError.innerText.trim()
            : '',
      }
    })
    lastPostUnlockObservationText = JSON.stringify(observation)
    const state = new DeviceProtectionPostUnlockGate(observation).state()
    if (state === DeviceProtectionAuthorizationGateState.Error) {
      firstVisibleVaultError = observation.errorText
    }
    return state
  }
  const postUnlock = { state: DeviceProtectionAuthorizationGateState.Waiting }
  try {
    // Answer the prompts as they come: authorize this device's key, then
    // open the vault the panel offers once it is unlocked.
    let authorized = false
    await expect
      .poll(
        async () => {
          postUnlock.state = await observePostUnlock()
          if (
            postUnlock.state === DeviceProtectionAuthorizationGateState.Open
          ) {
            await page.getByTestId('vault-panel-open').click()
            return false
          }
          if (
            postUnlock.state ===
              DeviceProtectionAuthorizationGateState.Authorize &&
            !authorized
          ) {
            authorized = true
            await button.click()
            return false
          }
          return [
            DeviceProtectionAuthorizationGateState.Unlocked,
            DeviceProtectionAuthorizationGateState.Error,
          ].includes(postUnlock.state)
        },
        { timeout: Math.max(1, postUnlockDeadline - Date.now()) },
      )
      .toBe(true)
    if (postUnlock.state === DeviceProtectionAuthorizationGateState.Error) {
      throw new Error(`Vault authorization failed: ${firstVisibleVaultError}`)
    }
  } catch (failure) {
    throw new Error(
      `Vault authorization did not settle. First visible vault error: ${firstVisibleVaultError}. Last observed gate state: ${lastPostUnlockObservationText}`,
      { cause: failure },
    )
  }
  // Unlocked beside the card, the vault opens from its panel.
  await openUnlockedVault(page)
  await expect(loginGate).toBeHidden({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await expect
    .poll(authenticatedSurface, { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
    .toBe(true)
  await waitForVaultOperationsIdle(page)
}

export async function invokeInitializedVaultProviderReload(page: Page) {
  await page.evaluate(async () => {
    enum VaultProviderReloadAvailabilityKind {
      Available = 'available',
      Unavailable = 'unavailable',
    }

    interface AvailableVaultProviderReload {
      readonly kind: VaultProviderReloadAvailabilityKind.Available
      readonly vault: NonNullable<Window['__nookVault']>
    }

    interface UnavailableVaultProviderReload {
      readonly kind: VaultProviderReloadAvailabilityKind.Unavailable
    }

    type VaultProviderReloadAvailability =
      AvailableVaultProviderReload | UnavailableVaultProviderReload

    const availability: VaultProviderReloadAvailability = window.__nookVault
      ? {
          kind: VaultProviderReloadAvailabilityKind.Available,
          vault: window.__nookVault,
        }
      : { kind: VaultProviderReloadAvailabilityKind.Unavailable }
    if (availability.kind === VaultProviderReloadAvailabilityKind.Unavailable) {
      throw new Error('Initialized vault provider reload is unavailable')
    }
    const options: ProviderLoadOptions = { ensureLocalRow: false }
    await availability.vault.loadProviders(options)
  })
}

export /** Wait until the login gate offers a vault to unlock or the vault is already open. */
async function ensureLoginLocalUnlockReady(page: Page) {
  const vaultPanel = page.getByTestId('vault-panel')
  const opened = openedWorkspace(page)
  if (await opened.isVisible()) {
    return
  }

  // A reload can unlock on its own and return to the page it left.
  await expect(page.getByTestId('login-gate').or(opened).first()).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  if (await opened.isVisible()) {
    return
  }

  const vaultRow = vaultChoiceOption(page)

  await expect
    .poll(
      async () => {
        if (await vaultPanel.isVisible()) return 'ready'
        if (await vaultRow.isVisible()) return 'ready'
        if (await vaultPassphraseKey(page).isVisible()) return 'ready'
        await page.evaluate(async () => {
          const vault = window.__nookVault
          await vault?.refreshLocalVaultCatalog?.()
          await vault?.prepareLocalLogin?.()
        })
        return 'waiting'
      },
      { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    .toBe('ready')
}

/** The row that opens a locked vault's panel, where its passphrase is
 * offered: the given vault's, else the first. */
export function vaultPassphraseKey(page: Page, storeId = '') {
  return vaultChoiceOption(page, storeId)
}

/** Open the passphrase field beside the locked card and unlock with it. */
export async function unlockWithCardPassword(
  page: Page,
  opts: { password: string; entryLabel?: string; storeId?: string },
) {
  if (opts.storeId) {
    await page.evaluate(async (storeId) => {
      await window.__nookVault?.chooseLoginVault(storeId)
    }, opts.storeId)
  }
  const input = page.getByTestId('card-password-input')
  const open = vaultPassphraseKey(page, opts.storeId)
  await expect(open.or(input).first()).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  // The vault row opens its panel beside the card, where the passphrase is
  // read; with no card for the vault, the field stands on its own.
  if (
    !(await input.isVisible()) &&
    (await open.getAttribute('aria-expanded')) !== 'true'
  ) {
    await open.click()
  }
  await expect(input).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  if (opts.entryLabel) {
    await page
      .getByTestId('card-password-entry')
      .selectOption({ label: opts.entryLabel })
  }
  await page.getByTestId('card-password-input').fill(opts.password)
  await dismissSyncConflictIfVisible(page)
  await page.getByTestId('card-password-submit').click()
}

/** Unlock from the login gate: the vault row (this device's passkey), or a
 * backup password when one is given. */
export async function unlockVaultOnLogin(
  page: Page,
  opts?: { password?: string; entryLabel?: string; storeId?: string },
) {
  const opened = openedWorkspace(page)
  if (await opened.isVisible()) {
    return
  }
  await ensureLoginLocalUnlockReady(page)
  if (await opened.isVisible()) {
    return
  }
  if (opts?.password) {
    const passwordUnlock: Parameters<typeof unlockWithCardPassword>[1] = {
      password: opts.password,
      ...(opts.entryLabel ? { entryLabel: opts.entryLabel } : {}),
      ...(opts.storeId ? { storeId: opts.storeId } : {}),
    }
    await unlockWithCardPassword(page, passwordUnlock)
    await openUnlockedVault(page)
    return
  }
  await openVaultPanelAndUnlock(page, opts?.storeId)
  await openUnlockedVault(page)
}

/** The open vault, or the workspace page an unlock returned to. */
function openedWorkspace(page: Page) {
  return page
    .getByTestId('vault-panel')
    .or(page.getByTestId('authenticated-shell'))
    .first()
}

/** Mark the browser session as explicitly locked so auto-unlock stays off after reload. */
export async function disableLoginAutoUnlock(page: Page) {
  await page.evaluate(() => {
    sessionStorage.setItem('nook_vault_session_locked', '1')
  })
}

/** @deprecated `disableLoginAutoUnlock` no longer adds a dummy provider. */
export async function removeE2eDummyGithubSyncProvider(page: Page) {
  await page.evaluate(() => {})
}

/** Open a vault's panel beside its card and unlock it with this device's
 * key. The plain vault list unlocks on the row itself. */
export async function openVaultPanelAndUnlock(page: Page, storeId = '') {
  const unlock = page.getByTestId('vault-panel-unlock')
  const open = page.getByTestId('vault-panel-open')
  const shell = page.getByTestId('authenticated-shell')
  const row = vaultChoiceOption(page, storeId)
  await expect(row.or(unlock).or(open).first()).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  // The row toggles its panel: open it unless it already is.
  if (
    !(await unlock.isVisible()) &&
    !(await open.isVisible()) &&
    (await row.getAttribute('aria-expanded')) !== 'true'
  ) {
    await expect(row).toBeEnabled({ timeout: UI_TIMEOUT_MS })
    await dismissSyncConflictIfVisible(page)
    await row.click()
  }
  // A row whose key needs recovery prompts at once instead.
  const overlay = page.getByTestId('passkey-auth-overlay')
  await expect(unlock.or(open).or(shell).or(overlay).first()).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  if (await unlock.isVisible()) await unlock.click()
}

/** After an unlock beside the card, go into the vault the panel offers,
 * pressing Unlock again while it is still offered. */
export async function openUnlockedVault(page: Page) {
  // The vault, or the page the unlock returns to: a workspace page, an
  // identity page, adding a device, or approving an extension.
  const workspace = page
    .getByTestId('vault-panel')
    .or(page.getByTestId('authenticated-shell'))
    .or(page.getByTestId('identity-page'))
    .or(page.getByTestId('add-device-page'))
    .or(page.getByTestId('approve-extension-device-btn'))
    .first()
  const open = page.getByTestId('vault-panel-open')
  const unlock = page.getByTestId('vault-panel-unlock')
  await expect
    .poll(
      async () => {
        if (await workspace.isVisible()) return 'open'
        if ((await unlock.isVisible()) && (await unlock.isEnabled())) {
          await unlock.click()
          return 'waiting'
        }
        if ((await open.isVisible()) && (await open.isEnabled())) {
          await open.click()
        }
        return 'waiting'
      },
      { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    .not.toBe('waiting')
}
