import { test } from '@playwright/test'
import { runScenario, startVaultWithPin } from './steps'

// First run stopped at its sync provider step: this browser's key is
// protected with the scenario PIN and nothing else exists yet. The start for
// checking the sync step itself and the providers it offers.
test('first run at the sync provider step with a PIN key', async () => {
  await runScenario(async (devices) => {
    const browser = await devices.open('this-device')
    await startVaultWithPin(browser)
  })
})
