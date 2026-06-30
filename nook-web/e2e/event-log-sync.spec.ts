import { expect, test } from '@playwright/test'
import {
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  assertNoVaultError,
  assertVaultReady,
  createLocalVaultOnLogin,
  reloadUnlockWithGithubSync,
  triggerVaultSyncRefresh,
  uniqueSecretKey,
  waitForVaultOperationsIdle,
} from './helpers'

test.describe('event-log sync then add', () => {
  test.describe.configure({ mode: 'serial' })

  test('sync-then-add secure note after github provider connect', async ({
    page,
  }) => {
    await page.goto('/')
    await createLocalVaultOnLogin(page)
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })

    await reloadUnlockWithGithubSync(page)

    await triggerVaultSyncRefresh(page)
    await assertNoVaultError(page)
    await assertVaultReady(page)
    await waitForVaultOperationsIdle(page)

    const title = uniqueSecretKey('e2e-event-log-note')
    const noteBody = '# Post-sync note\n\nSaved after provider sync.'

    await page.getByTestId('add-secret-btn').click()
    await page.getByTestId('item-type-secure-note').click()
    await page.getByTestId('secret-label').fill(title)
    await page.getByTestId('secret-value').fill(noteBody)
    await page.getByTestId('save-secret-btn').click()

    await assertNoVaultError(page)
    const row = page.getByTestId('secret-row').filter({ hasText: title })
    await expect(row).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
    await expect(page.getByTestId('vault-group-secure-note')).toBeVisible()
  })
})
