import { expect, test, type Page } from './fixtures'
import { generateKeyPairSync, sign } from 'node:crypto'
import { createLocalE2eGoogleDriveVaultStub } from './drive-stub'
import {
  addSecret,
  assertVaultReady,
  clearBrowserVault,
  createIsolatedContext,
  createLocalVaultOnLogin,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  enrollmentCodeFromLink,
  expandSettingsSection,
  flushNookLogPersistQueue,
  openLoginProviderSetup,
  openOnboardDevicePanel,
  openStorageSettings,
  readPersistedAppLogs,
  revealSecretValue,
  seedGithubSyncProvidersWhileUnlocked,
  seedExtraOauthFileProviders,
  seedOauthFileSyncProvidersWhileUnlocked,
  UI_TIMEOUT_MS,
  uniqueSecretKey,
  waitForVaultUnlocked,
} from './helpers'

const SIMPLE_SECRET_VALUE = 'architecture-simple-secret-value'
const ONBOARD_PASSWORD = 'architecture-onboard-password-1'
const SHARED_JOINER_IDENTITY = 'joiner@example.com'
const SHARED_SECRET_VALUE = 'architecture-shared-secret-value'
const SHARED_JOINER_TOKEN = 'ya29.architecture-shared-joiner-token'

function signedSentinelInvitation(): string {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const signingPublicKey = publicKey
    .export({ format: 'der', type: 'spki' })
    .subarray(-32)
    .toString('hex')
  const request = {
    version: 1,
    sessionId: 'abcdefghijk',
    policy: { participantCount: 3, threshold: 2 },
    initiatorDeviceId: '0123456789abcdef',
    initiatorSigningPublicKey: signingPublicKey,
  }
  const signature = sign(
    undefined,
    Buffer.from(
      JSON.stringify([
        request.version,
        request.sessionId,
        request.policy,
        request.initiatorDeviceId,
        request.initiatorSigningPublicKey,
      ]),
    ),
    privateKey,
  ).toString('hex')
  return JSON.stringify({ ...request, signature })
}
const PERSONAL_ONLY_PROVIDER = {
  id: 'architecture-personal-only-github',
  label: 'Personal-only GitHub',
  githubRepo: 'personal-only-vault',
  githubPat: 'ghp_architecture_personal_only',
}
const SHARED_PROVIDER = {
  id: 'architecture-shared-provider',
  label: 'Shared architecture drive',
  fileName: 'architecture-shared.yaml',
  accessToken: 'ya29.architecture-shared-provider-token',
  accountEmail: 'owner@example.com',
}

async function createOnboardPasswordInline(page: Page) {
  await expect(page.getByTestId('onboard-wizard-password-step')).toBeVisible()
  await page.getByTestId('vault-password-label').fill('Architecture onboard')
  await page.getByTestId('vault-password-input').fill(ONBOARD_PASSWORD)
  await page.getByTestId('vault-password-confirm').fill(ONBOARD_PASSWORD)
  await page.getByTestId('submit-vault-password').click()
  await expect(page.getByTestId('app-success')).toContainText(/password/i, {
    timeout: UI_TIMEOUT_MS,
  })
}

async function chooseFirstOnboardPassword(page: Page) {
  const entryList = page.getByTestId('onboard-password-entry-list')
  await expect(entryList).toBeVisible()
  await entryList.getByRole('radio').first().click()
}

async function assertAppLogsDoNotLeak(page: Page, sensitiveValues: string[]) {
  await flushNookLogPersistQueue(page)
  const entries = await readPersistedAppLogs(page, 1000)
  const serialized = JSON.stringify(entries ?? [])
  for (const value of sensitiveValues) {
    expect(serialized).not.toContain(value)
  }
  expect(serialized).not.toMatch(/(?:secrets_key|members_key)\s*[:=]/i)
}

async function lastMockPrfOutput(page: Page) {
  return page.evaluate(
    () =>
      (
        window as Window & {
          __nookE2eLastPrfOutput?: string
        }
      ).__nookE2eLastPrfOutput ?? '',
  )
}

