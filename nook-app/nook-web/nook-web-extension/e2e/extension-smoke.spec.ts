import { chromium, expect, test } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  advanceCreateVaultWizardToFinalStep,
  connectedSetupState,
  extensionDir,
  getServiceWorker,
  installMockPasskeyRuntime,
  launchExtensionContext,
  e2eSentinelVaultBaseUrl,
  openSimpleVaultConnection,
  pairingGrantStorageKey,
  readExtensionPersistenceSnapshot,
  readExtensionStorage,
  sendExternalMessage,
  setupPasskeyExtensionPopup,
  setupStorageKey,
  simpleVaultBaseUrl,
  startLoginServer,
  syntheticEventLogRecords,
  waitForExtensionPairingReady,
  writeExtensionStorage,
  type ExtensionPairingApprovedMessage,
} from './helpers/extension-smoke-runtime'
import {
  belongs_to_sentinel_vault,
  belongs_to_simple_vault,
  simple_vault_url,
} from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { ExtensionConnectScope } from '../../nook-web-shared/src/extension/extension-connect-scope'
import { ExtensionPairingVaultType } from '../../nook-web-shared/src/extension/runtime-messages'
import {
  ensurePinProtectedPopup,
  installForcePinDeviceProtection,
} from './helpers/pin-device'
import { lockExtensionSession } from './helpers/paired-pin-extension'
import { ExtensionSessionMessageType } from '../src/offscreen/session-message-dispatch'

const chromiumExecutablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim() ?? ''

