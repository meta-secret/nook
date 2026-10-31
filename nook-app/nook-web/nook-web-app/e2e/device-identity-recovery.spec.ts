import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import {
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  expectFirstVaultOpen,
  startFirstRun,
} from './helpers'

declare global {
  interface Window {
    __releaseRecoveryStorageWork?: () => void
  }
}

type RecoveryStorageSnapshot = {
  readonly wrappedIdentityStored: boolean
  readonly registryStored: boolean
}

async function createProtectedVault(page: Page): Promise<void> {
  await page.goto('/app/')
  const chooser = page.getByTestId('login-create-vault-chooser')
  const vaultError = page.getByTestId('vault-error')
  await expect
    .poll(
      async () => (await chooser.isVisible()) || (await vaultError.isVisible()),
      { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    .toBe(true)
  if (await vaultError.isVisible()) {
    throw new Error(
      `Protected vault setup failed: ${await vaultError.innerText()}`,
    )
  }
  await startFirstRun(page)
  const createChoice = page.getByTestId('device-protection-create-new-choice')
  if (await createChoice.isVisible()) await createChoice.click()
  await page.getByTestId('device-protection-setup-btn').click()
  await expectFirstVaultOpen(page, 'Recovery test vault')
}

/**
 * Recovery sits under the vault's unlock: at once when this browser's key
 * cannot be read, otherwise after its passkey unlock fails there.
 */
async function openDeviceRecovery(page: Page): Promise<void> {
  const recovery = page.getByTestId('device-protection-recovery-btn')
  const row = page.getByTestId('identity-vault-row').first()
  const unlock = page.getByTestId('vault-panel-unlock')
  await expect
    .poll(
      async () => {
        if (await recovery.isVisible()) return 'recovery'
        if (await row.isVisible()) return 'row'
        return 'waiting'
      },
      { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    .not.toBe('waiting')
  if (await recovery.isVisible()) return
  await page.evaluate(() => {
    localStorage.setItem('nook_e2e_passkey_mode', 'cancel')
  })
  // A card's row opens its vault panel; a row no card lists unlocks at once.
  if (
    !(await unlock.isVisible()) &&
    (await row.getAttribute('aria-expanded')) !== 'true'
  ) {
    await row.click()
  }
  await expect(unlock.or(recovery).first()).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  if (!(await recovery.isVisible())) await unlock.click()
  await expect(recovery).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
}

/** After a reset this browser has no key: opening the vault sets one up. */
async function openDeviceSetup(page: Page): Promise<void> {
  const choice = page.getByTestId('device-protection-use-existing-choice')
  const row = page.getByTestId('identity-vault-row').first()
  await expect(choice.or(row).first()).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  if (!(await choice.isVisible())) await row.click()
  await expect(choice).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
}

async function expectDeviceKeyRecoveryInitiationAvailable(
  page: Page,
): Promise<void> {
  await expect(page.getByTestId('identity-vault-row').first()).toBeEnabled({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
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
            const keyringValue: unknown =
              typeof identityKeyring.result === 'string'
                ? JSON.parse(identityKeyring.result)
                : {}
            const entriesValue: unknown =
              typeof keyringValue === 'object' &&
              Object(keyringValue) === keyringValue
                ? Object.getOwnPropertyDescriptor(keyringValue, 'entries')
                    ?.value
                : {}
            const entryCount = Array.isArray(entriesValue)
              ? entriesValue.length
              : 0
            resolve({
              wrappedIdentityStored: Boolean(
                legacyWrapped.result || appKeyWrapped.result || entryCount > 0,
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
    .poll(() => peer.evaluate(() => Boolean(window.__nookVault)))
    .toBe(true)
  await peer.evaluate(() => {
    const peerVault = window.__nookVault
    if (!peerVault) throw new Error('Vault runtime is not exposed')
    void peerVault.enqueueStorage(async () => {
      await new Promise<void>((resolve) => {
        window.__releaseRecoveryStorageWork = resolve
        localStorage.setItem('nook_e2e_recovery_storage_started', 'true')
      })
      return peerVault.admitManager()
    })
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
  await openDeviceRecovery(page)
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByTestId('device-protection-recovery-btn').click()

  await expect
    .poll(() =>
      peer.evaluate(() => {
        return window.__nookVault?.localDataDeletionStarted === true
      }),
    )
    .toBe(true)
  expect((await readRecoveryStorage(page)).wrappedIdentityStored).toBe(true)
  await peer.evaluate(() => {
    window.__releaseRecoveryStorageWork?.()
    delete window.__releaseRecoveryStorageWork
  })

  // The peer reloads once its storage work finishes and recovery has reset
  // the device key; an evaluation that the reload interrupts is read again
  // from the reloaded page.
  await expect
    .poll(
      () =>
        peer
          .evaluate(() => {
            return window.__nookVault?.localDataDeletionStarted !== false
          })
          .catch(() => true),
      { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    .toBe(false)
  const persisted = await readRecoveryStorage(page)
  expect(persisted.wrappedIdentityStored).toBe(false)
  expect(persisted.registryStored).toBe(true)
  await openDeviceSetup(page)
  await expect(
    page.getByTestId('device-protection-use-existing-choice'),
  ).toHaveText('Authenticate')
  await peer.evaluate(async () => {
    const peerVault = window.__nookVault
    if (!peerVault) throw new Error('Vault runtime is not exposed')
    await peerVault.enqueueStorage(async () => {
      sessionStorage.setItem('nook_e2e_peer_reinitialized', 'true')
      return peerVault.admitManager()
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
  await openDeviceRecovery(page)
  const recovery = page.getByTestId('device-protection-recovery-btn')
  await expect(recovery).toHaveText('Reset this browser')
  page.once('dialog', (dialog) => dialog.accept())
  await recovery.click()

  await openDeviceSetup(page)
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
  await openDeviceRecovery(page)
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByTestId('device-protection-recovery-btn').click()

  await openDeviceSetup(page)
  await expect(
    page.getByTestId('device-protection-use-existing-choice'),
  ).toHaveText('Authenticate')
  const persisted = await readRecoveryStorage(page)
  expect(persisted.wrappedIdentityStored).toBe(false)
  expect(persisted.registryStored).toBe(true)
})
