import { test, expect, type BrowserContext, type Page } from '@playwright/test'
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
  submitOnboardEnrollmentCode,
  UI_TIMEOUT_MS,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  uniqueSecretKey,
  waitForGithubVaultState,
  waitForLocalVaultState,
  waitForStableLocalVaultState,
  waitForVaultOperationsIdle,
  waitForVaultSyncIdle,
  waitForVaultUnlocked,
} from './helpers'
import {
  createSyncTarget,
  installSyncStubOnPages,
  connectSyncGenesisDevice,
  type SyncE2eTarget,
} from './sync-provider'

test.describe('vault password envelope (stub sync)', () => {
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

    await installSyncStubOnPages([deviceA, deviceB], target)
    await connectSyncGenesisDevice(deviceA, target)
    await waitForVaultOperationsIdle(deviceA)
    await waitForVaultSyncIdle(deviceA)
    await addSecret(deviceA, sharedSecretKey, sharedSecretValue, target)
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

  test('device A issues an enrollment code carrying github credentials', async () => {
    await deviceA.getByTestId('vault-secrets-tab').click()
    await expect(deviceA.getByTestId('vault-panel')).toBeVisible()
    await deviceA.getByTestId('vault-onboard-tab').click()
    const codeArea = await submitOnboardEnrollmentCode(deviceA, vaultPassword)
    const code = (await codeArea.inputValue()).trim()
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

    test.info().annotations.push({ type: 'enrollment-code', description: code })
  })

  test('device B self-enrols via the pasted code without approval', async () => {
    const codeArea = deviceA.getByTestId('onboard-code')
    const code = (await codeArea.inputValue()).trim()
    expect(code.length).toBeGreaterThan(40)

    await deviceB.goto('/')
    await expect(deviceB.getByTestId('login-gate')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })

    await expandLoginEnrollmentPanel(deviceB)
    await deviceB.getByTestId('open-enrollment-code-btn').click()
    await deviceB.getByTestId('enrollment-code-input').fill(code)
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
      (snapshot) => snapshot.memberPkIds.length >= 1,
      { page: deviceB, timeoutMs: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    expect(yaml.unlockMode).toBe('keys')
    expect(yaml.joinEntries).toHaveLength(0)
  })

  test('rotating the password rewrites the envelope on github', async () => {
    const before = await waitForLocalVaultState(
      deviceA,
      (snapshot) => snapshot.hasPasswordEnvelope,
    )
    const oldEnvelope = before.passwordEnvelopeCiphertext
    expect(oldEnvelope).not.toBeNull()

    await openStorageSettings(deviceA)
    await rotateVaultPassword(deviceA, 'rotated-pw-9')

    const after = await waitForStableLocalVaultState(
      deviceA,
      (snapshot) =>
        snapshot.hasPasswordEnvelope &&
        snapshot.passwordEnvelopeCiphertext !== null &&
        snapshot.passwordEnvelopeCiphertext !== oldEnvelope,
      { timeoutMs: ENROLLMENT_UNLOCK_TIMEOUT_MS, stableReads: 2 },
    )
    expect(after.passwordEnvelopeCiphertext).not.toBe(oldEnvelope)
    expect(after.passwordEnvelopeCiphertext).not.toBeNull()
  })

  test('removing the backup password leaves device-key unlock intact', async () => {
    if (!(await deviceA.getByTestId('storage-settings-panel').isVisible())) {
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
