import { chromium, expect, test, type Page } from '@playwright/test'
import {
  assertWebsitePasskeyThroughExtension,
  attachNookLogsForTest,
  advanceCreateVaultWizardToFinalStep,
  extensionApprovalVaultName,
  extensionDir,
  EXTENSION_UNLOCK_TIMEOUT_MS,
  getServiceWorker,
  installMockPasskeyRuntime,
  isHostedSmoke,
  launchExtensionContext,
  lockExtensionSession,
  openSimpleVaultConnection,
  readExtensionStorage,
  removeExtensionStorageKeys,
  readPersistedAppLogs,
  registerWebsitePasskeyThroughExtension,
  sendExternalMessage,
  setupPasskeyExtensionPopup,
  setupStorageKey,
  simpleVaultBaseUrl,
  startLoginServer,
  waitForExtensionPairingReady,
  type WebsitePasskeyAssertionBrowserFlow,
} from './helpers/extension-smoke-runtime'
import {
  PairedVaultCompanionUnlockKind,
  unlockPairedVaultThroughCompanion,
  type PairedVaultCompanionUnlock,
} from './helpers/paired-vault-companion-unlock'
import { belongs_to_simple_vault } from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { ExtensionConnectScope } from '../../nook-web-shared/src/extension/extension-connect-scope'
import { OpenCompanionLauncherIntent } from '../../nook-web-shared/src/extension/companion-launcher-message'
import { createLocalVaultOnLogin } from '../../nook-web-app/e2e/helpers'

const chromiumExecutablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim() ?? ''

enum WebsitePageStateKind {
  Skipped = 'skipped',
  Opened = 'opened',
}

type WebsitePageState =
  | { kind: WebsitePageStateKind.Skipped }
  | { kind: WebsitePageStateKind.Opened; page: Page }

enum ExtensionConnectionParameter {
  DeviceId = 'device_id',
  DevicePublicKey = 'device_public_key',
  DeviceSigningPublicKey = 'device_signing_public_key',
  HandoffNonce = 'nonce',
}

enum ExtensionConnectionParametersParseKind {
  Valid = 'valid',
  Invalid = 'invalid',
}

type ExtensionConnectionParametersParseResult =
  | {
      kind: ExtensionConnectionParametersParseKind.Valid
      deviceId: string
      devicePublicKey: string
      deviceSigningPublicKey: string
      handoffNonce: string
    }
  | {
      kind: ExtensionConnectionParametersParseKind.Invalid
      missingParameter: ExtensionConnectionParameter
    }

function parseExtensionConnectionParameters(
  connectionUrl: URL,
): ExtensionConnectionParametersParseResult {
  const deviceId = connectionUrl.searchParams.get(
    ExtensionConnectionParameter.DeviceId,
  )
  if (typeof deviceId !== 'string' || deviceId.trim().length === 0) {
    return {
      kind: ExtensionConnectionParametersParseKind.Invalid,
      missingParameter: ExtensionConnectionParameter.DeviceId,
    }
  }
  const devicePublicKey = connectionUrl.searchParams.get(
    ExtensionConnectionParameter.DevicePublicKey,
  )
  if (
    typeof devicePublicKey !== 'string' ||
    devicePublicKey.trim().length === 0
  ) {
    return {
      kind: ExtensionConnectionParametersParseKind.Invalid,
      missingParameter: ExtensionConnectionParameter.DevicePublicKey,
    }
  }
  const deviceSigningPublicKey = connectionUrl.searchParams.get(
    ExtensionConnectionParameter.DeviceSigningPublicKey,
  )
  if (
    typeof deviceSigningPublicKey !== 'string' ||
    deviceSigningPublicKey.trim().length === 0
  ) {
    return {
      kind: ExtensionConnectionParametersParseKind.Invalid,
      missingParameter: ExtensionConnectionParameter.DeviceSigningPublicKey,
    }
  }
  const handoffNonce = connectionUrl.searchParams.get(
    ExtensionConnectionParameter.HandoffNonce,
  )
  if (typeof handoffNonce !== 'string' || handoffNonce.trim().length === 0) {
    return {
      kind: ExtensionConnectionParametersParseKind.Invalid,
      missingParameter: ExtensionConnectionParameter.HandoffNonce,
    }
  }
  return {
    kind: ExtensionConnectionParametersParseKind.Valid,
    deviceId,
    devicePublicKey,
    deviceSigningPublicKey,
    handoffNonce,
  }
}

