import { expect, test, type Page } from './fixtures'
import { createLocalE2eGoogleDriveVaultStub } from './drive-stub'
import {
  addSecret,
  assertVaultReady,
  clearBrowserVault,
  createLocalVaultOnLogin,
  enrollmentCodeFromLink,
  flushNookLogPersistQueue,
  openLoginProviderSetup,
  openOnboardDevicePanel,
  readPersistedAppLogs,
  seedOauthFileSyncProvidersWhileUnlocked,
  UI_TIMEOUT_MS,
  uniqueSecretKey,
} from './helpers'

const SIMPLE_SECRET_VALUE = 'architecture-simple-secret-value'
const ONBOARD_PASSWORD = 'architecture-onboard-password-1'
const SHARED_JOINER_IDENTITY = 'joiner@example.com'
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
}

test.describe('vault architecture modes', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await clearBrowserVault(page)
    await page.reload()
    await expect(page.getByTestId('login-create-vault-chooser')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
  })

  test('shows mode selectors and gates nexus secret creation setup', async ({
    page,
  }) => {
    await expect(page.getByTestId('mode-group-device')).toBeVisible()
    await expect(page.getByTestId('mode-group-vault')).toBeVisible()
    await expect(page.getByTestId('mode-group-replication')).toBeVisible()
    await expect(page.getByTestId('nexus-readiness-gate')).toHaveCount(0)

    await page.getByTestId('mode-option-anti-hacker').click()
    await expect(page.getByTestId('mode-option-anti-hacker')).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await page.getByTestId('mode-option-nexus').click()
    await expect(page.getByTestId('nexus-readiness-gate')).toBeVisible()

    await page.getByTestId('mode-option-simple').click()
    await expect(page.getByTestId('nexus-readiness-gate')).toHaveCount(0)
  })

  test('creates a simple personal vault and keeps secret values out of app logs', async ({
    page,
  }) => {
    await page.getByTestId('mode-option-simple').click()
    await page.getByTestId('mode-option-personal').click()
    await createLocalVaultOnLogin(page, 'Simple personal architecture')
    await assertVaultReady(page)

    const key = uniqueSecretKey('architecture-simple')
    await addSecret(page, key, SIMPLE_SECRET_VALUE)

    await expect(
      page.getByTestId('secret-row').filter({ hasText: key }),
    ).toBeVisible()
    await assertAppLogsDoNotLeak(page, [SIMPLE_SECRET_VALUE])
  })

  test('keeps a new nexus vault locked for secret creation until shares exist', async ({
    page,
  }) => {
    await page.getByTestId('mode-option-nexus').click()
    await expect(page.getByTestId('nexus-readiness-gate')).toBeVisible()
    await createLocalVaultOnLogin(page, 'Nexus architecture')
    await assertVaultReady(page)

    await expect(page.getByTestId('add-secret-btn')).toBeDisabled()
    await expect(page.getByTestId('secret-edit-blocked-banner')).toContainText(
      'Nexus secret creation is locked',
    )
  })

  test('disables providers that cannot satisfy shared replication', async ({
    page,
  }) => {
    await page.getByTestId('mode-option-shared').click()
    await openLoginProviderSetup(page)

    await expect(page.getByTestId('provider-picker-list')).toBeVisible()
    const github = page.getByTestId('provider-option-github')
    await expect(github).toBeDisabled()
    await expect(github).toContainText('selected replication mode')
    await expect(page.getByTestId('provider-option-oauth-file')).toBeEnabled()
    await expect(page.getByTestId('provider-option-icloud')).toBeDisabled()
  })

  test('collects a shared provider identity before issuing an onboarding link', async ({
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

    await page.getByTestId('mode-option-shared').click()
    await createLocalVaultOnLogin(page, 'Shared replication architecture')
    await seedOauthFileSyncProvidersWhileUnlocked(
      page,
      [SHARED_PROVIDER],
      driveStub,
    )

    await openOnboardDevicePanel(page)
    await createOnboardPasswordInline(page)
    await chooseFirstOnboardPassword(page)

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
    expect(driveStub.getSharedFolders()[0]?.writers).toContain(
      SHARED_JOINER_IDENTITY,
    )
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
      ONBOARD_PASSWORD,
      code,
    ])
  })

  test.describe('mobile', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test('keeps mode and provider gates usable on narrow screens', async ({
      page,
    }) => {
      await expect(page.getByTestId('mode-group-vault')).toBeVisible()
      await page.getByTestId('mode-option-nexus').click()
      await expect(page.getByTestId('nexus-readiness-gate')).toBeVisible()

      await page.getByTestId('mode-option-shared').click()
      await openLoginProviderSetup(page)
      await expect(page.getByTestId('provider-picker-list')).toBeVisible()
      await expect(page.getByTestId('provider-option-github')).toBeDisabled()
      await expect(page.getByTestId('provider-option-oauth-file')).toBeEnabled()
    })
  })
})
