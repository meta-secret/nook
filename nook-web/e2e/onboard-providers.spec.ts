import { expect, test } from './fixtures'
import {
  clearBrowserVault,
  connectLocalVaultLegacy,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  forceVaultQuiescentForE2e,
  openOnboardDevicePanel,
  seedExtraOauthFileProviders,
  seedOauthFileSyncProvidersWhileUnlocked,
  stubGoogleDriveVaultForLocalE2e,
  UI_TIMEOUT_MS,
  waitForLoadedSyncProviders,
  readLocalVaultYamlFromIdb,
} from './helpers'

const INLINE_ONBOARD_PASSWORD = 'onboard-pass-1'

async function createOnboardPasswordInline(
  page: import('@playwright/test').Page,
) {
  await expect(page.getByTestId('onboard-wizard-password-step')).toBeVisible()
  await page.getByTestId('vault-password-label').fill('test')
  await page.getByTestId('vault-password-input').fill(INLINE_ONBOARD_PASSWORD)
  await page.getByTestId('vault-password-confirm').fill(INLINE_ONBOARD_PASSWORD)
  await page.getByTestId('submit-vault-password').click()
  await expect(page.getByTestId('app-success')).toContainText(/password/i, {
    timeout: UI_TIMEOUT_MS,
  })
}

async function chooseFirstOnboardPassword(
  page: import('@playwright/test').Page,
) {
  const entryList = page.getByTestId('onboard-password-entry-list')
  await expect(entryList).toBeVisible()
  await entryList.getByRole('radio').first().click()
}

test.describe('onboard provider picker', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await clearBrowserVault(page)
    await page.reload()
    await connectLocalVaultLegacy(page)
  })

  test('wizard starts on vault password step when no passwords exist', async ({
    page,
  }) => {
    await openOnboardDevicePanel(page)

    await expect(page.getByTestId('onboard-wizard-password-step')).toBeVisible()
    await expect(
      page.getByTestId('onboard-password-prerequisite'),
    ).toBeVisible()
    await expect(page.getByTestId('onboard-wizard-sync-step')).toBeVisible()
    await expect(page.getByTestId('onboard-wizard-generate-step')).toBeVisible()
    await expect(page.getByTestId('onboard-device-submit')).toHaveCount(0)
    await expect(page.getByTestId('onboard-provider-list')).toHaveCount(0)
  })

  test('wizard requires an explicit password choice before sync setup', async ({
    page,
  }) => {
    await openOnboardDevicePanel(page)
    await createOnboardPasswordInline(page)

    await expect(page.getByTestId('onboard-password-prerequisite')).toHaveCount(
      0,
    )
    const entryList = page.getByTestId('onboard-password-entry-list')
    await expect(entryList).toBeVisible()
    await expect(entryList.getByRole('radio')).toHaveCount(1)
    await expect(page.getByTestId('add-provider-btn')).toHaveCount(0)
    await expect(page.getByTestId('onboard-device-submit')).toHaveCount(0)

    await chooseFirstOnboardPassword(page)

    await expect(page.getByTestId('onboard-wizard-sync-step')).toBeVisible()
    await expect(page.getByTestId('add-provider-btn')).toBeVisible()
    await expect(page.getByTestId('onboard-wizard-generate-step')).toBeVisible()
    await expect(page.getByTestId('onboard-device-submit')).toHaveCount(0)
  })

  test('generate step stays locked until a sync provider exists', async ({
    page,
  }) => {
    await openOnboardDevicePanel(page)
    await createOnboardPasswordInline(page)
    await chooseFirstOnboardPassword(page)

    await expect(page.getByTestId('add-provider-btn')).toBeVisible()
    await expect(page.getByTestId('onboard-device-submit')).toHaveCount(0)

    await seedOauthFileSyncProvidersWhileUnlocked(page)
    await page.getByTestId('vault-onboard-tab').click()
    await expect(page.getByTestId('onboard-wizard-generate-step')).toBeVisible()
    await expect(page.getByTestId('onboard-device-submit')).toBeVisible()
    await expect(page.getByTestId('onboard-device-submit')).toBeEnabled({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
  })

  test('shows file and account hints for multiple oauth-file sync providers', async ({
    page,
  }) => {
    const personalToken = 'ya29.e2e-personal-access-token-secret'
    const workToken = 'ya29.e2e-work-access-token-secret'

    const providers = [
      {
        id: 'gd-personal',
        label: 'Google Drive · personal',
        fileName: 'personal.yaml',
        accessToken: personalToken,
        accountEmail: 'personal@example.com',
      },
      {
        id: 'gd-work',
        label: 'Google Drive · work',
        fileName: 'work.yaml',
        accessToken: workToken,
        accountEmail: 'work@example.com',
      },
    ]

    await seedExtraOauthFileProviders(page, providers)
    const vaultYaml = await readLocalVaultYamlFromIdb(page)
    for (const provider of providers) {
      await stubGoogleDriveVaultForLocalE2e(page, {
        fileName: provider.fileName,
        vaultYaml,
      })
    }

    await page.reload()
    await expect(page.getByTestId('login-local-vault-detected')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await page.getByTestId('unlock-vault-btn').click()
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await forceVaultQuiescentForE2e(page)
    await waitForLoadedSyncProviders(page, 2)

    await openOnboardDevicePanel(page)
    await createOnboardPasswordInline(page)
    await chooseFirstOnboardPassword(page)

    await page
      .getByTestId('onboard-wizard-sync-step')
      .getByRole('button')
      .click()
    const providerList = page.getByTestId('onboard-provider-list')
    await expect(providerList).toBeVisible()

    const personal = page.getByTestId('onboard-provider-gd-personal')
    const work = page.getByTestId('onboard-provider-gd-work')
    await expect(personal).toBeVisible()
    await expect(work).toBeVisible()

    await expect(
      page.getByTestId('onboard-provider-detail-gd-personal'),
    ).toContainText('personal.yaml')
    await expect(
      page.getByTestId('onboard-provider-detail-gd-work'),
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

  test('sync step offers inline add-provider flow', async ({ page }) => {
    await openOnboardDevicePanel(page)
    await createOnboardPasswordInline(page)
    await chooseFirstOnboardPassword(page)

    await page.getByTestId('add-provider-btn').click()
    await expect(page.getByTestId('provider-picker-list')).toBeVisible()
    await expect(page.getByTestId('provider-option-github')).toBeVisible()
  })
})
