import { test, expect, type BrowserContext, type Page } from './fixtures'
import {
  addSecret,
  addVaultPassword,
  assertVaultReady,
  createIsolatedContext,
  dismissSyncConflictIfVisible,
  expandSettingsSection,
  expandLoginEnrollmentPanel,
  expectNoVaultPasswords,
  openStorageSettings,
  invokeInitializedVaultProviderReload,
  revealSecretValue,
  rotateVaultPassword,
  seedExtraOauthFileProviders,
  seedLocalVaultYamlForEnrollment,
  readLocalVaultYamlFromIdb,
  readNookLogEntries,
  readNookLogSnapshot,
  readRawAuthProvidersFromIdb,
  submitOnboardEnrollmentCode,
  enrollmentCodeFromLink,
  triggerVaultSyncRefresh,
  waitForVaultOperationsIdle,
  UI_TIMEOUT_MS,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  uniqueSecretKey,
  waitForGithubVaultState,
  waitForLocalVaultState,
  waitForStableLocalVaultState,
  parseJson,
  readStringProperty,
  requireRecord,
  waitForVaultUnlocked,
} from './helpers'
import {
  createSyncTarget,
  E2eSyncProviderId,
  installSyncRemote,
  installSyncRemoteOnPages,
  connectSyncGenesisDevice,
  waitForSyncRemoteState,
  type SyncE2eTarget,
} from './sync-provider'
import { GithubStubFailureScenario } from './helpers/local-sync'
import { PasswordEnvelopeCiphertextStateKind } from './vault-yaml'

