import { test, expect, type BrowserContext, type Page } from './fixtures'
import {
  beginAddSyncProvider,
  addSecret,
  expectIdentityMembers,
  assertVaultReady,
  E2E_IDENTITY_PASSPHRASE,
  openVaultAfterIdentityJoin,
  redeemIdentityEnrollmentCode,
  clearBrowserVault,
  connectGoogleDriveGenesisDevice,
  createLocalVaultOnLogin,
  createIsolatedContext,
  disableVaultIdleLock,
  expandSettingsSection,
  installGoogleOAuthMock,
  invokeInitializedVaultProviderReload,
  localizeAppLinkForE2e,
  listLocalVaultEntries,
  openLoginProviderSetup,
  openOnboardDevicePanel,
  openStorageSettings,
  revealSecretValue,
  seedExtraICloudProviders,
  submitOnboardEnrollmentCode,
  uniqueSecretKey,
  waitForLoadedSyncProviders,
  waitForVaultOperationsIdle,
  waitForSecretOnDevice,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  UI_TIMEOUT_MS,
  openVaultPage,
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
import {
  createLocalE2eICloudVaultStub,
  E2eCloudKitAcceptance,
  E2eCloudKitParticipantType,
  E2eCloudKitPermission,
  e2eICloudShareTarget,
  installCloudKitShareStub,
} from './icloud-stub'
import { E2E_GOOGLE_ACCOUNT_EMAIL } from './google-identity-stub'
import enLocale from '../../../nook-platform/nook-app-common/locales/en.json' with { type: 'json' }
import ruLocale from '../../../nook-platform/nook-app-common/locales/ru.json' with { type: 'json' }

const ICLOUD_CONTAINER_IDENTIFIER = 'iCloud.metasecret.project.com'

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

  test('enrolls a clean browser through the vault folder without IndexedDB seeding', async () => {
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
    // The provider syncs under the one My Drive folder it created; only the
    // signed-in account can open it.
    const [vaultFolder, ...otherFolders] = target.stub.getSharedFolders()
    if (!vaultFolder) throw new Error('the provider did not create a folder')
    expect(otherFolders).toHaveLength(0)
    expect(vaultFolder.name).toBe('Nook')
    expect(vaultFolder.writers).toEqual([E2E_GOOGLE_ACCOUNT_EMAIL])
    await assertVaultReady(deviceA)
    await disableVaultIdleLock(deviceA)

    const secretKey = uniqueSecretKey('file-onboard')
    const secretValue = 'shared-through-file-provider-onboarding'
    await addSecret(deviceA, secretKey, secretValue)
    await waitForSyncRemoteState(
      target,
      (snapshot) => snapshot.secretIds.length >= 1,
    )
    expect(target.stub.getEventFileCount()).toBeGreaterThan(0)

    // The invite names the folder's own account; no provider credential or
    // folder permission travels with it.
    await openOnboardDevicePanel(deviceA)
    const linkInput = await submitOnboardEnrollmentCode(
      deviceA,
      E2E_IDENTITY_PASSPHRASE,
      { inviteAccount: E2E_GOOGLE_ACCOUNT_EMAIL },
    )
    const enrollmentLink = (await linkInput.inputValue()).trim()
    expect(enrollmentLink).toContain('#enroll=')
    expect(target.stub.getSharedFolders()).toEqual([vaultFolder])

    await openCleanBrowserSignedInToFileProvider(deviceB, target)
    const localEnrollmentLink = localizeAppLinkForE2e(deviceB, enrollmentLink)
    await deviceB.goto('about:blank')
    await deviceB.goto(localEnrollmentLink)
    await redeemIdentityEnrollmentCode(deviceB, E2E_IDENTITY_PASSPHRASE)
    await expectIdentityMembers(deviceA, 2)
    await openVaultAfterIdentityJoin(deviceB)
    await assertVaultReady(deviceB)
    // The vault name travels encrypted in the vault's event log, so the joined
    // browser lists the vault under the name the first browser gave it.
    const [founderVault] = await listLocalVaultEntries(deviceA)
    if (!founderVault?.store_id)
      throw new Error('the first browser lists no vault')
    expect(founderVault.label).toBe('Test vault')
    await expect
      .poll(
        async () =>
          (await listLocalVaultEntries(deviceB)).find(
            (entry) => entry.store_id === founderVault.store_id,
          )?.label,
      )
      .toBe('Test vault')
    // The joining device syncs through the same folder instead of creating one.
    expect(target.stub.getSharedFolders()).toEqual([vaultFolder])
    await waitForSecretOnDevice(deviceB, secretKey)
    expect(await revealSecretValue(deviceB, secretKey)).toBe(secretValue)
  })
})

