import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import { ENROLLMENT_UNLOCK_TIMEOUT_MS } from '../helpers'

const DEMO_BEAT_MS = 700

async function demoBeat(page: Page) {
  await page.waitForTimeout(DEMO_BEAT_MS)
}

test('offer PIN device protection when passkeys are unavailable', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('nook_e2e_manual_passkey', 'true')
    localStorage.setItem('nook_e2e_passkey_mode', 'unavailable')
  })
  await page.goto('/app/')
  await expect(page.getByTestId('login-create-vault-chooser')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await demoBeat(page)

  await page.getByTestId('get-started-path-simple').click()
  await page.getByTestId('login-vault-name-input').fill('AI-debug PIN vault')
  await page.getByTestId('login-create-device-vault-btn').click()
  await expect(page.getByTestId('passkey-auth-overlay')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await demoBeat(page)

  await page.getByTestId('device-protection-setup-btn').click()
  await expect(page.getByTestId('device-protection-error')).toContainText(
    'Passkeys are unavailable in this browser profile',
  )
  await expect(
    page.getByTestId('device-protection-pin-setup-btn'),
  ).toBeVisible()
  await demoBeat(page)
})

test('recover device identity before importing an existing vault', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('nook_e2e_manual_passkey', 'true')
  })
  await page.goto('/app/')
  await expect(page.getByTestId('login-create-vault-chooser')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })

  await page.getByTestId('login-connect-storage-btn').click()
  await expect(page.getByTestId('login-provider-setup')).toBeVisible()
  await demoBeat(page)

  await page.evaluate(() => {
    const vault = (
      window as Window & {
        __nookVault?: {
          beginProviderSetup: (type: 'local') => void
        }
      }
    ).__nookVault
    if (!vault) throw new Error('E2E vault state is not exposed')
    vault.beginProviderSetup('local')
  })
  await expect(page.getByTestId('connect-provider-btn')).toBeVisible()
  await page.getByTestId('connect-provider-btn').click()

  await expect(page.getByTestId('passkey-auth-overlay')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await expect(page.getByTestId('device-protection-gate')).toBeVisible()
  await expect(page.getByTestId('vault-error')).not.toContainText(
    "Authorize before using this browser's device key.",
  )
  await demoBeat(page)
})
