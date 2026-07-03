import { expect, test } from './fixtures'
import {
  clearBrowserVault,
  connectLocalVaultLegacy,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  forceVaultQuiescentForE2e,
  openOnboardDevicePanel,
  seedExtraGithubProviders,
  seedGithubSyncProvidersWhileUnlocked,
  UI_TIMEOUT_MS,
  waitForLoadedSyncProviders,
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

  test('wizard advances to sync provider step after inline password creation', async ({
    page,
  }) => {
    await openOnboardDevicePanel(page)
    await createOnboardPasswordInline(page)

    await expect(page.getByTestId('onboard-password-prerequisite')).toHaveCount(
      0,
    )
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

    await expect(page.getByTestId('add-provider-btn')).toBeVisible()
    await expect(page.getByTestId('onboard-device-submit')).toHaveCount(0)

    await seedGithubSyncProvidersWhileUnlocked(page)
    await page.getByTestId('vault-onboard-tab').click()
    await expect(page.getByTestId('onboard-wizard-generate-step')).toBeVisible()
    await expect(page.getByTestId('onboard-device-submit')).toBeVisible()
    await expect(page.getByTestId('onboard-device-submit')).toBeEnabled({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
  })

  test('shows repository and token hints for multiple GitHub providers', async ({
    page,
  }) => {
    const fullPatAlpha = 'github_pat_11AAAAbbbbCCCCDDDD'
    const fullPatBeta = 'github_pat_22EEEEffffGGGGHHHH'

    await seedExtraGithubProviders(page, [
      {
        id: 'gh-repo-alpha',
        label: 'GitHub · alpha',
        githubRepo: 'alpha',
        githubPat: fullPatAlpha,
      },
      {
        id: 'gh-repo-beta',
        label: 'GitHub · beta',
        githubRepo: 'beta',
        githubPat: fullPatBeta,
      },
    ])

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

    await page
      .getByTestId('onboard-wizard-sync-step')
      .getByRole('button')
      .click()
    const providerList = page.getByTestId('onboard-provider-list')
    await expect(providerList).toBeVisible()

    const alpha = page.getByTestId('onboard-provider-gh-repo-alpha')
    const beta = page.getByTestId('onboard-provider-gh-repo-beta')
    await expect(alpha).toBeVisible()
    await expect(beta).toBeVisible()

    await expect(
      page.getByTestId('onboard-provider-detail-gh-repo-alpha'),
    ).toContainText('alpha/nook-vault.yaml')
    await expect(
      page.getByTestId('onboard-provider-detail-gh-repo-beta'),
    ).toContainText('beta/nook-vault.yaml')
    await expect(providerList).toContainText('github_pat_11A…')
    await expect(providerList).toContainText('github_pat_22E…')
    await expect(providerList).not.toContainText(fullPatAlpha)
    await expect(providerList).not.toContainText(fullPatBeta)
    await expect(page.getByTestId('onboard-provider-local')).toHaveCount(0)

    await beta.click()
    await expect(beta).toHaveAttribute('aria-checked', 'true')
    await expect(alpha).toHaveAttribute('aria-checked', 'false')
  })

  test('sync step offers inline add-provider flow', async ({ page }) => {
    await openOnboardDevicePanel(page)
    await createOnboardPasswordInline(page)

    await page.getByTestId('add-provider-btn').click()
    await expect(page.getByTestId('provider-picker-list')).toBeVisible()
    await expect(page.getByTestId('provider-option-github')).toBeVisible()
  })
})
