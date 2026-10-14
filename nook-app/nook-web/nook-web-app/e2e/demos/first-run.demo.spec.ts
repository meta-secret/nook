import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import {
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  expectFirstVaultOpen,
  UI_TIMEOUT_MS,
} from '../helpers'

const DEMO_BEAT_MS = 700

async function demoBeat(page: Page) {
  await page.waitForTimeout(DEMO_BEAT_MS)
}

test('a first vault takes a name, then introduces its identity and offers a backup', async ({
  page,
}) => {
  // Let the person create the passkey on the "This is you" step.
  await page.addInitScript(() => {
    localStorage.setItem('nook_e2e_manual_passkey', 'true')
  })
  await page.goto('/app/')

  // One field, one button; returning users get two quiet links.
  const start = page.getByTestId('first-vault-start')
  await expect(start).toBeVisible({ timeout: UI_TIMEOUT_MS })
  await expect(page.getByTestId('identities-hero')).toHaveCount(0)
  await expect(page.getByTestId('get-started-path-sentinel')).toHaveCount(0)
  await expect(page.getByTestId('login-join-identity-btn')).toBeVisible()
  await expect(page.getByTestId('login-connect-storage-btn')).toBeVisible()
  await demoBeat(page)

  await page.getByTestId('login-vault-name-input').fill('Personal')
  await page.getByTestId('login-create-device-vault-btn').click()

  // The identity is introduced where its passkey is made.
  const protect = page.getByTestId('first-run-protect-step')
  await expect(protect).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  await expect(protect).toContainText('This is you')
  await expect(page.getByTestId('first-run-identity-preview')).toContainText(
    'Personal',
  )
  await expect(page.getByTestId('passkey-auth-overlay')).toHaveCount(0)
  await demoBeat(page)

  await page.getByTestId('device-protection-create-new-choice').click()
  await page.getByTestId('device-protection-setup-btn').click()

  // The vault exists; backing up is offered, never forced.
  const backup = page.getByTestId('first-run-backup-step')
  await expect(backup).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  await expect(backup).toContainText('Back up your identity')
  await demoBeat(page)

  await expectFirstVaultOpen(page)
  await expect(page.getByTestId('first-run-backup-step')).toHaveCount(0)
  await demoBeat(page)
})
