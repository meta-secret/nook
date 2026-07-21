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
  await expect(page.getByTestId('device-protection-pin-setup-btn')).toBeVisible()
  await demoBeat(page)
})
