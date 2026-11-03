import { test } from '@playwright/test'
import {
  nameFirstIdentityHere,
  openVaultPage,
} from '../../nook-web-app/e2e/helpers'
import {
  pairExtension,
  protectExtensionWithPin,
  runScenario,
  saveLogin,
  startVaultWithPin,
} from './steps'

// A keyring kept on this browser only, with no sync provider yet: a PIN
// key, one vault with a login, and the extension paired. The start for
// checking how a sync provider is added (the dev build's S3 form fills in
// the local S3 server with one click).
test('local keyring with a PIN, a login, the extension paired, no provider', async () => {
  await runScenario(async (browser) => {
    await protectExtensionWithPin(browser)
    const vault = await startVaultWithPin(browser)
    await nameFirstIdentityHere(vault, 'Local keyring')
    await openVaultPage(vault)
    await saveLogin(vault)
    await pairExtension(browser, vault)
  })
})
