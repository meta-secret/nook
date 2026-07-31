import { chromium, expect, test, type Page } from '@playwright/test'
import {
  assertWebsitePasskey,
  attachNookLogsForTest,
  advanceCreateVaultWizardToFinalStep,
  belongsToSimpleVault,
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
  registerWebsitePasskey,
  sendExternalMessage,
  setupPasskeyExtensionPopup,
  setupStorageKey,
  simpleVaultBaseUrl,
  startLoginServer,
  waitForExtensionPairingReady,
} from './helpers/extension-smoke-runtime'
import { ExtensionConnectScope } from '../../nook-web-shared/src/extension/extension-connect-scope'

const chromiumExecutablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim() ?? ''

enum WebsitePageStateKind {
  Skipped = 'skipped',
  Opened = 'opened',
}

type WebsitePageState =
  | { kind: WebsitePageStateKind.Skipped }
  | { kind: WebsitePageStateKind.Opened; page: Page }

test('creates a passkey from browser-native WASM options after extension messaging', async ({
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

  const userDataDir = testInfo.outputPath('chromium-profile')
  const context = await launchExtensionContext(userDataDir)
  await context.addInitScript(installMockPasskeyRuntime)

  try {
    const popupPage = await setupPasskeyExtensionPopup(context)
    await expect(popupPage.getByTestId('open-simple-vault-btn')).toBeVisible()
    await expect(popupPage.getByTestId('stay-as-companion-btn')).toBeVisible()
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
    const extensionDeviceId = connectUrl.searchParams.get('device_id')
    const extensionDevicePublicKey =
      connectUrl.searchParams.get('device_public_key')
    const extensionDeviceSigningPublicKey = connectUrl.searchParams.get(
      'device_signing_public_key',
    )
    const initialHandoffNonce = connectUrl.searchParams.get('nonce')
    expect(extensionDeviceId).toBeTruthy()
    expect(extensionDevicePublicKey).toBeTruthy()
    expect(extensionDeviceSigningPublicKey).toBeTruthy()
    expect(initialHandoffNonce).toBeTruthy()

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
        payload: { intent: 'pair' },
      }),
    ).toEqual({ ok: true })
    const pairingLauncher = await openedPairingLauncher
    await expect(pairingLauncher).toHaveURL(
      `chrome-extension://${extensionId}/popup/index.html?intent=pair`,
    )
    await expect(
      pairingLauncher.getByTestId('extension-companion-home'),
    ).toBeVisible()
    await expect(
      pairingLauncher.getByTestId('companion-vault-status'),
    ).toHaveAttribute('data-connected', 'false')
    await expect(
      pairingLauncher.getByTestId('connect-simple-vault-btn'),
    ).toBeVisible()

    const reopenedConnectPage = context.waitForEvent('page')
    await pairingLauncher.getByTestId('connect-simple-vault-btn').click()
    const reconnectPage = await reopenedConnectPage
    await expect(reconnectPage).toHaveURL((url) =>
      belongsToSimpleVault(simpleVaultBaseUrl, url.toString()),
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
      const websiteCredentialId = await registerWebsitePasskey(website.page)
      websitePasskeyState = {
        kind: WebsitePasskeyStateKind.Created,
        credentialId: websiteCredentialId,
      }
      expect(websiteCredentialId).toBeTruthy()
      await assertWebsitePasskey(website.page, websiteCredentialId)
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
      connectedPopupPage.getByTestId('extension-companion-home'),
    ).toBeVisible()
    await expect(
      connectedPopupPage.getByTestId('stay-as-companion-btn'),
    ).toBeVisible()
    await expect(
      connectedPopupPage.getByTestId('open-simple-vault-btn'),
    ).toBeVisible()

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
    const loginPickerPromise = context.waitForEvent('page')
    await fillWidget.getByRole('button', { name: 'Continue with Nook' }).click()
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

    await reopenedVaultPage.getByTestId('unlock-vault-btn').click()

    await expect(
      reopenedVaultPage.getByTestId('passkey-auth-overlay'),
    ).toHaveCount(0)
    await expect(
      reopenedVaultPage.getByTestId('authenticated-shell'),
    ).toBeVisible()
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
        return (entries ?? []).filter(
          (entry) =>
            entry.scope === 'vault-lifecycle' &&
            entry.message === 'extension identity adopted' &&
            entry.data?.includes(extensionDeviceId ?? '') === true,
        ).length
      })
      .toBe(3)
    if (
      websiteAfterUnlock.kind === WebsitePageStateKind.Opened &&
      websitePasskeyState.kind === WebsitePasskeyStateKind.Created
    ) {
      await assertWebsitePasskey(
        websiteAfterUnlock.page,
        websitePasskeyState.credentialId,
      )
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

      const extensionAuthWindowPromise = restartedContext.waitForEvent('page')
      await lockedVaultPage.getByTestId('unlock-vault-btn').click()
      const extensionAuthWindow = await extensionAuthWindowPromise
      await expect(extensionAuthWindow).toHaveURL(
        `chrome-extension://${restartedExtensionId}/popup/index.html`,
      )
      await expect(
        extensionAuthWindow.getByTestId('extension-device-setup'),
      ).toBeVisible()
      await expect(
        lockedVaultPage.getByTestId('passkey-auth-overlay'),
      ).toHaveCount(0)

      await extensionAuthWindow
        .getByTestId('device-protection-unlock-btn')
        .click()
      await expect(
        extensionAuthWindow.getByTestId('extension-companion-home'),
      ).toBeVisible()
      await expect(
        extensionAuthWindow.getByTestId('stay-as-companion-btn'),
      ).toBeVisible()
      await expect(
        lockedVaultPage.getByTestId('authenticated-shell'),
      ).toBeVisible({ timeout: 15_000 })
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
    // import the event log without requiring an unlocked saveAuthProviders path.
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

test('re-approves an existing vault after reload without event-log-access-not-granted', async ({
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
    const popupPage = await setupPasskeyExtensionPopup(context)
    const simplePage = await openSimpleVaultConnection(context, popupPage)

    await advanceCreateVaultWizardToFinalStep(simplePage)
    await simplePage.getByTestId('login-vault-name-input').fill(vaultName)
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
      vaultName,
    )
    await simplePage.getByRole('button', { name: 'Done' }).click()
    await expect(simplePage.getByTestId('authenticated-shell')).toBeVisible({
      timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
    })

    // Forget the extension-side grant only. The website vault and its persisted
    // signing identity must remain so Approve can mint an authorized JoinApproved.
    const pairedStorage = await readExtensionStorage(context)
    const grantKeys = Object.keys(pairedStorage).filter((key) =>
      key.startsWith('nook:extension-pairing-grant:'),
    )
    await removeExtensionStorageKeys(context, [...grantKeys, setupStorageKey])

    // Reload Simple Vault so the manager must restore the signing seed from
    // IndexedDB instead of the original in-memory identity handoff.
    await simplePage.reload()
    const postReloadShell = simplePage.getByTestId('authenticated-shell')
    const postReloadUnlock = simplePage.getByTestId('login-local-unlock-step')
    await expect(postReloadShell.or(postReloadUnlock)).toBeVisible({
      timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
    })
    if (await postReloadUnlock.isVisible()) {
      await simplePage.getByTestId('unlock-vault-btn').click()
      await expect(postReloadShell).toBeVisible({
        timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
      })
    }

    const worker = await getServiceWorker(context)
    const extensionId = new URL(worker.url()).host
    const pairPopup = await context.newPage()
    await pairPopup.goto(
      `chrome-extension://${extensionId}/popup/index.html?intent=pair`,
    )
    await expect(pairPopup.getByTestId('connect-simple-vault-btn')).toBeVisible(
      { timeout: EXTENSION_UNLOCK_TIMEOUT_MS },
    )
    const reopenedConnect = context.waitForEvent('page')
    await pairPopup.getByTestId('connect-simple-vault-btn').click()
    const reconnectPage = await reopenedConnect
    await expect(reconnectPage).toHaveURL((url) =>
      belongsToSimpleVault(simpleVaultBaseUrl, url.toString()),
    )

    const consent = reconnectPage.getByTestId('extension-connect-consent')
    const unlockStep = reconnectPage.getByTestId('login-local-unlock-step')
    await expect(consent.or(unlockStep)).toBeVisible({
      timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
    })
    if (await unlockStep.isVisible()) {
      await reconnectPage.getByTestId('unlock-vault-btn').click()
      await expect(consent).toBeVisible({
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
    await expect(popupPage.getByTestId('extension-companion-home')).toBeVisible(
      { timeout: 15_000 },
    )
  } finally {
    await context.close()
  }
})