test.describe('Google Drive authorized accounts', () => {
  test.setTimeout(180_000)

  test('authorizes a second account on the vault folder and invites a device signed in as it', async ({
    browser,
    page: owner,
  }) => {
    const ownerToken = 'ya29.e2e_shared_owner'
    const ownerEmail = 'owner@example.com'
    const collaboratorToken = 'ya29.e2e_shared_collaborator'
    const collaboratorEmail = 'collaborator@example.com'
    const strangerToken = 'ya29.e2e_shared_stranger'
    const driveStub = createLocalE2eGoogleDriveVaultStub(
      '',
      'shared-provider-events',
    )
    await installGoogleOAuthMock(owner, ownerToken)
    await driveStub.install(owner, {
      accessToken: ownerToken,
      accountEmail: ownerEmail,
      fileName: 'shared-provider-events',
    })
    await owner.goto('/app/')
    await clearBrowserVault(owner)
    await owner.reload()

    await createLocalVaultOnLogin(owner, 'Shared Drive vault')
    await openStorageSettings(owner)
    await expandSettingsSection(owner, 'storage')
    await beginAddSyncProvider(owner)
    await owner.getByTestId('provider-option-oauth-file').click()
    await expect(owner.getByTestId('google-oauth-setup')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    // There is no storage mode or folder to choose: Connect & sync creates
    // the account's one Nook root folder, which accounts are shared into.
    await expect(owner.getByTestId('google-setup-sync-step')).toBeVisible()
    await expect(owner.getByTestId('drive-file-input')).toHaveCount(0)
    await owner.getByTestId('google-sign-in-btn').click()
    await expect(owner.getByTestId('google-folder-on-connect')).toContainText(
      'Nook',
      { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    const connectButton = owner.getByTestId('connect-provider-btn')
    await expect(connectButton).toBeEnabled()
    await connectButton.click()
    await waitForVaultOperationsIdle(owner, ENROLLMENT_UNLOCK_TIMEOUT_MS)
    await assertVaultReady(owner)

    // The Sync page lists each provider's authorized accounts on its card.
    const accounts = owner.getByTestId('authorized-accounts')
    await expect(
      accounts.getByTestId(`authorized-account-${ownerEmail}`),
    ).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
    const [sharedFolder] = driveStub.getSharedFolders()
    if (!sharedFolder) throw new Error('Drive stub did not create a folder')
    expect(sharedFolder.name).toBe('Nook')
    // Creating the folder shares it with nobody.
    expect(sharedFolder.writers).toEqual([ownerEmail])

    await accounts
      .getByTestId('authorized-account-email-input')
      .fill(collaboratorEmail)
    await accounts.getByTestId('authorized-account-add-btn').click()
    await expect(
      accounts.getByTestId(`authorized-account-${collaboratorEmail}`),
    ).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
    expect(driveStub.getSharedFolders()[0]?.writers).toEqual([
      ownerEmail,
      collaboratorEmail,
    ])
    // The owner's own access belongs to the folder and cannot be removed.
    await expect(
      accounts.getByTestId(`authorized-account-remove-${ownerEmail}`),
    ).toHaveCount(0)
    await expect(
      accounts.getByTestId(`authorized-account-remove-${collaboratorEmail}`),
    ).toBeVisible()

    // The identity-namespaced row keeps each vault in its own child folder.
    await expect
      .poll(() => driveStub.getEventFileCount(), {
        timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
      })
      .toBeGreaterThan(0)
    expect(driveStub.getEventFileCountDirectlyIn(sharedFolder.id)).toBe(0)
    await openVaultPage(owner)

    const secretKey = uniqueSecretKey('shared-drive-onboard')
    const secretValue = 'shared-without-owner-google-credentials'
    await addSecret(owner, secretKey, secretValue)
    await openOnboardDevicePanel(owner)
    await expect(owner.getByTestId('onboarding-type-label')).toContainText(
      enLocale.architecture_modes[
        'onboarding_type_shared-provider-grant_title'
      ],
    )
    const picker = owner
      .getByTestId('onboard-device-panel')
      .getByTestId('authorized-accounts')
    await expect(
      picker.getByTestId(`authorized-account-pick-${ownerEmail}`),
    ).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
    await expect(
      picker.getByTestId(`authorized-account-pick-${collaboratorEmail}`),
    ).toBeEnabled()
    const linkInput = await submitOnboardEnrollmentCode(
      owner,
      E2E_IDENTITY_PASSPHRASE,
      { inviteAccount: collaboratorEmail },
    )
    const enrollmentLink = (await linkInput.inputValue()).trim()
    expect(enrollmentLink).toContain('#enroll=')
    // Issuing the invite changes no Drive permission.
    expect(driveStub.getSharedFolders()).toHaveLength(1)
    expect(driveStub.getSharedFolders()[0]?.writers).toEqual([
      ownerEmail,
      collaboratorEmail,
    ])

    // A browser signed in as an account the link does not name is refused.
    const strangerContext = await createIsolatedContext(browser)
    const stranger = await strangerContext.newPage()
    try {
      await installGoogleOAuthMock(stranger, strangerToken)
      await driveStub.install(stranger, {
        accessToken: strangerToken,
        accountEmail: 'stranger@example.com',
        fileName: 'shared-provider-events',
      })
      await stranger.goto('/app/')
      await clearBrowserVault(stranger)
      await stranger.goto('about:blank')
      await stranger.goto(localizeAppLinkForE2e(owner, enrollmentLink))
      await expect(stranger.getByTestId('join-this-device')).toBeVisible({
        timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
      })
      await stranger
        .getByTestId('enrollment-password-input')
        .fill(E2E_IDENTITY_PASSPHRASE)
      await stranger.getByTestId('submit-enrollment-code-btn').click()
      await expect(stranger.getByTestId('vault-error')).toContainText(
        enLocale.errors.validation.joiner_account_mismatch,
        { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
      )
      await expect(stranger.getByTestId('identity-join-ready')).toHaveCount(0)
    } finally {
      await stranger.close()
      await strangerContext.close()
    }

    const collaboratorContext = await createIsolatedContext(browser)
    const collaborator = await collaboratorContext.newPage()
    try {
      await installGoogleOAuthMock(collaborator, collaboratorToken)
      await driveStub.install(collaborator, {
        accessToken: collaboratorToken,
        accountEmail: collaboratorEmail,
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
      await expect(collaborator.getByTestId('join-this-device')).toBeVisible({
        timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
      })
      await redeemIdentityEnrollmentCode(collaborator, E2E_IDENTITY_PASSPHRASE)
      await expectIdentityMembers(owner, 2)
      await openVaultAfterIdentityJoin(collaborator)
      await assertVaultReady(collaborator)
      await waitForSecretOnDevice(collaborator, secretKey)
      expect(await revealSecretValue(collaborator, secretKey)).toBe(secretValue)
      await openStorageSettings(collaborator)
      await expandSettingsSection(collaborator, 'storage')
      await expect(
        collaborator.getByTestId('settings-provider-oauth-file'),
      ).toBeVisible()
      // The collaborator synced through the owner's folder.
      expect(driveStub.getSharedFolders()).toHaveLength(1)
    } finally {
      await collaborator.close()
      await collaboratorContext.close()
    }
  })
})

test.describe('iCloud provider setup', () => {
  test('always offers the CloudKit share step', async ({ page }) => {
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
    // Every iCloud provider syncs through a CloudKit share that Connect &
    // sync creates; nothing asks for a share before sign-in.
    await expect(page.getByTestId('icloud-setup-sync-step')).toBeVisible()
    await expect(page.getByTestId('icloud-share-on-connect')).toHaveCount(0)
  })

  test('invites a device as one of the CloudKit share participants', async ({
    page,
  }) => {
    const ownerEmail = 'owner@icloud.example'
    const memberEmail = 'member@icloud.example'
    const viewerEmail = 'viewer@icloud.example'
    await installCloudKitShareStub(page, [
      {
        email: ownerEmail,
        type: E2eCloudKitParticipantType.Owner,
        permission: E2eCloudKitPermission.ReadWrite,
        acceptanceStatus: E2eCloudKitAcceptance.Accepted,
      },
      {
        email: memberEmail,
        type: E2eCloudKitParticipantType.PrivateUser,
        permission: E2eCloudKitPermission.ReadWrite,
        acceptanceStatus: E2eCloudKitAcceptance.Accepted,
      },
      {
        email: viewerEmail,
        type: E2eCloudKitParticipantType.PrivateUser,
        permission: E2eCloudKitPermission.ReadOnly,
        acceptanceStatus: E2eCloudKitAcceptance.Accepted,
      },
    ])
    const iCloudStub = createLocalE2eICloudVaultStub('', 'icloud-share-events')
    await iCloudStub.install(page)
    await page.goto('/app/')
    await clearBrowserVault(page)
    await page.reload()
    await createLocalVaultOnLogin(page, 'iCloud share vault')
    await seedExtraICloudProviders(page, [
      {
        id: 'e2e-icloud-share-owner',
        label: 'iCloud share',
        fileName: 'icloud-share-events',
        accessToken: 'ck-web-auth-e2e-share-owner',
        iCloudShareTarget: e2eICloudShareTarget('owner'),
      },
    ])
    await invokeInitializedVaultProviderReload(page)
    await waitForLoadedSyncProviders(page, 1)

    await openOnboardDevicePanel(page)
    await expect(page.getByTestId('onboarding-type-label')).toContainText(
      enLocale.architecture_modes[
        'onboarding_type_shared-provider-grant_title'
      ],
    )
    const accounts = page
      .getByTestId('onboard-device-panel')
      .getByTestId('authorized-accounts')
    // The owner reads its share's participants through its private database.
    await expect(
      accounts.getByTestId(`authorized-account-pick-${memberEmail}`),
    ).toBeEnabled({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
    await expect(page.locator('html')).toHaveAttribute(
      'data-e2e-cloudkit-share-database',
      'private',
    )
    await expect(
      accounts.getByTestId(`authorized-account-pick-${ownerEmail}`),
    ).toBeEnabled()
    // A view-only participant cannot sync a device.
    await expect(
      accounts.getByTestId(`authorized-account-pick-${viewerEmail}`),
    ).toBeDisabled()
    // The invite only picks. iCloud participants are managed in Apple's
    // sharing sheet, reached from the Sync page, not by email.
    await expect(
      accounts.getByTestId('authorized-account-email-input'),
    ).toHaveCount(0)
    await accounts.getByTestId('authorized-accounts-manage-link').click()
    const providerAccounts = page
      .getByTestId('storage-providers-section')
      .getByTestId('authorized-accounts')
    await expect(
      providerAccounts.getByTestId('authorized-account-email-input'),
    ).toHaveCount(0)
    await providerAccounts
      .getByTestId('authorized-accounts-manage-icloud')
      .click()
    await expect(page.locator('html')).toHaveAttribute(
      'data-e2e-cloudkit-share-ui',
      '1',
    )
    await openOnboardDevicePanel(page)
    await expect(
      accounts.getByTestId(`authorized-account-pick-${memberEmail}`),
    ).toBeEnabled({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })

    const linkInput = await submitOnboardEnrollmentCode(
      page,
      E2E_IDENTITY_PASSPHRASE,
      { inviteAccount: memberEmail },
    )
    expect((await linkInput.inputValue()).trim()).toContain('#enroll=')
  })

  test('opens one Apple sign-in tab from the prepared CloudKit control', async ({
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
    const context = page.context()
    await context.route('https://api.apple-cloudkit.com/**', (route) =>
      route.abort(),
    )
    await context.route('https://cdn.apple-cloudkit.com/**', (route) =>
      route.abort(),
    )
    await context.route('https://idmsa.apple.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '' }),
    )
    await page.addInitScript(() => {
      const container = {
        setUpAuth: async () => {
          document.documentElement.setAttribute(
            'data-e2e-cloudkit-auth-setup',
            'waiting',
          )
          await new Promise<void>((resolve) => {
            document.addEventListener(
              'e2e-cloudkit-auth-setup-release',
              () => resolve(),
              { once: true },
            )
          })
          return { kind: 'signed-out' as const }
        },
        whenUserSignsIn: () => new Promise<never>(() => {}),
      }
      Object.defineProperty(window, 'CloudKit', {
        configurable: true,
        value: {
          configure: (configuration: {
            containers: [
              { containerIdentifier: string },
              ...{ containerIdentifier: string }[],
            ]
          }) => {
            const configuredContainerIdentifier =
              configuration.containers[0].containerIdentifier
            document.documentElement.setAttribute(
              'data-e2e-cloudkit-container',
              configuredContainerIdentifier,
            )
            const control = document.createElement('button')
            control.type = 'button'
            control.className = 'apple-auth-button'
            control.style.width = '64px'
            control.style.height = '36px'
            control.addEventListener('click', () => {
              const authUrl = new URL(
                'https://idmsa.apple.com/appleauth/auth/signin',
              )
              authUrl.searchParams.set(
                'containerIdentifier',
                configuredContainerIdentifier,
              )
              window.open(authUrl.toString(), '_blank')
            })
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
    const signInControl = page.getByTestId('icloud-sign-in-btn')
    await expect(page.locator('html')).toHaveAttribute(
      'data-e2e-cloudkit-auth-setup',
      'waiting',
    )
    const locale = await page.locator('html').getAttribute('lang')
    const localeCopy = locale?.startsWith('ru') ? ruLocale : enLocale
    const preparingCopy = localeCopy.provider_setup.icloud_preparing_sign_in
    await expect(signInControl).toContainText(preparingCopy)
    await page.evaluate(() => {
      document.dispatchEvent(new Event('e2e-cloudkit-auth-setup-release'))
    })
    const signInButton = page.locator(
      '#apple-sign-in-button .apple-auth-button',
    )
    await expect(signInButton).toHaveCount(1)
    await expect(signInButton).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute(
      'data-e2e-cloudkit-container',
      ICLOUD_CONTAINER_IDENTIFIER,
    )

    const popupPromise = page.waitForEvent('popup')
    await signInButton.click()
    const popup = await popupPromise
    await popup.waitForLoadState('domcontentloaded')

    const authUrl = new URL(popup.url())
    expect(authUrl.hostname).toBe('idmsa.apple.com')
    expect(authUrl.searchParams.get('containerIdentifier')).toBe(
      ICLOUD_CONTAINER_IDENTIFIER,
    )
    expect(context.pages()).toHaveLength(2)
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

/** A clean browser whose Google sign-in returns the file provider's account.
 * It reaches the vault only through the onboarding link. */
async function openCleanBrowserSignedInToFileProvider(
  page: Page,
  target: SyncE2eTarget,
) {
  await installGoogleOAuthMock(page, target.pat)
  await installSyncRemote(page, target)
  await page.goto('/app/')
  await clearBrowserVault(page)
  await page.reload()
}