async function assertGroupsDoNotOverlap(page: Page, testIds: string[]) {
  const boxes = await Promise.all(
    testIds.map(async (testId) => {
      const locator = page.getByTestId(testId)
      await expect(locator).toBeVisible()
      const box = await locator.boundingBox()
      expect(box, `${testId} should have a layout box`).not.toBeNull()
      return { testId, box: box! }
    }),
  )
  const viewport = page.viewportSize()
  expect(viewport).not.toBeNull()
  for (const { testId, box } of boxes) {
    expect(box.x, `${testId} starts inside viewport`).toBeGreaterThanOrEqual(0)
    expect(
      box.x + box.width,
      `${testId} stays inside viewport width`,
    ).toBeLessThanOrEqual(viewport!.width + 1)
  }
  for (let left = 0; left < boxes.length; left += 1) {
    for (let right = left + 1; right < boxes.length; right += 1) {
      const a = boxes[left]!
      const b = boxes[right]!
      const overlapsX =
        a.box.x < b.box.x + b.box.width && b.box.x < a.box.x + a.box.width
      const overlapsY =
        a.box.y < b.box.y + b.box.height && b.box.y < a.box.y + a.box.height
      expect(
        overlapsX && overlapsY,
        `${a.testId} should not overlap ${b.testId}`,
      ).toBe(false)
    }
  }
}

async function continueToPathChooser(page: Page) {
  await expect(page.getByTestId('get-started-path-chooser')).toBeVisible()
}

async function setLegacyReplicationForProviderTest(
  page: Page,
  mode: 'personal' | 'shared',
) {
  await page.evaluate((replicationMode) => {
    const testWindow = window as Window & {
      __nookVault?: { draftReplicationType: 'personal' | 'shared' }
    }
    if (testWindow.__nookVault) {
      testWindow.__nookVault.draftReplicationType = replicationMode
    }
  }, mode)
}