test('sets up the extension device first and sends its public keys to Simple Vault', async ({
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

  const manifest = JSON.parse(
    await readFile(path.join(extensionDir, 'manifest.json'), 'utf8'),
  ) as { action?: { default_popup?: string } }
  expect(manifest.action?.default_popup).toBe('popup/index.html')

  const loginServer = await startLoginServer()
  const userDataDir = testInfo.outputPath('chromium-profile')
  const context = await launchExtensionContext(userDataDir)

  await context.route('**/*', (route) => {
    const url = route.request().url()
    if (belongs_to_simple_vault(simpleVaultBaseUrl, url)) {
      return route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><body><h1>Simple Vault</h1></body></html>',
      })
    }
    if (belongs_to_sentinel_vault(simpleVaultBaseUrl, url)) {
      return route.fulfill({
        contentType: 'text/html',
        body: '<form><input autocomplete="username"><input type="password"></form>',
      })
    }
    return route.continue()
  })

  try {
    const worker = await getServiceWorker(context)
    const extensionId = new URL(worker.url()).host

    const popupPage = await context.newPage()
    await popupPage.goto(`chrome-extension://${extensionId}/popup/index.html`)
    await expect(popupPage.getByTestId('extension-device-setup')).toBeVisible()
    await expect(
      popupPage.getByTestId('device-protection-use-existing-choice'),
    ).toHaveText('Authenticate')
    await expect(popupPage.getByTestId('device-mode-select')).toBeHidden()
    await expect(
      popupPage.getByTestId('device-protection-create-new-choice'),
    ).toHaveText('Create passkey')
    await expect(
      popupPage.getByTestId('device-protection-setup-btn'),
    ).toBeHidden()

    await popupPage.getByTestId('device-protection-create-new-choice').click()
    await expect(
      popupPage.getByTestId('device-mode-select').locator('option:checked'),
    ).toHaveText('Standard')
    await expect(
      popupPage.getByTestId('device-protection-setup-btn'),
    ).toHaveText('Create new passkey')
    await expect(
      popupPage.getByTestId('device-protection-use-existing-choice'),
    ).toBeVisible()

    const openedConnectPage = context.waitForEvent('page', { timeout: 30_000 })
    expect(
      await popupPage.evaluate(
        () =>
          new Promise<unknown>((resolve) => {
            chrome.runtime.sendMessage(
              {
                type: 'nook:begin-extension-pairing',
                payload: {
                  deviceId: 'device-popup-e2e',
                  devicePublicKey: 'age1popup',
                  deviceSigningPublicKey: 'popup-signing-key',
                  deviceLabel: 'Nook Extension - Chromium test profile',
                },
              },
              resolve,
            )
          }),
      ),
    ).toEqual({ ok: true })
    const simplePage = await openedConnectPage
    await expect(simplePage).toHaveURL((url) => {
      const expected = new URL(
        simple_vault_url(simpleVaultBaseUrl, 'extension-connect'),
      )
      return (
        url.origin === expected.origin &&
        url.pathname === expected.pathname &&
        url.searchParams.get('extension_id') === extensionId &&
        url.searchParams.get('device_id') === 'device-popup-e2e' &&
        url.searchParams.get('device_public_key') === 'age1popup' &&
        url.searchParams.get('device_signing_public_key') ===
          'popup-signing-key' &&
        url.searchParams.has('nonce') &&
        url.searchParams.get('scopes') ===
          'vault-access,password-filling,passkey-management,sync-provider-credentials'
      )
    })

    const openedCompanionPage = context.waitForEvent('page', {
      timeout: 30_000,
    })
    expect(
      await sendExternalMessage(simplePage, extensionId, {
        type: 'nook:open-companion-launcher',
      }),
    ).toEqual({ ok: true })
    const companionPage = await openedCompanionPage
    await expect(companionPage).toHaveURL(
      `chrome-extension://${extensionId}/popup/index.html`,
    )
    await expect(
      companionPage.getByTestId('extension-device-setup'),
    ).toBeVisible()
    await companionPage.close()

    const loginPage = await context.newPage()
    await loginPage.goto(`${loginServer.origin}/login`)
    const widget = loginPage.locator('#nook-auth-widget')
    await expect(widget).toBeVisible()
    await expect(widget.getByText('Nook Pilot · 1/3')).toBeVisible()
    await expect(widget.getByText('Ready to sign in')).toBeVisible()
    await expect(widget.getByText('localhost')).toBeVisible()
    await expect(widget.getByTestId('nook-auth-gate-vault-status')).toHaveText(
      'Vault not connected',
    )
    await expect(
      widget.getByRole('button', { name: 'Continue with Nook' }),
    ).toBeVisible()
    await expect(
      widget.getByRole('button', { name: 'Open vault' }),
    ).toBeVisible()

    const loginSubmit = loginPage.locator('form button[type="submit"]')
    await loginSubmit.evaluate((button) => {
      button.textContent = ''
      button.setAttribute('aria-label', 'Save')
    })
    await expect(widget).toHaveCount(0)
    await loginSubmit.evaluate((button) => {
      button.setAttribute('aria-label', 'Sign in')
    })
    await expect(widget).toBeVisible()

    await loginSubmit.evaluate((button) => {
      const unrelatedForm = document.createElement('form')
      unrelatedForm.id = 'unrelated-form'
      document.body.append(unrelatedForm)
      button.setAttribute('form', unrelatedForm.id)
    })
    await expect(widget).toHaveCount(0)
    await loginSubmit.evaluate((button) => {
      button.removeAttribute('form')
      button.ownerDocument.getElementById('unrelated-form')?.remove()
    })
    await expect(widget).toBeVisible()

    const loginForm = loginPage.locator('form')
    await loginForm.evaluate((form) => form.setAttribute('style', 'opacity: 0'))
    await expect(widget).toHaveCount(0)
    await loginForm.evaluate((form) => form.removeAttribute('style'))
    await expect(widget).toBeVisible()

    await loginForm.evaluate((form) => form.setAttribute('inert', ''))
    await expect(widget).toHaveCount(0)
    await loginForm.evaluate((form) => form.removeAttribute('inert'))
    await expect(widget).toBeVisible()

    await loginPage.setViewportSize({ width: 900, height: 700 })
    await loginPage.addStyleTag({
      content:
        '@media (max-width: 600px) { form button[type="submit"] { display: none !important; } }',
    })
    await expect(widget).toBeVisible()
    await loginPage.setViewportSize({ width: 500, height: 700 })
    await expect(widget).toHaveCount(0)
    await loginPage.setViewportSize({ width: 900, height: 700 })
    await expect(widget).toBeVisible()

    const hiddenHeaderLoginPage = await context.newPage()
    await hiddenHeaderLoginPage.goto(
      `${loginServer.origin}/login-with-hidden-header`,
    )
    const hiddenHeaderWidget =
      hiddenHeaderLoginPage.locator('#nook-auth-widget')
    await expect(hiddenHeaderWidget.getByText('Ready to sign in')).toBeVisible()
    await expect(
      hiddenHeaderWidget.getByRole('button', { name: 'Continue with Nook' }),
    ).toBeVisible()
    await expect(hiddenHeaderWidget.getByText('Manual checkpoint')).toHaveCount(
      0,
    )

    const inertAccountPage = await context.newPage()
    await inertAccountPage.goto(`${loginServer.origin}/inert-account-field`)
    await expect(inertAccountPage.locator('#nook-auth-widget')).toHaveCount(0)

    await widget.evaluate((host) => {
      host.shadowRoot
        ?.querySelector<HTMLButtonElement>('button.primary-button')
        ?.click()
    })
    await expect(widget.getByText('Ready to sign in')).toBeVisible()

    await widget.getByRole('button', { name: 'Collapse Nook' }).click()
    await expect(
      widget.getByRole('button', { name: 'Continue with Nook' }),
    ).toBeHidden()
    await expect(
      widget
        .getByTestId('nook-auth-gate-expand')
        .getByText('1/3', { exact: true }),
    ).toBeVisible()
    await expect(
      widget.getByRole('button', { name: /Expand Nook: Nook Pilot · 1\/3/ }),
    ).toBeVisible()
    await widget.getByTestId('nook-auth-gate-expand').press('Enter')
    await expect(
      widget.getByRole('button', { name: 'Continue with Nook' }),
    ).toBeVisible()

    const openedVault = context.waitForEvent('page')
    await widget.getByRole('button', { name: 'Open vault' }).click()
    await expect(await openedVault).toHaveURL(simpleVaultBaseUrl)

    const signupPage = await context.newPage()
    await signupPage.goto(`${loginServer.origin}/signup`)
    const signupWidget = signupPage.locator('#nook-auth-widget')
    await expect(signupWidget.getByText('Nook Pilot · 2/5')).toBeVisible()
    await expect(signupWidget.getByText('Signup detected')).toBeVisible()
    await expect(
      signupWidget.getByRole('button', { name: 'Take over' }),
    ).toBeVisible()
    await signupWidget.evaluate((host) => {
      host.shadowRoot
        ?.querySelector<HTMLButtonElement>('button.text-button')
        ?.click()
    })
    await expect(signupWidget).toBeVisible()

    const otpPage = await context.newPage()
    await otpPage.goto(`${loginServer.origin}/otp`)
    const otpWidget = otpPage.locator('#nook-auth-widget')
    await expect(otpWidget.getByText('Nook Pilot · 2/3')).toBeVisible()
    await expect(otpWidget.getByText('Fill your 2FA code')).toBeVisible()

    const hiddenOtpPage = await context.newPage()
    await hiddenOtpPage.goto(`${loginServer.origin}/otp-hidden`)
    const hiddenOtpWidget = hiddenOtpPage.locator('#nook-auth-widget')
    await expect(hiddenOtpWidget).toHaveCount(0)
    await hiddenOtpPage
      .getByRole('button', { name: 'Continue to verification' })
      .click()
    await expect(hiddenOtpWidget.getByText('Fill your 2FA code')).toBeVisible()

    const combinedPage = await context.newPage()
    await combinedPage.goto(`${loginServer.origin}/combined`)
    const combinedWidget = combinedPage.locator('#nook-auth-widget')
    await expect(combinedWidget.getByText('Ready to sign in')).toBeVisible()
    await expect(
      combinedWidget.getByRole('button', { name: 'Continue with Nook' }),
    ).toBeVisible()

    const spaPage = await context.newPage()
    await spaPage.goto(`${loginServer.origin}/spa`)
    const spaWidget = spaPage.locator('#nook-auth-widget')
    await expect(
      spaWidget.getByRole('button', { name: 'Continue with Nook' }),
    ).toBeVisible()
    await spaPage.getByRole('button', { name: 'Next' }).click()
    await expect(
      spaWidget.getByRole('button', { name: 'Continue with Nook' }),
    ).toBeVisible()

    const microsoftPage = await context.newPage()
    await microsoftPage.goto(`${loginServer.origin}/microsoft`)
    const microsoftWidget = microsoftPage.locator('#nook-auth-widget')
    await expect(
      microsoftWidget.getByRole('button', { name: 'Continue with Nook' }),
    ).toBeVisible()
    await expect(microsoftPage.locator('[name="loginfmt"]')).toBeVisible()

    const slackPage = await context.newPage()
    await slackPage.goto(`${loginServer.origin}/slack`)
    const slackWidget = slackPage.locator('#nook-auth-widget')
    await expect(
      slackWidget.getByRole('button', { name: 'Continue with Nook' }),
    ).toBeVisible()
    await expect(slackPage.locator('[data-qa="login_email"]')).toBeVisible()

    const tier1Sites: Array<{ path: string; field: string }> = [
      { path: '/facebook', field: '[name="email"]' },
      { path: '/google', field: '[name="identifier"]' },
      { path: '/apple', field: '#account_name_text_field' },
      { path: '/amazon', field: '[name="email"]' },
      { path: '/github', field: '[name="login"]' },
      { path: '/linkedin', field: '#username' },
      { path: '/x', field: '[name="text"]' },
    ]
    for (const site of tier1Sites) {
      const page = await context.newPage()
      await page.goto(`${loginServer.origin}${site.path}`)
      const widget = page.locator('#nook-auth-widget')
      await expect(
        widget.getByRole('button', { name: 'Continue with Nook' }),
      ).toBeVisible()
      await expect(page.locator(site.field)).toBeVisible()
      await page.close()
    }

    const sentinelPage = await context.newPage()
    const sentinelUrl = e2eSentinelVaultBaseUrl()
    await sentinelPage.goto(sentinelUrl)
    await expect(sentinelPage.locator('#nook-auth-widget')).toHaveCount(0)

    const forgedGrant = {
      type: 'nook:extension-pairing-approved',
      payload: {
        vaultType: ExtensionPairingVaultType.Sentinel,
        deviceId: 'sentinel-device-e2e',
        devicePublicKey: 'age1sentinel',
        deviceSigningPublicKey: 'sentinel-signing-key',
        deviceLabel: 'Forged Sentinel device',
        vaultStoreId: 'sentinel-store-e2e',
        vaultName: 'Sentinel safe',
        approvedAt: '2026-07-07T00:00:00.000Z',
        scopes: [ExtensionConnectScope.VaultAccess],
        providers: [],
      },
      eventLogRecords: syntheticEventLogRecords,
    }
    expect(
      await sendExternalMessage(simplePage, extensionId, forgedGrant),
    ).toEqual({ ok: false, reason: 'invalid-pairing-grant' })

    const persistenceBeforeMalformedProvider =
      await readExtensionPersistenceSnapshot(worker)
    const malformedProviderGrant = {
      type: 'nook:extension-pairing-approved',
      payload: {
        vaultType: ExtensionPairingVaultType.Simple,
        deviceId: 'device-e2e',
        devicePublicKey: 'age1extension',
        deviceSigningPublicKey: 'extension-signing-key',
        deviceLabel: 'Nook Extension - Chromium test profile',
        vaultStoreId: 'store-e2e',
        vaultName: 'Personal',
        approvedAt: '2026-07-07T00:00:00.000Z',
        scopes: [
          ExtensionConnectScope.VaultAccess,
          ExtensionConnectScope.PasswordFilling,
        ],
        providers: [{ githubPat: 'github_pat_malformed_e2e_secret' }],
      },
      eventLogRecords: syntheticEventLogRecords,
    }
    expect(
      await sendExternalMessage(
        simplePage,
        extensionId,
        malformedProviderGrant,
      ),
    ).toEqual({ ok: false, reason: 'invalid-pairing-grant' })
    expect(await readExtensionPersistenceSnapshot(worker)).toEqual(
      persistenceBeforeMalformedProvider,
    )

    const approvedGrant: ExtensionPairingApprovedMessage = {
      type: 'nook:extension-pairing-approved',
      payload: {
        vaultType: ExtensionPairingVaultType.Simple,
        deviceId: 'device-e2e',
        devicePublicKey: 'age1extension',
        deviceSigningPublicKey: 'extension-signing-key',
        deviceLabel: 'Nook Extension - Chromium test profile',
        vaultStoreId: 'store-e2e',
        vaultName: 'Personal',
        approvedAt: '2026-07-07T00:00:00.000Z',
        scopes: [
          ExtensionConnectScope.VaultAccess,
          ExtensionConnectScope.PasswordFilling,
        ],
        providers: [],
      },
      eventLogRecords: syntheticEventLogRecords,
    }
    expect(
      await sendExternalMessage(simplePage, extensionId, approvedGrant),
    ).toEqual({ ok: false, reason: 'event-log-import-failed' })

    const storage = await readExtensionStorage(context)
    expect(Object.hasOwn(storage, pairingGrantStorageKey)).toBe(false)
    expect(Object.hasOwn(storage, setupStorageKey)).toBe(false)
  } finally {
    await context.close()
    await loginServer.close()
  }
})

