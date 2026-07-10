import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import {
  createLocalVaultOnLogin,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
} from './helpers'

async function clickDeviceProtectionSetup(page: Page) {
  const setupButton = page.getByTestId('device-protection-setup-btn')
  await expect(setupButton).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await expect(setupButton).toBeEnabled({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await setupButton.click({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
}

async function readVaultValue<T>(
  page: Page,
  key: string,
): Promise<T | undefined> {
  return page.evaluate(
    (valueKey) =>
      new Promise<T | undefined>((resolve, reject) => {
        const request = indexedDB.open('nook_db')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const transaction = db.transaction('vault', 'readonly')
          const store = transaction.objectStore('vault')
          const valueRequest = store.get(valueKey)
          transaction.onerror = () => reject(transaction.error)
          transaction.oncomplete = () => {
            db.close()
            resolve(valueRequest.result as T | undefined)
          }
        }
      }),
    key,
  )
}

async function readPersistedDeviceIdentity(
  page: Page,
): Promise<string | undefined> {
  return readVaultValue<string>(page, 'device_identity_wrapped')
}

async function readDeviceId(page: Page): Promise<string | undefined> {
  return readVaultValue<string>(page, 'device_id')
}

async function clearDeviceMetadata(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('nook_db')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const transaction = db.transaction('vault', 'readwrite')
          const store = transaction.objectStore('vault')
          store.delete('device_id')
          store.delete('device_identity_wrapped')
          transaction.onerror = () => reject(transaction.error)
          transaction.oncomplete = () => {
            db.close()
            resolve()
          }
        }
      }),
  )
}