test.describe('vault architecture modes', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/app/')
    await clearBrowserVault(page)
    await page.reload()
    await expect(page.getByTestId('login-create-vault-chooser')).toBeVisible({
      timeout: UI_TIMEOUT_MS * 2,
    })
  })

  test('follows the system theme until the user chooses one', async ({
    page,
  }) => {
    await page.evaluate(() => localStorage.removeItem('nook_color_mode'))
    await page.emulateMedia({ colorScheme: 'light' })
    await page.reload()

    const app = page.locator('main')
    await expect(app).not.toHaveClass(/dark/)
    await expect(page.getByTestId('theme-toggle-btn')).toHaveAttribute(
      'aria-label',
      /dark/i,
    )

    await page.emulateMedia({ colorScheme: 'dark' })
    await expect(app).toHaveClass(/dark/)
    await expect(page.getByTestId('theme-toggle-btn')).toHaveAttribute(
      'aria-label',
      /light/i,
    )

    await page.getByTestId('theme-toggle-btn').click()
    await expect(app).not.toHaveClass(/dark/)
    await page.emulateMedia({ colorScheme: 'light' })
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect(app).not.toHaveClass(/dark/)
    await page.reload()
    await expect(app).not.toHaveClass(/dark/)
  })

  test('routes simple and sentinel vaults into different creation workflows', async ({
    page,
  }) => {
    await expect(page.getByTestId('mode-group-device')).toHaveCount(0)
    await expect(page.getByTestId('vault-security-orbit')).toBeVisible()
    await expect(
      page.getByTestId('vault-security-orbit').locator('img'),
    ).toHaveAttribute('src', '/nook-logo-dark.png')
    await expect(page.getByTestId('get-started-path-chooser')).toBeVisible()

    await continueToPathChooser(page)
    await expect(page.getByTestId('get-started-path-chooser')).toBeVisible()
    await expect(page.getByTestId('get-started-path-simple')).toBeVisible()
    await expect(page.getByTestId('get-started-path-sentinel')).toBeVisible()
    await expect(page.getByTestId('get-started-path-join')).toHaveCount(0)
    await expect(page.getByTestId('mode-group-vault')).toHaveCount(0)
    await expect(page.getByTestId('mode-group-replication')).toHaveCount(0)
    await expect(page.getByTestId('create-vault-wizard-create')).toHaveCount(0)
    await expect(page.getByTestId('mode-group-onboarding')).toHaveCount(0)
    await expect(
      page.getByTestId('mode-group-provider-capability'),
    ).toHaveCount(0)
    await expect(page.getByTestId('sentinel-genesis-introduction')).toHaveCount(
      0,
    )
    await expect(page.getByTestId('replication-mode-select')).toHaveCount(0)
    await expect(
      page.getByTestId('create-vault-wizard-nav-replication'),
    ).toHaveCount(0)

    await page.getByTestId('get-started-path-simple').click()
    await expect(page.getByTestId('create-vault-wizard-create')).toBeVisible()
    await expect(page.getByTestId('login-vault-name-input')).toBeVisible()
    await expect(
      page.getByTestId('login-create-device-vault-btn'),
    ).toBeVisible()
    await expect(page.getByTestId('login-connect-storage-btn')).toBeVisible()
    await page.getByTestId('create-vault-wizard-back').click()

    await page.getByTestId('get-started-path-sentinel').click()
    await expect(page.getByTestId('sentinel-dashboard-choice')).toBeVisible()
    await expect(page.getByTestId('sentinel-genesis-policy-step')).toHaveCount(
      0,
    )
    await page.getByTestId('sentinel-dashboard-card-stack').click()
    await expect(
      page.getByTestId('sentinel-onboarding-roster-next'),
    ).toHaveCount(0)
    await expect(page.getByTestId('sentinel-genesis-policy-step')).toHaveCount(
      0,
    )
    await expect(page.getByTestId('login-connect-storage-btn')).toHaveCount(0)
    await expect(
      page.getByTestId('login-create-vault-chooser'),
    ).toHaveAttribute('data-sentinel-dashboard', 'card-stack')
    await expect(page.getByTestId('passkey-auth-overlay')).toHaveCount(0)
    await expect(
      page.getByTestId('sentinel-onboarding-create-keys'),
    ).toBeVisible()
    const headingBox = await page
      .getByTestId('sentinel-dashboard-heading')
      .boundingBox()
    const progressBox = await page
      .getByTestId('sentinel-onboarding-progress')
      .boundingBox()
    if (!headingBox || !progressBox) {
      throw new Error('Sentinel heading and progress must have layout boxes')
    }
    expect(headingBox.y).toBeLessThan(progressBox.y)
    expect(headingBox.y).toBeLessThan(96)
    expect(headingBox.height).toBeLessThan(64)
    expect(
      progressBox.y - (headingBox.y + headingBox.height),
    ).toBeLessThanOrEqual(24)
    await expect(page.getByTestId('sentinel-genesis-name-input')).toHaveCount(0)
    await expect(
      page.getByTestId('sentinel-genesis-response-input'),
    ).toHaveCount(0)
    await page.getByTestId('sentinel-onboarding-create-keys').click()
    await expect(page.getByTestId('sentinel-genesis-name-step')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(page.getByTestId('sentinel-genesis-policy-step')).toHaveCount(
      0,
    )
    const actionsColumn = page.getByTestId('sentinel-onboarding-actions-column')
    const summaryColumn = page.getByTestId('sentinel-onboarding-summary-column')
    const nameStep = actionsColumn.getByTestId('sentinel-genesis-name-step')
    const vaultSummary = summaryColumn.getByTestId(
      'sentinel-onboarding-vault-summary',
    )
    await expect(nameStep).toBeVisible()
    await expect(nameStep).toContainText('Name vault')
    await expect(nameStep).not.toContainText('login.')
    await expect(
      page.getByTestId('sentinel-onboarding-continue-policy'),
    ).toHaveText('Continue')
    await expect(vaultSummary).toBeVisible()
    await expect(
      summaryColumn.getByTestId('sentinel-onboarding-summary-name'),
    ).toContainText('NOT SET')
    await expect(summaryColumn.locator('input, [role="combobox"]')).toHaveCount(
      0,
    )
    const nameStepBox = await nameStep.boundingBox()
    const vaultSummaryBox = await vaultSummary.boundingBox()
    const actionsColumnBox = await actionsColumn.boundingBox()
    const summaryColumnBox = await summaryColumn.boundingBox()
    if (
      !nameStepBox ||
      !vaultSummaryBox ||
      !actionsColumnBox ||
      !summaryColumnBox
    ) {
      throw new Error('Sentinel setup columns must have layout boxes')
    }
    expect(nameStepBox.x).toBeLessThan(vaultSummaryBox.x)
    expect(summaryColumnBox.width).toBeGreaterThan(actionsColumnBox.width)
    await expect(
      page.getByTestId('sentinel-genesis-response-input'),
    ).toHaveCount(0)
    await expect(
      summaryColumn.getByTestId('sentinel-onboarding-summary-policy'),
    ).toContainText('NOT SET')
    await page
      .getByTestId('sentinel-genesis-name-input')
      .fill('Ordered Sentinel')
    await expect(
      summaryColumn.getByTestId('sentinel-onboarding-summary-name'),
    ).toHaveText('Ordered Sentinel')
    await page.getByTestId('sentinel-onboarding-continue-policy').click()
    await expect(page.getByTestId('sentinel-genesis-name-step')).toHaveCount(0)
    const policyStep = actionsColumn.getByTestId('sentinel-genesis-policy-step')
    await expect(policyStep).toBeVisible()
    const policyStepBox = await policyStep.boundingBox()
    if (!policyStepBox) {
      throw new Error('Sentinel policy step must have a layout box')
    }
    expect(policyStepBox.x).toBeLessThan(vaultSummaryBox.x)
    await page.getByTestId('sentinel-genesis-threshold').click()
    await page.getByTestId('sentinel-threshold-option-3').click()
    await page.getByTestId('sentinel-genesis-participant-count').click()
    await page.getByTestId('sentinel-participant-count-option-2').click()
    await expect(
      page.getByTestId('sentinel-genesis-threshold'),
    ).toHaveAttribute('data-value', '3')
    await expect(
      page.getByTestId('sentinel-onboarding-continue-devices'),
    ).toBeDisabled()
    await page.getByTestId('sentinel-genesis-threshold').click()
    await page.getByTestId('sentinel-threshold-option-2').click()
    await expect(
      summaryColumn.getByTestId('sentinel-onboarding-summary-policy'),
    ).toContainText('2 OF 2 SHARES REQUIRED')
    await expect(
      actionsColumn.getByTestId('sentinel-onboarding-continue-devices'),
    ).toBeEnabled()
    await page.getByTestId('sentinel-onboarding-continue-devices').click()
    await expect(
      page.getByTestId('sentinel-genesis-response-input'),
    ).toBeVisible()
    await expect(
      page.getByTestId('sentinel-onboarding-roster-next'),
    ).toBeVisible({ timeout: UI_TIMEOUT_MS })
    await expect(
      page.getByTestId('sentinel-onboarding-devices-remaining'),
    ).toContainText('1')
    await expect(page.getByTestId('sentinel-genesis-finalize')).toBeDisabled()
    await expect(
      actionsColumn.getByTestId('sentinel-genesis-finalize'),
    ).toBeVisible()
    await expect(
      summaryColumn.getByTestId('sentinel-genesis-request'),
    ).toBeVisible()
    await expect(
      page.getByTestId('sentinel-genesis-participant-fields'),
    ).toBeVisible()
    await expect(
      page.getByTestId('sentinel-onboarding-progress'),
    ).toContainText('Add devices')
    const progressSteps = page
      .getByTestId('sentinel-onboarding-progress')
      .locator('li')
    await expect(progressSteps.nth(1)).toContainText('Define shares')
    await expect(progressSteps.nth(2)).toHaveAttribute('data-current', 'step')
    await expect(page.getByTestId('login-vault-name-input')).toHaveCount(0)
    await expect(page.getByTestId('replication-mode-select')).toHaveCount(0)
  })

  test('renders wizard copy from the bundled locale catalogs', async ({
    page,
  }) => {
    const chooser = page.getByTestId('login-create-vault-chooser')
    await expect(chooser).toContainText('Keys, not accounts.')
    await continueToPathChooser(page)
    await expect(chooser).toContainText('Choose your vault')
    await expect(page.getByTestId('get-started-path-simple')).toContainText(
      'Create simple vault',
    )
    await expect(page.getByTestId('get-started-path-sentinel')).toContainText(
      'Create Sentinel vault',
    )
    await expect(page.getByTestId('login-path-cloud')).toContainText(
      'Import an existing Simple or Sentinel vault',
    )
    await expect(page.getByTestId('login-connect-storage-btn')).toContainText(
      'Import from sync provider',
    )
    await expect(page.getByTestId('get-started-path-join')).toHaveCount(0)

    await page.getByTestId('header-language-select').click()
    await page.getByTestId('header-language-option-ru').click()

    await expect(chooser).toContainText('Ключи, а не аккаунты.')
    await expect(chooser).toContainText('Выберите сейф')
    await expect(page.getByTestId('get-started-path-simple')).toContainText(
      'Создать простой сейф',
    )
    await expect(page.getByTestId('get-started-path-sentinel')).toContainText(
      'Sentinel',
    )
  })

  test('creates a simple personal vault and keeps secret values out of app logs', async ({
    page,
  }) => {
    await createLocalVaultOnLogin(page, 'Simple personal architecture')
    await assertVaultReady(page)

    const key = uniqueSecretKey('architecture-simple')
    await addSecret(page, key, SIMPLE_SECRET_VALUE)

    await expect(
      page.getByTestId('secret-row').filter({ hasText: key }),
    ).toBeVisible()
    const prfOutput = await lastMockPrfOutput(page)
    expect(prfOutput.length).toBeGreaterThan(0)
    await assertAppLogsDoNotLeak(page, [SIMPLE_SECRET_VALUE, prfOutput])
  })

  test('does not create a sentinel vault before its participant ceremony', async ({
    page,
  }) => {
    await continueToPathChooser(page)
    await page.getByTestId('get-started-path-sentinel').click()
    await page.getByTestId('sentinel-dashboard-terminal').click()
    const terminalDashboard = page.getByTestId('sentinel-terminal-dashboard')
    await expect(terminalDashboard).toBeVisible()
    await expect(terminalDashboard).toBeFocused()
    await expect(
      page.getByTestId('login-create-vault-chooser'),
    ).toHaveAttribute('data-sentinel-dashboard', 'terminal')
    await page.locator('[data-participant-count="16"]').click()
    await expect(page.getByTestId('sentinel-genesis-threshold')).toContainText(
      '2 of 16',
    )
    await page.getByTestId('sentinel-genesis-threshold').click()
    await expect(page.getByTestId('sentinel-genesis-start')).toBeVisible()
    await expect(page.getByTestId('vault-panel')).toHaveCount(0)
    await expect(page.getByTestId('login-connect-storage-btn')).toHaveCount(0)

    await page.getByTestId('sentinel-dashboard-back').click()
    await expect(page.getByTestId('sentinel-dashboard-choice')).toBeVisible()
    await expect(page.getByTestId('sentinel-dashboard-terminal')).toBeFocused()
  })

  test('does not expose unrestricted Sentinel join as a creation path', async ({
    page,
  }) => {
    await continueToPathChooser(page)
    await expect(page.getByTestId('get-started-path-simple')).toBeVisible()
    await expect(page.getByTestId('get-started-path-sentinel')).toBeVisible()
    await expect(page.getByTestId('get-started-path-join')).toHaveCount(0)
    await expect(page.getByTestId('login-enrollment-toggle')).toHaveCount(0)
  })

  test('opens participant response only from an owner invitation URL', async ({
    page,
  }) => {
    await createLocalVaultOnLogin(page)
    const ownerRequest = signedSentinelInvitation()
    await page.goto(
      `/app/?sentinel-request=${encodeURIComponent(ownerRequest)}`,
    )
    await expect(
      page.getByTestId('sentinel-genesis-participant-step'),
    ).toBeVisible({ timeout: UI_TIMEOUT_MS })
    await expect(page.getByTestId('get-started-path-chooser')).toHaveCount(0)
    await expect(
      page.getByTestId('sentinel-genesis-share-request-input'),
    ).toHaveValue(ownerRequest)
    await expect(
      page.getByTestId('sentinel-genesis-connect-device'),
    ).toBeVisible()
  })

  test('disables providers that cannot satisfy shared replication', async ({
    page,
  }) => {
    await setLegacyReplicationForProviderTest(page, 'shared')
    await openLoginProviderSetup(page)

    await expect(page.getByTestId('provider-picker-list')).toBeVisible()
    const github = page.getByTestId('provider-option-github')
    await expect(github).toBeDisabled()
    await expect(github).toContainText('selected replication mode')
    await expect(page.getByTestId('provider-option-oauth-file')).toBeEnabled()
    await expect(page.getByTestId('provider-option-icloud')).toBeDisabled()
    await assertGroupsDoNotOverlap(page, [
      'provider-option-github',
      'provider-option-oauth-file',
      'provider-option-icloud',
    ])
  })

  test('grants shared storage, flushes it, and redeems the link in a second browser', async ({
    browser,
    page,
  }) => {
    const driveStub = createLocalE2eGoogleDriveVaultStub(
      '',
      SHARED_PROVIDER.fileName,
    )
    await driveStub.install(page, {
      accessToken: SHARED_PROVIDER.accessToken,
      fileName: SHARED_PROVIDER.fileName,
    })

    await setLegacyReplicationForProviderTest(page, 'shared')
    await createLocalVaultOnLogin(page, 'Shared replication architecture')
    const sharedSecretKey = uniqueSecretKey('architecture-shared')
    await addSecret(page, sharedSecretKey, SHARED_SECRET_VALUE)
    await seedGithubSyncProvidersWhileUnlocked(page, [PERSONAL_ONLY_PROVIDER])
    await seedOauthFileSyncProvidersWhileUnlocked(
      page,
      [SHARED_PROVIDER],
      driveStub,
      2,
    )

    await openStorageSettings(page)
    await expandSettingsSection(page, 'storage')
    await expect(
      page.getByTestId(`provider-capability-${PERSONAL_ONLY_PROVIDER.id}`),
    ).toContainText(/personal replication only/i)
    await expect(
      page.getByTestId(`sync-provider-${PERSONAL_ONLY_PROVIDER.id}`),
    ).toBeDisabled()
    await expect(
      page.getByTestId(`provider-capability-${SHARED_PROVIDER.id}`),
    ).toContainText(/personal and shared replication/i)

    await openOnboardDevicePanel(page)
    await createOnboardPasswordInline(page)
    await chooseFirstOnboardPassword(page)
    await page
      .getByTestId('onboard-wizard-sync-step')
      .getByRole('button')
      .click()

    const personalOnlyProvider = page.getByTestId(
      `onboard-provider-${PERSONAL_ONLY_PROVIDER.id}`,
    )
    await expect(personalOnlyProvider).toBeDisabled()
    await expect(
      page.getByTestId(
        `onboard-provider-capability-${PERSONAL_ONLY_PROVIDER.id}`,
      ),
    ).toContainText(/personal replication only/i)
    await expect(
      page.getByTestId(`onboard-provider-${SHARED_PROVIDER.id}`),
    ).toHaveAttribute('aria-checked', 'true')

    await expect(page.getByTestId('onboard-wizard-sync-step')).toContainText(
      'Shared architecture drive connected',
    )

    await expect(page.getByTestId('onboarding-type-label')).toContainText(
      'Shared provider grant',
    )
    await expect(page.getByTestId('shared-joiner-identity-input')).toBeVisible()
    await page.getByTestId('onboard-password-input').fill(ONBOARD_PASSWORD)
    await page.getByTestId('onboard-device-submit').click()
    await expect(page.getByTestId('onboard-error')).toContainText(
      /joiner provider identity/i,
    )
    await expect(page.getByTestId('onboarding-link-url')).toHaveCount(0)

    await page
      .getByTestId('shared-joiner-identity-input')
      .fill(SHARED_JOINER_IDENTITY)
    await page.getByTestId('onboard-device-submit').click()

    const linkInput = page.getByTestId('onboarding-link-url')
    await expect(linkInput).toBeVisible({ timeout: UI_TIMEOUT_MS })
    await expect(page.getByTestId('shared-grant-instructions')).toContainText(
      SHARED_JOINER_IDENTITY,
    )
    await expect(page.getByTestId('shared-grant-instructions')).toContainText(
      /Shared Drive folder|готова|ready/i,
    )
    expect(driveStub.getSharedFolders().length).toBeGreaterThan(0)
    const sharedFolder = driveStub.getSharedFolders()[0]!
    expect(sharedFolder.writers).toContain(SHARED_JOINER_IDENTITY)
    await expect
      .poll(() => driveStub.getEventFileCountForParent(sharedFolder.id), {
        timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
      })
      .toBeGreaterThan(0)
    const link = (await linkInput.inputValue()).trim()
    const code = enrollmentCodeFromLink(link)
    const envelope = JSON.parse(
      Buffer.from(code, 'base64url').toString('utf8'),
    ) as {
      ct?: string
      password?: string
      provider?: unknown
    }

    expect(envelope.ct).toBeTruthy()
    expect(envelope.password).toBeUndefined()
    expect(envelope.provider).toBeUndefined()
    expect(JSON.stringify(envelope)).not.toContain(SHARED_PROVIDER.accessToken)
    expect(JSON.stringify(envelope)).not.toContain(ONBOARD_PASSWORD)
    await assertAppLogsDoNotLeak(page, [
      SHARED_PROVIDER.accessToken,
      PERSONAL_ONLY_PROVIDER.githubPat,
      ONBOARD_PASSWORD,
      code,
      SHARED_SECRET_VALUE,
    ])

    const joinerContext = await createIsolatedContext(browser)
    const joiner = await joinerContext.newPage()
    try {
      await driveStub.install(joiner, {
        accessToken: SHARED_JOINER_TOKEN,
        fileName: SHARED_PROVIDER.fileName,
      })
      await joiner.goto('/app/')
      await expect(
        joiner.getByTestId('login-create-vault-chooser'),
      ).toBeVisible({
        timeout: UI_TIMEOUT_MS,
      })
      await seedExtraOauthFileProviders(joiner, [
        {
          id: 'architecture-shared-joiner-provider',
          label: 'Joiner shared architecture drive',
          fileName: SHARED_PROVIDER.fileName,
          accessToken: SHARED_JOINER_TOKEN,
          accountEmail: SHARED_JOINER_IDENTITY,
          folderId: sharedFolder.id,
        },
      ])
      await joiner.goto('about:blank')
      await joiner.goto(link)
      await expect(joiner.getByTestId('enrollment-scan-panel')).toBeVisible({
        timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
      })
      await joiner
        .getByTestId('enrollment-password-input')
        .fill(ONBOARD_PASSWORD)
      await joiner.getByTestId('submit-enrollment-code-btn').click()
      await waitForVaultUnlocked(joiner, ENROLLMENT_UNLOCK_TIMEOUT_MS)
      await assertVaultReady(joiner)
      const revealed = await revealSecretValue(joiner, sharedSecretKey)
      expect(revealed).toBe(SHARED_SECRET_VALUE)
      await assertAppLogsDoNotLeak(joiner, [
        SHARED_JOINER_TOKEN,
        ONBOARD_PASSWORD,
        code,
        SHARED_SECRET_VALUE,
      ])
    } finally {
      await joiner.close()
      await joinerContext.close()
    }
  })

  test('preserves and flushes the created folder when Drive sharing needs manual completion', async ({
    page,
  }) => {
    const driveStub = createLocalE2eGoogleDriveVaultStub(
      '',
      SHARED_PROVIDER.fileName,
    )
    await driveStub.install(page, {
      accessToken: SHARED_PROVIDER.accessToken,
      fileName: SHARED_PROVIDER.fileName,
      sharedPermissionStatus: 403,
    })

    await setLegacyReplicationForProviderTest(page, 'shared')
    await createLocalVaultOnLogin(page, 'Manual shared grant architecture')
    await seedOauthFileSyncProvidersWhileUnlocked(
      page,
      [SHARED_PROVIDER],
      driveStub,
    )
    // The seeding helper installs its normal-success route after the initial
    // route. Reinstall the failure behavior last so Playwright dispatches the
    // permission request through the manual-grant scenario.
    await driveStub.install(page, {
      accessToken: SHARED_PROVIDER.accessToken,
      fileName: SHARED_PROVIDER.fileName,
      sharedPermissionStatus: 403,
    })
    await openOnboardDevicePanel(page)
    await createOnboardPasswordInline(page)
    await chooseFirstOnboardPassword(page)
    await page
      .getByTestId('shared-joiner-identity-input')
      .fill(SHARED_JOINER_IDENTITY)
    await page.getByTestId('onboard-password-input').fill(ONBOARD_PASSWORD)
    await page.getByTestId('onboard-device-submit').click()

    await expect(page.getByTestId('onboarding-link-url')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    const sharedFolder = driveStub.getSharedFolders()[0]!
    expect(sharedFolder.writers).toEqual([])
    await expect(page.getByTestId('shared-grant-instructions')).toContainText(
      sharedFolder.name,
    )
    await expect(page.getByTestId('shared-grant-instructions')).toContainText(
      SHARED_JOINER_IDENTITY,
    )
    await expect
      .poll(() => driveStub.getEventFileCountForParent(sharedFolder.id), {
        timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
      })
      .toBeGreaterThan(0)
  })

  test.describe('mobile', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test('keeps mode and provider gates usable on narrow screens', async ({
      page,
    }) => {
      await continueToPathChooser(page)
      await expect(page.getByTestId('get-started-path-chooser')).toBeVisible()
      await expect(page.getByTestId('mode-group-vault')).toHaveCount(0)
      await expect(page.getByTestId('mode-group-onboarding')).toHaveCount(0)
      await expect(
        page.getByTestId('mode-group-provider-capability'),
      ).toHaveCount(0)
      await page.getByTestId('get-started-path-sentinel').click()
      await page.getByTestId('sentinel-dashboard-card-stack').click()
      await expect(
        page.getByTestId('sentinel-onboarding-roster-next'),
      ).toHaveCount(0)
      await expect(
        page.getByTestId('sentinel-onboarding-create-keys'),
      ).toBeVisible({ timeout: UI_TIMEOUT_MS })
      await expect(
        page.getByTestId('sentinel-genesis-policy-step'),
      ).toHaveCount(0)
      await page.getByTestId('sentinel-dashboard-back').click()
      await page.getByTestId('create-vault-wizard-back').click()

      // Sentinel genesis is provider-free and has its own creation ceremony.
      // Return to the chooser before exercising the legacy provider gates.
      await setLegacyReplicationForProviderTest(page, 'shared')
      await openLoginProviderSetup(page)
      await expect(page.getByTestId('provider-picker-list')).toBeVisible()
      await expect(page.getByTestId('provider-option-github')).toBeDisabled()
      await expect(page.getByTestId('provider-option-oauth-file')).toBeEnabled()
      await assertGroupsDoNotOverlap(page, [
        'provider-option-github',
        'provider-option-oauth-file',
        'provider-option-icloud',
      ])
    })
  })
})
