import { expect, test } from '@playwright/test'
import { LocalS3Identity } from '../scripts/local-s3'
import {
  connectS3InFirstRun,
  createKeyringOnS3,
  ManagePage,
  openManagePage,
  openStoreId,
  openVaultPage,
  uniqueS3KeyPrefix,
  type E2eS3Location,
} from '../../nook-web-app/e2e/helpers'
import { firstPage } from './dev-browser'
import { runScenario, saveLogin, startVaultWithPin } from './steps'

// Two devices. The first keeps a PIN-protected keyring on the local S3
// server with one vault and a login. The second, a fresh profile, finds that
// keyring in first run's sync provider step and asks to join it; the first
// approves. Setup then connects S3 and opens the keyring's vault on its own,
// and ends on the keyrings page with that vault's panel: the panel says the
// vault is open here, and Open vault goes into it.
test('first run joins an S3 keyring and its vault opens from the panel', async () => {
  await runScenario(async (devices) => {
    const location: E2eS3Location = {
      keyPrefix: uniqueS3KeyPrefix('first-run-join'),
      identity: LocalS3Identity.DeviceA,
    }
    const first = await devices.open('first-device')
    const vault = await firstPage(first)
    let storeId = ''
    await devices.step('first device: S3 keyring with a login', async () => {
      await startVaultWithPin(first)
      await connectS3InFirstRun(vault, location)
      await createKeyringOnS3(vault, 'S3 keyring')
      await openVaultPage(vault)
      await saveLogin(vault)
      storeId = await openStoreId(vault)
    })

    const second = await devices.open('second-device')
    const joiner = await firstPage(second)
    await devices.step(
      'second device: first run asks to join the keyring',
      async () => {
        await startVaultWithPin(second)
        await connectS3InFirstRun(joiner, {
          keyPrefix: location.keyPrefix,
          identity: LocalS3Identity.DeviceB,
        })
        const listed = joiner.locator(
          '[data-testid="setup-identity"][data-setup="requestToJoin"]',
        )
        await listed.getByTestId('setup-identity-join').click()
        await expect(joiner.getByTestId('first-run-join-step')).toBeVisible()
      },
    )
    await devices.step('first device: approves the join', async () => {
      await openManagePage(vault, ManagePage.Devices)
      await vault.getByTestId('identity-sync-now-btn').click()
      const request = vault.getByTestId('identity-join-request')
      await expect(request).toBeVisible()
      await request.getByTestId('identity-join-request-approve').click()
      await expect(request).toHaveCount(0)
    })
    await devices.step(
      'second device: setup opens the vault, and its panel goes into it',
      async () => {
        await joiner.getByTestId('first-run-join-check').click()
        await expect(joiner.getByTestId('first-run-join-step')).toHaveCount(0)
        const row = joiner.locator(
          `[data-testid="identity-vault-row"][data-store-id="${storeId}"]`,
        )
        // Opened by setup: not offered from the provider again.
        await expect(row).toHaveAttribute('data-state', 'open')
        await joiner.getByTestId('vault-panel-open').click()
        await expect(
          joiner
            .getByTestId('vault-group-login')
            .getByTestId('secret-row')
            .first(),
        ).toBeVisible()
      },
    )
  })
})
