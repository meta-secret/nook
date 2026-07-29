import { expect, type Page } from '@playwright/test'
import { createLocalE2eGoogleDriveVaultStub } from '../drive-stub'
import {
  assertJoinPendingYaml,
  joinCountFromYaml,
  parseVaultYamlSnapshot,
} from '../vault-yaml'
import { dumpNookLogs } from './app-logs'
import {
  DEFAULT_GITHUB_REPO,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  GITHUB_CONNECT_TIMEOUT_MS,
  UI_TIMEOUT_MS,
  configuredGithubSyncTimeoutMs,
} from './environment'
import {
  GithubE2eTarget,
  assertNoVaultErrors,
  triggerVaultSyncRefresh,
  waitForGithubVaultState,
  waitForSyncRemoteVaultState,
} from './github-sync'
import { E2eOauthFileStub, createLocalE2eGithubVaultStub } from './local-sync'
import {
  assertEnrolledVaultOnGithub,
  assertGenesisVaultOnGithub,
} from './secret-operations'
import {
  connectGithubSyncProviderFromSettings,
  connectGoogleDriveSyncProviderFromSettings,
  dismissSyncConflictIfVisible,
  expandSettingsSection,
  openStorageSettings,
} from './settings-auth'
import {
  assertGithubConnected,
  clearBrowserVault,
  disableVaultIdleLock,
  installGoogleOAuthMock,
  setupGithubProvider,
  setupGoogleDriveProvider,
  waitForEngine,
  waitForStorageChainIdle,
  waitForVaultOperationsIdle,
} from './vault-runtime'
import { createLocalVaultOnLogin } from './vault-setup'

export async function expectEmptyLocalFolderRejected(
  page: Page,
  afterSetup: () => Promise<void> = async () => {},
): Promise<void> {
  await page.getByTestId('login-connect-storage-btn').click()
  await expect(page.getByTestId('login-provider-setup')).toBeVisible()
  await afterSetup()
  await page.getByTestId('provider-option-local-folder').click()
  await page.getByTestId('login-choose-local-folder-btn').click()
  await expect(page.getByTestId('login-local-folder-selected')).toHaveText(
    'Nook Backup',
  )
  await page.getByTestId('login-connect-local-folder-btn').click()
  await expect(page.getByTestId('vault-error')).toContainText(
    'No existing vault was found in this provider',
  )
  await expect(page.getByTestId('passkey-auth-overlay')).toHaveCount(0)
}

export async function connectGithubVault(
  page: Page,
  pat: string,
  repoName = DEFAULT_GITHUB_REPO,
  stub?: ReturnType<typeof createLocalE2eGithubVaultStub>,
) {
  const target = { pat, repoName, stub }
  if (stub) {
    await stub.install(page, { repoName })
  }
  await page.goto('/app/')
  await createLocalVaultOnLogin(page)
  await connectGithubSyncProviderFromSettings(page, repoName, pat)
  if (stub) {
    await expect
      .poll(
        () => {
          if (stub.getEventFileCount() > 0) return 'event-log'
          const yaml = stub.getVaultYaml()
          if (!yaml.trim()) return 'waiting'
          try {
            const snapshot = parseVaultYamlSnapshot(yaml)
            return snapshot.authPkIds.length >= 1 &&
              snapshot.memberPkIds.length >= 1
              ? 'vault-yaml'
              : 'waiting'
          } catch {
            return 'waiting'
          }
        },
        { timeout: GITHUB_CONNECT_TIMEOUT_MS },
      )
      .not.toBe('waiting')
  } else {
    await waitForGithubVaultState(
      target,
      (yaml) => yaml.authPkIds.length >= 1 && yaml.memberPkIds.length >= 1,
      { page, timeoutMs: GITHUB_CONNECT_TIMEOUT_MS },
    )
  }
  await assertGithubConnected(page)
}

export async function connectGoogleDriveVault(
  page: Page,
  accessToken: string,
  fileName: string,
  stub?: E2eOauthFileStub,
) {
  await installGoogleOAuthMock(page, accessToken)
  if (stub) {
    await stub.install(page, { fileName })
  }
  await page.goto('/app/')
  await createLocalVaultOnLogin(page)
  await connectGoogleDriveSyncProviderFromSettings(page, fileName, accessToken)
  await waitForSyncRemoteVaultState(
    stub ?? createLocalE2eGoogleDriveVaultStub('', fileName),
    (yaml) => yaml.authPkIds.length >= 1 && yaml.memberPkIds.length >= 1,
    { page, timeoutMs: GITHUB_CONNECT_TIMEOUT_MS },
  )
  await assertGithubConnected(page)
}