test.describe('passkey device-key protection', () => {
  test('makes passkey creation primary and keeps setup workflows mutually exclusive', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem('nook_e2e_manual_passkey', 'true')
    })
    await page.goto('/')

    await expect(page.getByTestId('device-protection-step')).toHaveText(
      'Device setup · Step 1 of 2',
    )
    await expect(page.getByTestId('device-protection-title')).toHaveText(
      'Prepare this browser',
    )
    await expect(page.getByTestId('mode-group-device')).toBeVisible()
    await expect(
      page.getByTestId('device-protection-create-workflow'),
    ).toBeVisible()
    await expect(
      page.getByTestId('device-protection-existing-workflow'),
    ).toBeHidden()

    await page.getByTestId('device-protection-use-existing-choice').click()
    await expect(
      page.getByTestId('device-protection-existing-workflow'),
    ).toBeVisible()
    await expect(page.getByText('Need a new Nook passkey?')).toBeVisible()
    await expect(
      page.getByTestId('device-protection-create-new-choice'),
    ).toHaveText('Create new passkey')
    await expect(
      page.getByTestId('device-protection-create-workflow'),
    ).toBeHidden()

    await page.getByTestId('device-protection-create-new-choice').click()
    await expect(
      page.getByTestId('device-protection-create-workflow'),
    ).toBeVisible()
    await expect(
      page.getByTestId('device-protection-existing-workflow'),
    ).toBeHidden()
  })

  test('derives the device identity and requires passkey authorization after reload', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem('nook_e2e_manual_passkey', 'true')
    })
    await page.goto('/')

    await expect(page.getByTestId('device-protection-gate')).toBeVisible()
    await page.getByTestId('device-protection-label-input').fill('Work laptop')
    await clickDeviceProtectionSetup(page)
    await expect(page.getByTestId('login-gate')).toBeVisible()
    await expect(page.getByTestId('mode-group-device')).toHaveCount(0)
    const deviceId = await readDeviceId(page)
    const shortDeviceId = `${deviceId.slice(0, 6)}...${deviceId.slice(-4)}`
    await expect
      .poll(() =>
        page.evaluate(() => localStorage.getItem('nook_e2e_passkey_label')),
      )
      .toBe(`Work laptop - device ${shortDeviceId}`)

    const wrapped = await readPersistedDeviceIdentity(page)

    expect(wrapped).toBeDefined()
    expect(wrapped).toContain('"protection":"passkey-derived"')
    expect(wrapped).not.toContain('"ciphertext"')
    expect(wrapped).not.toContain('AGE-SECRET-KEY-')

    await createLocalVaultOnLogin(page, 'Passkey test vault')
    await page.getByTestId('header-lock-vault-btn').click()
    await expect(page.getByTestId('device-protection-unlock-btn')).toBeVisible()
    await expect(page.getByTestId('device-protection-unlock-btn')).toHaveText(
      'Continue with passkey',
    )
    await expect(
      page.getByTestId('device-protection-create-new-choice'),
    ).toBeHidden()
    await expect(page.getByTestId('device-protection-setup-btn')).toBeHidden()
    await page.getByTestId('device-protection-unlock-btn').click()
    await expect(page.getByTestId('login-gate')).toBeVisible()

    await page.reload()
    await expect(page.getByTestId('device-protection-unlock-btn')).toBeVisible()
    await page.getByTestId('device-protection-unlock-btn').click()
    await expect(page.getByTestId('login-gate')).toBeVisible()
  })

  test('reuses high-security device mode without showing it during vault creation', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem('nook_e2e_manual_passkey', 'true')
    })
    await page.goto('/')

    await page.getByTestId('device-mode-select').click()
    await page.getByRole('option', { name: 'High security' }).click()
    await clickDeviceProtectionSetup(page)
    await expect(page.getByTestId('login-gate')).toBeVisible()
    await expect(page.getByTestId('mode-group-device')).toHaveCount(0)

    await page.reload()
    await page.getByTestId('device-protection-unlock-btn').click()
    await expect(page.getByTestId('login-gate')).toBeVisible()
    await expect(page.getByTestId('mode-group-device')).toHaveCount(0)
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as Window & {
                __nookVault?: { draftDeviceMode?: string }
              }
            ).__nookVault?.draftDeviceMode,
        ),
      )
      .toBe('anti-hacker')
  })

  test('recovers the same device identity from an existing passkey after local metadata is cleared', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem('nook_e2e_manual_passkey', 'true')
    })
    await page.goto('/')

    await expect(page.getByTestId('device-protection-gate')).toBeVisible()
    await clickDeviceProtectionSetup(page)
    await expect(page.getByTestId('login-gate')).toBeVisible()

    const originalDeviceId = await readDeviceId(page)
    await clearDeviceMetadata(page)

    await page.reload()
    await page.getByTestId('device-protection-use-existing-choice').click()
    await expect(
      page.getByTestId('device-protection-existing-passkey-btn'),
    ).toBeVisible()
    await page.getByTestId('device-protection-existing-passkey-btn').click()
    await expect(page.getByTestId('login-gate')).toBeVisible()

    const recoveredDeviceId = await readDeviceId(page)
    expect(recoveredDeviceId).toBe(originalDeviceId)
  })

  test('falls back to PIN wrapping when the authenticator does not support PRF', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem('nook_e2e_manual_passkey', 'true')
      localStorage.setItem('nook_e2e_passkey_mode', 'unsupported')
    })
    await page.goto('/')
    await clickDeviceProtectionSetup(page)

    await expect(page.getByTestId('device-protection-error')).toContainText(
      'does not support WebAuthn PRF',
    )
    await page.getByTestId('device-protection-pin-input').fill('123456')
    await page.getByTestId('device-protection-pin-confirm').fill('123456')
    await page.getByTestId('device-protection-pin-setup-btn').click()
    await expect(page.getByTestId('login-gate')).toBeVisible()

    const wrapped = await readPersistedDeviceIdentity(page)
    expect(wrapped).toBeDefined()
    expect(wrapped).toContain('"protection":"pin"')
    expect(wrapped).not.toContain('AGE-SECRET-KEY-')

    await createLocalVaultOnLogin(page, 'PIN fallback vault')
    await page.getByTestId('header-lock-vault-btn').click()
    await expect(
      page.getByTestId('device-protection-pin-unlock-btn'),
    ).toBeVisible()
    await page.getByTestId('device-protection-pin-unlock-input').fill('000000')
    await page.getByTestId('device-protection-pin-unlock-btn').click()
    await expect(page.getByTestId('device-protection-error')).toContainText(
      'did not decrypt',
    )
    await page.getByTestId('device-protection-pin-unlock-input').fill('123456')
    await page.getByTestId('device-protection-pin-unlock-btn').click()
    await expect(page.getByTestId('login-gate')).toBeVisible()

    await page.reload()
    await expect(
      page.getByTestId('device-protection-pin-unlock-btn'),
    ).toBeVisible()
    await page.getByTestId('device-protection-pin-unlock-input').fill('123456')
    await page.getByTestId('device-protection-pin-unlock-btn').click()
    await expect(page.getByTestId('login-gate')).toBeVisible()
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
