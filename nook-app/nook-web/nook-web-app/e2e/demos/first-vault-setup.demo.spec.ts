import { expect, test } from '../fixtures'
import { LOCAL_PROVIDER_TYPE } from '../../../nook-web-shared/src/vault-app/lib/auth/provider-types'
import { ExtensionConnectStepKind } from '../../../nook-web-shared/src/extension/extension-connect-progress'
import {
  clearBrowserVault,
  connectLocalVault,
  flushNookLogPersistQueue,
  readPersistedAppLogs,
  UI_TIMEOUT_MS,
} from '../helpers'

const DEMO_BEAT_MS = 700

test('open an empty local vault without a browser-data reload alert', async ({
  page,
}) => {
  await page.goto('/app/')
  await clearBrowserVault(page)
  await page.reload()
  await expect(page.getByTestId('login-create-vault-chooser')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await page.waitForTimeout(DEMO_BEAT_MS)

  await connectLocalVault(page)
  await expect(page.getByTestId('vault-panel')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await expect(page.getByTestId('header-lock-vault-btn')).toBeEnabled()
  await expect(page.getByTestId('join-enrollment-dialog')).toHaveCount(0)
  await expect(page.getByTestId('card-password-input')).toHaveCount(0)
  await expect
    .poll(() => page.evaluate(() => '__nookVault' in window), {
      timeout: UI_TIMEOUT_MS,
    })
    .toBe(true)
  const storageMode = await page.evaluate(() => {
    const vault = window.__nookVault
    if (!vault) throw new Error('Vault debug hooks are unavailable')
    return vault.storageMode
  })
  expect(storageMode).toBe(LOCAL_PROVIDER_TYPE)
  await expect(page.getByTestId('vault-error')).toHaveCount(0)
  await page.waitForTimeout(DEMO_BEAT_MS)

  const websiteDeviceId = await page.evaluate(() => {
    const vault = window.__nookVault
    if (!vault) throw new Error('Vault debug hooks are unavailable')
    return vault.deviceId
  })
  await expect(page.locator('html')).not.toHaveAttribute(
    'data-nook-extension-runtime-id',
  )

  // A new manager must finish startup before automatically reopening this vault.
  await page.reload()
  await expect(page.getByTestId('vault-panel')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const vault = window.__nookVault
          return Boolean(
            vault && !vault.isInitializing && vault.isAuthenticated,
          )
        }),
      { timeout: UI_TIMEOUT_MS },
    )
    .toBe(true)
  await expect(page.getByTestId('vault-error')).toHaveCount(0)
  await page.waitForTimeout(DEMO_BEAT_MS)

  // With no companion provider, startup retains the website device identity.
  expect(await page.evaluate(() => window.__nookVault?.deviceId)).toBe(
    websiteDeviceId,
  )
  await expect(page.getByTestId('vault-pair-extension-btn')).toHaveCount(0)
  await expect(page.getByTestId('page-bar-title')).toBeVisible()

  const languageSelect = page.getByTestId('header-language-select')
  await languageSelect.click()
  await page.getByTestId('header-language-option-ru').click()
  await expect(languageSelect).toHaveText('RU')
  await page.waitForTimeout(DEMO_BEAT_MS)

  // Keep the typed workspace-to-secret-form callback boundary in the demo.
  await page.getByTestId('add-secret-btn').click()
  await expect(page.getByTestId('item-type-picker')).toBeVisible()
  await page.getByTestId('add-secret-back-btn').click()
  await expect(page.getByTestId('add-secret-panel')).toBeHidden()

  await flushNookLogPersistQueue(page)
  const logs = await readPersistedAppLogs(page)
  expect(
    logs.some(
      (entry) =>
        entry.scope === 'wasm-connect' && entry.message === 'connect complete',
    ),
  ).toBe(true)
  expect(
    logs.some(
      (entry) =>
        entry.scope === 'vault-sync' &&
        entry.message === 'vault sync timer started',
    ),
  ).toBe(true)
  expect(
    logs.some(
      (entry) =>
        entry.scope === 'vault-sync' &&
        entry.data?.includes('Vault crypto not initialized'),
    ),
  ).toBeFalsy()

  await page.getByTestId('header-lock-vault-btn').click()
  await expect(page.getByTestId('identity-vault-row').first()).toBeVisible()
  await expect(page.getByTestId('vault-error')).toHaveCount(0)
  await page.waitForTimeout(DEMO_BEAT_MS)
})

test('the extension connect route reports opened then choosing, and creating once a vault is created', async ({
  page,
}) => {
  // The extension opens its connect route and listens on a runtime port.
  // This stub stands in for that port and keeps the steps the page sends.
  await page.addInitScript(() => {
    const steps: unknown[] = []
    const port = {
      postMessage: (step: unknown) => steps.push(step),
      disconnect: () => {},
      onDisconnect: { addListener: () => {} },
    }
    Object.assign(window, {
      __nookConnectSteps: steps,
      chrome: { runtime: { connect: () => port } },
    })
  })
  const connect = new URLSearchParams({
    device_id: 'demo-extension-device',
    device_public_key: 'age1demoextension',
    device_signing_public_key: 'demo-extension-signing-key',
    extension_id: 'demo-extension',
    device_label: 'Nook Extension',
    nonce: 'demo-nonce',
    scopes: 'vault-access,password-filling',
  })
  const reportedSteps = () =>
    page.evaluate((): unknown => Reflect.get(window, '__nookConnectSteps'))

  await page.goto(`/extension-connect?${connect}`)
  await expect(page.getByTestId('first-vault-start')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  // Starting the app is not creating a vault: the side panel only hears
  // that the page opened and that the person chooses to create or join.
  await expect
    .poll(reportedSteps, { timeout: UI_TIMEOUT_MS })
    .toEqual([
      { kind: ExtensionConnectStepKind.Opened },
      { kind: ExtensionConnectStepKind.Choosing },
    ])
  await page.waitForTimeout(DEMO_BEAT_MS)

  // Creating starts only when the person creates the first vault.
  await page.getByTestId('login-vault-name-input').fill('Personal')
  await page.getByTestId('login-create-device-vault-btn').click()
  await expect
    .poll(
      async () => {
        const steps = await reportedSteps()
        return Array.isArray(steps) ? steps.slice(0, 3) : steps
      },
      { timeout: UI_TIMEOUT_MS },
    )
    .toEqual([
      { kind: ExtensionConnectStepKind.Opened },
      { kind: ExtensionConnectStepKind.Choosing },
      { kind: ExtensionConnectStepKind.Creating },
    ])
  await page.waitForTimeout(DEMO_BEAT_MS)
})
