import { expect, test } from '../fixtures'
import {
  addVaultPassword,
  clearBrowserVault,
  connectLocalVault,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  expectVaultPasswordStatus,
  openOpenVaultPanel,
  UI_TIMEOUT_MS,
} from '../helpers'

const DEMO_BEAT_MS = 700

test('the vault panel names its passphrases and keeps a failed unlock and its recovery on the card', async ({
  page,
}) => {
  const directory = process.env.NOOK_DEMO_SCREENSHOT_DIR
  await page.goto('/app/')
  await clearBrowserVault(page)
  await page.reload()
  await connectLocalVault(page)

  // A vault without passphrases says so beside its card.
  await openOpenVaultPanel(page)
  const count = page.getByTestId('vault-panel-passphrases-count')
  const hint = page.getByTestId('vault-panel-passphrases-hint')
  await expect(count).toHaveText('0')

  // A passphrase added on its page shows in the panel on the way back.
  await addVaultPassword(page, 'Paper copy', 'paper-copy-pass-42')
  await expectVaultPasswordStatus(page, 1, {
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await openOpenVaultPanel(page)
  await expect(count).toHaveText('1')
  await expect(hint).toHaveText('Paper copy')
  await page.waitForTimeout(DEMO_BEAT_MS)
  if (directory) {
    await page.screenshot({ path: `${directory}/vault-panel-passphrases.png` })
  }

  // Locked, a cancelled passkey stays on the card: its reason and this
  // browser's key recovery sit under the unlock, with no page-level sheet.
  await page.getByTestId('identity-lock').click()
  const unlock = page.getByTestId('vault-panel-unlock')
  await expect(unlock).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  await page.evaluate(() => {
    localStorage.setItem('nook_e2e_passkey_mode', 'cancel')
  })
  await unlock.click()
  await expect(page.getByTestId('vault-panel-unlock-error')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await expect(page.getByTestId('device-recovery')).toHaveAttribute(
    'data-kind',
    'passkey',
  )
  await expect(page.getByTestId('passkey-auth-overlay')).toHaveCount(0)
  await page.waitForTimeout(DEMO_BEAT_MS)
  if (directory) {
    await page.screenshot({
      path: `${directory}/vault-panel-unlock-failed.png`,
    })
  }

  // Trying again unlocks in place.
  await page.evaluate(() => {
    localStorage.removeItem('nook_e2e_passkey_mode')
  })
  await unlock.click()
  await expect(page.getByTestId('vault-panel-beside')).toHaveAttribute(
    'data-state',
    'open',
    { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
  )
  await expect(page.getByTestId('vault-panel-unlock-error')).toHaveCount(0)
  await expect(page.getByTestId('passkey-auth-overlay')).toHaveCount(0)
  await page.waitForTimeout(DEMO_BEAT_MS)

  // Sync reached from the overview, not only from Manage, can add a provider.
  await page.getByTestId('identity-overview-toggle').click()
  await page.getByTestId('overview-open-sync').click()
  await page.getByTestId('add-provider-btn').click()
  await expect(page.getByTestId('provider-picker-list')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await page.waitForTimeout(DEMO_BEAT_MS)
})
