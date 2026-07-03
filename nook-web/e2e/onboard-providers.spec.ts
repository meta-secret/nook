import { expect, test } from './fixtures'
import {
  clearBrowserVault,
  connectLocalVaultLegacy,
  seedExtraGithubProviders,
  UI_TIMEOUT_MS,
  waitForLoadedSyncProviders,
} from './helpers'

test.describe('onboard provider picker', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await clearBrowserVault(page)
    await page.reload()
    await connectLocalVaultLegacy(page)
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
    await waitForLoadedSyncProviders(page, 2)

    await page.getByTestId('vault-onboard-tab').click()
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

  test('links open the matching settings section', async ({ page }) => {
    await page.getByTestId('vault-onboard-tab').click()
    await expect(page.getByTestId('onboard-device-panel')).toBeVisible()

    await page.getByTestId('onboard-open-storage-settings').click()
    await expect(page.getByTestId('storage-settings-panel')).toBeVisible()
    await expect(
      page
        .getByTestId('storage-providers-section')
        .locator('button[aria-expanded]'),
    ).toHaveAttribute('aria-expanded', 'true')

    await page.getByTestId('vault-onboard-tab').click()
    await page.getByTestId('onboard-open-password-settings').click()
    await expect(page.getByTestId('storage-settings-panel')).toBeVisible()
    await expect(
      page.getByTestId('vault-unlock-section').locator('button[aria-expanded]'),
    ).toHaveAttribute('aria-expanded', 'true')
    await expect(
      page
        .getByTestId('storage-providers-section')
        .locator('button[aria-expanded]'),
    ).toHaveAttribute('aria-expanded', 'false')
  })
})
