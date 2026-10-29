import { chromium, expect, test, type Page } from '@playwright/test'
import {
  PasskeyVaultDiscovery,
  WebsitePasskeyStateKind,
  type WebsitePasskeyState,
} from './helpers/passkey-vault-discovery'
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
  openSimpleVaultConnection,
  readExtensionStorage,
  removeExtensionStorageKeys,
  createWebsiteIdentityForConnect,
  registerWebsitePasskeyThroughExtension,
  sendExternalMessage,
  setupPasskeyExtensionPopup,
  setupStorageKey,
  simpleVaultBaseUrl,
  startLoginServer,
  stopExtensionServiceWorker,
  waitForExtensionPairingReady,
  waitForNewPage,
  reuseNookTabForConnect,
  reconnectVaultFromPairingLauncher,
  withE2eDeadline,
  type WebsitePasskeyAssertionBrowserFlow,
} from './helpers/extension-smoke-runtime'
import {
  expectVaultOpened,
  startVaultPanelUnlock,
  unlockExtensionThroughCompanion,
} from './helpers/paired-vault-companion-unlock'
import { ExtensionConnectScope } from '../../nook-web-shared/src/extension/extension-connect-scope'
import { OpenCompanionLauncherIntent } from '../../nook-web-shared/src/extension/companion-launcher-message'
import {
  authorizeDeviceProtection,
  createLocalVaultOnLogin,
} from '../../nook-web-app/e2e/helpers'
import { RealSidePanel } from './helpers/real-side-panel'

