import { expect, test } from './fixtures'
import {
  createLocalVaultOnLogin,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
} from './helpers'

async function clickDeviceProtectionSetup(
  page: import('@playwright/test').Page,
) {
  const setupButton = page.getByTestId('device-protection-setup-btn')
  await expect(setupButton).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await expect(setupButton).toBeEnabled({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await setupButton.click({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
}

test.describe('passkey device-key protection', () => {
  test('wraps the device identity and requires passkey authorization after reload', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem('nook_e2e_manual_passkey', 'true')
    })
    await page.goto('/')

    await expect(page.getByTestId('device-protection-gate')).toBeVisible()
    await clickDeviceProtectionSetup(page)
    await expect(page.getByTestId('login-gate')).toBeVisible()

    const persisted = await page.evaluate(
      () =>
        new Promise<{ wrapped: string | undefined }>((resolve, reject) => {
          const request = indexedDB.open('nook_db')
          request.onerror = () => reject(request.error)
          request.onsuccess = () => {
            const db = request.result
            const transaction = db.transaction('vault', 'readonly')
            const store = transaction.objectStore('vault')
            const wrappedRequest = store.get('device_identity_wrapped')
            transaction.onerror = () => reject(transaction.error)
            transaction.oncomplete = () => {
              db.close()
              resolve({
                wrapped: wrappedRequest.result as string | undefined,
              })
            }
          }
        }),
    )

    expect(persisted.wrapped).toBeDefined()
    expect(persisted.wrapped).not.toContain('AGE-SECRET-KEY-')

    await createLocalVaultOnLogin(page, 'Passkey test vault')
    await page.getByTestId('header-lock-vault-btn').click()
    await expect(page.getByTestId('device-protection-unlock-btn')).toBeVisible()
    await page.getByTestId('device-protection-unlock-btn').click()
    await expect(page.getByTestId('login-gate')).toBeVisible()

    await page.reload()
    await expect(page.getByTestId('device-protection-unlock-btn')).toBeVisible()
    await page.getByTestId('device-protection-unlock-btn').click()
    await expect(page.getByTestId('login-gate')).toBeVisible()
  })

  test('fails closed when the authenticator does not support PRF', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem('nook_e2e_manual_passkey', 'true')
      localStorage.setItem('nook_e2e_passkey_mode', 'unsupported')
    })
    await page.goto('/')
    await clickDeviceProtectionSetup(page)

    await expect(page.getByTestId('device-protection-error')).toContainText(
      'does not support the WebAuthn PRF extension',
    )
    await expect(page.getByTestId('device-protection-gate')).toBeVisible()
  })

  test('keeps setup recoverable after passkey cancellation', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem('nook_e2e_manual_passkey', 'true')
      localStorage.setItem('nook_e2e_passkey_mode', 'cancel')
    })
    await page.goto('/')
    await clickDeviceProtectionSetup(page)

    await expect(page.getByTestId('device-protection-error')).toBeVisible()
    await expect(page.getByTestId('device-protection-setup-btn')).toBeEnabled()
  })

  test('can reset an inaccessible local identity without deleting vault storage', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem('nook_e2e_manual_passkey', 'true')
    })
    await page.goto('/')
    await clickDeviceProtectionSetup(page)
    await expect(page.getByTestId('login-gate')).toBeVisible()
    await createLocalVaultOnLogin(page, 'Recovery test vault')
    await page.reload()

    page.once('dialog', (dialog) => dialog.accept())
    await page.getByTestId('device-protection-recovery-btn').click()
    await expect(page.getByTestId('device-protection-setup-btn')).toBeVisible()

    const persisted = await page.evaluate(
      () =>
        new Promise<{ wrapped: unknown; registry: unknown }>(
          (resolve, reject) => {
            const request = indexedDB.open('nook_db')
            request.onerror = () => reject(request.error)
            request.onsuccess = () => {
              const db = request.result
              const transaction = db.transaction('vault', 'readonly')
              const store = transaction.objectStore('vault')
              const wrappedRequest = store.get('device_identity_wrapped')
              const registryRequest = store.get('vault_registry')
              transaction.onerror = () => reject(transaction.error)
              transaction.oncomplete = () => {
                db.close()
                resolve({
                  wrapped: wrappedRequest.result,
                  registry: registryRequest.result,
                })
              }
            }
          },
        ),
    )
    expect(persisted.wrapped).toBeUndefined()
    expect(persisted.registry).toBeDefined()
  })
})
