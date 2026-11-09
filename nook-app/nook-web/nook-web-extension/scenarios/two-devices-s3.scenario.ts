import { expect, test } from '@playwright/test'
import { LocalS3Identity } from '../scripts/local-s3'
import {
  connectS3InFirstRun,
  createKeyringOnS3,
  flushRemoteEventsToSyncProviders,
  ManagePage,
  openManagePage,
  openStoreId,
  openVaultPage,
  uniqueS3KeyPrefix,
} from '../../nook-web-app/e2e/helpers'
import { firstPage } from './dev-browser'
import {
  expectBothDevicesCounted,
  expectDevicesGrouped,
  expectJourney,
  expectUnlockedKeyringCountsBothDevices,
  issueInvite,
  joinWithInvite,
  pairExtension,
  protectExtensionWithPin,
  reloadAndUnlockWithPin,
  reopenAndUnlockKeyring,
  runScenario,
  saveLogin,
  startVaultWithPin,
} from './steps'

// Two devices, each its own Brave window and profile. The first keeps a
// PIN-protected keyring on the local S3 server with a vault and a login,
// pairs its extension, reopens and unlocks, and issues a one-time invite
// carrying its S3 key; the second opens the invite, protects its own key
// with a PIN, joins, opens the vault, and reopens and unlocks too. Every
// step's console and app logs are audited on both devices; any error fails
// the scenario. The second device's set-up journey then waits only for its
// own extension, which it pairs. Both windows stay open, the keyring's
// set-up journey done on each.
test('two devices on one S3 keyring, the second joined from an invite', async () => {
  await runScenario(async (devices) => {
    const first = await devices.open('first-device')
    const vault = await firstPage(first)
    await devices.step('first device: extension PIN', () =>
      protectExtensionWithPin(first),
    )
    await devices.step('first device: vault PIN key', async () => {
      await startVaultWithPin(first)
    })
    await devices.step('first device: S3 sync provider', () =>
      connectS3InFirstRun(vault, {
        keyPrefix: uniqueS3KeyPrefix('two-devices'),
        identity: LocalS3Identity.DeviceA,
      }),
    )
    await devices.step('first device: keyring on S3', () =>
      createKeyringOnS3(vault, 'S3 keyring'),
    )
    await devices.step('first device: login saved', async () => {
      await openVaultPage(vault)
      await saveLogin(vault)
    })
    await devices.step('first device: extension paired', () =>
      pairExtension(first, vault),
    )
    await devices.step('first device: reload and unlock', () =>
      reloadAndUnlockWithPin(vault),
    )
    await devices.step(
      'first device: set-up journey leads with a second device',
      () =>
        expectJourney(vault, {
          keyringName: 'S3 keyring',
          progress: '2 of 3 done',
          steps: [
            ['copy', 'done'],
            ['device', 'open'],
            ['extension', 'done'],
          ],
          lead: 'Add a device',
        }),
    )
    let invite = ''
    await devices.step('first device: invite issued', async () => {
      invite = await issueInvite(vault)
    })

    const second = await devices.open('second-device')
    const joiner = await firstPage(second)
    await devices.step('second device: joined from the invite', () =>
      joinWithInvite(joiner, invite),
    )
    await devices.step('second device: reload and unlock', () =>
      reloadAndUnlockWithPin(joiner),
    )
    await devices.step('first device: keyring counts both devices', () =>
      expectBothDevicesCounted(vault, 'S3 keyring'),
    )
    await devices.step(
      'second device: set-up journey waits only for its extension',
      async () => {
        await expectJourney(joiner, {
          keyringName: 'S3 keyring',
          progress: '2 of 3 done',
          steps: [
            ['copy', 'done'],
            ['device', 'done'],
            ['extension', 'open'],
          ],
          lead: 'Connect extension',
        })
        if (process.env.LOOK_OUT) {
          await joiner.getByTestId('identity-protection-toggle').click()
          await joiner
            .getByTestId('identity-card-protection')
            .screenshot({ path: `${process.env.LOOK_OUT}/second-journey.png` })
          await joiner.getByTestId('identity-protection-close').click()
        }
      },
    )
    await devices.step('second device: extension PIN', () =>
      protectExtensionWithPin(second),
    )
    await devices.step('second device: extension paired', () =>
      pairExtension(second, joiner),
    )
    await devices.step('second device: set-up journey done', () =>
      expectUnlockedKeyringCountsBothDevices(joiner, 'S3 keyring'),
    )
    await devices.step('first device: apps grouped by device', async () => {
      await expectDevicesGrouped(vault)
      if (process.env.LOOK_OUT)
        await vault
          .getByTestId('identity-panel-devices')
          .screenshot({ path: `${process.env.LOOK_OUT}/devices-grouped.png` })
    })
    for (const [name, page] of [
      ['first device', vault],
      ['second device', joiner],
    ] as const) {
      await devices.step(`${name}: reopened, keyring unlocked`, async () => {
        await reopenAndUnlockKeyring(page)
        await expectUnlockedKeyringCountsBothDevices(page, 'S3 keyring')
      })
    }
    let laterStoreId = ''
    await devices.step('first device: adds a second vault', async () => {
      await vault.getByTestId('identity-new-vault').click()
      await vault.getByTestId('login-vault-name-input').fill('Later')
      await vault.getByTestId('login-create-additional-vault-btn').click()
      await openVaultPage(vault)
      await saveLogin(vault)
      await flushRemoteEventsToSyncProviders(vault)
      laterStoreId = await openStoreId(vault)
    })
    await devices.step(
      'second device: opens the new vault from its keyring card',
      async () => {
        // The keyring is unlocked with no vault open and the extension
        // paired, as after reopening the browser. The new vault is not on
        // this browser yet: Open vault reads it from S3 and goes into it,
        // and stays there.
        await openManagePage(joiner, ManagePage.Devices)
        await joiner.getByTestId('identity-sync-now-btn').click()
        await joiner.getByTestId('header-identities-btn').click()
        const away = joiner.locator(
          `[data-testid="identity-vault-row"][data-store-id="${laterStoreId}"]`,
        )
        await expect(away).toHaveAttribute('data-state', 'unavailable')
        await away.click()
        await joiner.getByTestId('vault-panel-open').click()
        await expect(joiner.getByTestId('vault-panel')).toBeVisible()
        await expect(joiner).toHaveURL(/\/vault$/)
        // Background work after the open (the next sync, the extension
        // following the session) must not send it back to the keyrings.
        await joiner.waitForTimeout(12_000)
        await expect(joiner).toHaveURL(/\/vault$/)
        await expect(joiner.getByTestId('vault-panel')).toBeVisible()
        expect(await openStoreId(joiner)).toBe(laterStoreId)
      },
    )
  })
})
