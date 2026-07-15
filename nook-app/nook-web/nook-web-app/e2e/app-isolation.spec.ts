import { expect, test } from './fixtures'
import { createLocalVaultOnLogin, UI_TIMEOUT_MS } from './helpers'
import { installMockPasskeyRuntime } from './passkey-mock'

const SIMPLE_APP_URL = (
  process.env.VITE_SIMPLE_APP_URL?.trim() || 'https://simple.nokey.sh'
).replace(/\/+$/, '')

type DebugVault = {
  manager?: {
    setVaultArchitectureJson(value: string): void
    deviceId: string
    devicePublicKey: string
    deviceSigningPublicKey(): Promise<string>
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
    await expect(page.getByTestId('get-started-path-chooser')).toBeVisible()
    await expect(page.getByTestId('get-started-path-simple')).toBeVisible()
    await expect(page.getByTestId('get-started-path-sentinel')).toHaveCount(0)
    await expect(page.getByTestId('login-connect-storage-btn')).toContainText(
      'Open an existing vault',
    )
    await expect(page.getByTestId('sentinel-dashboard-choice')).toHaveCount(0)
    await expect(page.getByTestId('sibling-vault-app-link')).toHaveCount(0)
    await page.getByTestId('get-started-path-simple').click()
    await expect(page.getByTestId('create-vault-wizard-create')).toBeVisible()
  } else {
    await expect(page.getByTestId('get-started-path-chooser')).toBeVisible()
    await expect(page.getByTestId('get-started-path-simple')).toHaveCount(0)
    await expect(page.getByTestId('get-started-path-sentinel')).toBeVisible()
    await expect(page.getByTestId('login-connect-storage-btn')).toContainText(
      'Open an existing vault',
    )
    await expect(page.getByTestId('create-vault-wizard-create')).toHaveCount(0)
    await expect(page.getByTestId('sibling-vault-app-link')).toHaveAttribute(
      'href',
      `${SIMPLE_APP_URL}/`,
    )
    await page.getByTestId('get-started-path-sentinel').click()
    await expect(page.getByTestId('sentinel-dashboard-choice')).toBeVisible()
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
  browser,
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

  const extensionContext = await browser.newContext()
  await extensionContext.addInitScript(installMockPasskeyRuntime)
  const extensionPage = await extensionContext.newPage()
  await extensionPage.goto(new URL(page.url()).origin)
  await expect
    .poll(
      () =>
        extensionPage.evaluate(
          () =>
            Boolean(
              (window as Window & { __nookVault?: DebugVault }).__nookVault
                ?.manager,
            ),
        ),
      { timeout: UI_TIMEOUT_MS * 2 },
    )
    .toBe(true)
  const extensionDevice = await extensionPage.evaluate(async () => {
    const manager = (window as Window & { __nookVault?: DebugVault })
      .__nookVault?.manager
    if (!manager) throw new Error('Extension device manager unavailable')
    return {
      deviceId: manager.deviceId,
      devicePublicKey: manager.devicePublicKey,
      deviceSigningPublicKey: await manager.deviceSigningPublicKey(),
    }
  })
  await extensionContext.close()
  await page.addInitScript(() => {
    Object.defineProperty(window, 'chrome', {
      configurable: true,
      value: {
        runtime: {
          sendMessage: (
            _extensionId: string,
            _message: unknown,
            callback: (response: unknown) => void,
          ) => callback({ ok: false }),
        },
      },
    })
  })
  await page.goto(
    `/extension-connect?device_id=${extensionDevice.deviceId}&device_public_key=${encodeURIComponent(extensionDevice.devicePublicKey)}&device_signing_public_key=${extensionDevice.deviceSigningPublicKey}&extension_id=test-extension&device_label=Nook%20Extension&nonce=test-nonce&scopes=vault-access,password-filling`,
  )
  await expect(page.getByTestId('login-local-unlock-step')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await page.getByTestId('unlock-vault-btn').click()
  await expect(page.getByTestId('extension-connect-consent')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await page.getByTestId('approve-extension-device-btn').click()
  await expect(
    page.getByTestId('extension-connect-consent').getByRole('alert'),
  ).toContainText(
    'The extension did not accept the Simple Vault pairing grant.',
  )
  await expect(page.getByTestId('extension-connect-approved')).toHaveCount(0)

  await page.getByTestId('header-lock-vault-btn').click()
  await expect(page.getByTestId('login-local-unlock-step')).toBeVisible()
})

test('opens the existing-vault workflow without starting creation', async ({
  page,
}, testInfo) => {
  const expectedKind =
    testInfo.project.name === 'simple-isolation' ? 'simple' : 'sentinel'

  await page.getByTestId('login-connect-storage-btn').click()

  await expect(page.locator('meta[name="nook-app-kind"]')).toHaveAttribute(
    'content',
    expectedKind,
  )
  await expect(page.getByTestId('login-provider-setup')).toBeVisible()
  await expect(page.getByTestId('create-vault-wizard-create')).toHaveCount(0)
  await expect(page.getByTestId('sentinel-dashboard-choice')).toHaveCount(0)
  await expect(page.getByTestId('login-create-vault-chooser')).toHaveCount(0)
  await expect(page.getByTestId('login-back-to-get-started')).toBeVisible()
})
