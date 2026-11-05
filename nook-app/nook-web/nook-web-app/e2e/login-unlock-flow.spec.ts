import { expect, test } from './fixtures'
import {
  clearBrowserVault,
  connectLocalVault,
  disableLoginAutoUnlock,
  openLoginProviderSetup,
  UI_TIMEOUT_MS,
  unlockVaultOnLogin,
} from './helpers'

test.describe('login unlock flow (local-first)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/app/')
    await clearBrowserVault(page)
    await page.reload()
    await connectLocalVault(page)
  })

  test('unlocks with PRF-enabled device keys from local login step', async ({
    page,
  }) => {
    await disableLoginAutoUnlock(page)
    await page.reload()
    const vaultRow = page.getByTestId('identity-vault-row').first()
    await expect(vaultRow).toBeVisible({ timeout: UI_TIMEOUT_MS })
    const prfEnabledAfterReload = await page.evaluate(async () => {
      const credential: unknown = await navigator.credentials.get({
        publicKey: {
          challenge: new Uint8Array([1]),
          extensions: { prf: { eval: { first: new Uint8Array([2]) } } },
        },
      })
      if (typeof credential !== 'object' || Object(credential) !== credential) {
        throw new Error('Expected a public-key credential.')
      }
      const methodValue: unknown = Object.getOwnPropertyDescriptor(
        credential,
        'getClientExtensionResults',
      )?.value
      if (typeof methodValue !== 'function') {
        throw new Error('Expected a public-key extension result method.')
      }
      type CredentialMethod = {
        call: (thisArg: unknown, ...args: never[]) => unknown
      }
      const method: CredentialMethod = methodValue
      const extensionResults: unknown = method.call(credential)
      if (
        typeof extensionResults !== 'object' ||
        Object(extensionResults) !== extensionResults
      ) {
        throw new Error('Expected public-key extension results.')
      }
      const prf: unknown = Object.getOwnPropertyDescriptor(
        extensionResults,
        'prf',
      )?.value
      if (typeof prf !== 'object' || Object(prf) !== prf) return false
      const enabled: unknown = Object.getOwnPropertyDescriptor(
        prf,
        'enabled',
      )?.value
      return typeof enabled === 'boolean' ? enabled : false
    })
    expect(prfEnabledAfterReload).toBe(true)
    await unlockVaultOnLogin(page)
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
  })
})

test.describe('login storage provider setup', () => {
  test('hides local device from sync provider picker on create-vault screen', async ({
    page,
  }) => {
    await page.goto('/app/')
    await clearBrowserVault(page)
    await page.reload()

    await openLoginProviderSetup(page)
    await expect(page.getByTestId('provider-picker-list')).toBeVisible()
    await expect(page.getByTestId('provider-option-local')).toHaveCount(0)
    await expect(page.getByTestId('provider-option-github')).toBeVisible()
  })
})
