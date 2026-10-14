import type { VaultState } from '$lib/vault.svelte'
import { expect, test } from './fixtures'
import {
  connectLocalVault,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  installPasskeyMock,
  openKeysPage,
} from './helpers'

test.describe('identity keys', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('nook_e2e_manual_passkey', 'true')
    })
    await installPasskeyMock(page)
  })

  test('says one key is not enough and renames this browser passkey', async ({
    page,
  }) => {
    await connectLocalVault(page)
    await openKeysPage(page)

    const summary = page.getByTestId('identity-keys-summary')
    await expect(summary).toHaveAttribute('data-key-count', '1', {
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(page.getByTestId('identity-keys-add-device')).toBeVisible()
    await expect(page.getByTestId('identity-keys-passwords')).toBeVisible()
    const key = page.getByTestId('identity-key')
    await expect(key).toHaveCount(1)
    await expect(key).toContainText('Nook in this browser')

    await key.getByTestId('identity-key-rename').click()
    await page.getByTestId('identity-key-name-input').fill('Family passkey')
    await page.getByTestId('identity-key-save').click()
    await expect(key).toContainText('Family passkey')

    await key.getByTestId('identity-key-rename').click()
    await page.getByTestId('identity-key-name-input').fill('Travel passkey')
    // The name is written before the page re-reads the directory; while
    // every read fails the page offers Retry, which recovers once reads work.
    const failReads = (fail: boolean) =>
      page.evaluate((shouldFail) => {
        const vault = (
          window as Window & { __nookVault?: Pick<VaultState, 'admitManager'> }
        ).__nookVault
        if (!vault) return 'Vault runtime is not exposed'
        const admission = vault.admitManager()
        if (admission.isErr()) return admission.error.translationKey
        const manager = admission.value
        if (shouldFail) {
          manager.identity_directory_snapshot_request = () => {
            throw new Error('Forced keys reload failure')
          }
        } else {
          Reflect.deleteProperty(manager, 'identity_directory_snapshot_request')
        }
        return ''
      }, fail)
    expect(await failReads(true)).toBe('')
    await page.getByTestId('identity-key-save').click()
    await expect(page.getByTestId('identity-keys-retry')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    expect(await failReads(false)).toBe('')
    await page.getByTestId('identity-keys-retry').click()
    await expect(page.getByTestId('identity-key')).toContainText(
      'Travel passkey',
      { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
  })
})
