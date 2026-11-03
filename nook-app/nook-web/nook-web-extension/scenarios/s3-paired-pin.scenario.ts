import { test } from '@playwright/test'
import { LocalS3Identity } from '../scripts/local-s3'
import {
  connectS3InFirstRun,
  createKeyringOnS3,
  openVaultPage,
  uniqueS3KeyPrefix,
} from '../../nook-web-app/e2e/helpers'
import {
  pairExtension,
  protectExtensionWithPin,
  runScenario,
  saveLogin,
  startVaultWithPin,
} from './steps'

// A web vault keyring on the local S3 server, protected by a PIN, with one
// vault and a login, and the extension (also PIN-protected) paired with it.
test('S3 keyring with a PIN, a login, and the extension paired', async () => {
  await runScenario(async (devices) => {
    const browser = await devices.open('this-device')
    await protectExtensionWithPin(browser)
    const vault = await startVaultWithPin(browser)
    await connectS3InFirstRun(vault, {
      keyPrefix: uniqueS3KeyPrefix('scenario'),
      identity: LocalS3Identity.DeviceA,
    })
    await createKeyringOnS3(vault, 'S3 keyring')
    await openVaultPage(vault)
    await saveLogin(vault)
    await pairExtension(browser, vault)
  })
})
