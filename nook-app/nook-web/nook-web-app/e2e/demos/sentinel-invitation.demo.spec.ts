import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import { ENROLLMENT_UNLOCK_TIMEOUT_MS } from '../helpers'

const DEMO_BEAT_MS = 700

async function demoBeat(page: Page) {
  await page.waitForTimeout(DEMO_BEAT_MS)
}

test('Sentinel creation invites participants instead of standalone join', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('nook_e2e_manual_passkey', 'true')
  })
  await page.goto('/app/')
  await expect(page.getByTestId('login-create-vault-chooser')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await demoBeat(page)

  await expect(page.getByTestId('get-started-path-simple')).toBeVisible()
  await expect(page.getByTestId('get-started-path-sentinel')).toBeVisible()
  await expect(page.getByTestId('get-started-path-join')).toHaveCount(0)
  await demoBeat(page)

  await page.getByTestId('get-started-path-sentinel').click()
  await page.getByTestId('sentinel-dashboard-card-stack').click()
  await expect(
    page.getByTestId('sentinel-onboarding-create-keys'),
  ).toBeVisible()
  await demoBeat(page)

  await page.getByTestId('sentinel-onboarding-create-keys').click()
  await expect(page.getByTestId('passkey-auth-overlay')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await page.getByTestId('device-protection-create-new-choice').click()
  await page.getByTestId('device-protection-setup-btn').click()
  await expect(page.getByTestId('sentinel-genesis-name-step')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await page
    .getByTestId('sentinel-genesis-name-input')
    .fill('Sentinel response demo')
  await page.getByTestId('sentinel-onboarding-continue-policy').click()
  await page.getByTestId('sentinel-onboarding-continue-devices').click()
  const responseInput = page.getByTestId('sentinel-genesis-response-input')
  await expect(responseInput).toBeVisible()
  await expect(responseInput).toHaveAttribute(
    'placeholder',
    'Paste signed authentication response or its URL',
  )
  await expect(
    page.getByTestId('sentinel-genesis-authentication-instructions'),
  ).toContainText('Paste the signed response')
  await demoBeat(page)
})
