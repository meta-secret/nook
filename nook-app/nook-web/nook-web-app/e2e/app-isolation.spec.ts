import { expect, test } from './fixtures'
import { createLocalVaultOnLogin, UI_TIMEOUT_MS } from './helpers'

const SIMPLE_APP_URL = (
  process.env.VITE_SIMPLE_APP_URL?.trim() || 'https://simple.nokey.sh'
).replace(/\/+$/, '')

type DebugVault = {
  manager?: {
    setVaultArchitectureJson(value: string): void
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('login-create-vault-chooser')).toBeVisible({
    timeout: UI_TIMEOUT_MS * 2,
  })
  await expect(page.getByTestId('migrate-legacy-vaults-link')).toHaveCount(0)
})

test('exposes only the project capability and rejects the opposite vault type', async ({
  page,
}, testInfo) => {
  const isSimple = testInfo.project.name === 'simple-isolation'
  const expectedKind = isSimple ? 'simple' : 'sentinel'
  await expect(page.locator('meta[name="nook-app-kind"]')).toHaveAttribute(
    'content',
    expectedKind,
  )
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __nookConfiguredVaultApplication?: string })
            .__nookConfiguredVaultApplication,
      ),
    )
    .toBe(expectedKind)

  if (isSimple) {
    await expect(page.getByTestId('create-vault-wizard-create')).toBeVisible()
    await expect(page.getByTestId('sentinel-dashboard-choice')).toHaveCount(0)
    await expect(page.getByTestId('sibling-vault-app-link')).toHaveCount(0)
  } else {
    await expect(page.getByTestId('sentinel-dashboard-choice')).toBeVisible()
    await expect(page.getByTestId('create-vault-wizard-create')).toHaveCount(0)
    await expect(page.getByTestId('get-started-path-simple')).toHaveCount(0)
    await expect(page.getByTestId('sibling-vault-app-link')).toHaveAttribute(
      'href',
      `${SIMPLE_APP_URL}/`,
    )
  }

  const oppositeArchitecture = isSimple
    ? {
        device_mode: 'standard',
        vault_type: 'sentinel',
        replication_type: 'personal',
        sentinel: {
          threshold: 2,
          required_participants: 3,
          ready_participants: 0,
        },
      }
    : {
        device_mode: 'standard',
        vault_type: 'simple',
        replication_type: 'personal',
      }
  const error = await page.evaluate((architecture) => {
    const manager = (window as Window & { __nookVault?: DebugVault })
      .__nookVault?.manager
    if (!manager) return 'manager unavailable'
    try {
      manager.setVaultArchitectureJson(JSON.stringify(architecture))
      return ''
    } catch (caught) {
      return caught instanceof Error ? caught.message : String(caught)
    }
  }, oppositeArchitecture)
  expect(error).toContain('errors.validation.vault_application_type_mismatch')
})

test('keeps extension routing and local session behavior app-specific', async ({
  page,
}, testInfo) => {
  const isSimple = testInfo.project.name === 'simple-isolation'
  const extensionResponse = await page.request.get('/extension-connect')
  expect(extensionResponse.status()).toBe(isSimple ? 200 : 404)

  if (!isSimple) {
    await expect(page.getByTestId('approve-extension-device-btn')).toHaveCount(
      0,
    )
    return
  }

  await createLocalVaultOnLogin(page, 'Isolated Simple vault')
  await expect(page.getByTestId('vault-panel')).toBeVisible()
  await page.getByTestId('header-lock-vault-btn').click()
  await expect(page.getByTestId('login-local-unlock-step')).toBeVisible()
})