test('creates a passkey from browser-native WASM options after extension messaging', async ({
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

  const userDataDir = testInfo.outputPath('chromium-profile')
  const context = await launchExtensionContext(userDataDir)
  await context.addInitScript(installMockPasskeyRuntime)

  try {
    const popupPage = await setupPasskeyExtensionPopup(context)
    await expect(
      popupPage.getByTestId('connect-simple-vault-btn'),
    ).toBeVisible()
    await expect(popupPage.getByTestId('open-simple-vault-btn')).toHaveCount(0)
    await openSimpleVaultConnection(context, popupPage)
  } finally {
    await context.close()
  }
})

test('uses a passkey-backed extension to create, approve, lock, and unlock a Simple Vault', async ({
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')
  testInfo.setTimeout(180_000)

  const userDataDir =
    process.env.NOOK_EXTENSION_E2E_PROFILE_DIR ||
    testInfo.outputPath('chromium-profile')
  const context = await launchExtensionContext(userDataDir)
  const loginServer = await startLoginServer()
  const website: WebsitePageState = isHostedSmoke
    ? { kind: WebsitePageStateKind.Skipped }
    : { kind: WebsitePageStateKind.Opened, page: await context.newPage() }
  if (website.kind === WebsitePageStateKind.Opened) {
    await website.page.goto(`${loginServer.origin}/login`)
  }
  const websiteAfterUnlock: WebsitePageState = isHostedSmoke
    ? { kind: WebsitePageStateKind.Skipped }
    : { kind: WebsitePageStateKind.Opened, page: await context.newPage() }
  if (websiteAfterUnlock.kind === WebsitePageStateKind.Opened) {
    await websiteAfterUnlock.page.goto(`${loginServer.origin}/login`)
  }
  await context.addInitScript(installMockPasskeyRuntime)

  try {
    const popupPage = await setupPasskeyExtensionPopup(context)
    const extensionId = new URL(popupPage.url()).host
    const simplePage = await openSimpleVaultConnection(context, popupPage)
    const connectUrl = new URL(simplePage.url())
    const connectionParameters = parseExtensionConnectionParameters(connectUrl)
    if (
      connectionParameters.kind ===
      ExtensionConnectionParametersParseKind.Invalid
    ) {
      throw new Error(
        `Extension connection URL omitted ${connectionParameters.missingParameter}.`,
      )
    }
    const extensionDeviceId = connectionParameters.deviceId
    const extensionDevicePublicKey = connectionParameters.devicePublicKey
    const extensionDeviceSigningPublicKey =
      connectionParameters.deviceSigningPublicKey
    const initialHandoffNonce = connectionParameters.handoffNonce

    await advanceCreateVaultWizardToFinalStep(simplePage)
    await simplePage
      .getByTestId('login-vault-name-input')
      .fill(extensionApprovalVaultName)
    await expect(
      simplePage.getByText(
        `Create “${extensionApprovalVaultName}” locally using the extension's protected device key.`,
      ),
    ).toBeVisible()
    await expect(simplePage.getByText(/passkey is required/i)).toHaveCount(0)
    await simplePage.getByTestId('login-create-device-vault-btn').click()
    await expect(simplePage.getByTestId('passkey-auth-overlay')).toHaveCount(0)
    await expect(
      simplePage.getByTestId('extension-connect-consent'),
    ).toBeVisible()
    expect(
      await simplePage.evaluate(
        ({
          extensionId,
          nonce,
          deviceId,
          devicePublicKey,
          deviceSigningPublicKey,
        }) =>
          new Promise((resolve) => {
            chrome.runtime.sendMessage(
              extensionId,
              {
                type: 'nook:extension-identity-handoff-request',
                payload: {
                  recipientPublicKey: 'age1replayattempt',
                  nonce,
                  expectedDeviceId: deviceId,
                  expectedDevicePublicKey: devicePublicKey,
                  expectedDeviceSigningPublicKey: deviceSigningPublicKey,
                },
              },
              resolve,
            )
          }),
        {
          extensionId,
          nonce: initialHandoffNonce,
          deviceId: extensionDeviceId,
          devicePublicKey: extensionDevicePublicKey,
          deviceSigningPublicKey: extensionDeviceSigningPublicKey,
        },
      ),
    ).toEqual({
      ok: false,
      reason: 'extension-identity-handoff-not-issued',
    })
    if (!isHostedSmoke) {
      expect(
        await simplePage.evaluate(
          () =>
            (
              window as Window & {
                __nookVault?: { deviceId?: string }
              }
            ).__nookVault?.deviceId,
        ),
      ).toBe(extensionDeviceId)
    }

    await simplePage.getByTestId('approve-extension-device-btn').click()
    await waitForExtensionPairingReady(
      simplePage,
      async () => {
        const storage = await readExtensionStorage(context)
        return storage[setupStorageKey]
      },
      extensionApprovalVaultName,
    )
    const pairedStorage = await readExtensionStorage(context)
    const pairedGrant = Object.entries(pairedStorage).find(([key]) =>
      key.startsWith('nook:extension-pairing-grant:'),
    )?.[1]
    expect(pairedGrant).toEqual(
      expect.objectContaining({
        vaultName: extensionApprovalVaultName,
        deviceLabel: expect.any(String),
        approvedAt: expect.any(String),
        scopes: expect.arrayContaining([
          ExtensionConnectScope.PasskeyManagement,
          ExtensionConnectScope.PasswordFilling,
        ]),
      }),
    )

    const openedPairingLauncher = context.waitForEvent('page')
    expect(
      await sendExternalMessage(simplePage, extensionId, {
        type: 'nook:open-companion-launcher',
        payload: { intent: OpenCompanionLauncherIntent.Pair },
      }),
    ).toEqual({ ok: true })
    const pairingLauncher = await openedPairingLauncher
    await expect(pairingLauncher).toHaveURL(
      `chrome-extension://${extensionId}/popup/index.html?intent=pair`,
    )
    await expect(
      pairingLauncher.getByTestId('extension-toolbar-menu'),
    ).toBeVisible()
    await expect(
      pairingLauncher.getByTestId('companion-vault-status'),
    ).toHaveText('Vault not connected')
    await expect(
      pairingLauncher.getByTestId('connect-simple-vault-btn'),
    ).toBeVisible()
    await expect(
      pairingLauncher.getByTestId('open-simple-vault-btn'),
    ).toHaveCount(0)
    await expect(
      pairingLauncher.getByText(
        'Pair this browser with Simple Vault to use saved logins and passkeys on websites.',
      ),
    ).toHaveCount(0)

    const reopenedConnectPage = context.waitForEvent('page')
    await pairingLauncher.getByTestId('connect-simple-vault-btn').click()
    const reconnectPage = await reopenedConnectPage
    await expect(reconnectPage).toHaveURL((url) =>
      belongs_to_simple_vault(simpleVaultBaseUrl, url.toString()),
    )
    await reconnectPage.close()
    await pairingLauncher.close()

    enum WebsitePasskeyStateKind {
      NotCreated = 'not-created',
      Created = 'created',
    }

    type WebsitePasskeyState =
      | { kind: WebsitePasskeyStateKind.NotCreated }
      | { kind: WebsitePasskeyStateKind.Created; credentialId: string }
    let websitePasskeyState: WebsitePasskeyState = {
      kind: WebsitePasskeyStateKind.NotCreated,
    }
    if (website.kind === WebsitePageStateKind.Opened) {
      const websiteCredentialId = await registerWebsitePasskeyThroughExtension(
        website.page,
      )
      websitePasskeyState = {
        kind: WebsitePasskeyStateKind.Created,
        credentialId: websiteCredentialId,
      }
      expect(websiteCredentialId).toBeTruthy()
      const websitePasskeyAssertion: WebsitePasskeyAssertionBrowserFlow = {
        page: website.page,
        credentialId: websiteCredentialId,
      }
      await assertWebsitePasskeyThroughExtension(websitePasskeyAssertion)
      await website.page.close()
    }

    await simplePage.getByRole('button', { name: 'Done' }).click()
    await expect(simplePage.getByTestId('authenticated-shell')).toBeVisible()
    await simplePage.close()

    const connectedPopupPage = await context.newPage()
    await connectedPopupPage.goto(
      `chrome-extension://${extensionId}/popup/index.html`,
    )
    await expect(
      connectedPopupPage.getByTestId('extension-toolbar-menu'),
    ).toBeVisible()
    await expect(
      connectedPopupPage.getByTestId('open-simple-vault-btn'),
    ).toBeVisible()
    await expect(
      connectedPopupPage.getByTestId('companion-vault-status'),
    ).toHaveText(`Connected to ${extensionApprovalVaultName}`)
    await expect(
      connectedPopupPage.getByText('Nook extension', { exact: true }),
    ).toBeVisible()
    await expect(
      connectedPopupPage.getByTestId('connect-simple-vault-btn'),
    ).toHaveCount(0)
    await expect(
      connectedPopupPage.getByTestId('pair-another-vault-btn'),
    ).toHaveClass(/menu-secondary-action/)
    const toolbarBounds = await connectedPopupPage
      .getByTestId('extension-toolbar-menu')
      .boundingBox()
    expect(toolbarBounds?.height).toBeLessThan(180)
    const menuLogoBounds = await connectedPopupPage
      .locator('.menu-logo')
      .boundingBox()
    expect(menuLogoBounds?.width).toBeLessThanOrEqual(34)

    const reopenedVaultPagePromise = context.waitForEvent('page')
    await connectedPopupPage.getByTestId('open-simple-vault-btn').click()
    const reopenedVaultPage = await reopenedVaultPagePromise
    await expect(reopenedVaultPage).toHaveURL((url) => {
      const expected = new URL(simpleVaultBaseUrl)
      return (
        url.origin === expected.origin && url.pathname === expected.pathname
      )
    })
    await expect(
      reopenedVaultPage.getByTestId('authenticated-shell'),
    ).toBeVisible({
      timeout: 15_000,
    })
    await expect(
      reopenedVaultPage.getByTestId('passkey-auth-overlay'),
    ).toHaveCount(0)
    if (!isHostedSmoke) {
      expect(
        await reopenedVaultPage.evaluate(
          () =>
            (
              window as Window & {
                __nookVault?: { deviceId?: string }
              }
            ).__nookVault?.deviceId,
        ),
      ).toBe(extensionDeviceId)
    }
    // Reopening a paired vault completes the paired-vault handoff through the
    // strict Rust session payload. The stored grant above deliberately carries
    // routing and display metadata that must not enter that payload.
    await expect
      .poll(async () => {
        const entries = await readPersistedAppLogs(reopenedVaultPage)
        return entries.filter((entry) => {
          if (
            entry.scope !== 'vault-lifecycle' ||
            entry.message !== 'extension identity adopted' ||
            typeof entry.data !== 'string'
          ) {
            return false
          }
          return entry.data.includes(extensionDeviceId)
        }).length
      })
      .toBe(2)

    const emptyOtpPage = await context.newPage()
    await emptyOtpPage.goto(`${loginServer.origin}/otp`)
    const emptyOtpWidget = emptyOtpPage.locator('#nook-auth-widget')
    const emptyAuthenticatorPickerPromise = context.waitForEvent('page')
    await emptyOtpWidget.getByRole('button', { name: 'Fill 2FA code' }).click()
    const emptyAuthenticatorPicker = await emptyAuthenticatorPickerPromise
    await emptyAuthenticatorPicker.waitForURL(/intent=authenticator-picker/)
    await expect(
      emptyAuthenticatorPicker.getByRole('heading', {
        name: 'Choose a 2FA code',
      }),
    ).toBeVisible()
    await expect(
      emptyAuthenticatorPicker.getByTestId('authenticator-destination'),
    ).toContainText(`Code will be filled on ${loginServer.origin}.`)
    await expect(
      emptyAuthenticatorPicker.getByText('No matching 2FA items.'),
    ).toBeVisible()
    await emptyAuthenticatorPicker.close()
    await emptyOtpPage.close()

    await reopenedVaultPage.getByTestId('add-secret-btn').click()
    await reopenedVaultPage.getByTestId('item-type-login').click()
    await reopenedVaultPage.getByTestId('secret-label').fill(loginServer.origin)
    await reopenedVaultPage
      .getByTestId('login-username')
      .fill('alice@nook.test')
    await reopenedVaultPage
      .getByTestId('secret-value')
      .fill('extension-fill-password')
    await reopenedVaultPage.getByTestId('save-secret-btn').click()
    await expect(
      reopenedVaultPage
        .getByTestId('vault-group-login')
        .getByTestId('secret-row'),
    ).toBeVisible({ timeout: 15_000 })

    await reopenedVaultPage.getByTestId('add-secret-btn').click()
    await reopenedVaultPage.getByTestId('item-type-login').click()
    await reopenedVaultPage.getByTestId('secret-label').fill(loginServer.origin)
    await reopenedVaultPage.getByTestId('login-username').fill('bob@nook.test')
    await reopenedVaultPage
      .getByTestId('secret-value')
      .fill('second-extension-password')
    await reopenedVaultPage.getByTestId('save-secret-btn').click()
    await expect(
      reopenedVaultPage
        .getByTestId('vault-group-login')
        .getByTestId('secret-row'),
    ).toHaveCount(2)

    await reopenedVaultPage.getByTestId('add-secret-btn').click()
    await reopenedVaultPage.getByTestId('item-type-authenticator').click()
    await reopenedVaultPage
      .getByTestId('authenticator-issuer')
      .fill('Nook extension e2e')
    await reopenedVaultPage
      .getByTestId('authenticator-account')
      .fill('alice@nook.test')
    await reopenedVaultPage
      .getByTestId('authenticator-secret')
      .fill('JBSWY3DPEHPK3PXP')
    await reopenedVaultPage.getByTestId('save-secret-btn').click()
    await expect(
      reopenedVaultPage
        .getByTestId('vault-group-authenticator')
        .getByTestId('secret-row'),
    ).toBeVisible({ timeout: 15_000 })

    const fillLoginPage = await context.newPage()
    await fillLoginPage.goto(`${loginServer.origin}/login`)
    const fillWidget = fillLoginPage.locator('#nook-auth-widget')
    await expect(fillWidget).toBeVisible()
    const compactLauncher = fillWidget.getByTestId('nook-auth-gate-expand')
    await expect(compactLauncher).toBeVisible({ timeout: 20_000 })
    await compactLauncher.click()
    const fillSavedLogin = fillWidget.getByRole('button', {
      name: 'Fill saved login',
    })
    await expect(fillSavedLogin).toBeVisible({ timeout: 20_000 })
    const loginPickerPromise = context.waitForEvent('page', {
      timeout: 30_000,
    })
    await fillSavedLogin.click()
    await expect(fillWidget.getByText('alice@nook.test')).toHaveCount(0)
    await expect(fillWidget.getByText('bob@nook.test')).toHaveCount(0)
    const loginPicker = await loginPickerPromise
    await loginPicker.waitForURL(/intent=login-picker/)
    await expect(loginPicker.getByText('alice@nook.test')).toBeVisible({
      timeout: 20_000,
    })
    await expect(loginPicker.getByText('bob@nook.test')).toBeVisible()
    await loginPicker.getByRole('button', { name: /alice@nook\.test/ }).click()
    await expect
      .poll(
        async () =>
          fillLoginPage.evaluate(() => {
            const submittedLogin = (
              window as Window & {
                __nookLoginSubmitted?: {
                  email: string
                  password: string
                }
              }
            ).__nookLoginSubmitted
            return Boolean(submittedLogin) && typeof submittedLogin === 'object'
          }),
        { timeout: 20_000 },
      )
      .toBe(true)
    const submittedLogin = await fillLoginPage.evaluate(
      () =>
        (
          window as Window & {
            __nookLoginSubmitted?: {
              email: string
              password: string
            }
          }
        ).__nookLoginSubmitted,
    )
    expect(submittedLogin).toEqual({
      email: 'alice@nook.test',
      password: 'extension-fill-password',
    })
    await expect.poll(() => loginPicker.isClosed()).toBe(true)
    await expect(fillWidget.getByText('Nook Pilot · 3/3')).toBeVisible()
    await expect(fillWidget.getByText('Verifying sign-in')).toBeVisible()
    await expect(
      fillWidget.getByText(
        'Credentials were submitted. Nook is waiting for the site response.',
      ),
    ).toBeVisible()
    await fillLoginPage.close()

    const otpPage = await context.newPage()
    await otpPage.goto(`${loginServer.origin}/otp`)
    const otpWidget = otpPage.locator('#nook-auth-widget')
    await expect(otpWidget.getByText('Fill your 2FA code')).toBeVisible()
    const authenticatorPickerPromise = context.waitForEvent('page')
    await otpWidget.getByRole('button', { name: 'Fill 2FA code' }).click()
    await expect(otpWidget.getByText('Nook extension e2e')).toHaveCount(0)
    await expect(otpWidget.getByText('alice@nook.test')).toHaveCount(0)
    const authenticatorPicker = await authenticatorPickerPromise
    await authenticatorPicker.waitForURL(/intent=authenticator-picker/)
    await expect(
      authenticatorPicker.getByText('Nook extension e2e'),
    ).toBeVisible({ timeout: 20_000 })
    await authenticatorPicker
      .getByRole('button', { name: /Nook extension e2e/ })
      .click()
    await expect(otpPage.locator('[autocomplete="one-time-code"]')).toHaveValue(
      /^\d{6}$/,
    )
    await expect.poll(() => authenticatorPicker.isClosed()).toBe(true)
    await expect(otpWidget.getByText('Nook Pilot · 2/3')).toBeVisible()
    await expect(
      otpWidget.getByText(
        'The code is filled. Review the site and submit it manually.',
      ),
    ).toBeVisible()
    await otpPage.close()

    await reopenedVaultPage.getByTestId('header-lock-vault-btn').click()
    await expect(
      reopenedVaultPage.getByTestId('login-local-unlock-step'),
    ).toBeVisible({ timeout: EXTENSION_UNLOCK_TIMEOUT_MS })

    const firstUnlock: PairedVaultCompanionUnlock = {
      context,
      vaultPage: reopenedVaultPage,
      companionUnlock: PairedVaultCompanionUnlockKind.Optional,
      extensionId,
    }
    await unlockPairedVaultThroughCompanion(firstUnlock)
    if (!isHostedSmoke) {
      expect(
        await reopenedVaultPage.evaluate(
          () =>
            (
              window as Window & {
                __nookVault?: { deviceId?: string }
              }
            ).__nookVault?.deviceId,
        ),
      ).toBe(extensionDeviceId)
    }
    await expect
      .poll(async () => {
        const entries = await readPersistedAppLogs(reopenedVaultPage)
        return entries.filter((entry) => {
          if (
            entry.scope !== 'vault-lifecycle' ||
            entry.message !== 'extension identity adopted' ||
            typeof entry.data !== 'string'
          ) {
            return false
          }
          return entry.data.includes(extensionDeviceId)
        }).length
      })
      .toBe(3)
    if (
      websiteAfterUnlock.kind === WebsitePageStateKind.Opened &&
      websitePasskeyState.kind === WebsitePasskeyStateKind.Created
    ) {
      const websitePasskeyAssertion: WebsitePasskeyAssertionBrowserFlow = {
        page: websiteAfterUnlock.page,
        credentialId: websitePasskeyState.credentialId,
      }
      await assertWebsitePasskeyThroughExtension(websitePasskeyAssertion)
      await websiteAfterUnlock.page.close()
    }
    await attachNookLogsForTest(reopenedVaultPage, testInfo)

    await context.close()
    const restartedContext = await chromium.launchPersistentContext(
      userDataDir,
      {
        headless: false,
        ...(chromiumExecutablePath
          ? { executablePath: chromiumExecutablePath }
          : {}),
        args: [
          `--disable-extensions-except=${extensionDir}`,
          `--load-extension=${extensionDir}`,
        ],
      },
    )
    await restartedContext.addInitScript(installMockPasskeyRuntime)
    try {
      const restartedWorker = await getServiceWorker(restartedContext)
      const restartedExtensionId = new URL(restartedWorker.url()).host
      expect(restartedExtensionId).toBe(extensionId)

      const lockedVaultPage = await restartedContext.newPage()
      await lockedVaultPage.goto(simpleVaultBaseUrl)
      await expect(
        lockedVaultPage.getByTestId('login-local-unlock-step'),
      ).toBeVisible({ timeout: EXTENSION_UNLOCK_TIMEOUT_MS })

      const restartedUnlock: PairedVaultCompanionUnlock = {
        context: restartedContext,
        vaultPage: lockedVaultPage,
        companionUnlock: PairedVaultCompanionUnlockKind.Required,
        extensionId: restartedExtensionId,
      }
      await unlockPairedVaultThroughCompanion(restartedUnlock)
      await expect(
        lockedVaultPage.getByTestId('passkey-auth-overlay'),
      ).toHaveCount(0)
    } finally {
      await restartedContext.close()
    }
  } finally {
    await context.close()
    await loginServer.close()
  }
})

test('accepts the pairing grant after the extension session was locked', async ({
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')
  test.skip(isHostedSmoke, 'Hosted smoke keeps a warm unlocked session')
  testInfo.setTimeout(180_000)

  const userDataDir = testInfo.outputPath('chromium-profile-locked-handoff')
  const context = await launchExtensionContext(userDataDir)
  await context.addInitScript(installMockPasskeyRuntime)

  try {
    const popupPage = await setupPasskeyExtensionPopup(context)
    const simplePage = await openSimpleVaultConnection(context, popupPage)

    await advanceCreateVaultWizardToFinalStep(simplePage)
    await simplePage
      .getByTestId('login-vault-name-input')
      .fill('Locked session handoff vault')
    await simplePage.getByTestId('login-create-device-vault-btn').click()
    await expect(
      simplePage.getByTestId('extension-connect-consent'),
    ).toBeVisible()

    // Close the offscreen session before Approve. The grant handoff must still
    // import the event log without requiring an unlocked save_auth_providers_snapshot path.
    await lockExtensionSession(context)

    await simplePage.getByTestId('approve-extension-device-btn').click()
    await waitForExtensionPairingReady(
      simplePage,
      async () => {
        const storage = await readExtensionStorage(context)
        return storage[setupStorageKey]
      },
      'Locked session handoff vault',
    )
    await expect(
      simplePage.getByTestId('extension-connect-approved'),
    ).toBeVisible()
    await expect(
      simplePage.getByTestId('extension-connect-consent').getByRole('alert'),
    ).toHaveCount(0)
  } finally {
    await context.close()
  }
})

test('re-approves an existing local vault after reload without event-log-access-not-granted', async ({
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')
  test.skip(isHostedSmoke, 'Hosted smoke keeps a warm unlocked session')
  testInfo.setTimeout(180_000)

  const vaultName = 'Existing vault re-pair'
  const userDataDir = testInfo.outputPath('chromium-profile-existing-repair')
  const context = await launchExtensionContext(userDataDir)
  await context.addInitScript(installMockPasskeyRuntime)

  try {
    // Match the user path: existing Simple Vault (local passkey) first, then
    // Connect from the extension. Unlock must work without a pairing grant.
    const popupPage = await setupPasskeyExtensionPopup(context)
    const simplePage = await context.newPage()
    await simplePage.goto(simpleVaultBaseUrl)
    await createLocalVaultOnLogin(simplePage, vaultName, 'authenticated-shell')

    const worker = await getServiceWorker(context)
    const extensionId = new URL(worker.url()).host
    // Extension popups close after Connect opens Simple Vault — always use a
    // fresh page for pairing instead of reusing the setup popup.
    await popupPage.close()
    const pairPopup = await context.newPage()
    const openedConnect = context.waitForEvent('page', {
      timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
    })
    await pairPopup.goto(
      `chrome-extension://${extensionId}/popup/index.html?intent=pair`,
    )
    await expect(pairPopup.getByTestId('connect-simple-vault-btn')).toBeVisible(
      { timeout: EXTENSION_UNLOCK_TIMEOUT_MS },
    )
    await pairPopup.getByTestId('connect-simple-vault-btn').click()
    const connectPage = await openedConnect
    await expect(connectPage).toHaveURL((url) =>
      belongs_to_simple_vault(simpleVaultBaseUrl, url.toString()),
    )

    const consent = connectPage.getByTestId('extension-connect-consent')
    const unlockStep = connectPage.getByTestId('login-local-unlock-step')
    await expect(consent.or(unlockStep)).toBeVisible({
      timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
    })
    if (await unlockStep.isVisible()) {
      await connectPage.getByTestId('unlock-vault-btn').click()
      const passkeyOverlay = connectPage.getByTestId('passkey-auth-overlay')
      if (await passkeyOverlay.isVisible()) {
        await connectPage.getByTestId('device-protection-unlock-btn').click()
      }
      await expect(consent).toBeVisible({
        timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
      })
    }

    await connectPage.getByTestId('approve-extension-device-btn').click()
    await waitForExtensionPairingReady(
      connectPage,
      async () => {
        const storage = await readExtensionStorage(context)
        return storage[setupStorageKey]
      },
      vaultName,
    )
    await expect(
      connectPage.getByTestId('extension-connect-approved'),
    ).toBeVisible()
    await connectPage.getByRole('button', { name: 'Done' }).click()

    const pairedStorage = await readExtensionStorage(context)
    const grantKeys = Object.keys(pairedStorage).filter((key) =>
      key.startsWith('nook:extension-pairing-grant:'),
    )
    expect(grantKeys.length).toBeGreaterThan(0)
    await removeExtensionStorageKeys(context, grantKeys)

    // Reload so the website manager must restore its signing seed from
    // IndexedDB, then unlock with the local website passkey and re-approve.
    await simplePage.goto(simpleVaultBaseUrl)
    const reloadedShell = simplePage.getByTestId('authenticated-shell')
    const reloadedUnlock = simplePage.getByTestId('login-local-unlock-step')
    await expect(reloadedShell.or(reloadedUnlock)).toBeVisible({
      timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
    })
    if (await reloadedUnlock.isVisible()) {
      await simplePage.getByTestId('unlock-vault-btn').click()
      const reloadOverlay = simplePage.getByTestId('passkey-auth-overlay')
      if (await reloadOverlay.isVisible()) {
        await simplePage.getByTestId('device-protection-unlock-btn').click()
      }
      await expect(reloadedShell).toBeVisible({
        timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
      })
    }

    const repairPopup = await context.newPage()
    const reopenedConnect = context.waitForEvent('page', {
      timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
    })
    await repairPopup.goto(
      `chrome-extension://${extensionId}/popup/index.html?intent=pair`,
    )
    await expect(
      repairPopup.getByTestId('connect-simple-vault-btn'),
    ).toBeVisible({ timeout: EXTENSION_UNLOCK_TIMEOUT_MS })
    await repairPopup.getByTestId('connect-simple-vault-btn').click()
    const reconnectPage = await reopenedConnect
    await expect(reconnectPage).toHaveURL((url) =>
      belongs_to_simple_vault(simpleVaultBaseUrl, url.toString()),
    )

    const reconnectConsent = reconnectPage.getByTestId(
      'extension-connect-consent',
    )
    const reconnectUnlock = reconnectPage.getByTestId('login-local-unlock-step')
    await expect(reconnectConsent.or(reconnectUnlock)).toBeVisible({
      timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
    })
    if (await reconnectUnlock.isVisible()) {
      await reconnectPage.getByTestId('unlock-vault-btn').click()
      const reconnectOverlay = reconnectPage.getByTestId('passkey-auth-overlay')
      if (await reconnectOverlay.isVisible()) {
        await reconnectPage.getByTestId('device-protection-unlock-btn').click()
      }
      await expect(reconnectConsent).toBeVisible({
        timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
      })
    }

    await reconnectPage.getByTestId('approve-extension-device-btn').click()
    await waitForExtensionPairingReady(
      reconnectPage,
      async () => {
        const storage = await readExtensionStorage(context)
        return storage[setupStorageKey]
      },
      vaultName,
    )
    await expect(
      reconnectPage.getByTestId('extension-connect-approved'),
    ).toBeVisible()
    await expect(
      reconnectPage.getByTestId('extension-connect-consent').getByRole('alert'),
    ).toHaveCount(0)
    await expect(
      reconnectPage.getByText('event-log-access-not-granted'),
    ).toHaveCount(0)
    await expect(
      reconnectPage.getByText(
        'The extension did not accept the Simple Vault pairing grant.',
      ),
    ).toHaveCount(0)
  } finally {
    await context.close()
  }
})

test('reuses the offscreen session after the service worker restarts', async ({
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')
  test.skip(isHostedSmoke, 'Hosted smoke keeps a warm unlocked session')
  testInfo.setTimeout(120_000)

  const userDataDir = testInfo.outputPath('chromium-profile-worker-restart')
  const context = await launchExtensionContext(userDataDir)
  await context.addInitScript(installMockPasskeyRuntime)

  try {
    const popupPage = await setupPasskeyExtensionPopup(context)
    const worker = await getServiceWorker(context)
    const cdp = await context.newCDPSession(popupPage)
    const { targetInfos } = await cdp.send('Target.getTargets')
    const workerTarget = targetInfos.find(
      (target) =>
        target.type === 'service_worker' && target.url === worker.url(),
    )
    if (!workerTarget) {
      throw new Error('Expected the active extension service worker target')
    }
    await expect(
      cdp.send('Target.closeTarget', {
        targetId: workerTarget.targetId,
      }),
    ).resolves.toEqual({ success: true })

    await popupPage.reload()
    await expect
      .poll(
        async () => {
          const restartedTargets = await cdp.send('Target.getTargets')
          return restartedTargets.targetInfos.some(
            (target) =>
              target.type === 'service_worker' && target.url === worker.url(),
          )
        },
        { timeout: 15_000 },
      )
      .toBe(true)
    await expect(popupPage.getByTestId('extension-toolbar-menu')).toBeVisible({
      timeout: 15_000,
    })
  } finally {
    await context.close()
  }
})
