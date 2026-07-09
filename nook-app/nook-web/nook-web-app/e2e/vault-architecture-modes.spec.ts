import { expect, test } from './fixtures'
import { clearBrowserVault, openLoginProviderSetup, UI_TIMEOUT_MS } from './helpers'

test.describe('vault architecture modes', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await clearBrowserVault(page)
    await page.reload()
    await expect(page.getByTestId('login-create-vault-chooser')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
  })

  test('shows mode selectors and gates nexus secret creation setup', async ({
    page,
  }) => {
    await expect(page.getByTestId('mode-group-vault')).toBeVisible()
    await expect(page.getByTestId('mode-group-replication')).toBeVisible()
    await expect(page.getByTestId('nexus-readiness-gate')).toHaveCount(0)

    await page.getByTestId('mode-option-nexus').click()
    await expect(page.getByTestId('nexus-readiness-gate')).toBeVisible()

    await page.getByTestId('mode-option-simple').click()
    await expect(page.getByTestId('nexus-readiness-gate')).toHaveCount(0)
  })

  test('disables providers that cannot satisfy shared replication', async ({
    page,
  }) => {
    await page.getByTestId('mode-option-shared').click()
    await openLoginProviderSetup(page)

    await expect(page.getByTestId('provider-picker-list')).toBeVisible()
    await expect(page.getByTestId('provider-option-github')).toBeDisabled()
    await expect(page.getByTestId('provider-option-oauth-file')).toBeEnabled()
    await expect(page.getByTestId('provider-option-icloud')).toBeDisabled()
  })
})
