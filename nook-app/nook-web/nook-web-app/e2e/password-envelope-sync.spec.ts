import { test, expect, type BrowserContext, type Page } from './fixtures'
import {
  addSecret,
  addVaultPassword,
  assertVaultReady,
  createIsolatedContext,
  dismissSyncConflictIfVisible,
  expandSettingsSection,
  expandLoginEnrollmentPanel,
  expectVaultPasswordStatus,
  openStorageSettings,
  revealSecretValue,
  rotateVaultPassword,
  seedExtraOauthFileProviders,
  seedLocalVaultYamlForEnrollment,
  readLocalVaultYamlFromIdb,
  submitOnboardEnrollmentCode,
  enrollmentCodeFromLink,
  UI_TIMEOUT_MS,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  uniqueSecretKey,
  waitForGithubVaultState,
  waitForLocalVaultState,
  waitForStableLocalVaultState,
  waitForVaultUnlocked,
} from './helpers'
import {
  createSyncTarget,
  installSyncRemote,
  installSyncRemoteOnPages,
  connectSyncGenesisDevice,
  waitForSyncRemoteState,
  type SyncE2eTarget,
} from './sync-provider'

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
    await expectVaultPasswordStatus(deviceA, 'none')

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

    const outer = JSON.parse(
      Buffer.from(code, 'base64url').toString('utf8'),
    ) as {
      entry_id?: string
      provider?: { type: string; pat?: string; repo?: string }
      password?: string
      issued_at: string
      ct?: string
    }
    expect(outer.entry_id).toBeTruthy()
    expect(outer.provider).toBeUndefined()
    expect(outer.password).toBeUndefined()
    expect(outer.ct).toBeTruthy()
    expect(typeof outer.issued_at).toBe('string')
    expect(Date.parse(outer.issued_at)).not.toBeNaN()

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
    await deviceB.evaluate(async () => {
      const vault = (
        window as Window & {
          __nookVault?: { loadProviders?: () => Promise<void> }
        }
      ).__nookVault
      await vault?.loadProviders?.()
    })

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
    expect(oldEnvelope).not.toBeUndefined()

    await openStorageSettings(deviceA)
    await rotateVaultPassword(deviceA, 'rotated-pw-9')

    const after = await waitForStableLocalVaultState(
      deviceA,
      (snapshot) =>
        snapshot.hasPasswordEnvelope &&
        snapshot.passwordEnvelopeCiphertext !== undefined &&
        snapshot.passwordEnvelopeCiphertext !== oldEnvelope,
      { timeoutMs: ENROLLMENT_UNLOCK_TIMEOUT_MS, stableReads: 2 },
    )
    expect(after.passwordEnvelopeCiphertext).not.toBe(oldEnvelope)
    expect(after.passwordEnvelopeCiphertext).not.toBeUndefined()
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
    await expectVaultPasswordStatus(deviceA, 'none', {
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
})
