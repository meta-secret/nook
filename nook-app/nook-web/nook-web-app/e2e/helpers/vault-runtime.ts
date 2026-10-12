import { expect, type Page } from '@playwright/test'
import { keepVaultIdleLockDisabled } from './device-enrollment'
import { ENROLLMENT_UNLOCK_TIMEOUT_MS, UI_TIMEOUT_MS } from './environment'
import { assertNoVaultErrors } from './github-sync'

/**
 * Serial multi-device specs leave one browser idle while another acts; the e2e
 * idle timeout (2.5s) would auto-lock the waiting device and break sync flows.
 */
export async function disableVaultIdleLock(page: Page) {
  await page.evaluate(() => {
    const vault = (
      window as Window & {
        __nookVault?: { stopIdleSessionTracking?: () => void }
      }
    ).__nookVault
    vault?.stopIdleSessionTracking?.()
  })
}

/** Stop periodic background sync so e2e can wait for in-flight work to finish. */
export async function pauseVaultBackgroundSync(page: Page) {
  await page.evaluate(() => {
    const vault = (
      window as Window & {
        __nookVault?: { stopVaultSync?: () => void }
      }
    ).__nookVault
    vault?.stopVaultSync?.()
  })
}

/** Stop background sync timers and clear stuck sync flags (keeps idle lock active). */
export async function forceVaultSyncQuiescentForE2e(page: Page) {
  await page.evaluate(() => {
    const vault = (
      window as Window & {
        __nookVault?: {
          stopVaultSync?: () => void
          isSyncing?: boolean
          isFanOutSyncing?: boolean
          clearSyncingProvider: () => void
          isPasswordBusy?: boolean
        }
      }
    ).__nookVault
    if (!vault) return
    vault.stopVaultSync?.()
    vault.isSyncing = false
    vault.isFanOutSyncing = false
    vault.clearSyncingProvider()
    vault.isPasswordBusy = false
  })
}

/** Wait for the wasm storage queue to drain; reset if it stalls (e2e dev build). */
export async function waitForStorageChainIdle(
  page: Page,
  timeoutMs = ENROLLMENT_UNLOCK_TIMEOUT_MS,
) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const drained = await page.evaluate(async () => {
      const vault = (
        window as Window & {
          __nookVault?: {
            waitForStorageChain?: () => Promise<void>
          }
        }
      ).__nookVault
      if (!vault?.waitForStorageChain) return true
      return Promise.race([
        vault.waitForStorageChain().then(() => true),
        new Promise<boolean>((resolve) => {
          setTimeout(() => resolve(false), 500)
        }),
      ])
    })
    if (drained) return
  }
  await page.evaluate(() => {
    ;(
      window as Window & {
        __nookVault?: { resetStorageChain?: () => void }
      }
    ).__nookVault?.resetStorageChain?.()
  })
}

/** Wait until unlock/save/password wasm work has finished (e2e dev build). */
export async function waitForVaultOperationsIdle(
  page: Page,
  timeoutMs = ENROLLMENT_UNLOCK_TIMEOUT_MS,
) {
  await pauseVaultBackgroundSync(page)
  // Sync UI flags can be reasserted by an already queued timer after it is
  // stopped. The storage chain below is the authoritative persistence gate;
  // only unlock/save/password work must block this poll.
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const vault = (
            window as Window & {
              __nookVault?: {
                isVerifying?: boolean
                isSaving?: boolean
                isPasswordBusy?: boolean
              }
            }
          ).__nookVault
          if (!vault) return true
          return !vault.isVerifying && !vault.isSaving && !vault.isPasswordBusy
        }),
      { timeout: timeoutMs },
    )
    .toBe(true)
  await waitForStorageChainIdle(page, timeoutMs)
  await forceVaultSyncQuiescentForE2e(page)
}

export async function assertGithubConnected(page: Page) {
  await assertNoVaultErrors(page, { allowTransient: true })
  if (!(await page.getByTestId('vault-panel').isVisible())) {
    await page.getByTestId('vault-secrets-tab').click()
  }
  await expect(page.getByTestId('vault-panel')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await keepVaultIdleLockDisabled(page)
}

export enum GoogleOAuthErrorStateKind {
  Hidden = 'hidden',
  Visible = 'visible',
}

export type GoogleOAuthErrorState =
  | { kind: GoogleOAuthErrorStateKind.Hidden }
  | { kind: GoogleOAuthErrorStateKind.Visible; message: string }

export async function readGoogleOAuthError(
  page: Page,
): Promise<GoogleOAuthErrorState> {
  const error = page.getByTestId('google-oauth-error')
  if (!(await error.isVisible())) {
    return { kind: GoogleOAuthErrorStateKind.Hidden }
  }
  const content = await error.textContent()
  if (typeof content !== 'string') {
    return { kind: GoogleOAuthErrorStateKind.Hidden }
  }
  const message = content.trim()
  return message
    ? { kind: GoogleOAuthErrorStateKind.Visible, message }
    : { kind: GoogleOAuthErrorStateKind.Hidden }
}

export async function waitForGoogleOAuthSignedIn(page: Page) {
  await expect
    .poll(
      async () => {
        const errorText = await readGoogleOAuthError(page)
        if (errorText.kind === GoogleOAuthErrorStateKind.Visible) {
          throw new Error(`Google OAuth failed: ${errorText.message}`)
        }
        return (
          (await page.getByTestId('google-account-status').isVisible()) ||
          (await page.getByTestId('connect-provider-btn').isVisible())
        )
      },
      { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    .toBe(true)
}

export function installGoogleTokenClient(token: string) {
  window.google = {
    accounts: {
      oauth2: {
        initTokenClient: (config: {
          callback: (response: {
            access_token: string
            expires_in: number
          }) => void
        }) => ({
          requestAccessToken: () => {
            config.callback({ access_token: token, expires_in: 3600 })
          },
        }),
      },
    },
  }
}

/** Mock Google Identity Services token client for e2e (call before navigation). */
export async function installGoogleOAuthMock(
  page: Page,
  accessToken = 'ya29.e2e_stub_access_token',
) {
  const gisMockBody = `window.google=window.google||{};window.google.accounts=window.google.accounts||{};window.google.accounts.oauth2={initTokenClient:function(config){return{requestAccessToken:function(){config.callback({access_token:${JSON.stringify(accessToken)},expires_in:3600})}}}};`

  await page.addInitScript(installGoogleTokenClient, accessToken)
  await page.route('https://accounts.google.com/gsi/client', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: gisMockBody,
    })
  })
  await page.route(
    'https://www.googleapis.com/drive/v3/about**',
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: { emailAddress: 'e2e-user@example.com' },
        }),
      })
    },
  )
  await page.evaluate(installGoogleTokenClient, accessToken)
}
