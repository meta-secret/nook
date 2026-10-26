import { expect, type Page } from '@playwright/test'
import { createLocalE2eGoogleDriveVaultStub } from '../drive-stub'
import { parseVaultYamlSnapshot } from '../vault-yaml'
import { DEFAULT_GITHUB_REPO, GITHUB_CONNECT_TIMEOUT_MS } from './environment'
import {
  type GithubE2eTarget,
  waitForGithubVaultState,
  waitForSyncRemoteVaultState,
} from './github-sync'
import {
  createLocalE2eGithubVaultStub,
  type E2eOauthFileStub,
} from './local-sync'
import {
  connectGithubSyncProviderFromSettings,
  connectGoogleDriveSyncProviderFromSettings,
} from './settings-auth'
import {
  assertGithubConnected,
  clearBrowserVault,
  installGoogleOAuthMock,
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
  await connectGoogleDriveSyncProviderFromSettings(page, accessToken)
  await waitForSyncRemoteVaultState(
    ((...[v = createLocalE2eGoogleDriveVaultStub('', fileName)]) => v)(stub),
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

export async function dismissJoinEnrollmentDialog(page: Page) {
  for (const testId of ['join-enrollment-dismiss', 'join-enrollment-close']) {
    const button = page.getByTestId(testId)
    if (await button.isVisible()) {
      await button.click()
    }
  }
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
