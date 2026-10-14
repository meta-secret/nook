import { expect, test } from './fixtures'
import {
  clearBrowserVault,
  connectLocalVault,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  forceVaultQuiescentForE2e,
  openOnboardDevicePanel,
  seedExtraOauthFileProviders,
  seedOauthFileSyncProvidersWhileUnlocked,
  installOauthFileRemoteForLocalE2e,
  UI_TIMEOUT_MS,
  waitForLoadedSyncProviders,
  readLocalVaultYamlFromIdb,
  openManagePage,
  ManagePage,
} from './helpers'

test.describe('identity onboarding provider picker', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/app/')
    await clearBrowserVault(page)
    await page.reload()
    await connectLocalVault(page)
  })

  test('asks for a sync provider before an identity code can be created', async ({
    page,
  }) => {
    await openOnboardDevicePanel(page)

    await expect(page.getByTestId('onboard-no-identity-mount')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await expect(page.getByTestId('onboard-device-submit')).toHaveCount(0)
    await expect(page.getByTestId('onboard-provider-list')).toHaveCount(0)

    await page.getByTestId('onboard-open-sync-btn').click()
    await expect(page.getByTestId('storage-providers-section')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
  })

  test('creates codes through an identity mount with a generated passphrase', async ({
    page,
  }) => {
    await seedOauthFileSyncProvidersWhileUnlocked(page)
    await openManagePage(page, ManagePage.Devices)
    await expect(page.getByTestId('onboard-provider-list')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(page.getByTestId('onboard-device-submit')).toBeEnabled({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })

    const passphrase = page.getByTestId('onboard-passphrase-input')
    const generated = await passphrase.inputValue()
    expect(generated).toMatch(/^[A-Za-z0-9]{20}$/)
    await page.getByTestId('onboard-new-passphrase-btn').click()
    await expect(passphrase).not.toHaveValue(generated)
  })

  test('shows file and account hints for multiple oauth-file identity mounts', async ({
    page,
  }) => {
    const personalToken = 'ya29.e2e-personal-access-token-secret'
    const workToken = 'ya29.e2e-work-access-token-secret'

    const providers = [
      {
        id: 'file-personal',
        label: 'File · personal',
        fileName: 'personal.yaml',
        accessToken: personalToken,
        accountEmail: 'personal@example.com',
      },
      {
        id: 'file-work',
        label: 'File · work',
        fileName: 'work.yaml',
        accessToken: workToken,
        accountEmail: 'work@example.com',
      },
    ]

    await seedExtraOauthFileProviders(page, providers)
    const vaultYaml = await readLocalVaultYamlFromIdb(page)
    for (const provider of providers) {
      await installOauthFileRemoteForLocalE2e(page, {
        fileName: provider.fileName,
        vaultYaml,
      })
    }

    await page.reload()
    await expect(page.getByTestId('identity-vault-row').first()).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await page.getByTestId('identity-vault-row').first().click()
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await forceVaultQuiescentForE2e(page)
    await waitForLoadedSyncProviders(page, 2)

    await openOnboardDevicePanel(page)
    const providerList = page.getByTestId('onboard-provider-list')
    await expect(providerList).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })

    const personal = page.getByTestId('onboard-provider-file-personal')
    const work = page.getByTestId('onboard-provider-file-work')
    await expect(personal).toBeVisible()
    await expect(work).toBeVisible()

    await expect(
      page.getByTestId('onboard-provider-detail-file-personal'),
    ).toContainText('personal.yaml')
    await expect(
      page.getByTestId('onboard-provider-detail-file-work'),
    ).toContainText('work.yaml')
    await expect(providerList).toContainText('personal@example.com')
    await expect(providerList).toContainText('work@example.com')
    await expect(providerList).not.toContainText(personalToken)
    await expect(providerList).not.toContainText(workToken)
    await expect(page.getByTestId('onboard-provider-local')).toHaveCount(0)

    await work.click()
    await expect(work).toHaveAttribute('aria-checked', 'true')
    await expect(personal).toHaveAttribute('aria-checked', 'false')
  })
})