const chromiumExecutablePath = ((v) => (v ? v : ''))(
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim(),
)
test.use({ trace: 'retain-on-failure' })
enum ExtensionAppLogAttachmentName {
  Restarted = 'restarted-extension-nook-app-logs.json',
}
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
  return {
    kind: ExtensionConnectionParametersParseKind.Valid,
    deviceId,
    devicePublicKey,
    deviceSigningPublicKey,
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
    await expect(popupPage.getByTestId('open-simple-vault-btn')).toBeVisible()
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
  const context = await test.step('launch extension session', () =>
    launchExtensionContext(userDataDir))
  const loginServer = await test.step('start credential fixture', () =>
    startLoginServer())
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
    const popupPage = await test.step('prepare extension device identity', () =>
      setupPasskeyExtensionPopup(context))
    const extensionId = new URL(popupPage.url()).host
    const simplePage = await test.step('open Simple Vault pairing', () =>
      openSimpleVaultConnection(context, popupPage))
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

    // The website runs its own first run: its own passkey makes its own app
    // key, and the extension is then approved as another app.
    await advanceCreateVaultWizardToFinalStep(simplePage)
    await createWebsiteIdentityForConnect(simplePage)
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
      ).not.toBe(extensionDeviceId)
    }

    await simplePage.getByTestId('approve-extension-device-btn').click()
    await test.step('admit pairing grant', async () => {
      await waitForExtensionPairingReady(
        simplePage,
        async () => {
          const storage = await readExtensionStorage(context)
          return storage[setupStorageKey]
        },
        extensionApprovalVaultName,
      )
    })
    const pairedStorage = await readExtensionStorage(context)
    const pairedGrant = Object.entries(pairedStorage).find(([key]) =>
      key.startsWith('nook:extension-pairing-grant:'),
    )?.[1]
    expect(pairedGrant).toEqual(
      expect.objectContaining({
        vaultName: extensionApprovalVaultName,
        deviceLabel: expect.any(String),
        approvedAt: expect.any(Number),
        scopes: expect.arrayContaining([
          ExtensionConnectScope.PasskeyManagement,
          ExtensionConnectScope.PasswordFilling,
        ]),
      }),
    )

    const [launcherResponse, pairingLauncher] = await Promise.all([
      sendExternalMessage(simplePage, extensionId, {
        type: 'nook:open-companion-launcher',
        payload: { intent: OpenCompanionLauncherIntent.Pair },
      }),
      waitForNewPage(context, 'extension pairing launcher'),
    ])
    expect(launcherResponse).toEqual({ ok: true })
    await expect(pairingLauncher).toHaveURL(
      `chrome-extension://${extensionId}/popup/index.html?intent=pair`,
    )
    await expect(
      pairingLauncher.getByTestId('extension-toolbar-menu'),
    ).toBeVisible({ timeout: EXTENSION_UNLOCK_TIMEOUT_MS })
    await expect(pairingLauncher.getByTestId('companion-vaults')).toBeVisible()
    await expect(
      pairingLauncher.getByTestId('connect-simple-vault-btn'),
    ).toBeVisible()

    const reconnectRequest: Parameters<
      typeof reconnectVaultFromPairingLauncher
    >[0] = { context, simplePage, pairingLauncher }
    await reconnectVaultFromPairingLauncher(reconnectRequest)
    // Back to the vault: the website unlocks it with its own passkey.
    await simplePage.goto(simpleVaultBaseUrl)

    let websitePasskeyState: WebsitePasskeyState = {
      kind: WebsitePasskeyStateKind.NotCreated,
    }
    if (website.kind === WebsitePageStateKind.Opened) {
      const websiteCredentialId =
        await test.step('register website passkey through extension', () =>
          registerWebsitePasskeyThroughExtension(website.page))
      websitePasskeyState = {
        kind: WebsitePasskeyStateKind.Created,
        credentialId: websiteCredentialId,
      }
      expect(websiteCredentialId).toBeTruthy()
      const websitePasskeyAssertion: WebsitePasskeyAssertionBrowserFlow = {
        page: website.page,
        credentialId: websiteCredentialId,
      }
      await test.step('assert website passkey through extension', () =>
        assertWebsitePasskeyThroughExtension(websitePasskeyAssertion))
      await website.page.close()
    }

    // Reopened from its address, the vault asks for the website's own
    // passkey; the extension is never asked for its key.
    await authorizeDeviceProtection(simplePage)
    await expect(simplePage).toHaveURL((url) => url.pathname.endsWith('/vault'))
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

    const [reopenedVaultPage] = await Promise.all([
      waitForNewPage(context, 'reopened paired-vault page'),
      connectedPopupPage.getByTestId('open-simple-vault-btn').click(),
    ])
    await expect(reopenedVaultPage).toHaveURL((url) => {
      const expected = new URL(simpleVaultBaseUrl)
      return (
        url.origin === expected.origin && url.pathname === expected.pathname
      )
    })
    // The unlocked extension opens the page; the page unlocks its own key.
    await authorizeDeviceProtection(reopenedVaultPage)
    await expect(
      reopenedVaultPage.getByTestId('authenticated-shell'),
    ).toBeVisible({
      timeout: 15_000,
    })
    await expect(
      reopenedVaultPage.getByTestId('passkey-auth-overlay'),
    ).toHaveCount(0)
    try {
      await new PasskeyVaultDiscovery(reopenedVaultPage).assert(
        websitePasskeyState,
      )
    } finally {
      await attachNookLogsForTest(reopenedVaultPage, testInfo, { print: true })
    }
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
      ).not.toBe(extensionDeviceId)
    }

    await test.step('present empty authenticator picker', async () => {
      await unlockExtensionThroughCompanion({ context, extensionId })
      const emptyOtpPage = await context.newPage()
      await emptyOtpPage.goto(`${loginServer.origin}/otp`)
      const emptyOtpWidget = emptyOtpPage.locator('#nook-auth-widget')
      await emptyOtpWidget
        .getByRole('button', { name: 'Fill 2FA code' })
        .click()
      // The click opens the real side panel, with nothing to offer yet.
      const sidePanel = await RealSidePanel.attach(userDataDir)
      try {
        const emptyPicker = sidePanel.page.getByTestId('authenticator-picker')
        await expect(
          emptyPicker.getByRole('heading', { name: /Choose a 2FA code/ }),
        ).toBeVisible()
        await expect(
          emptyPicker.getByTestId('authenticator-destination'),
        ).toContainText(`Code will be filled on ${loginServer.origin}.`)
        await expect(
          emptyPicker.getByText('No matching 2FA items.'),
        ).toBeVisible()
        await emptyPicker.getByTestId('authenticator-cancel').click()
        await expect(emptyPicker).toHaveCount(0)
      } finally {
        await sidePanel.detach()
      }
      await emptyOtpPage.close()
    })

    await test.step('save website credentials in paired vault', async () => {
      await reopenedVaultPage.getByTestId('add-secret-btn').click()
      await reopenedVaultPage.getByTestId('item-type-login').click()
      await reopenedVaultPage
        .getByTestId('secret-label')
        .fill(loginServer.origin)
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
      await reopenedVaultPage
        .getByTestId('secret-label')
        .fill(loginServer.origin)
      await reopenedVaultPage
        .getByTestId('login-username')
        .fill('bob@nook.test')
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
    })

    await test.step('fill website password through extension', async () => {
      await unlockExtensionThroughCompanion({ context, extensionId })
      const fillLoginPage = await context.newPage()
      await fillLoginPage.goto(`${loginServer.origin}/login`)
      const fillWidget = fillLoginPage.locator('#nook-auth-widget')
      await expect(fillWidget).toBeVisible()
      const pageCount = context.pages().length
      await fillWidget.getByRole('button', { name: 'Sign in' }).click()
      const inlinePicker = fillWidget.getByTestId('nook-inline-login-picker')
      await expect(inlinePicker).toBeVisible()
      const loginPicker = inlinePicker.contentFrame()
      await expect(fillWidget.getByText('alice@nook.test')).toHaveCount(0)
      await expect(fillWidget.getByText('bob@nook.test')).toHaveCount(0)
      await expect(loginPicker.getByText('alice@nook.test')).toBeVisible({
        timeout: 20_000,
      })
      await expect(loginPicker.getByText('bob@nook.test')).toBeVisible()
      expect(context.pages()).toHaveLength(pageCount)
      await loginPicker
        .getByRole('button', { name: /alice@nook\.test/ })
        .click()
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
              return (
                Boolean(submittedLogin) && typeof submittedLogin === 'object'
              )
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
      await expect(inlinePicker).toHaveCount(0)
      await expect(fillWidget.getByText('Nook Pilot · 3/3')).toBeVisible()
      const checklist = fillWidget.getByTestId('nook-auth-checklist')
      await expect(checklist).toHaveAttribute('data-status', 'Waiting')
      await expect(checklist).toContainText('Form submission observed')
      await expect(checklist).toContainText('Waiting for the site’s response')
      await fillLoginPage.close()
    })

    await test.step('fill authenticator code through extension', async () => {
      await unlockExtensionThroughCompanion({ context, extensionId })
      const otpPage = await context.newPage()
      await otpPage.goto(`${loginServer.origin}/otp`)
      const otpWidget = otpPage.locator('#nook-auth-widget')
      await expect(otpWidget.getByText('Fill your 2FA code')).toBeVisible()
      await otpWidget.getByRole('button', { name: 'Fill 2FA code' }).click()
      await expect(otpWidget.getByText('Nook extension e2e')).toHaveCount(0)
      await expect(otpWidget.getByText('alice@nook.test')).toHaveCount(0)
      // The click opens the real side panel, where the item is chosen.
      const sidePanel = await RealSidePanel.attach(userDataDir)
      try {
        const picker = sidePanel.page.getByTestId('authenticator-picker')
        await expect(picker.getByText('Nook extension e2e')).toBeVisible({
          timeout: 20_000,
        })
        // The panel lists the request before this page has registered it; a
        // choice made before then is refused.
        await expect(
          otpWidget.getByText(
            'Choose a 2FA item in the Nook side panel. You can search all 2FA items in your vault.',
          ),
        ).toBeVisible()
        await picker.getByRole('button', { name: /Nook extension e2e/ }).click()
        await expect(
          otpPage.locator('[autocomplete="one-time-code"]'),
        ).toHaveValue(/^\d{6}$/)
        await expect(picker).toHaveCount(0)
      } finally {
        await sidePanel.detach()
      }
      await expect(otpWidget.getByText('Nook Pilot · 2/3')).toBeVisible()
      await expect(
        otpWidget.getByText(
          'The code is filled. Review the site and submit it manually.',
        ),
      ).toBeVisible()
      await otpPage.close()
    })

    await reopenedVaultPage.getByTestId('header-lock-vault-btn').click()
    await expect(
      reopenedVaultPage.getByTestId('identity-vault-row').first(),
    ).toBeVisible({ timeout: EXTENSION_UNLOCK_TIMEOUT_MS })

    // The page's Lock locks the page alone: it holds its own key, and its
    // own passkey opens the vault again.
    await test.step('unlock the vault with the website passkey', () =>
      authorizeDeviceProtection(reopenedVaultPage))
    await expect(
      reopenedVaultPage.getByTestId('authenticated-shell'),
    ).toBeVisible({ timeout: EXTENSION_UNLOCK_TIMEOUT_MS })
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
      ).not.toBe(extensionDeviceId)
    }
    if (
      websiteAfterUnlock.kind === WebsitePageStateKind.Opened &&
      websitePasskeyState.kind === WebsitePasskeyStateKind.Created
    ) {
      console.log('[extension e2e] reopening companion for website assertion')
      await unlockExtensionThroughCompanion({ context, extensionId })
      console.log('[extension e2e] companion ready for website assertion')
      const websiteWidget = websiteAfterUnlock.page.locator('#nook-auth-widget')
      await withE2eDeadline(
        websiteAfterUnlock.page.reload(),
        'reload website after companion unlock',
      )
      await withE2eDeadline(
        expect(websiteWidget).toBeVisible(),
        'wait for widget after companion-unlock reload',
      )
      console.log('[extension e2e] widget wait complete')
      const pageCount = context.pages().length
      await websiteWidget.getByRole('button', { name: 'Sign in' }).click()
      console.log('[extension e2e] Continue click complete')
      const inlinePicker = websiteWidget.getByTestId('nook-inline-login-picker')
      await expect(inlinePicker).toBeVisible()
      const websiteLoginPicker = inlinePicker.contentFrame()
      await expect(websiteLoginPicker.getByText('alice@nook.test')).toBeVisible(
        { timeout: 20_000 },
      )
      console.log('[extension e2e] post-unlock login picker loaded')
      expect(context.pages()).toHaveLength(pageCount)
      await websiteWidget
        .getByRole('button', { name: 'Cancel', exact: true })
        .click()
      await expect(inlinePicker).toHaveCount(0)
      await withE2eDeadline(
        websiteAfterUnlock.page.reload(),
        'reload website after login picker',
      )
      await expect(
        websiteAfterUnlock.page.locator('#nook-auth-widget'),
      ).toBeVisible()
      const websitePasskeyAssertion: WebsitePasskeyAssertionBrowserFlow = {
        page: websiteAfterUnlock.page,
        credentialId: websitePasskeyState.credentialId,
      }
      await test.step('assert website passkey after companion unlock', () =>
        assertWebsitePasskeyThroughExtension(websitePasskeyAssertion))
      await websiteAfterUnlock.page.close()
    }
    await withE2eDeadline(
      attachNookLogsForTest(reopenedVaultPage, testInfo),
      'attach extension app logs',
      10_000,
    )

    await withE2eDeadline(
      context.close(),
      'close extension context before restart',
    )
    const restartedContext = await chromium.launchPersistentContext(
      userDataDir,
      {
        channel: 'chromium',
        headless: true,
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
    const lockedVaultPage = await restartedContext.newPage()
    try {
      const restartedWorker = await getServiceWorker(restartedContext)
      const restartedExtensionId = new URL(restartedWorker.url()).host
      expect(restartedExtensionId).toBe(extensionId)
      await lockedVaultPage.goto(simpleVaultBaseUrl)
      await expect(
        lockedVaultPage.getByTestId('identity-vault-row').first(),
      ).toBeVisible({ timeout: EXTENSION_UNLOCK_TIMEOUT_MS })

      // After the browser restarts the vault still opens with the website's
      // own passkey, whatever state the extension is in.
      await test.step('unlock the vault with the website passkey after restart', () =>
        authorizeDeviceProtection(lockedVaultPage))
      await expect(
        lockedVaultPage.getByTestId('authenticated-shell'),
      ).toBeVisible({ timeout: EXTENSION_UNLOCK_TIMEOUT_MS })
    } finally {
      const restartedLogOptions: Parameters<typeof attachNookLogsForTest>[2] = {
        attachmentName: ExtensionAppLogAttachmentName.Restarted,
      }
      await attachNookLogsForTest(
        lockedVaultPage,
        testInfo,
        restartedLogOptions,
      )
      console.log('[extension e2e] closing restarted context')
      await withE2eDeadline(
        restartedContext.close(),
        'close restarted extension context',
      )
      console.log('[extension e2e] restarted context closed')
    }
  } finally {
    console.log('[extension e2e] closing extension context')
    await withE2eDeadline(context.close(), 'close extension context')
    console.log('[extension e2e] extension context closed')
    console.log('[extension e2e] closing mock credential server')
    await withE2eDeadline(loginServer.close(), 'close mock credential server')
    console.log('[extension e2e] mock credential server closed')
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
    await createWebsiteIdentityForConnect(simplePage)

    // Close the offscreen session before Approve. The grant handoff must still
    // import the event log without requiring an unlocked save_auth_providers_snapshot path.
    const sessionWorker = await getServiceWorker(context)
    await sessionWorker.evaluate(() => chrome.offscreen.closeDocument())

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
      simplePage.getByTestId('extension-connect-consent'),
    ).toHaveCount(0)
    await expect(
      simplePage.locator('[data-extension-pairing-rejection-reason]'),
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
    await pairPopup.goto(
      `chrome-extension://${extensionId}/popup/index.html?intent=pair`,
    )
    await expect(pairPopup.getByTestId('extension-toolbar-menu')).toBeVisible({
      timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
    })
    await expect(pairPopup.getByTestId('connect-simple-vault-btn')).toBeVisible(
      { timeout: EXTENSION_UNLOCK_TIMEOUT_MS },
    )
    // The auth tab shares the vault tab's window, so Connect reuses that
    // Nook tab on the connect route instead of opening another.
    const connectPage = await reuseNookTabForConnect({
      context,
      nookPage: simplePage,
      connect: () => pairPopup.getByTestId('connect-simple-vault-btn').click(),
    })

    const consent = connectPage.getByTestId('extension-connect-consent')
    const unlockStep = connectPage.getByTestId('identity-vault-row').first()
    await expect(consent.or(unlockStep)).toBeVisible({
      timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
    })
    await authorizeDeviceProtection(connectPage)
    await expect(consent).toBeVisible({
      timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
    })

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
      connectPage.getByTestId('extension-connect-consent'),
    ).toHaveCount(0)
    await expect(connectPage).toHaveURL((url) =>
      url.pathname.endsWith('/identities'),
    )
    await expect(connectPage.getByTestId('identities-hub')).toBeVisible()

    const pairedStorage = await readExtensionStorage(context)
    const grantKeys = Object.keys(pairedStorage).filter((key) =>
      key.startsWith('nook:extension-pairing-grant:'),
    )
    expect(grantKeys.length).toBeGreaterThan(0)
    await removeExtensionStorageKeys(context, grantKeys)

    // Reload, restore the IndexedDB signing seed, then unlock and re-approve.
    await simplePage.goto(simpleVaultBaseUrl)
    const reloadedShell = simplePage.getByTestId('authenticated-shell')
    const reloadedUnlock = simplePage.getByTestId('identity-vault-row').first()
    await expect(reloadedShell.or(reloadedUnlock)).toBeVisible({
      timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
    })
    if (await reloadedUnlock.isVisible()) {
      await startVaultPanelUnlock(simplePage)
      const reloadOverlay = simplePage.getByTestId('passkey-auth-overlay')
      if (await reloadOverlay.isVisible()) {
        await simplePage.getByTestId('device-protection-unlock-btn').click()
      }
      await expectVaultOpened(simplePage)
    }

    const repairPopup = await context.newPage()
    await repairPopup.goto(
      `chrome-extension://${extensionId}/popup/index.html?intent=pair`,
    )
    // Removing the active grant must close the session before re-approval.
    await expect(repairPopup.getByTestId('extension-device-setup')).toBeVisible(
      {
        timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
      },
    )
    await expect(
      repairPopup.getByTestId('connect-simple-vault-btn'),
    ).toHaveCount(0)
    await repairPopup.getByTestId('device-protection-unlock-btn').click()
    await expect(
      repairPopup.getByTestId('connect-simple-vault-btn'),
    ).toBeVisible({ timeout: EXTENSION_UNLOCK_TIMEOUT_MS })
    const reconnectPage = await reuseNookTabForConnect({
      context,
      nookPage: simplePage,
      connect: () =>
        repairPopup.getByTestId('connect-simple-vault-btn').click(),
    })

    const reconnectConsent = reconnectPage.getByTestId(
      'extension-connect-consent',
    )
    const reconnectUnlock = reconnectPage
      .getByTestId('identity-vault-row')
      .first()
    await expect(reconnectConsent.or(reconnectUnlock)).toBeVisible({
      timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
    })
    if (await reconnectUnlock.isVisible()) {
      // The vault's panel unlocks it; the consent then asks to connect.
      await authorizeDeviceProtection(reconnectPage)
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
      reconnectPage.getByTestId('extension-connect-consent'),
    ).toHaveCount(0)
    await expect(
      reconnectPage.locator('[data-extension-pairing-rejection-reason]'),
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
    await stopExtensionServiceWorker({
      worker,
      cdp,
    })

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
