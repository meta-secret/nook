import { test } from '@playwright/test'
import { LocalS3Identity } from '../scripts/local-s3'
import {
  connectS3InFirstRun,
  createKeyringOnS3,
  openVaultPage,
  uniqueS3KeyPrefix,
} from '../../nook-web-app/e2e/helpers'
import { firstPage } from './dev-browser'
import {
  expectBothDevicesCounted,
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
// the scenario. Both windows stay open, the keyring's checklist done.
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
    await devices.step('second device: keyring counts both devices', () =>
      expectBothDevicesCounted(joiner, 'S3 keyring'),
    )
    for (const [name, page] of [
      ['first device', vault],
      ['second device', joiner],
    ] as const) {
      await devices.step(`${name}: reopened, keyring unlocked`, async () => {
        await reopenAndUnlockKeyring(page)
        await expectUnlockedKeyringCountsBothDevices(page, 'S3 keyring')
      })
    }
  })
})
