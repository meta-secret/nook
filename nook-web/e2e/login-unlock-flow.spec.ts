import { expect, test } from '@playwright/test'
import {
  addVaultPassword,
  clearBrowserVault,
  connectLocalVault,
  connectLoginProvider,
  disableLoginAutoUnlock,
  openStorageSettings,
  selectLoginUnlockMethod,
  UI_TIMEOUT_MS,
  unlockVaultOnLogin,
} from './helpers'

async function wipeDeviceIdentity(page: import('@playwright/test').Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('nook_db', 1)
        request.onerror = () =>
          reject(request.error ?? new Error('idb open failed'))
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction('vault', 'readwrite')
          const store = tx.objectStore('vault')
          store.delete('device_id')
          store.delete('device_identity_secret')
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error ?? new Error('idb delete failed'))
        }
      }),
  )
}

test.describe('login unlock flow (provider + method)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await clearBrowserVault(page)
    await page.reload()
    await connectLocalVault(page)
  })

  test('shows storage provider and unlock method as two sequential steps', async ({
    page,
  }) => {
    await openStorageSettings(page)
    await addVaultPassword(page, 'Work backup', 'work-pass-1')
    await expect(page.getByTestId('vault-password-status')).toContainText(
      '1 password',
      { timeout: UI_TIMEOUT_MS },
    )

    await disableLoginAutoUnlock(page)
    await page.reload()
    await expect(page.getByTestId('login-gate')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })

    await expect(page.getByTestId('saved-providers-list')).toBeVisible()
    await expect(page.getByTestId('login-wizard-connection-step')).toBeVisible()
    await expect(
      page.getByTestId('login-wizard-authorization-step'),
    ).not.toBeVisible()
    await expect(page.getByTestId('login-connect-provider-btn')).toBeVisible()

    await connectLoginProvider(page)
    await expect(
      page.getByTestId('login-wizard-authorization-step'),
    ).toBeVisible()
    await expect(page.getByTestId('login-unlock-method-keys')).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await expect(page.getByTestId('login-unlock-method-password')).toBeVisible()
    await expect(page.getByTestId('login-password-input')).not.toBeVisible()
  })

  test('defaults to device keys and unlocks after connect', async ({
    page,
  }) => {
    await disableLoginAutoUnlock(page)
    await page.reload()
    await expect(page.getByTestId('login-gate')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await connectLoginProvider(page)
    await expect(page.getByTestId('login-unlock-method-keys')).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await page.getByTestId('unlock-vault-btn').click()
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
  })

  test('switches to backup password and shows labelled entry picker', async ({
    page,
  }) => {
    await openStorageSettings(page)
    await addVaultPassword(page, 'Personal', 'personal-pass')
    await addVaultPassword(page, 'Travel', 'travel-pass')

    await disableLoginAutoUnlock(page)
    await page.reload()
    await expect(page.getByTestId('login-gate')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })

    await connectLoginProvider(page)
    await selectLoginUnlockMethod(page, 'password')
    await expect(
      page.getByTestId('login-unlock-method-password'),
    ).toHaveAttribute('aria-checked', 'true')
    const entryList = page.getByTestId('login-password-entry-list')
    await expect(
      entryList.getByRole('button', { name: 'Personal' }),
    ).toBeVisible()
    await expect(
      entryList.getByRole('button', { name: 'Travel' }),
    ).toBeVisible()
    await expect(page.getByTestId('login-password-input')).toBeVisible()
  })

  test('unlocks with backup password when device keys are missing', async ({
    page,
  }) => {
    await openStorageSettings(page)
    await addVaultPassword(page, 'Recovery', 'recovery-pass-99')

    await wipeDeviceIdentity(page)
    await page.reload()
    await expect(page.getByTestId('login-gate')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })

    const joinClose = page.getByTestId('join-enrollment-close')
    if (await joinClose.isVisible()) {
      await joinClose.click()
    }

    await unlockVaultOnLogin(page, {
      entryLabel: 'Recovery',
      password: 'recovery-pass-99',
    })
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
  })

  test('hides backup password option when vault has no password entries', async ({
    page,
  }) => {
    await disableLoginAutoUnlock(page)
    await page.reload()
    await expect(page.getByTestId('login-gate')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await connectLoginProvider(page)
    await expect(page.getByTestId('login-unlock-method-fieldset')).toBeVisible()
    await expect(page.getByTestId('login-unlock-method-keys')).toBeVisible()
    await expect(
      page.getByTestId('login-unlock-method-password'),
    ).not.toBeVisible()
  })
})
