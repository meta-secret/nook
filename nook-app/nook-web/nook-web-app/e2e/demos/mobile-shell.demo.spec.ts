import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import {
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  expectFirstVaultOpen,
  UI_TIMEOUT_MS,
} from '../helpers'

const DEMO_BEAT_MS = 700
const PHONE = { width: 390, height: 844 }

async function demoBeat(page: Page) {
  await page.waitForTimeout(DEMO_BEAT_MS)
}

async function expectNoSidewaysScroll(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      })),
    )
    .toEqual({ clientWidth: PHONE.width, scrollWidth: PHONE.width })
}

test('a phone gets a full first run, an edge-to-edge shell and a stacked control page', async ({
  page,
}) => {
  await page.setViewportSize(PHONE)
  await page.addInitScript(() => {
    localStorage.setItem('nook_e2e_manual_passkey', 'true')
  })
  await page.goto('/app/')

  // The name field keeps its height when the form stacks.
  const start = page.getByTestId('first-vault-start')
  await expect(start).toBeVisible({ timeout: UI_TIMEOUT_MS })
  const nameInput = page.getByTestId('login-vault-name-input')
  const inputBox = await nameInput.boundingBox()
  expect(((v) => (v ? v : 0))(inputBox?.height)).toBeGreaterThanOrEqual(40)
  await expectNoSidewaysScroll(page)
  await demoBeat(page)

  await nameInput.fill('Personal')
  await page.getByTestId('login-create-device-vault-btn').click()

  // The passkey comes first on a phone; the identity preview follows and
  // offers no actions, since the identity does not exist yet.
  const protect = page.getByTestId('first-run-protect-step')
  await expect(protect).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  const gate = page.getByTestId('device-protection-gate')
  const preview = page.getByTestId('first-run-identity-preview')
  await expect(gate).toBeVisible()
  const gateTop = ((v) => (v ? v : 0))((await gate.boundingBox())?.y)
  const previewTop = ((v) => (v ? v : 0))((await preview.boundingBox())?.y)
  expect(gateTop).toBeLessThan(previewTop)
  await expect(preview.getByTestId('identity-manage')).toHaveCount(0)
  await expect(preview.getByTestId('identity-unlock')).toHaveCount(0)
  await demoBeat(page)

  await page.getByTestId('device-protection-create-new-choice').click()
  await page.getByTestId('device-protection-setup-btn').click()
  await expectFirstVaultOpen(page)

  // The shell runs edge to edge under the header.
  const shell = page.getByTestId('authenticated-shell')
  await expect(shell).toBeVisible()
  const shellBox = await shell.boundingBox()
  expect(((v) => (v ? v : 0))(shellBox?.width)).toBe(PHONE.width)
  await expectNoSidewaysScroll(page)
  await demoBeat(page)

  // The identity's control page stacks its parts; each opens in place.
  await page.getByTestId('header-identities-btn').click()
  await page.getByTestId('identity-manage').first().click()
  await expect(page.getByTestId('identity-overview')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await expectNoSidewaysScroll(page)
  await demoBeat(page)

  const keys = page.getByTestId('overview-keys')
  await keys.scrollIntoViewIfNeeded()
  await keys.click()
  await expect(page).toHaveURL(/\/identity\/keys$/)
  await expect(page.getByTestId('overview-panel')).toBeVisible()
  await expect(page.getByTestId('identity-keys')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await expect(keys).toHaveAttribute('aria-expanded', 'true')
  await expectNoSidewaysScroll(page)
  await demoBeat(page)

  // Closing the part returns to the control page.
  await page.getByTestId('overview-panel-close').click()
  await expect(page).toHaveURL(/\/identity$/)
  await expect(page.getByTestId('overview-panel')).toHaveCount(0)
  await demoBeat(page)
})
