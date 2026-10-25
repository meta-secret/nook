import {
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test'
import {
  E2E_GOOGLE_ACCOUNT_EMAIL,
  installGoogleIdentityTokenMock,
} from '../google-identity-stub'
import { installMockPasskeyRuntime } from '../passkey-mock'
import { keepVaultIdleLockDisabled } from './device-enrollment'
import { ENROLLMENT_UNLOCK_TIMEOUT_MS, UI_TIMEOUT_MS } from './environment'
import { assertNoVaultErrors } from './github-sync'
import { openVaultPage } from './workspace-navigation'

export async function clearBrowserVault(page: Page) {
  const appMountReadinessOptions: { timeout: number } = {
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  }
  await expect(page.getByTestId('app-shell-content')).toBeAttached(
    appMountReadinessOptions,
  )
  await expect
    .poll(() => page.evaluate(() => '__nookVault' in window), {
      timeout: UI_TIMEOUT_MS,
    })
    .toBe(true)

  const cleared = await page.evaluate(async () => {
    const vault = window.__nookVault
    if (!vault) throw new Error('__nookVault is not available on the page')
    await vault.init()
    vault.stopVaultSync()
    await vault.waitForStorageChain()
    if (!vault.hasManager) return { ok: true as const, value: false }
    const manager = vault.admitManager()
    if (manager.isErr())
      return { ok: false as const, error: manager.error.translationKey }
    try {
      await manager.value.delete_local_browser_data()
    } catch {
      return { ok: false as const, error: 'Native local data deletion failed' }
    }
    return { ok: true as const, value: true }
  })
  if (!cleared.ok) throw new Error(cleared.error)
  const clearedThroughManager = cleared.value
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
        const vaultDb = indexedDB.deleteDatabase('nook_db')
        vaultDb.onsuccess = done
        vaultDb.onerror = () =>
          reject(
            ((v) => (v ? v : new Error('Vault database failed to open')))(
              vaultDb.error,
            ),
          )
        vaultDb.onblocked = done

        const authDb = indexedDB.deleteDatabase('nook_auth')
        authDb.onsuccess = done
        authDb.onerror = () =>
          reject(
            ((v) => (v ? v : new Error('Auth database failed to open')))(
              authDb.error,
            ),
          )
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
          clearSyncingProvider: () => void
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

export async function assertGithubConnected(page: Page) {
  await assertNoVaultErrors(page, { allowTransient: true })
  if (!(await page.getByTestId('vault-panel').isVisible())) {
    await openVaultPage(page)
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

/**
 * Create the signed-in provider's My Drive vault folder from the setup
 * wizard. Every Google Drive provider syncs under one; connecting stays
 * disabled until it exists. The wizard then lists the folder's accounts.
 */
export async function createGoogleDriveVaultFolder(page: Page) {
  const create = page.getByTestId('google-create-shared-folder-btn')
  await expect(create).toBeEnabled({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  await create.click()
  await expect(page.getByTestId('google-shared-folder-status')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await expect(
    page
      .getByTestId('authorized-accounts')
      .getByTestId('authorized-accounts-list'),
  ).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
}

/** Mock Google Identity Services token client for e2e (call before navigation). */
export async function installGoogleOAuthMock(
  page: Page,
  accessToken = 'ya29.e2e_stub_access_token',
) {
  await page.route(
    'https://www.googleapis.com/drive/v3/about**',
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: { emailAddress: E2E_GOOGLE_ACCOUNT_EMAIL },
        }),
      })
    },
  )
  await installGoogleIdentityTokenMock(page, accessToken)
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
          reject(((v) => (v ? v : new Error('idb open failed')))(request.error))
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction('vault', 'readwrite')
          const store = tx.objectStore('vault')
          store.delete('local_identity_keyring_v1')
          store.delete('device_id')
          store.delete('device_identity_wrapped')
          store.delete('app_id')
          store.delete('app_key_wrapped')
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () =>
            reject(((v) => (v ? v : new Error('idb delete failed')))(tx.error))
        }
      }),
  )
}