test('keeps the extension vault independent and switches after valid re-pairing', async ({
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')
  testInfo.setTimeout(180_000)

  const userDataDir = testInfo.outputPath('chromium-profile-unpair')
  const context = await launchExtensionContext(userDataDir)
  await context.addInitScript(installMockPasskeyRuntime)

  try {
    const popupPage = await setupPasskeyExtensionPopup(context)
    const extensionId = new URL(popupPage.url()).host
    const simplePage = await openSimpleVaultConnection(context, popupPage)

    await advanceCreateVaultWizardToFinalStep(simplePage)
    await simplePage
      .getByTestId('login-vault-name-input')
      .fill('Unpair test vault')
    await simplePage.getByTestId('login-create-device-vault-btn').click()
    await expect(
      simplePage.getByTestId('extension-connect-consent'),
    ).toBeVisible()

    await simplePage.getByTestId('approve-extension-device-btn').click()
    await waitForExtensionPairingReady(
      simplePage,
      async () => {
        const storage = await readExtensionStorage(context)
        return storage[setupStorageKey]
      },
      'Unpair test vault',
    )
    await expect(
      simplePage.getByTestId('extension-connect-approved'),
    ).toBeVisible()
    await simplePage.getByRole('button', { name: 'Done' }).click()

    await simplePage.getByTestId('vault-settings-tab').click()
    const dangerSection = simplePage.getByTestId('vault-danger-section')
    await dangerSection.getByRole('button').first().click()
    await simplePage.getByTestId('delete-local-vault-button').click()
    await simplePage.getByTestId('delete-local-vault-confirm').click()

    await expect(simplePage).toHaveURL((url) => url.pathname === '/', {
      timeout: 15_000,
    })

    const storageAfterWebsiteDeletion = await readExtensionStorage(context)
    expect(storageAfterWebsiteDeletion[setupStorageKey]).toMatchObject({
      status: 'ready',
      selectedVaultName: 'Unpair test vault',
    })
    expect(
      Object.keys(storageAfterWebsiteDeletion).filter((key) =>
        key.startsWith('nook:extension-pairing-grant:'),
      ),
    ).toHaveLength(1)

    const replacementPopupPage = await context.newPage()
    await replacementPopupPage.goto(
      `chrome-extension://${extensionId}/popup/index.html?intent=pair`,
    )
    await expect(
      replacementPopupPage.getByTestId('extension-companion-home'),
    ).toBeVisible()
    const replacementPage = await openSimpleVaultConnection(
      context,
      replacementPopupPage,
    )
    await advanceCreateVaultWizardToFinalStep(replacementPage)
    await replacementPage
      .getByTestId('login-vault-name-input')
      .fill('Replacement vault')
    await replacementPage.getByTestId('login-create-device-vault-btn').click()
    await expect(
      replacementPage.getByTestId('extension-connect-consent'),
    ).toBeVisible()
    await replacementPage.getByTestId('approve-extension-device-btn').click()
    await waitForExtensionPairingReady(
      replacementPage,
      async () => {
        const repairedStorage = await readExtensionStorage(context)
        return repairedStorage[setupStorageKey]
      },
      'Replacement vault',
    )
    const repairedStorage = await readExtensionStorage(context)
    const repairedSetup = repairedStorage[setupStorageKey]
    expect(repairedSetup).toMatchObject({
      status: 'ready',
      selectedVaultName: 'Replacement vault',
    })
    expect(repairedSetup).toEqual(
      expect.objectContaining({
        eventCount: expect.any(Number),
        eventLogHeads: expect.arrayContaining([expect.any(String)]),
      }),
    )
    const repairedGrants = Object.entries(repairedStorage).filter(([key]) =>
      key.startsWith('nook:extension-pairing-grant:'),
    )
    expect(repairedGrants).toHaveLength(2)
    expect(repairedGrants.map(([, grant]) => grant)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ vaultName: 'Unpair test vault' }),
        expect.objectContaining({ vaultName: 'Replacement vault' }),
      ]),
    )
    // Exercise the extension-facing half of replacement import rather than
    // accepting storage metadata alone. The browser-WASM regression covers
    // the exact Sentinel-to-Simple architecture transition; this verifies the
    // real pairing wiring adopts that replacement as the usable active vault.
    const verifiedPopupPage = await context.newPage()
    await verifiedPopupPage.goto(
      `chrome-extension://${extensionId}/popup/index.html`,
    )
    await expect(
      verifiedPopupPage.getByTestId('extension-companion-home'),
    ).toBeVisible()
    await expect(
      verifiedPopupPage.getByTestId('companion-vault-status'),
    ).toContainText('Replacement vault')
    const replacementGrantEntry = repairedGrants.find(
      ([, grant]) =>
        (grant as { vaultName: string }).vaultName === 'Replacement vault',
    )
    if (!replacementGrantEntry) {
      throw new Error('replacement vault grant must exist after repair')
    }
    const replacementGrant = replacementGrantEntry[1]
    const vaultBackedLookup = await verifiedPopupPage.evaluate(
      async (grant) => {
        await chrome.runtime.sendMessage({
          type: 'nook:ensure-extension-session-runtime',
        })
        return chrome.runtime.sendMessage({
          type: 'nook:extension-session-list-logins',
          payload: {
            ...(grant as {
              vaultStoreId: string
              deviceId: string
              devicePublicKey: string
              deviceSigningPublicKey: string
            }),
            origin: 'https://example.com',
            queue: { kind: 'message-default' },
          },
        })
      },
      replacementGrant,
    )
    expect(vaultBackedLookup).toEqual({ ok: true, accounts: [] })
  } finally {
    await context.close()
  }
})

