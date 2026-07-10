import { expect, test, type Page } from './fixtures'
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

test.describe('vault architecture modes', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await clearBrowserVault(page)
    await page.reload()
    await expect(page.getByTestId('login-create-vault-chooser')).toBeVisible({
      timeout: UI_TIMEOUT_MS * 2,
    })
  })

  test('shows only actionable vault selectors', async ({
    page,
  }) => {
    await expect(page.getByTestId('mode-group-device')).toHaveCount(0)
    await expect(page.getByTestId('mode-group-vault')).toBeVisible()
    await expect(page.getByTestId('mode-group-replication')).toBeVisible()
    await expect(page.getByTestId('mode-group-onboarding')).toHaveCount(0)
    await expect(page.getByTestId('mode-group-provider-capability')).toHaveCount(
      0,
    )
    await assertGroupsDoNotOverlap(page, [
      'mode-group-vault',
      'mode-group-replication',
    ])
    await expect(page.getByTestId('nexus-readiness-gate')).toHaveCount(0)

    await page.getByTestId('vault-mode-select').click()
    await page.getByTestId('mode-option-nexus').click()
    await expect(page.getByTestId('nexus-readiness-gate')).toBeVisible()

    await page.getByTestId('vault-mode-select').click()
    await page.getByTestId('mode-option-simple').click()
    await expect(page.getByTestId('nexus-readiness-gate')).toHaveCount(0)
  })

  test('creates a simple personal vault and keeps secret values out of app logs', async ({
    page,
  }) => {
    await page.getByTestId('vault-mode-select').click()
    await page.getByTestId('mode-option-simple').click()
    await page.getByTestId('replication-mode-select').click()
    await page.getByTestId('mode-option-personal').click()
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

  test('keeps a new nexus vault locked for secret creation until shares exist', async ({
    page,
  }) => {
    await page.getByTestId('vault-mode-select').click()
    await page.getByTestId('mode-option-nexus').click()
    await expect(page.getByTestId('nexus-readiness-gate')).toBeVisible()
    await createLocalVaultOnLogin(page, 'Nexus architecture')
    await assertVaultReady(page)

    await expect(page.getByTestId('add-secret-btn')).toBeDisabled()
    await expect(page.getByTestId('secret-edit-blocked-banner')).toContainText(
      'Nexus secret creation is locked',
    )

    await openOnboardDevicePanel(page)
    await expect(page.getByTestId('nexus-onboard-guidance')).toBeVisible()
    await expect(page.getByTestId('nexus-participant-readiness')).toContainText(
      '0 of 2 participants ready',
    )
    await expect(page.getByTestId('onboard-password-prerequisite')).toHaveCount(
      0,
    )
    await expect(page.getByTestId('onboard-device-submit')).toHaveCount(0)

    await page.getByTestId('nexus-review-joins').click()
    await expect(page.getByTestId('vault-devices-section')).toBeVisible()
  })

  test('disables providers that cannot satisfy shared replication', async ({
    page,
  }) => {
    await page.getByTestId('replication-mode-select').click()
    await page.getByTestId('mode-option-shared').click()
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

    await page.getByTestId('replication-mode-select').click()
    await page.getByTestId('mode-option-shared').click()
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
      await joiner.goto('/')
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

    await page.getByTestId('replication-mode-select').click()
    await page.getByTestId('mode-option-shared').click()
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
      await expect(page.getByTestId('mode-group-vault')).toBeVisible()
      await expect(page.getByTestId('mode-group-onboarding')).toHaveCount(0)
      await expect(
        page.getByTestId('mode-group-provider-capability'),
      ).toHaveCount(0)
      await assertGroupsDoNotOverlap(page, [
        'mode-group-vault',
        'mode-group-replication',
      ])
      await page.getByTestId('vault-mode-select').click()
      await page.getByTestId('mode-option-nexus').click()
      await expect(page.getByTestId('nexus-readiness-gate')).toBeVisible()

      await page.getByTestId('replication-mode-select').click()
      await page.getByTestId('mode-option-shared').click()
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
