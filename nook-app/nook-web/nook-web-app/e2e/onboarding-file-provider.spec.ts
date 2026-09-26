import { test, expect, type BrowserContext, type Page } from './fixtures'
import {
  addSecret,
  addVaultPassword,
  assertVaultReady,
  clearBrowserVault,
  connectGoogleDriveGenesisDevice,
  createLocalVaultOnLogin,
  createIsolatedContext,
  disableVaultIdleLock,
  expandSettingsSection,
  installGoogleOAuthMock,
  localizeAppLinkForE2e,
  openLoginProviderSetup,
  openOnboardDevicePanel,
  openStorageSettings,
  revealSecretValue,
  submitOnboardEnrollmentCode,
  uniqueSecretKey,
  waitForEngine,
  waitForVaultOperationsIdle,
  waitForSecretOnDevice,
  waitForVaultUnlocked,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  UI_TIMEOUT_MS,
} from './helpers'
import {
  E2eSyncProviderId,
  createSyncTarget,
  installSyncRemote,
  waitForSyncRemoteState,
  type LocalFileSyncE2eTarget,
  type SyncE2eTarget,
} from './sync-provider'
import { createLocalE2eGoogleDriveVaultStub } from './drive-stub'

const VAULT_PASSWORD = 'file-onboard-pass-1'

