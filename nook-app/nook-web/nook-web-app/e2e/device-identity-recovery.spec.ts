import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { ENROLLMENT_UNLOCK_TIMEOUT_MS } from './helpers'

type RecoveryStorageSnapshot = {
  readonly wrappedIdentityStored: boolean
  readonly registryStored: boolean
}

async function createProtectedVault(page: Page): Promise<void> {
  await page.goto('/app/')
  await expect(page.getByTestId('login-create-vault-chooser')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await page.getByTestId('get-started-path-simple').click()
  await page.getByTestId('login-vault-name-input').fill('Recovery test vault')
  await page.getByTestId('login-create-device-vault-btn').click()
  const createChoice = page.getByTestId('device-protection-create-new-choice')
  if (await createChoice.isVisible()) await createChoice.click()
  await page.getByTestId('device-protection-setup-btn').click()
  await expect(page.getByTestId('vault-panel')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
}

async function openProtectionOverlay(page: Page): Promise<void> {
  const overlay = page.getByTestId('passkey-auth-overlay')
  const unlock = page.getByTestId('unlock-vault-btn')
  await expect
    .poll(async () => {
      if (await overlay.isVisible()) return 'overlay'
      if (await unlock.isVisible()) return 'unlock'
      return 'waiting'
    })
    .not.toBe('waiting')
  if (!(await overlay.isVisible())) await unlock.click()
  await expect(overlay).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
}

async function expectDeviceKeyRecoveryInitiationAvailable(
  page: Page,
): Promise<void> {
  await expect(page.getByTestId('login-unlock-method-keys')).toBeEnabled({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await expect(page.getByTestId('unlock-vault-btn')).toBeEnabled()
}

async function readRecoveryStorage(
  page: Page,
): Promise<RecoveryStorageSnapshot> {
  return page.evaluate(
    () =>
      new Promise<RecoveryStorageSnapshot>((resolve, reject) => {
        const request = indexedDB.open('nook_db')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const transaction = db.transaction('vault', 'readonly')
          const store = transaction.objectStore('vault')
          const legacyWrapped = store.get('device_identity_wrapped')
          const appKeyWrapped = store.get('app_key_wrapped')
          const identityKeyring = store.get('local_identity_keyring_v1')
          const registry = store.get('vault_registry')
          transaction.onerror = () => reject(transaction.error)
          transaction.oncomplete = () => {
            db.close()
            const keyring =
              typeof identityKeyring.result === 'string'
                ? (JSON.parse(identityKeyring.result) as {
                    entries: Array<{ appId: string }>
                  })
                : { entries: [] }
            resolve({
              wrappedIdentityStored: Boolean(
                legacyWrapped.result ||
                appKeyWrapped.result ||
                keyring.entries.length > 0,
              ),
              registryStored: Boolean(registry.result),
            })
          }
        }
      }),
  )
}

test('waits for peer storage work before destructive identity recovery', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('nook_e2e_manual_passkey', 'true')
  })
  await createProtectedVault(page)

  const peer = await page.context().newPage()
  await peer.goto('/app/')
  await expect
    .poll(() =>
      peer.evaluate(() =>
        Boolean(
          (
            window as Window & {
              __nookVault?: { readonly localDataDeletionStarted: boolean }
            }
          ).__nookVault,
        ),
      ),
    )
    .toBe(true)
  await peer.evaluate(() => {
    const peerWindow = window as Window & {
      __nookVault?: {
        enqueueStorage<T>(operation: () => Promise<T>): Promise<T>
      }
      __releaseRecoveryStorageWork?: () => void
    }
    if (!peerWindow.__nookVault) throw new Error('Vault runtime is not exposed')
    void peerWindow.__nookVault.enqueueStorage(
      () =>
        new Promise<void>((resolve) => {
          peerWindow.__releaseRecoveryStorageWork = resolve
          localStorage.setItem('nook_e2e_recovery_storage_started', 'true')
        }),
    )
  })
  await expect
    .poll(() =>
      page.evaluate(() =>
        localStorage.getItem('nook_e2e_recovery_storage_started'),
      ),
    )
    .toBe('true')

  await page.evaluate(() => {
    localStorage.setItem('nook_e2e_passkey_mode', 'cancel')
  })
  await page.reload()
  await openProtectionOverlay(page)
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByTestId('device-protection-recovery-btn').click()

  await expect
    .poll(() =>
      peer.evaluate(() => {
        const peerVault = (
          window as Window & {
            __nookVault?: { readonly localDataDeletionStarted: boolean }
          }
        ).__nookVault
        return peerVault?.localDataDeletionStarted ?? false
      }),
    )
    .toBe(true)
  expect((await readRecoveryStorage(page)).wrappedIdentityStored).toBe(true)
  await peer.evaluate(() => {
    const peerWindow = window as Window & {
      __releaseRecoveryStorageWork?: () => void
    }
    peerWindow.__releaseRecoveryStorageWork?.()
    delete peerWindow.__releaseRecoveryStorageWork
  })

  await expect(
    page.getByTestId('device-protection-use-existing-choice'),
  ).toHaveText('Authenticate')
  const persisted = await readRecoveryStorage(page)
  expect(persisted.wrappedIdentityStored).toBe(false)
  expect(persisted.registryStored).toBe(true)
  await expect
    .poll(() =>
      peer.evaluate(() => {
        const peerVault = (
          window as Window & {
            __nookVault?: { readonly localDataDeletionStarted: boolean }
          }
        ).__nookVault
        return peerVault?.localDataDeletionStarted ?? true
      }),
    )
    .toBe(false)
  await peer.evaluate(async () => {
    const peerVault = (
      window as Window & {
        __nookVault?: {
          enqueueStorage<T>(operation: () => Promise<T>): Promise<T>
        }
      }
    ).__nookVault
    if (!peerVault) throw new Error('Vault runtime is not exposed')
    await peerVault.enqueueStorage(async () => {
      sessionStorage.setItem('nook_e2e_peer_reinitialized', 'true')
    })
  })
  await expect
    .poll(() =>
      peer.evaluate(() =>
        sessionStorage.getItem('nook_e2e_peer_reinitialized'),
      ),
    )
    .toBe('true')
  await peer.close()
})

