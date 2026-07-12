import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { ENROLLMENT_UNLOCK_TIMEOUT_MS } from './helpers'

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

async function openPasskeyOverlayForSimpleCreate(page: Page) {
  await expect(page.getByTestId('login-create-vault-chooser')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await page.getByTestId('login-vault-name-input').fill('Passkey flow vault')
  await page.getByTestId('landing-auth-name-continue').click()
  await page.getByTestId('get-started-path-simple').click()
  await page.getByTestId('login-create-device-vault-btn').click()
  await expect(page.getByTestId('passkey-auth-overlay')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await expect(page.getByTestId('device-protection-gate')).toBeVisible()
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

test.describe('passkey device-key protection', () => {
  test('defers passkey until simple vault create and keeps setup workflows mutually exclusive', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem('nook_e2e_manual_passkey', 'true')
    })
    await page.goto('/app/')

    await expect(page.getByTestId('login-create-vault-chooser')).toBeVisible()
    await expect(page.getByTestId('device-protection-gate')).toHaveCount(0)

    await openPasskeyOverlayForSimpleCreate(page)

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
    await page.goto('/app/')

    await openPasskeyOverlayForSimpleCreate(page)
    await page.getByTestId('device-protection-label-input').fill('Work laptop')
    await clickDeviceProtectionSetup(page)
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    const deviceId = await readDeviceId(page)
    expect(deviceId).toBeTruthy()
    const shortDeviceId = `${deviceId!.slice(0, 6)}...${deviceId!.slice(-4)}`
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

  test('reuses high-security device mode without showing it during vault naming', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem('nook_e2e_manual_passkey', 'true')
    })
    await page.goto('/app/')

    await openPasskeyOverlayForSimpleCreate(page)
    await page.getByTestId('device-mode-select').click()
    await page.getByTestId('device-mode-option-anti-hacker').click()
    await page
      .getByTestId('device-protection-label-input')
      .fill('Hardened laptop')
    await clickDeviceProtectionSetup(page)
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })

    const wrapped = await readPersistedDeviceIdentity(page)
    expect(wrapped).toContain('"protection":"passkey-wrapped-local"')
  })

  test('falls back to PIN when PRF is unavailable', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('nook_e2e_manual_passkey', 'true')
      localStorage.setItem('nook_e2e_force_prf_unavailable', 'true')
    })
    await page.goto('/app/')

    await openPasskeyOverlayForSimpleCreate(page)
    await page.getByTestId('device-protection-use-existing-choice').click()
    await expect(
      page.getByTestId('device-protection-existing-passkey-btn'),
    ).toBeVisible()
    await page.getByTestId('device-protection-existing-passkey-btn').click()

    await expect(page.getByTestId('device-protection-error')).toContainText(
      /PIN|passkey|PRF/i,
    )
    await page.getByTestId('device-protection-pin-input').fill('123456')
    await page.getByTestId('device-protection-pin-confirm').fill('123456')
    await page.getByTestId('device-protection-pin-setup-btn').click()
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })

    await page.getByTestId('header-lock-vault-btn').click()
    await expect(
      page.getByTestId('device-protection-pin-unlock-btn'),
    ).toBeVisible()
    await page.getByTestId('device-protection-pin-unlock-input').fill('000000')
    await page.getByTestId('device-protection-pin-unlock-btn').click()
    await expect(page.getByTestId('device-protection-error')).toContainText(
      /PIN|incorrect|invalid/i,
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

  test('recovers from a failed passkey create without locking the overlay', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem('nook_e2e_manual_passkey', 'true')
      localStorage.setItem('nook_e2e_force_passkey_create_error', 'true')
    })
    await page.goto('/app/')

    await openPasskeyOverlayForSimpleCreate(page)
    await page.getByTestId('device-protection-setup-btn').click()
    await expect(page.getByTestId('device-protection-error')).toBeVisible()
    await expect(page.getByTestId('device-protection-setup-btn')).toBeEnabled()
  })

  test('allows PIN recovery reset back to passkey setup', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('nook_e2e_manual_passkey', 'true')
      localStorage.setItem('nook_e2e_force_prf_unavailable', 'true')
    })
    await page.goto('/app/')

    await openPasskeyOverlayForSimpleCreate(page)
    await page.getByTestId('device-protection-pin-input').fill('123456')
    await page.getByTestId('device-protection-pin-confirm').fill('123456')
    await page.getByTestId('device-protection-pin-setup-btn').click()
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await page.getByTestId('header-lock-vault-btn').click()
    await page.getByTestId('device-protection-recovery-btn').click()
    await expect(page.getByTestId('device-protection-setup-btn')).toBeVisible()
  })
})