test.describe('file sync provider onboarding', () => {
  test.setTimeout(180_000)

  let contextA: BrowserContext
  let contextB: BrowserContext
  let deviceA: Page
  let deviceB: Page
  let target: LocalFileSyncE2eTarget

  test.beforeAll(async ({ browser }) => {
    contextA = await createIsolatedContext(browser)
    contextB = await createIsolatedContext(browser)
    deviceA = await contextA.newPage()
    deviceB = await contextB.newPage()
    for (const [name, page] of [
      ['device A', deviceA],
      ['device B', deviceB],
    ] as const) {
      page.on('console', (message) => {
        const text = message.text()
        if (text.includes('[nook]') || message.type() === 'error') {
          console.log(`[${name} ${message.type()}] ${text}`)
        }
      })
    }
    target = createSyncTarget('', 'onboarding-file', E2eSyncProviderId.File)
  })

  test.afterAll(async () => {
    await deviceA?.close()
    await deviceB?.close()
    await contextA?.close()
    await contextB?.close()
  })

  test('enrolls a clean browser through the file sync provider without IndexedDB seeding', async () => {
    let googleDriveFallbackCount = 0
    await deviceA.route('https://www.googleapis.com/**', async (route) => {
      googleDriveFallbackCount += 1
      await route.fulfill({
        status: 418,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: '{}',
      })
    })
    await connectGoogleDriveGenesisDevice(
      deviceA,
      target.pat,
      target.repoName,
      target.stub,
    )
    const unsupportedStatus = await deviceA.evaluate(async (accessToken) => {
      const response = await fetch(
        'https://www.googleapis.com/drive/v3/e2e-unsupported-route',
        { headers: { Authorization: `Bearer ${accessToken}` } },
      )
      return response.status
    }, target.pat)
    expect(unsupportedStatus).toBe(404)
    expect(googleDriveFallbackCount).toBe(0)
    const privateFolderIds = target.stub.getPrivateFolderIds()
    expect(privateFolderIds).toHaveLength(1)
    expect(target.stub.getPrivateFolderCreateCount()).toBe(1)
    await assertVaultReady(deviceA)
    await disableVaultIdleLock(deviceA)

    const secretKey = uniqueSecretKey('file-onboard')
    const secretValue = 'shared-through-file-provider-onboarding'
    await addSecret(deviceA, secretKey, secretValue)
    await waitForSyncRemoteState(
      target,
      (snapshot) => snapshot.secretIds.length >= 1,
    )
    expect(target.stub.getPrivateFolderIds()).toEqual(privateFolderIds)
    expect(target.stub.getPrivateFolderCreateCount()).toBe(1)
    expect(target.stub.getEventFileCount()).toBeGreaterThan(0)

    await openStorageSettings(deviceA)
    await addVaultPassword(deviceA, 'File onboarding', VAULT_PASSWORD)
    await waitForSyncRemoteState(
      target,
      (snapshot) =>
        snapshot.hasPasswordEnvelope && snapshot.secretIds.length >= 1,
    )

    await openOnboardDevicePanel(deviceA)
    const linkInput = await submitOnboardEnrollmentCode(deviceA, VAULT_PASSWORD)
    const enrollmentLink = (await linkInput.inputValue()).trim()
    expect(enrollmentLink).toContain('#enroll=')

    await connectCleanBrowserToFileProvider(deviceB, target)
    const localEnrollmentLink = localizeAppLinkForE2e(deviceB, enrollmentLink)
    await deviceB.goto('about:blank')
    await deviceB.goto(localEnrollmentLink)
    await expect(deviceB.getByTestId('enrollment-scan-panel')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await expect(
      deviceB.getByTestId('enrollment-password-entry-hint'),
    ).toContainText('File onboarding')
    await deviceB.getByTestId('enrollment-password-input').fill(VAULT_PASSWORD)
    await deviceB.getByTestId('submit-enrollment-code-btn').click()

    await waitForVaultUnlocked(deviceB, ENROLLMENT_UNLOCK_TIMEOUT_MS)
    await assertVaultReady(deviceB)
    await waitForSecretOnDevice(deviceB, secretKey)
    expect(await revealSecretValue(deviceB, secretKey)).toBe(secretValue)
  })
})

test.describe('Google Drive provider modes', () => {
  test.setTimeout(180_000)

  test('shares one Drive folder across independently signed-in accounts', async ({
    browser,
    page: owner,
  }) => {
    const ownerToken = 'ya29.e2e_shared_owner'
    const collaboratorToken = 'ya29.e2e_shared_collaborator'
    const collaboratorEmail = 'collaborator@example.com'
    const driveStub = createLocalE2eGoogleDriveVaultStub(
      '',
      'shared-provider-events',
    )
    await installGoogleOAuthMock(owner, ownerToken)
    await driveStub.install(owner, {
      accessToken: ownerToken,
      fileName: 'shared-provider-events',
    })
    await owner.goto('/app/')
    await clearBrowserVault(owner)
    await owner.reload()

    await createLocalVaultOnLogin(owner, 'Shared Drive vault')
    await openStorageSettings(owner)
    await expandSettingsSection(owner, 'storage')
    await owner.getByTestId('add-provider-btn').first().click()
    await owner.getByTestId('provider-option-oauth-file').click()
    await expect(owner.getByTestId('google-oauth-setup')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await expect(
      owner.getByTestId('google-drive-mode-private'),
    ).toHaveAttribute('aria-checked', 'true')
    await owner.getByTestId('google-drive-mode-shared').click()
    await expect(owner.getByTestId('google-drive-mode-shared')).toHaveAttribute(
      'aria-checked',
      'true',
    )
    // Shared folder display names are independent from the validated internal
    // event-log backup name and may contain normal Drive filename characters.
    await owner.getByTestId('drive-file-input').fill('Team Vault')
    await owner.getByTestId('google-sign-in-btn').click()
    await expect(owner.getByTestId('google-shared-account-email')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await owner
      .getByTestId('google-shared-account-email')
      .fill(collaboratorEmail)
    await owner.getByTestId('google-create-shared-folder-btn').click()

    await expect
      .poll(
        () =>
          ((v) => (v ? v : false))(
            driveStub
              .getSharedFolders()[0]
              ?.writers.includes(collaboratorEmail),
          ),
        { timeout: UI_TIMEOUT_MS },
      )
      .toBe(true)

    const [sharedFolder] = driveStub.getSharedFolders()
    if (!sharedFolder) throw new Error('Drive stub did not create a folder')
    expect(sharedFolder.name).toBe('Team Vault')
    const connectButton = owner.getByTestId('connect-provider-btn')
    await expect(connectButton).toBeEnabled()
    await connectButton.click()
    await waitForVaultOperationsIdle(owner, ENROLLMENT_UNLOCK_TIMEOUT_MS)
    await assertVaultReady(owner)
    await expect
      .poll(() => driveStub.getEventFileCountForParent(sharedFolder.id), {
        timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
      })
      .toBeGreaterThan(0)
    await owner.getByTestId('vault-secrets-tab').click()

    const secretKey = uniqueSecretKey('shared-drive-onboard')
    const secretValue = 'shared-without-owner-google-credentials'
    await addSecret(owner, secretKey, secretValue)
    await openStorageSettings(owner)
    await addVaultPassword(owner, 'Shared Drive onboarding', VAULT_PASSWORD)
    await openOnboardDevicePanel(owner)
    await owner
      .getByTestId('onboard-password-entry-list')
      .getByRole('radio')
      .first()
      .click()
    await expect(owner.getByTestId('onboarding-type-label')).toContainText(
      'Shared provider grant',
    )
    await expect(
      owner.getByTestId('onboarding-type-description'),
    ).toContainText('signs in with their own provider identity')
    await expect(
      owner.getByTestId('shared-joiner-identity-input'),
    ).toBeVisible()
    await owner
      .getByTestId('shared-joiner-identity-input')
      .fill(collaboratorEmail)
    const linkInput = await submitOnboardEnrollmentCode(owner, VAULT_PASSWORD)
    const enrollmentLink = (await linkInput.inputValue()).trim()
    expect(enrollmentLink).toContain('#enroll=')
    expect(driveStub.getSharedFolders()).toHaveLength(1)

    const collaboratorContext = await createIsolatedContext(browser)
    const collaborator = await collaboratorContext.newPage()
    try {
      await installGoogleOAuthMock(collaborator, collaboratorToken)
      await driveStub.install(collaborator, {
        accessToken: collaboratorToken,
        fileName: 'shared-provider-events',
      })
      await collaborator.goto('/app/')
      await clearBrowserVault(collaborator)
      const localEnrollmentLink = localizeAppLinkForE2e(
        collaborator,
        enrollmentLink,
      )
      await collaborator.goto('about:blank')
      await collaborator.goto(localEnrollmentLink)
      await expect(
        collaborator.getByTestId('enrollment-scan-panel'),
      ).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
      await expect(
        collaborator.getByTestId('enrollment-icloud-auth-toggle'),
      ).toBeVisible()
      await collaborator
        .getByTestId('enrollment-password-input')
        .fill(VAULT_PASSWORD)
      await collaborator.getByTestId('submit-enrollment-code-btn').click()
      await waitForVaultUnlocked(collaborator, ENROLLMENT_UNLOCK_TIMEOUT_MS)
      await assertVaultReady(collaborator)
      await waitForSecretOnDevice(collaborator, secretKey)
      expect(await revealSecretValue(collaborator, secretKey)).toBe(secretValue)
      await openStorageSettings(collaborator)
      await expandSettingsSection(collaborator, 'storage')
      await expect(
        collaborator.getByTestId('settings-provider-oauth-file'),
      ).toBeVisible()
    } finally {
      await collaborator.close()
      await collaboratorContext.close()
    }
  })
})

test.describe('iCloud provider modes', () => {
  test('switches from private CloudKit storage to a shared target', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const container = {
        setUpAuth: async () => {},
        whenUserSignsIn: () => new Promise<never>(() => {}),
      }
      Object.defineProperty(window, 'CloudKit', {
        configurable: true,
        value: {
          configure: () => {},
          getDefaultContainer: () => container,
        },
      })
    })
    await page.goto('/app/')
    await clearBrowserVault(page)
    await page.reload()

    await openLoginProviderSetup(page)
    await page.getByTestId('provider-option-icloud').click()
    await expect(page.getByTestId('icloud-oauth-setup')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await expect(page.getByTestId('icloud-mode-private')).toHaveAttribute(
      'aria-checked',
      'true',
    )

    await page.getByTestId('icloud-mode-shared').click()

    await expect(page.getByTestId('icloud-mode-shared')).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await expect(page.getByTestId('icloud-shared-target-step')).toBeVisible()
  })

  test('shows the translated error and clears the busy state after native CloudKit sign-in fails', async ({
    page,
  }) => {
    await page.route('https://localhost:5173/**', async (route) => {
      const localRequestUrl = new URL(route.request().url())
      localRequestUrl.protocol = 'http:'
      localRequestUrl.hostname = '127.0.0.1'
      await route.fulfill({
        response: await route.fetch({ url: localRequestUrl.toString() }),
      })
    })
    await page.route('https://api.apple-cloudkit.com/**', (route) =>
      route.abort(),
    )
    await page.route('https://cdn.apple-cloudkit.com/**', (route) =>
      route.abort(),
    )
    await page.route('https://idmsa.apple.com/**', (route) => route.abort())
    await page.addInitScript(() => {
      const container = {
        setUpAuth: async () => ({ userRecordName: 1 }),
        whenUserSignsIn: () =>
          Promise.reject({
            serverErrorCode: 'INTERNAL_ERROR',
            reason: 'unexpected CloudKit sign-in failure',
          }),
      }
      Object.defineProperty(window, 'CloudKit', {
        configurable: true,
        value: {
          configure: () => {
            const control = document.createElement('button')
            control.type = 'button'
            control.style.width = '64px'
            control.style.height = '36px'
            control.setAttribute('data-testid', 'mock-cloudkit-sign-in')
            document.getElementById('apple-sign-in-button')?.append(control)
          },
          getDefaultContainer: () => container,
        },
      })
    })
    await page.goto('https://localhost:5173/app/')
    await clearBrowserVault(page)
    await page.reload()

    await openLoginProviderSetup(page)
    await page.getByTestId('provider-option-icloud').click()
    await expect(page.getByTestId('icloud-oauth-setup')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await expect(page.getByTestId('icloud-origin-unsupported')).toHaveCount(0)
    await expect(page.getByTestId('mock-cloudkit-sign-in')).toBeVisible()
    await page.getByTestId('mock-cloudkit-sign-in').click()

    const signInControl = page.getByTestId('icloud-sign-in-btn')
    await expect(page.getByTestId('icloud-oauth-error')).toBeVisible()
    await expect(signInControl.locator('div.absolute.inset-0')).toHaveCount(0)
    await expect(signInControl).not.toHaveClass(/opacity-60/)
  })
})

async function connectCleanBrowserToFileProvider(
  page: Page,
  target: SyncE2eTarget,
) {
  await installGoogleOAuthMock(page, target.pat)
  await installSyncRemote(page, target)
  await page.goto('/app/')
  await clearBrowserVault(page)
  await page.reload()

  await openLoginProviderSetup(page)
  await page.getByTestId('provider-option-oauth-file').click()
  await expect(page.getByTestId('google-oauth-setup')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await page.getByTestId('drive-file-input').fill(target.repoName)
  await page.getByTestId('google-sign-in-btn').click()

  const connectButton = await waitForEngine(page)
  await connectButton.click()
  await waitForVaultOperationsIdle(page)

  const dialog = page.getByTestId('join-enrollment-dialog')
  if (await dialog.isVisible()) {
    await page.getByTestId('join-enrollment-close').click()
    await expect(dialog).not.toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
  }
  await expect(page.getByTestId('login-gate')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
}