test('keeps recovery reachable when the identity directory is corrupt', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('nook_e2e_manual_passkey', 'true')
  })
  await createProtectedVault(page)
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('nook_db')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const transaction = db.transaction('vault', 'readwrite')
          transaction
            .objectStore('vault')
            .put('{future-or-corrupt', 'identity_directory_v1')
          transaction.onerror = () => reject(transaction.error)
          transaction.oncomplete = () => {
            db.close()
            resolve()
          }
        }
      }),
  )

  await page.reload()
  await expectDeviceKeyRecoveryInitiationAvailable(page)
  await openProtectionOverlay(page)
  const recovery = page.getByTestId('device-protection-recovery-btn')
  await expect(recovery).toHaveText('Reset this browser')
  page.once('dialog', (dialog) => dialog.accept())
  await recovery.click()

  await expect(
    page.getByTestId('device-protection-use-existing-choice'),
  ).toHaveText('Authenticate')
  const persisted = await readRecoveryStorage(page)
  expect(persisted.wrappedIdentityStored).toBe(false)
  expect(persisted.registryStored).toBe(true)
})

test('uses a safe full reset when the identity directory is missing', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('nook_e2e_manual_passkey', 'true')
  })
  await createProtectedVault(page)
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('nook_db')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const transaction = db.transaction('vault', 'readwrite')
          transaction.objectStore('vault').delete('identity_directory_v1')
          transaction.onerror = () => reject(transaction.error)
          transaction.oncomplete = () => {
            db.close()
            resolve()
          }
        }
      }),
  )

  await page.reload()
  await expectDeviceKeyRecoveryInitiationAvailable(page)
  await openProtectionOverlay(page)
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByTestId('device-protection-recovery-btn').click()

  await expect(
    page.getByTestId('device-protection-use-existing-choice'),
  ).toHaveText('Authenticate')
  const persisted = await readRecoveryStorage(page)
  expect(persisted.wrappedIdentityStored).toBe(false)
  expect(persisted.registryStored).toBe(true)
})
