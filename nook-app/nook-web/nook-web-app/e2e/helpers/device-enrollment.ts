import { expect, type Locator, type Page } from '@playwright/test'
import { createLocalE2eGoogleDriveVaultStub } from '../drive-stub'
import { parseVaultYamlSnapshot } from '../vault-yaml'
import {
  AuthenticatedWorkspaceObservation,
  AuthenticatedWorkspaceState,
  type AuthenticatedWorkspaceVisibility,
} from './authenticated-workspace'
import { DEFAULT_GITHUB_REPO, GITHUB_CONNECT_TIMEOUT_MS } from './environment'
import {
  waitForGithubVaultState,
  waitForSyncRemoteVaultState,
  type GithubE2eTarget,
} from './github-sync'
import {
  createLocalE2eGithubVaultStub,
  type E2eOauthFileStub,
} from './local-sync'
import {
  connectGithubSyncProviderFromSettings,
  connectGoogleDriveSyncProviderFromSettings,
} from './settings-auth'
import { assertGithubConnected, installGoogleOAuthMock } from './vault-runtime'
import { createLocalVaultOnLogin } from './vault-setup'

export async function connectGithubVault(
  page: Page,
  pat: string,
  repoName = DEFAULT_GITHUB_REPO,
  stub?: ReturnType<typeof createLocalE2eGithubVaultStub>,
) {
  const target: GithubE2eTarget = { pat, repoName }
  if (stub) target.stub = stub
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
    await stub.install(page, { fileName, accessToken })
  }
  await page.goto('/app/')
  await createLocalVaultOnLogin(page)
  await connectGoogleDriveSyncProviderFromSettings(page, fileName, accessToken)
  await waitForSyncRemoteVaultState(
    ((...[v = createLocalE2eGoogleDriveVaultStub('', fileName)]) => v)(stub),
    (yaml) => yaml.authPkIds.length >= 1 && yaml.memberPkIds.length >= 1,
    { page, timeoutMs: GITHUB_CONNECT_TIMEOUT_MS },
  )
  await assertGithubConnected(page)
}

export function isJoinerVaultReady(
  visibility: AuthenticatedWorkspaceVisibility,
): boolean {
  return (
    new AuthenticatedWorkspaceObservation(visibility).state() ===
    AuthenticatedWorkspaceState.Unlocked
  )
}

export async function tryJoinerQuickConnect(
  button: Pick<Locator, 'isVisible' | 'click'>,
  waitForIdle: () => Promise<void>,
): Promise<boolean> {
  if (!(await button.isVisible())) return false
  await button.click()
  await waitForIdle()
  return true
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