test.describe('vault password envelope with sync provider', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(180_000)

  let deviceA: Page
  let deviceB: Page
  let contextA: BrowserContext
  let contextB: BrowserContext
  let target: SyncE2eTarget

  const sharedSecretKey = uniqueSecretKey('e2e-pw-shared')
  const sharedSecretValue = 'shared-via-qr-enrollment'
  const vaultPassword = 'correct-horse-battery-staple'

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000)
    target = createSyncTarget('', 'password-envelope')

    contextA = await createIsolatedContext(browser)
    contextB = await createIsolatedContext(browser)
    deviceA = await contextA.newPage()
    deviceB = await contextB.newPage()

    await installSyncRemoteOnPages([deviceA, deviceB], target)
    await connectSyncGenesisDevice(deviceA, target)
    await addSecret(deviceA, sharedSecretKey, sharedSecretValue, target)
    await waitForSyncRemoteState(target, (yaml) => yaml.secretIds.length >= 1)
  })

  test.afterAll(async () => {
    await deviceA?.close()
    await deviceB?.close()
    await contextA?.close()
    await contextB?.close()
  })

  test('attaching a password switches the vault to password unlock mode', async () => {
    await openStorageSettings(deviceA)
    await expectNoVaultPasswords(deviceA)

    await addVaultPassword(deviceA, 'GitHub vault', vaultPassword)
    await deviceA.getByTestId('vault-secrets-tab').click()

    const yaml = await waitForStableLocalVaultState(
      deviceA,
      (snapshot) =>
        snapshot.hasPasswordEnvelope && snapshot.authPkIds.length >= 1,
    )
    expect(yaml.unlockMode).toBe('keys')
    expect(yaml.hasPasswordEnvelope).toBe(true)
    expect(yaml.authPkIds.length).toBeGreaterThanOrEqual(1)
    expect(yaml.joinEntries).toHaveLength(0)
    expect(yaml.memberPkIds.length).toBeGreaterThanOrEqual(1)
    expect(yaml.secretIds.length).toBeGreaterThanOrEqual(1)
  })

  test('device A issues an enrollment link without plaintext provider credentials', async () => {
    await deviceA.getByTestId('vault-secrets-tab').click()
    await expect(deviceA.getByTestId('vault-panel')).toBeVisible()
    await deviceA.getByTestId('vault-onboard-tab').click()
    const linkInput = await submitOnboardEnrollmentCode(deviceA, vaultPassword)
    const link = (await linkInput.inputValue()).trim()
    expect(link).toContain('#enroll=')
    const code = enrollmentCodeFromLink(link)
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/)

    const outer = requireRecord(
      parseJson(Buffer.from(code, 'base64url').toString('utf8')),
      'enrollment link payload',
    )
    expect(outer.entry_id).toBeTruthy()
    expect(Object.hasOwn(outer, 'provider')).toBe(false)
    expect(Object.hasOwn(outer, 'password')).toBe(false)
    expect(outer.ct).toBeTruthy()
    const issuedAt = readStringProperty(
      outer,
      'issued_at',
      'enrollment link payload',
    )
    expect(Date.parse(issuedAt)).not.toBeNaN()

    test.info().annotations.push({ type: 'enrollment-link', description: link })
  })

  test('device B self-enrols via the pasted link without approval', async () => {
    const linkInput = deviceA.getByTestId('onboarding-link-url')
    const link = (await linkInput.inputValue()).trim()
    expect(link).toContain('#enroll=')

    const enrollmentYaml = await readLocalVaultYamlFromIdb(deviceA)
    expect(enrollmentYaml.trim().length).toBeGreaterThan(0)
    await installSyncRemote(deviceB, target)

    await deviceB.goto('/app/')
    await expect(deviceB.getByTestId('login-gate')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await deviceB.waitForFunction(
      () =>
        Boolean(
          (
            window as Window & {
              __nookVault?: unknown
            }
          ).__nookVault,
        ),
      { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    await seedLocalVaultYamlForEnrollment(deviceB, enrollmentYaml)
    await seedExtraOauthFileProviders(deviceB, [
      {
        id: 'e2e-enroll-sync',
        label: 'File',
        fileName: target.repoName,
        accessToken: target.pat,
      },
    ])
    await invokeInitializedVaultProviderReload(deviceB)

    await expandLoginEnrollmentPanel(deviceB)
    await deviceB.getByTestId('open-enrollment-code-btn').click()
    await deviceB.getByTestId('enrollment-code-input').fill(link)
    await deviceB.getByTestId('enrollment-password-input').fill(vaultPassword)
    await deviceB.getByTestId('submit-enrollment-code-btn').click()

    await waitForVaultUnlocked(deviceB, ENROLLMENT_UNLOCK_TIMEOUT_MS)
    await assertVaultReady(deviceB)

    const row = deviceB
      .getByTestId('secret-row')
      .filter({ hasText: sharedSecretKey })
    await expect(row).toBeVisible({ timeout: UI_TIMEOUT_MS })
    const revealed = await revealSecretValue(deviceB, sharedSecretKey)
    expect(revealed).toBe(sharedSecretValue)

    const localYaml = await waitForLocalVaultState(
      deviceB,
      (snapshot) =>
        snapshot.authPkIds.length >= 1 && snapshot.secretIds.length >= 1,
    )
    expect(localYaml.unlockMode).toBe('keys')
    expect(localYaml.secretIds.length).toBeGreaterThanOrEqual(1)

    const yaml = await waitForGithubVaultState(
      target,
      (snapshot) =>
        snapshot.memberPkIds.length >= 2 && snapshot.joinEntries.length === 0,
      { page: deviceB, timeoutMs: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    expect(yaml.unlockMode).toBe('keys')
    expect(yaml.joinEntries).toHaveLength(0)
  })

  test('rotating the password rewrites the envelope on the sync provider', async () => {
    const before = await waitForLocalVaultState(
      deviceA,
      (snapshot) => snapshot.hasPasswordEnvelope,
    )
    const oldEnvelope = before.passwordEnvelopeCiphertext
    expect(oldEnvelope.kind).toBe(PasswordEnvelopeCiphertextStateKind.Present)

    await openStorageSettings(deviceA)
    await rotateVaultPassword(deviceA, 'rotated-pw-9')

    const after = await waitForStableLocalVaultState(
      deviceA,
      (snapshot) =>
        snapshot.hasPasswordEnvelope &&
        snapshot.passwordEnvelopeCiphertext.kind ===
          PasswordEnvelopeCiphertextStateKind.Present &&
        (oldEnvelope.kind !== PasswordEnvelopeCiphertextStateKind.Present ||
          snapshot.passwordEnvelopeCiphertext.ciphertext !==
            oldEnvelope.ciphertext),
      { timeoutMs: ENROLLMENT_UNLOCK_TIMEOUT_MS, stableReads: 2 },
    )
    expect(after.passwordEnvelopeCiphertext.kind).toBe(
      PasswordEnvelopeCiphertextStateKind.Present,
    )
  })

  test('removing the backup password leaves device-key unlock intact', async () => {
    if (!(await deviceA.getByTestId('vault-admin-panel').isVisible())) {
      await openStorageSettings(deviceA)
    }
    await waitForGithubVaultState(
      target,
      (snapshot) => snapshot.hasPasswordEnvelope,
      { timeoutMs: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    await expandSettingsSection(deviceA, 'unlock')
    await dismissSyncConflictIfVisible(deviceA)
    await deviceA.getByTestId('remove-vault-password-btn').click()
    await deviceA.getByTestId('confirm-remove-vault-password').click()
    await waitForGithubVaultState(
      target,
      (snapshot) => !snapshot.hasPasswordEnvelope,
      { timeoutMs: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    await expectNoVaultPasswords(deviceA, {
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })

    const yaml = await waitForLocalVaultState(
      deviceA,
      (snapshot) =>
        snapshot.unlockMode === 'keys' &&
        !snapshot.hasPasswordEnvelope &&
        snapshot.authPkIds.length >= 1,
    )
    expect(yaml.unlockMode).toBe('keys')
    expect(yaml.hasPasswordEnvelope).toBe(false)
    expect(yaml.authPkIds.length).toBeGreaterThanOrEqual(1)
    expect(yaml.secretIds.length).toBeGreaterThanOrEqual(1)
  })

  test('translates a GitHub 401 and logs only fixed rejection metadata', async () => {
    if (target.providerId !== E2eSyncProviderId.GitHub || !target.stub) {
      throw new Error('This scenario requires the GitHub mock provider')
    }
    const stub = target.stub
    const fixtureToken = 'fixture-rejected-token-not-a-pat'
    stub.setFailureScenario(GithubStubFailureScenario.UserUnauthorized)
    const logCountBefore = (await readNookLogEntries(deviceA, 500)).length

    await openStorageSettings(deviceA)
    await expandSettingsSection(deviceA, 'storage')
    await deviceA.getByTestId('add-provider-btn').first().click()
    await deviceA.getByTestId('provider-option-github').click()
    await deviceA.getByTestId('github-repo-input').fill('e2e-rejected-repo')
    await deviceA.getByTestId('github-pat-input').fill(fixtureToken)
    await deviceA.getByTestId('connect-provider-btn').click()

    await expect(deviceA.getByTestId('vault-error')).toContainText(
      'GitHub rejected this token (401). Check that it is active and has access to the selected repository.',
    )
    expect(stub.getFailureResponses().length).toBeGreaterThan(0)
    expect(
      stub
        .getFailureResponses()
        .every(
          (response) => response.path === '/user' && response.status === 401,
        ),
    ).toBe(true)
    const logEntries = await readNookLogEntries(deviceA, 500)
    const assessmentWarning = logEntries
      .slice(logCountBefore)
      .find((entry) => entry.message === 'provider vault assessment failed')
    expect(assessmentWarning?.data).toBe(
      JSON.stringify({
        provider_type: 'github',
        failure_kind: 'github-token-rejected',
        http_status: 401,
      }),
    )
    expect(JSON.stringify(assessmentWarning)).not.toContain(fixtureToken)
    expect(await deviceA.locator('body').innerText()).not.toContain(
      fixtureToken,
    )
    expect(await deviceA.content()).not.toContain(fixtureToken)
    await expect(deviceA.getByTestId('github-pat-input')).toHaveCount(0)
    const storedProviders = await readRawAuthProvidersFromIdb(deviceA)
    expect(JSON.stringify(storedProviders)).not.toContain(fixtureToken)

    const cancelSetup = deviceA.getByTestId('cancel-provider-setup')
    if ((await cancelSetup.count()) > 0) await cancelSetup.click()
    const cancelAdd = deviceA.getByTestId('cancel-add-provider-btn')
    if ((await cancelAdd.count()) > 0) await cancelAdd.click()
    await expect(
      deviceA.locator('[data-testid^="sync-provider-"]').first(),
    ).toBeVisible()
    stub.setFailureScenario(GithubStubFailureScenario.None)
  })

  test('reports event-log 403 as a translated sync failure with safe metadata', async () => {
    if (target.providerId !== E2eSyncProviderId.GitHub || !target.stub) {
      throw new Error('This scenario requires the GitHub mock provider')
    }
    await deviceB.close()
    const stub = target.stub
    stub.setFailureScenario(GithubStubFailureScenario.EventLogForbidden)
    await deviceA.getByTestId('vault-secrets-tab').click()
    const eventKey = uniqueSecretKey('e2e-github-permission-event')
    await deviceA.getByTestId('add-secret-btn').click()
    await deviceA.getByTestId('add-secret-panel').waitFor({ state: 'visible' })
    await deviceA.getByTestId('item-type-api-key').click()
    await deviceA.getByTestId('secret-label').fill(eventKey)
    await deviceA
      .getByTestId('secret-value')
      .fill('fixture event for GitHub repository permission coverage')
    await deviceA.getByTestId('save-secret-btn').click()
    await waitForVaultOperationsIdle(deviceA)

    const expectedFailureContext = JSON.stringify({
      provider_type: 'github',
      failure_kind: 'operation-failed',
    })
    const logSnapshotBeforeRefresh = await readNookLogSnapshot(deviceA, {
      limit: 5000,
    })
    const failureCountBeforeRefresh = logSnapshotBeforeRefresh.entries.filter(
      (entry) =>
        entry.message === 'provider synchronization failed' &&
        entry.data === expectedFailureContext,
    ).length

    await triggerVaultSyncRefresh(deviceA)
    const failureResponses = stub.getFailureResponses()
    expect(failureResponses).toContainEqual(
      expect.objectContaining({
        status: 403,
        path: expect.stringContaining('/contents/nook-log/'),
      }),
    )
    const refreshLogSnapshot = await readNookLogSnapshot(deviceA, {
      limit: 5000,
    })
    const synchronizationFailures = refreshLogSnapshot.entries.filter(
      (entry) =>
        entry.message === 'provider synchronization failed' &&
        entry.data === expectedFailureContext,
    )
    expect(synchronizationFailures.length).toBeGreaterThan(
      failureCountBeforeRefresh,
    )
    const synchronizationFailure =
      synchronizationFailures[synchronizationFailures.length - 1]
    expect(synchronizationFailure?.level).toBe('warn')
    expect(synchronizationFailure?.data).toBe(expectedFailureContext)
    await expect(deviceA.getByTestId('vault-error')).toContainText(
      'Sync failed for this provider.',
    )

    expect(JSON.stringify(refreshLogSnapshot.entries)).not.toContain(target.pat)
    expect(JSON.stringify(refreshLogSnapshot.entries)).not.toContain(
      'Resource not accessible by integration',
    )
  })
})