test('shows extension unlock when a paired device identity is unavailable', async ({
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

  const userDataDir = testInfo.outputPath('chromium-profile')
  await mkdir(userDataDir, { recursive: true })
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    ...(chromiumExecutablePath
      ? { executablePath: chromiumExecutablePath }
      : {}),
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
    ],
  })

  try {
    const worker = await getServiceWorker(context)
    const extensionId = new URL(worker.url()).host
    const popupPage = await context.newPage()
    await popupPage.goto(`chrome-extension://${extensionId}/popup/index.html`)
    await writeExtensionStorage(popupPage, {
      [setupStorageKey]: connectedSetupState,
    })
    await popupPage.reload()

    await expect(popupPage.getByTestId('extension-device-setup')).toBeVisible()
    await expect(popupPage.getByTestId('open-simple-vault-btn')).toHaveCount(0)
  } finally {
    await context.close()
  }
})

test('translates malformed device-action responses in the popup', async ({
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

  const userDataDir = testInfo.outputPath('chromium-profile-translated-error')
  const context = await launchExtensionContext(userDataDir)
  await context.addInitScript(installForcePinDeviceProtection)

  try {
    const worker = await getServiceWorker(context)
    const extensionId = new URL(worker.url()).host
    const popupPage = await context.newPage()
    await popupPage.goto(`chrome-extension://${extensionId}/popup/index.html`)
    await ensurePinProtectedPopup(popupPage)
    await lockExtensionSession(context)
    await popupPage.evaluate(() => {
      localStorage.setItem('nook_locale', 'ru')
    })
    await popupPage.reload()
    await expect(
      popupPage.getByTestId('device-protection-pin-unlock-btn'),
    ).toBeVisible()

    await popupPage.evaluate(
      (unlockMessageType: ExtensionSessionMessageType) => {
        type MalformedDeviceResponse = {
          ok: true
          device: {
            deviceId: string
            devicePublicKey: string
            deviceSigningPublicKey: string
          }
        }
        type UnlockPinRuntimeMessage = {
          type: ExtensionSessionMessageType
        }
        type UnlockPinRuntimeCallback = (
          response: MalformedDeviceResponse,
        ) => void
        type UnlockPinRuntimeArguments =
          | [message: UnlockPinRuntimeMessage]
          | [
              message: UnlockPinRuntimeMessage,
              callback: UnlockPinRuntimeCallback,
            ]
        const runtime = globalThis.chrome.runtime
        const originalSendMessage = runtime.sendMessage.bind(runtime)
        const descriptor: PropertyDescriptor = {
          configurable: true,
          value(...args: UnlockPinRuntimeArguments) {
            const [message, callback] = args
            if (message.type === unlockMessageType && callback) {
              const malformedResponse: MalformedDeviceResponse = {
                ok: true,
                device: {
                  deviceId: '',
                  devicePublicKey: '',
                  deviceSigningPublicKey: '',
                },
              }
              callback(malformedResponse)
              return
            }
            if (callback) {
              originalSendMessage(message, callback)
              return
            }
            return originalSendMessage(message)
          },
        }
        Object.defineProperty(runtime, 'sendMessage', descriptor)
      },
      ExtensionSessionMessageType.UnlockPin,
    )

    await popupPage
      .getByTestId('device-protection-pin-unlock-input')
      .fill('123456')
    await popupPage.getByTestId('device-protection-pin-unlock-btn').click()
    const error = popupPage.getByTestId('device-protection-error')
    await expect(error).toHaveText(
      'PIN или кодовая фраза не разблокировали этот браузер. Проверьте их и повторите попытку.',
    )
    await expect(error).not.toContainText(
      'Extension session returned malformed device identity.',
    )
  } finally {
    await context.close()
  }
})
