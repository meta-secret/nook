import type { Browser, BrowserContext, Page } from '@playwright/test'
import { expect, test } from './fixtures'
import {
  createIsolatedContext,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  waitForPersistedAppLog,
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

async function createSentinelParticipantAnnouncement(
  browser: Browser,
  label: string,
): Promise<{ context: BrowserContext; announcement: string }> {
  const context = await createIsolatedContext(browser)
  await context.addInitScript(() => {
    localStorage.setItem('nook_e2e_manual_passkey', 'true')
  })
  const participant = await context.newPage()
  await participant.goto('/app/')
  await expect(
    participant.getByTestId('login-create-vault-chooser'),
  ).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  await expect
    .poll(() =>
      participant.evaluate(() =>
        Boolean((window as Window & { __nookVault?: unknown }).__nookVault),
      ),
    )
    .toBe(true)

  const announcement = await participant.evaluate(async (deviceLabel) => {
    const participantVault = (
      window as Window & {
        __nookVault?: {
          setupDeviceProtection: (
            label: string,
            mode: 'standard',
          ) => Promise<void>
          createSentinelGenesisPublicKeyAnnouncement: () => Promise<string>
        }
      }
    ).__nookVault
    if (!participantVault) throw new Error('Participant vault is unavailable')
    await participantVault.setupDeviceProtection(deviceLabel, 'standard')
    return participantVault.createSentinelGenesisPublicKeyAnnouncement()
  }, label)

  return { context, announcement }
}

function participantAuthenticationUrl(announcement: string): string {
  return `/app/#sentinel-response=${Buffer.from(announcement).toString(
    'base64url',
  )}`
}

async function openExistingVaultProtectionOverlay(page: Page) {
  const overlay = page.getByTestId('passkey-auth-overlay')
  await expect(overlay).toBeHidden()
  const unlockVaultButton = page.getByTestId('unlock-vault-btn')
  await expect(unlockVaultButton).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await unlockVaultButton.click()
  await expect(overlay).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
}

async function unlockExistingVaultWithPasskey(page: Page) {
  await expect(page.getByTestId('passkey-auth-overlay')).toBeHidden()
  const unlockVaultButton = page.getByTestId('unlock-vault-btn')
  await expect(unlockVaultButton).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await unlockVaultButton.click()
  await expect(page.getByTestId('vault-panel')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await expect(page.getByTestId('passkey-auth-overlay')).toHaveCount(0)
}

async function openPasskeyOverlayForSimpleCreate(page: Page) {
  await expect(page.getByTestId('login-create-vault-chooser')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await page.getByTestId('get-started-path-simple').click()
  await page.getByTestId('login-vault-name-input').fill('Passkey flow vault')
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
  test('defers passkey until simple vault create without a second existing-passkey widget', async ({
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
      page.getByTestId('device-protection-use-existing-choice'),
    ).toHaveText('Use existing passkey')
    await expect(
      page.getByTestId('device-protection-existing-workflow'),
    ).toHaveCount(0)
  })

  test('uses participant passkeys and adds a signed key from the pre-genesis card', async ({
    browser,
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem('nook_e2e_manual_passkey', 'true')
    })
    await page.goto('/app/')

    const participantOne = await createSentinelParticipantAnnouncement(
      browser,
      'Sentinel participant one',
    )
    const participantTwo = await createSentinelParticipantAnnouncement(
      browser,
      'Sentinel participant two',
    )
    const participantAnnouncement = participantOne.announcement
    expect(participantAnnouncement).toContain('publicKeyAnnouncement')

    await page.getByTestId('get-started-path-sentinel').click()
    await page.getByTestId('sentinel-dashboard-card-stack').click()
    await expect(page.getByTestId('sentinel-onboarding-identity')).toBeVisible()
    await expect(page.getByTestId('sentinel-genesis-policy-step')).toHaveCount(
      0,
    )
    await expect(page.getByTestId('passkey-auth-overlay')).toHaveCount(0)
    await expect(
      page.getByTestId('sentinel-genesis-response-input'),
    ).toHaveCount(0)
    await page.getByTestId('sentinel-onboarding-create-keys').click()
    await expect(page.getByTestId('passkey-auth-overlay')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(
      page.getByTestId('sentinel-genesis-response-input'),
    ).toHaveCount(0)
    await clickDeviceProtectionSetup(page)
    await expect(page.getByTestId('sentinel-genesis-name-step')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(
      page.getByTestId('sentinel-genesis-response-input'),
    ).toHaveCount(0)
    await expect(
      page.getByTestId('sentinel-card-stack-dashboard'),
    ).toContainText('AUTOMATICALLY INCLUDED')
    await page
      .getByTestId('sentinel-genesis-name-input')
      .fill('Passkey Sentinel')
    await page.getByTestId('sentinel-onboarding-continue-policy').click()
    await expect(page.getByTestId('sentinel-genesis-policy-step')).toBeVisible()
    await page.getByTestId('sentinel-genesis-participant-count').click()
    await page.getByTestId('sentinel-participant-count-option-3').click()
    await page.getByTestId('sentinel-onboarding-continue-devices').click()
    await expect(
      page.getByTestId('sentinel-genesis-response-input'),
    ).toHaveCount(0)
    await expect(
      page.getByTestId('sentinel-genesis-authentication-instructions'),
    ).toContainText('Open the authentication URL')
    const participantNameInput = page.getByTestId(
      'sentinel-genesis-participant-name',
    )
    await expect(participantNameInput).toBeVisible()
    await expect(
      page.getByTestId('sentinel-genesis-add-participant'),
    ).toBeDisabled()
    await participantNameInput.fill("Ada's iPhone")
    await expect(
      page.getByTestId('sentinel-genesis-add-participant'),
    ).toBeDisabled()

    await page.goto(participantAuthenticationUrl(participantAnnouncement))
    await expect(
      page.getByTestId('sentinel-genesis-authentication-ready'),
    ).toContainText('Authentication response received')
    await participantNameInput.fill("Ada's iPhone")
    await expect(
      page.getByTestId('sentinel-genesis-add-participant'),
    ).toBeEnabled()

    await page.getByTestId('sentinel-genesis-add-participant').click()
    await expect(
      page.getByTestId('sentinel-card-stack-dashboard'),
    ).toContainText("Ada's iPhone")
    await page.goto(participantAuthenticationUrl(participantTwo.announcement))
    await expect(
      page.getByTestId('sentinel-genesis-authentication-ready'),
    ).toContainText('Authentication response received')
    await participantNameInput.fill("Grace's Laptop")
    await page.getByTestId('sentinel-genesis-add-participant').click()
    await expect(
      page.getByTestId('sentinel-card-stack-dashboard'),
    ).toContainText("Grace's Laptop")
    await expect(
      page.getByTestId('sentinel-genesis-participant-fields'),
    ).toHaveCount(0)
    await expect(
      page.getByTestId('sentinel-genesis-ceremony-step'),
    ).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
    await expect(page.getByTestId('sentinel-genesis-finalize')).toBeEnabled()
    await expect(
      page.getByTestId('sentinel-onboarding-progress').locator('li').nth(3),
    ).toHaveAttribute('data-current', 'step')
    await page.getByTestId('sentinel-genesis-finalize').click()
    await expect(
      page.getByTestId('sentinel-genesis-ceremony-step'),
    ).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
    await expect(page.getByTestId('sentinel-genesis-progress')).toContainText(
      '3 / 3',
      { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    await expect(page.getByTestId('sentinel-genesis-deliveries')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })

    await participantOne.context.close()
    await participantTwo.context.close()
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
    await unlockExistingVaultWithPasskey(page)

    await page.reload()
    await unlockExistingVaultWithPasskey(page)
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
    await page.getByRole('option', { name: 'High security' }).click()
    await clickDeviceProtectionSetup(page)
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(page.getByTestId('mode-group-device')).toHaveCount(0)

    await page.getByTestId('header-lock-vault-btn').click()
    await unlockExistingVaultWithPasskey(page)
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
    await page.goto('/app/')

    await openPasskeyOverlayForSimpleCreate(page)
    await clickDeviceProtectionSetup(page)
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })

    const originalDeviceId = await readDeviceId(page)
    await clearDeviceMetadata(page)

    await page.reload()
    // Existing vault stays in the app unlock workflow while device recovery is
    // deferred until the user explicitly asks to unlock it.
    await expect(page.getByTestId('login-gate')).toBeVisible()
    await expect(page.getByTestId('login-local-unlock-step')).toBeVisible()
    await expect(page.getByTestId('passkey-auth-overlay')).toHaveCount(0)
    await expect(page.getByTestId('unlock-vault-btn')).toBeEnabled()

    await page.getByTestId('unlock-vault-btn').click()
    await expect(page.getByTestId('passkey-auth-overlay')).toBeVisible()
    await expect(page.getByTestId('passkey-auth-overlay-dismiss')).toBeVisible()
    await page.getByTestId('device-protection-use-existing-choice').click()
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })

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
    await page.goto('/app/')
    await openPasskeyOverlayForSimpleCreate(page)
    await clickDeviceProtectionSetup(page)

    await expect(page.getByTestId('device-protection-error')).toContainText(
      'does not support WebAuthn PRF',
    )
    await page.getByTestId('device-protection-pin-input').fill('123456')
    await page.getByTestId('device-protection-pin-confirm').fill('123456')
    await page.getByTestId('device-protection-pin-setup-btn').click()
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })

    const wrapped = await readPersistedDeviceIdentity(page)
    expect(wrapped).toBeDefined()
    expect(wrapped).toContain('"protection":"pin"')
    expect(wrapped).not.toContain('AGE-SECRET-KEY-')

    await page.getByTestId('header-lock-vault-btn').click()
    await openExistingVaultProtectionOverlay(page)
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
    await expect(page.getByTestId('vault-panel')).toBeVisible()

    await page.reload()
    await openExistingVaultProtectionOverlay(page)
    await expect(
      page.getByTestId('device-protection-pin-unlock-btn'),
    ).toBeVisible()
    await page.getByTestId('device-protection-pin-unlock-input').fill('123456')
    await page.getByTestId('device-protection-pin-unlock-btn').click()
    await expect(page.getByTestId('vault-panel')).toBeVisible()
  })

  test('falls back to PIN setup when passkeys are unavailable', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem('nook_e2e_manual_passkey', 'true')
      localStorage.setItem('nook_e2e_passkey_mode', 'unavailable')
    })
    await page.goto('/app/')
    await openPasskeyOverlayForSimpleCreate(page)
    await clickDeviceProtectionSetup(page)

    await expect(page.getByTestId('device-protection-error')).toContainText(
      'Passkeys are unavailable in this browser profile',
    )
    await expect(
      page.getByTestId('device-protection-pin-setup-btn'),
    ).toBeVisible()
    await expect(page.getByTestId('device-protection-setup-btn')).toBeHidden()
    const entry = await waitForPersistedAppLog(page, {
      scope: 'vault-device-protection',
      level: 'warn',
      messageIncludes:
        'passkey unavailable; offering PIN device protection fallback',
    })
    expect(entry.data ?? '').toContain('passkey_unavailable')
  })

  test('falls back to a new PIN identity when passkey recovery is unavailable', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem('nook_e2e_manual_passkey', 'true')
      localStorage.setItem('nook_e2e_passkey_mode', 'unavailable')
    })
    await page.goto('/app/')
    await openPasskeyOverlayForSimpleCreate(page)
    await page.getByTestId('device-protection-use-existing-choice').click()

    await expect(page.getByTestId('device-protection-error')).toContainText(
      'Set a local PIN to protect a new device identity instead',
    )
    await expect(
      page.getByTestId('device-protection-pin-setup-btn'),
    ).toBeVisible()
    await expect(page.getByTestId('device-protection-setup-btn')).toBeHidden()
  })

  for (const scenario of [
    {
      mode: 'not-supported-error',
      error:
        'NotSupportedError: The requested public-key algorithm is not supported.',
    },
    {
      mode: 'security-error',
      error: 'SecurityError: This is an invalid domain.',
    },
  ]) {
    test(`keeps ${scenario.mode} explicit`, async ({ page }) => {
      await page.addInitScript((mode) => {
        localStorage.setItem('nook_e2e_manual_passkey', 'true')
        localStorage.setItem('nook_e2e_passkey_mode', mode)
      }, scenario.mode)
      await page.goto('/app/')
      await openPasskeyOverlayForSimpleCreate(page)
      await clickDeviceProtectionSetup(page)

      await expect(page.getByTestId('device-protection-error')).toContainText(
        scenario.error,
      )
      await expect(
        page.getByTestId('device-protection-setup-btn'),
      ).toBeEnabled()
      await expect(
        page.getByTestId('device-protection-pin-setup-btn'),
      ).toBeHidden()
    })
  }

  test('keeps setup recoverable after passkey cancellation', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem('nook_e2e_manual_passkey', 'true')
      localStorage.setItem('nook_e2e_passkey_mode', 'cancel')
    })
    await page.goto('/app/')
    await openPasskeyOverlayForSimpleCreate(page)
    await clickDeviceProtectionSetup(page)

    await expect(page.getByTestId('device-protection-error')).toContainText(
      'This browser did not finish creating the passkey',
    )
    await expect(page.getByTestId('device-protection-setup-btn')).toBeEnabled()
    await expect(
      page.getByTestId('device-protection-pin-setup-btn'),
    ).toBeHidden()
  })

  test('explains ambiguous cross-device passkey recovery failures', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem('nook_e2e_manual_passkey', 'true')
      localStorage.setItem('nook_e2e_passkey_mode', 'cancel')
    })
    await page.goto('/app/')
    await openPasskeyOverlayForSimpleCreate(page)
    await page.getByTestId('device-protection-use-existing-choice').click()

    await expect(page.getByTestId('device-protection-error')).toContainText(
      'Your phone may have approved the passkey, but this browser did not receive a usable credential',
    )
    await expect(page.getByTestId('device-protection-setup-btn')).toBeEnabled()
    await expect(
      page.getByTestId('device-protection-pin-setup-btn'),
    ).toBeHidden()
  })

  test('can reset an inaccessible local identity without deleting vault storage', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem('nook_e2e_manual_passkey', 'true')
    })
    await page.goto('/app/')
    await openPasskeyOverlayForSimpleCreate(page)
    await clickDeviceProtectionSetup(page)
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await page.evaluate(() => {
      localStorage.setItem('nook_e2e_passkey_mode', 'cancel')
    })
    await page.reload()
    await openExistingVaultProtectionOverlay(page)

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
    expect(persisted.registry).toBeTruthy()
  })
})
