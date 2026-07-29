import { expect, type Page } from '@playwright/test'
import { UnlockMethod } from '$lib/components/login/login-unlock-state'
import { parseVaultYamlSnapshot, type VaultYamlSnapshot } from '../vault-yaml'
import { E2E_OAUTH_ONBOARD_PROVIDER } from './auth-providers'
import {
  dismissJoinEnrollmentDialog,
  keepVaultIdleLockDisabled,
} from './device-enrollment'
import {
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  UI_TIMEOUT_MS,
  sleep,
} from './environment'
import { readLocalVaultYamlFromIdb } from './local-sync'
import {
  disableVaultIdleLock,
  forceVaultQuiescentForE2e,
  installGoogleOAuthMock,
  waitForGoogleOAuthSignedIn,
  waitForVaultOperationsIdle,
} from './vault-runtime'

/** Expand the login enrollment accordion on the login gate. */
export async function expandLoginEnrollmentPanel(page: Page) {
  const toggle = page.getByTestId('login-enrollment-toggle')
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click()
  }
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

export async function addVaultPassword(
  page: Page,
  label: string,
  password: string,
  options?: { expectedCount?: number },
) {
  const expectedCount = options?.expectedCount ?? 1
  await expandSettingsSection(page, 'unlock')
  await page.getByTestId('set-vault-password-btn').click()
  await page.getByTestId('vault-password-label').fill(label)
  await page.getByTestId('vault-password-input').fill(password)
  await page.getByTestId('vault-password-confirm').fill(password)
  await page.getByTestId('submit-vault-password').click()
  await expect(page.getByTestId('app-success')).toContainText(/password/i, {
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
  await expect(success).toContainText(/password/i)
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
  const timeoutMs = options?.timeoutMs ?? ENROLLMENT_UNLOCK_TIMEOUT_MS
  // IndexedDB read via page.evaluate — small round-trip, still much cheaper than network.
  const intervalMs = options?.intervalMs ?? 150
  const stableReads = options?.stableReads ?? 3
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
  count: number | 'none',
  options?: { timeout?: number },
) {
  await expandSettingsSection(page, 'unlock')
  const status = page
    .getByTestId('vault-unlock-section')
    .getByTestId('vault-password-status')
  const timeout = options?.timeout ?? UI_TIMEOUT_MS
  if (count === 'none') {
    await expect(status).toContainText('None', { timeout })
    return
  }
  if (count === 1) {
    await expect(status).toContainText(/1 (password|item)/, { timeout })
    return
  }
  await expect(status).toContainText(new RegExp(`${count} (passwords|items)`), {
    timeout,
  })
}

/** Issue an onboard enrollment code and return the onboarding link input locator. */
export async function submitOnboardEnrollmentCode(
  page: Page,
  password: string,
) {
  await assertVaultReady(page)
  await waitForVaultOperationsIdle(page)
  await forceVaultQuiescentForE2e(page)
  await expect(page.getByTestId('onboard-device-panel')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await dismissSyncConflictIfVisible(page)
  const entryList = page.getByTestId('onboard-password-entry-list')
  if (await entryList.isVisible()) {
    await entryList.getByRole('radio').first().click()
  }
  await expect(page.getByTestId('onboard-device-submit')).toBeEnabled({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await page.getByTestId('onboard-password-input').fill(password)
  await page.getByTestId('onboard-device-submit').click()

  const linkInput = page.getByTestId('onboarding-link-url')
  const generating = page.getByTestId('onboard-generating')
  const error = page.getByTestId('onboard-error')
  await expect(linkInput.or(error).or(generating)).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  if (await error.isVisible()) {
    throw new Error(
      `Onboard enrollment failed: ${(await error.textContent())?.trim() ?? 'unknown error'}`,
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

/** Open the onboard-device settings view with sync timers paused for e2e. */
export async function openOnboardDevicePanel(page: Page) {
  await assertVaultReady(page)
  await waitForVaultOperationsIdle(page)
  await forceVaultQuiescentForE2e(page)
  await page.getByTestId('vault-onboard-tab').click()
  await expect(page.getByTestId('onboard-device-panel')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
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

export async function selectLoginUnlockMethod(
  page: Page,
  method: UnlockMethod,
) {
  const button = page.getByTestId(`login-unlock-method-${method}`)
  await expect(button).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  await button.click()
}

/** Authorize the wrapped device identity after an explicit or idle lock. */
export async function authorizeDeviceProtection(
  page: Page,
  opts?: { storeId?: string },
) {
  const overlay = page.getByTestId('passkey-auth-overlay')
  const vaultPanel = page.getByTestId('vault-panel')
  const button = page.getByTestId('device-protection-unlock-btn')
  if (!(await overlay.isVisible())) {
    const vaultPicker = page.getByTestId('login-vault-picker')
    if (await vaultPicker.isVisible()) {
      const option = opts?.storeId
        ? page.locator(
            `[data-testid="login-vault-option"][data-store-id="${opts.storeId}"]`,
          )
        : page.getByTestId('login-vault-option').first()
      await expect(option).toBeVisible({ timeout: UI_TIMEOUT_MS })
      await option.click()
    }
    const unlockVaultButton = page.getByTestId('unlock-vault-btn')
    await expect(unlockVaultButton).toBeVisible({ timeout: UI_TIMEOUT_MS })
    await unlockVaultButton.click()
  }
  await expect
    .poll(
      async () => {
        if (await vaultPanel.isVisible()) return 'unlocked'
        if ((await button.isVisible()) && (await button.isEnabled())) {
          return 'authorize'
        }
        return 'waiting'
      },
      { timeout: UI_TIMEOUT_MS },
    )
    .not.toBe('waiting')
  if (await vaultPanel.isVisible()) {
    await waitForVaultOperationsIdle(page)
    return
  }
  await button.click()
  await expect(vaultPanel).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await waitForVaultOperationsIdle(page)
}

export async function invokeVaultLoadProviders(page: Page) {
  await page.evaluate(async () => {
    const vault = (
      window as Window & {
        __nookVault?: {
          isAuthenticated?: boolean
          loadProviders?: () => Promise<void>
        }
      }
    ).__nookVault
    if (vault?.isAuthenticated && vault.loadProviders) {
      await vault.loadProviders()
    }
  })
}

export /** Wait until the login gate exposes local unlock or the vault is already open. */
async function ensureLoginLocalUnlockReady(page: Page) {
  const vaultPanel = page.getByTestId('vault-panel')
  if (await vaultPanel.isVisible()) {
    return
  }

  await expect(page.getByTestId('login-gate')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })

  const localUnlock = page.getByTestId('login-local-unlock-step')
  const vaultPicker = page.getByTestId('login-vault-picker')

  await expect
    .poll(
      async () => {
        if (await vaultPanel.isVisible()) return 'ready'
        if (await localUnlock.isVisible()) return 'ready'
        if (await vaultPicker.isVisible()) return 'ready'
        await page.evaluate(async () => {
          const vault = (
            window as Window & {
              __nookVault?: {
                refreshLocalVaultCatalog?: () => Promise<void>
                prepareLocalLogin?: () => Promise<void>
              }
            }
          ).__nookVault
          await vault?.refreshLocalVaultCatalog?.()
          await vault?.prepareLocalLogin?.()
        })
        return 'waiting'
      },
      { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    .toBe('ready')
}

/** Unlock from the login gate — optional password when device keys are unavailable. */
export async function unlockVaultOnLogin(
  page: Page,
  opts?: { password?: string; entryLabel?: string; storeId?: string },
) {
  if (await page.getByTestId('vault-panel').isVisible()) {
    return
  }
  await ensureLoginLocalUnlockReady(page)

  const vaultPicker = page.getByTestId('login-vault-picker')
  if (await vaultPicker.isVisible()) {
    const option = opts?.storeId
      ? page.locator(
          `[data-testid="login-vault-option"][data-store-id="${opts.storeId}"]`,
        )
      : page.getByTestId('login-vault-option').first()
    await expect(option).toBeVisible({ timeout: UI_TIMEOUT_MS })
    await option.click()
    await expect(page.getByTestId('login-local-unlock-step')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
  }

  const localUnlock = page.getByTestId('login-local-unlock-step')
  if (await localUnlock.isVisible()) {
    if (opts?.password) {
      await selectLoginUnlockMethod(page, UnlockMethod.Password)
      await expect(
        page.getByTestId('login-password-entry-list').getByRole('button', {
          name: opts.entryLabel ?? /.+/,
        }),
      ).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
      if (opts.entryLabel) {
        await page
          .getByTestId('login-password-entry-list')
          .getByRole('button', { name: opts.entryLabel })
          .click()
      }
      await page.getByTestId('login-password-input').fill(opts.password)
    } else {
      const keysMethod = page.getByTestId('login-unlock-method-keys')
      if (await keysMethod.isVisible()) {
        const checked = await keysMethod.getAttribute('aria-checked')
        if (checked !== 'true') {
          await selectLoginUnlockMethod(page, UnlockMethod.Keys)
        }
      }
    }
    const unlockBtn = page.getByTestId('unlock-vault-btn')
    const vaultPanel = page.getByTestId('vault-panel')
    if (await vaultPanel.isVisible()) {
      return
    }
    await expect(unlockBtn).toBeEnabled({ timeout: UI_TIMEOUT_MS })
    if (await vaultPanel.isVisible()) {
      return
    }
    await dismissSyncConflictIfVisible(page)
    await unlockBtn.click()
    return
  }

  throw new Error(
    'Login gate has no local unlock step — use createLocalVaultOnLogin or openLoginProviderSetup.',
  )
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