export async function connectGoogleDriveGenesisDevice(
  page: Page,
  accessToken: string,
  fileName: string,
  stub?: E2eOauthFileStub,
) {
  await page.goto('/app/')
  await clearBrowserVault(page)
  await page.reload()
  await connectGoogleDriveVault(page, accessToken, fileName, stub)
}

/** Genesis device: fresh browser + GitHub repo → connected vault. */
export async function connectGithubGenesisDevice(
  page: Page,
  pat: string,
  repoName: string,
  stub?: ReturnType<typeof createLocalE2eGithubVaultStub>,
) {
  await page.goto('/app/')
  await clearBrowserVault(page)
  await page.reload()
  await connectGithubVault(page, pat, repoName, stub)
}

export /** Joiner connect runs GitHub assess + wasm — allow the same budget as genesis connect. */
async function waitForJoinEnrollmentDialog(page: Page) {
  const joinDialog = page.getByTestId('join-enrollment-dialog')
  await expect
    .poll(
      async () => {
        await assertNoVaultErrors(page, { allowTransient: true })
        if (await joinDialog.isVisible()) return 'join'
        if (await page.getByTestId('login-password-entry-list').isVisible()) {
          return 'password'
        }
        return 'waiting'
      },
      { timeout: GITHUB_CONNECT_TIMEOUT_MS },
    )
    .toBe('join')
  await expect(page.getByTestId('join-enrollment-confirm')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
}

/** Second device: same repo → join enrollment dialog. */
export async function connectGithubJoinerDevice(
  page: Page,
  pat: string,
  repoName: string,
  stub?: ReturnType<typeof createLocalE2eGithubVaultStub>,
) {
  const target = { pat, repoName, stub }
  await assertGenesisVaultOnGithub(target)
  if (stub) {
    await stub.install(page, { repoName })
  }
  await page.goto('/app/')
  await clearBrowserVault(page)
  await page.reload()
  await setupGithubProvider(page, pat, repoName)
  const connectButton = await waitForEngine(page)
  await connectButton.click()
  await waitForJoinEnrollmentDialog(page)
}

export async function sendJoinRequest(
  page: Page,
  pat: string,
  repoName: string,
  stub?: ReturnType<typeof createLocalE2eGithubVaultStub>,
) {
  await page.getByTestId('join-enrollment-confirm').click()
  await waitForVaultOperationsIdle(page)
  await waitForStorageChainIdle(page, ENROLLMENT_UNLOCK_TIMEOUT_MS)

  const snapshot = await waitForGithubVaultState(
    { pat, repoName, stub },
    (yaml) => yaml.joinEntries.length >= 1 || joinCountFromYaml(yaml.raw) >= 1,
    { page, timeoutMs: GITHUB_CONNECT_TIMEOUT_MS },
  )
  assertJoinPendingYaml(snapshot)
  const join = snapshot.joinEntries[0]

  await expect(page.getByTestId('join-enrollment-dialog')).toContainText(
    'Waiting for approval',
    { timeout: UI_TIMEOUT_MS },
  )

  await page.getByTestId('join-enrollment-dismiss').click()
  await expect(page.getByTestId('join-enrollment-dialog')).not.toBeVisible()

  return join
}

export async function waitForPendingJoinOnDevice(page: Page, deviceId: string) {
  await waitForPendingJoinBanner(page, deviceId)
  const row = page.getByTestId('device-join-row').filter({ hasText: deviceId })
  await expect(row).toBeVisible({ timeout: UI_TIMEOUT_MS })
}

/** Wait until pending joins are visible on an enrolled device (manual sync + banner). */
export async function waitForPendingJoinBanner(page: Page, deviceId?: string) {
  await expect
    .poll(
      async () => {
        await dismissSyncConflictIfVisible(page)
        await page.evaluate(async () => {
          const vault = (
            window as Window & {
              __nookVault?: {
                refreshPendingJoinsFromProviders?: () => Promise<void>
              }
            }
          ).__nookVault
          await vault?.refreshPendingJoinsFromProviders?.()
        })
        try {
          await triggerVaultSyncRefresh(page)
        } catch {
          await page.evaluate(async () => {
            const vault = (
              window as Window & {
                __nookVault?: { manualSync?: () => Promise<void> }
              }
            ).__nookVault
            await vault?.manualSync?.()
          })
        }
        await waitForVaultOperationsIdle(page)
        if (deviceId) {
          const row = page
            .getByTestId('device-join-row')
            .filter({ hasText: deviceId })
          if (await row.isVisible()) return true
        }
        if (await page.getByTestId('pending-joins-banner').isVisible()) {
          return true
        }
        const pending = await page.evaluate(() => {
          const vault = (
            window as Window & {
              __nookVault?: { pendingJoins?: unknown[] }
            }
          ).__nookVault
          return vault?.pendingJoins?.length ?? 0
        })
        return pending > 0
      },
      { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    .toBe(true)
  await expect(page.getByTestId('pending-joins-banner')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
}

export async function approveJoinFromBanner(
  page: Page,
  deviceId: string,
  target: GithubE2eTarget,
  expectedMembers: number,
) {
  await waitForPendingJoinOnDevice(page, deviceId)
  const row = page.getByTestId('device-join-row').filter({ hasText: deviceId })
  await row.getByTestId('approve-join-btn').click()
  await assertEnrolledVaultOnGithub(target, expectedMembers, page)
  await expect(row).not.toBeVisible({ timeout: UI_TIMEOUT_MS })
}

export async function approveJoinFromSettings(
  page: Page,
  deviceId: string,
  target: GithubE2eTarget,
  expectedMembers: number,
) {
  await openStorageSettings(page)
  await expandSettingsSection(page, 'devices')
  await waitForPendingJoinInSettings(page, deviceId)
  const row = page.getByTestId('pending-join-row').filter({ hasText: deviceId })
  await row.getByTestId('approve-join-btn').click()
  await assertEnrolledVaultOnGithub(target, expectedMembers, page)
  await expect(row).not.toBeVisible({ timeout: UI_TIMEOUT_MS })
}

export async function waitForPendingJoinInSettings(
  page: Page,
  deviceId: string,
) {
  const row = page.getByTestId('pending-join-row').filter({ hasText: deviceId })
  await expect
    .poll(
      async () => {
        await page.evaluate(async () => {
          const vault = (
            window as Window & {
              __nookVault?: {
                refreshPendingJoinsFromProviders?: () => Promise<void>
              }
            }
          ).__nookVault
          await vault?.refreshPendingJoinsFromProviders?.()
        })
        if (await row.isVisible()) return true
        try {
          await triggerVaultSyncRefresh(page)
        } catch {
          // Sync control may still be disabled while background work finishes.
        }
        return row.isVisible()
      },
      { timeout: configuredGithubSyncTimeoutMs() },
    )
    .toBe(true)
}

export async function dismissJoinEnrollmentDialog(page: Page) {
  for (const testId of ['join-enrollment-dismiss', 'join-enrollment-close']) {
    const button = page.getByTestId(testId)
    if (await button.isVisible()) {
      await button.click()
    }
  }
}

export /** Pull remote vault state on the login gate (joiner waiting for / after approval). */
async function refreshGithubVaultOnLoginGate(page: Page) {
  await page.evaluate(async () => {
    const vault = (
      window as Window & {
        __nookVault?: {
          syncFromStorage?: (opts?: { force?: boolean }) => Promise<void>
        }
      }
    ).__nookVault
    await vault?.syncFromStorage?.({ force: true })
  })
  await waitForVaultOperationsIdle(page)
}

export type JoinerVaultReadyTarget = {
  pat: string
  repoName: string
  providerId?: string
  stub?: {
    install: (page: Page, opts: Record<string, unknown>) => Promise<void>
  }
}

export function isOauthFileJoinerTarget(target: JoinerVaultReadyTarget) {
  return (
    target.providerId === 'file' ||
    target.providerId === 'local' ||
    target.providerId === 'google-drive'
  )
}

export async function tryGithubVaultConnect(
  page: Page,
  target: JoinerVaultReadyTarget,
) {
  await refreshGithubVaultOnLoginGate(page)
  await dismissSyncConflictIfVisible(page)
  await dismissJoinEnrollmentDialog(page)

  const quickConnect = page.getByTestId('connect-provider-btn').first()
  if (await quickConnect.isVisible()) {
    if (await quickConnect.isEnabled()) {
      await quickConnect.click()
      await waitForVaultOperationsIdle(page)
    }
    return
  }
  if (await page.getByTestId('login-provider-setup').isVisible()) {
    await page.getByTestId('provider-option-github').click()
    const repoInput = page.getByTestId('github-repo-input')
    if (await repoInput.isVisible()) {
      await repoInput.fill(target.repoName)
      await page.getByTestId('github-pat-input').fill(target.pat)
    }
    const connectButton = await waitForEngine(page)
    await connectButton.click()
    await waitForVaultOperationsIdle(page)
    return
  }
  await setupGithubProvider(page, target.pat, target.repoName)
  const connectButton = await waitForEngine(page)
  await connectButton.click()
  await waitForVaultOperationsIdle(page)
}

export async function tryOauthFileVaultConnect(
  page: Page,
  target: JoinerVaultReadyTarget,
) {
  await refreshGithubVaultOnLoginGate(page)
  await dismissSyncConflictIfVisible(page)
  await dismissJoinEnrollmentDialog(page)

  const quickConnect = page.getByTestId('connect-provider-btn').first()
  if (await quickConnect.isVisible()) {
    if (await quickConnect.isEnabled()) {
      await quickConnect.click()
      await waitForVaultOperationsIdle(page)
    }
    return
  }

  await installGoogleOAuthMock(page, target.pat)
  await setupGoogleDriveProvider(page, target.repoName)
  const connectButton = await waitForEngine(page)
  await connectButton.click()
  await waitForVaultOperationsIdle(page)
}

export async function tryJoinerVaultConnect(
  page: Page,
  target: JoinerVaultReadyTarget,
) {
  if (isOauthFileJoinerTarget(target)) {
    await tryOauthFileVaultConnect(page, target)
    return
  }
  await tryGithubVaultConnect(page, target)
}

/**
 * Keep the e2e idle lock (2.5s) suppressed across unlocks.
 *
 * `disableVaultIdleLock` only stops the *current* tracker; every
 * `markVaultUnlocked()` starts a new one. While a helper is driving connect
 * attempts, the vault can unlock and idle-lock again between two Playwright
 * calls, so pin an interval in the page that keeps stopping the tracker.
 */
export async function keepVaultIdleLockDisabled(page: Page) {
  await page.evaluate(() => {
    const w = window as Window & {
      __nookVault?: { stopIdleSessionTracking?: () => void }
      __nookE2eIdleGuard?: number
    }
    if (w.__nookE2eIdleGuard) return
    w.__nookE2eIdleGuard = window.setInterval(() => {
      w.__nookVault?.stopIdleSessionTracking?.()
    }, 300)
  })
}

export async function waitForJoinerVaultReady(
  page: Page,
  target: JoinerVaultReadyTarget,
) {
  if (target.stub) {
    await target.stub.install(
      page,
      isOauthFileJoinerTarget(target)
        ? { fileName: target.repoName }
        : { repoName: target.repoName },
    )
  }
  if (isOauthFileJoinerTarget(target)) {
    await installGoogleOAuthMock(page, target.pat)
  }
  await keepVaultIdleLockDisabled(page)
  try {
    await expect
      .poll(
        async () => {
          await refreshGithubVaultOnLoginGate(page)
          await dismissSyncConflictIfVisible(page)
          await dismissJoinEnrollmentDialog(page)
          if (
            (await page.getByTestId('vault-panel').isVisible()) ||
            (await page.getByTestId('secret-row').count()) > 0
          ) {
            return true
          }
          await tryJoinerVaultConnect(page, target)
          return (
            (await page.getByTestId('vault-panel').isVisible()) ||
            (await page.getByTestId('secret-row').count()) > 0
          )
        },
        { timeout: GITHUB_CONNECT_TIMEOUT_MS },
      )
      .toBe(true)
  } catch (error) {
    await dumpNookLogs(page, 'waitForJoinerVaultReady')
    throw error
  }
  await disableVaultIdleLock(page)
}
