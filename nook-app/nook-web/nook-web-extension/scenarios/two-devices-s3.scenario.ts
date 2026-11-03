import { test } from '@playwright/test'
import { LocalS3Identity } from '../scripts/local-s3'
import {
  connectS3InFirstRun,
  createKeyringOnS3,
  expectIdentityMembers,
  openVaultPage,
  uniqueS3KeyPrefix,
} from '../../nook-web-app/e2e/helpers'
import { firstPage } from './dev-browser'
import {
  issueInvite,
  joinWithInvite,
  runScenario,
  saveLogin,
  startVaultWithPin,
} from './steps'

// Two devices, each its own Brave window and profile: the first keeps a
// PIN-protected keyring on the local S3 server with a vault and a login and
// issues a one-time invite carrying its S3 key; the second opens the invite,
// protects its own key with a PIN, joins, and opens the vault. Both windows
// stay open, with the keyring listing two devices.
test('two devices on one S3 keyring, the second joined from an invite', async () => {
  await runScenario(async (devices) => {
    const first = await devices.open('first-device')
    const vault = await startVaultWithPin(first)
    await connectS3InFirstRun(vault, {
      keyPrefix: uniqueS3KeyPrefix('two-devices'),
      identity: LocalS3Identity.DeviceA,
    })
    await createKeyringOnS3(vault, 'S3 keyring')
    await openVaultPage(vault)
    await saveLogin(vault)
    const invite = await issueInvite(vault)

    const second = await devices.open('second-device')
    await joinWithInvite(await firstPage(second), invite)
    await expectIdentityMembers(vault, 2)
  })
})
