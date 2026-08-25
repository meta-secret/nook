import { expect, test } from './fixtures'
import { type NookVaultManager } from '$app-wasm'
import {
  connectLocalVault,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  installPasskeyMock,
} from './helpers'

type IdentityDirectorySnapshotRequestOwner = Pick<
  NookVaultManager,
  'identity_directory_snapshot_request'
>

test.describe('devices and access passkey inventory', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('nook_e2e_manual_passkey', 'true')
    })
    await installPasskeyMock(page)
  })

  test('renames the passkey in its inventory row and recovers from a failed reload', async ({
    page,
  }) => {
    await connectLocalVault(page)
    await page.getByTestId('vault-devices-access-tab').click()
    await expect(page.getByTestId('devices-access-dashboard')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    const app = page.getByTestId('devices-access-app')
    const passkeyFacts = page.getByTestId('devices-access-passkey-facts')
    await expect(passkeyFacts).toContainText('Passkey ID')
    await expect(passkeyFacts).toContainText('passkey_')
    await expect(passkeyFacts).toContainText('Stored with')
    await expect(passkeyFacts).toContainText('First recorded by Nook')
    await expect(passkeyFacts).toContainText('Last used')
    await expect(app).toContainText('Nook in this browser')
    await expect(app).not.toContainText('App key')
    await expect(page.getByTestId('devices-access-app-id')).not.toBeVisible()
    await app.locator('summary').click()
    await expect(page.getByTestId('devices-access-app-id')).toBeVisible()
    await expect(page.getByTestId('devices-access-app-id')).toContainText(
      'Nook app ID',
    )
    await page.getByTestId('devices-access-rename-passkey').click()
    const nameInput = page.getByTestId('devices-access-passkey-name-input')
    await nameInput.fill('Family passkey')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(
      page.getByTestId('devices-access-key-inventory'),
    ).toContainText('Family passkey')
    await expect(
      page.getByText('Where did you save this passkey?'),
    ).toHaveCount(0)

    await page.getByTestId('devices-access-rename-passkey').click()
    await page
      .getByTestId('devices-access-passkey-name-input')
      .fill('Travel passkey')
    // The name is written before the dashboard re-reads its snapshot, so
    // failing the next snapshot read exercises "saved, but reload failed".
    await page.evaluate(() => {
      const manager = (
        window as Window & {
          __nookVault?: {
            requireManager(): IdentityDirectorySnapshotRequestOwner
          }
        }
      ).__nookVault?.requireManager()
      if (!manager) throw new Error('Vault manager is not exposed')
      manager.identity_directory_snapshot_request = () => {
        Reflect.deleteProperty(manager, 'identity_directory_snapshot_request')
        throw new Error('Forced dashboard reload failure')
      }
    })
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByTestId('devices-access-retry')).toBeVisible()
    await page.getByTestId('devices-access-retry').click()
    await expect(
      page.getByTestId('devices-access-key-inventory'),
    ).toContainText('Travel passkey')
  })
})
