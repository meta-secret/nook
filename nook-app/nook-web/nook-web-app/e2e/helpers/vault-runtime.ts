import { omittedValue } from '../../../nook-web-shared/src/explicit-state'
import {
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test'
import { installMockPasskeyRuntime } from '../passkey-mock'
import { keepVaultIdleLockDisabled } from './device-enrollment'
import { ENROLLMENT_UNLOCK_TIMEOUT_MS, UI_TIMEOUT_MS } from './environment'
import { assertNoVaultErrors } from './github-sync'
import { openLoginProviderSetup } from './vault-setup'

export async function clearBrowserVault(page: Page) {
  const clearedThroughManager = await page.evaluate(async () => {
    const vault = (
      window as Window & {
        __nookVault?: {
          initPromise?: Promise<void>
          stopVaultSync?: () => void
          waitForStorageChain?: () => Promise<void>
          enqueueStorage?: <T>(operation: () => Promise<T>) => Promise<T>
          manager?: { deleteLocalBrowserData?: () => Promise<void> }
        }
      }
    ).__nookVault
    await vault?.initPromise
    vault?.stopVaultSync?.()
    await vault?.waitForStorageChain?.()
    const manager = vault?.manager
    if (!manager?.deleteLocalBrowserData) return false
    if (vault.enqueueStorage) {
      await vault.enqueueStorage(() => manager.deleteLocalBrowserData!())
    } else {
      await manager.deleteLocalBrowserData()
    }
    return true
  })
  await page.evaluate(
    (vaultAlreadyCleared) =>
      new Promise<void>((resolve, reject) => {
        localStorage.clear()
        if (vaultAlreadyCleared) {
          resolve()
          return
        }
        let pending = 2
        const done = () => {
          pending -= 1
          if (pending === 0) resolve()
        }
        const onError = (err: DOMException | void) =>
          reject(err ?? new Error('IndexedDB delete failed'))

        const vaultDb = indexedDB.deleteDatabase('nook_db')
        vaultDb.onsuccess = done
        vaultDb.onerror = () => onError(vaultDb.error ?? omittedValue())
        vaultDb.onblocked = done

        const authDb = indexedDB.deleteDatabase('nook_auth')
        authDb.onsuccess = done
        authDb.onerror = () => onError(authDb.error ?? omittedValue())
        authDb.onblocked = done
      }),
    clearedThroughManager,
  )
}

export async function createIsolatedContext(
  browser: Browser,
): Promise<BrowserContext> {
  const context = await browser.newContext()
  await context.addInitScript(installMockPasskeyRuntime)
  return context
}

export async function installPasskeyMock(page: Page): Promise<void> {
  await page.addInitScript(installMockPasskeyRuntime)
}

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
          syncingProviderId?: string | void
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

/** Stop timers and clear stuck sync flags so wasm storage ops can proceed in e2e. */
export async function forceVaultQuiescentForE2e(page: Page) {
  await page.evaluate(() => {
    const vault = (
      window as Window & {
        __nookVault?: {
          stopVaultSync?: () => void
          stopIdleSessionTracking?: () => void
          isSyncing?: boolean
          isFanOutSyncing?: boolean
          syncingProviderId?: string | void
          isPasswordBusy?: boolean
        }
      }
    ).__nookVault
    if (!vault) return
    vault.stopVaultSync?.()
    vault.stopIdleSessionTracking?.()
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

/** Wait until background vault sync / fan-out is idle (e2e dev build only). */
export async function waitForVaultSyncIdle(
  page: Page,
  timeoutMs = ENROLLMENT_UNLOCK_TIMEOUT_MS,
) {
  await pauseVaultBackgroundSync(page)
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const vault = (
            window as Window & {
              __nookVault?: { isSyncActivityVisible?: boolean }
            }
          ).__nookVault
          return vault ? !vault.isSyncActivityVisible : true
        }),
      { timeout: timeoutMs },
    )
    .toBe(true)
}

export function uniqueSecretKey(prefix: string) {
  return `${prefix}-${Date.now()}`
}

export async function waitForEngine(page: Page) {
  const button = page.getByTestId('connect-provider-btn')
  await expect(button.first()).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await expect(button.first()).toBeEnabled({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await expect(button.first()).not.toContainText('Loading engine', {
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  return button.first()
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

export async function setupGithubProvider(
  page: Page,
  pat: string,
  repoName: string,
) {
  await openLoginProviderSetup(page)
  await page.getByTestId('provider-option-github').click()
  await page.getByTestId('github-repo-input').fill(repoName)
  await page.getByTestId('github-pat-input').fill(pat)
}

export async function readGoogleOAuthError(page: Page): Promise<string | void> {
  const error = page.getByTestId('google-oauth-error')
  if (!(await error.isVisible())) {
    return
  }
  return (
    ((await error.textContent()) ?? omittedValue())?.trim() || omittedValue()
  )
}

export async function waitForGoogleOAuthSignedIn(page: Page) {
  await expect
    .poll(
      async () => {
        const errorText = await readGoogleOAuthError(page)
        if (errorText) {
          throw new Error(`Google OAuth failed: ${errorText}`)
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

export async function setupGoogleDriveProvider(page: Page, fileName: string) {
  await openLoginProviderSetup(page)
  await page.getByTestId('provider-option-oauth-file').click()
  await expect(page.getByTestId('google-oauth-setup')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await page.getByTestId('drive-file-input').fill(fileName)
  await page.getByTestId('google-sign-in-btn').click()
  await waitForGoogleOAuthSignedIn(page)
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

export async function waitForVaultUnlocked(
  page: Page,
  timeout = UI_TIMEOUT_MS,
) {
  try {
    await expect(page.getByTestId('vault-panel')).toBeVisible({ timeout })
  } catch (error) {
    const errorText = (
      await page
        .getByTestId('vault-error')
        .or(page.getByTestId('onboard-error'))
        .or(page.getByTestId('vault-password-error'))
        .allTextContents()
    )
      .map((text) => text.trim())
      .filter(Boolean)
      .join(' | ')
    throw new Error(
      errorText
        ? `Vault did not unlock. Visible error: ${errorText}`
        : `Vault did not unlock: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
}

export async function wipeDeviceIdentity(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('nook_db')
        request.onerror = () =>
          reject(request.error ?? new Error('idb open failed'))
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction('vault', 'readwrite')
          const store = tx.objectStore('vault')
          store.delete('device_id')
          store.delete('device_identity_wrapped')
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error ?? new Error('idb delete failed'))
        }
      }),
  )
}
