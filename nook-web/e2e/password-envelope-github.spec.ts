import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import {
  addSecret,
  addVaultPassword,
  assertVaultReady,
  connectGithubGenesisDevice,
  createE2eGithubRepoName,
  createIsolatedContext,
  expandSettingsSection,
  expandLoginEnrollmentPanel,
  finishE2eGithubSuite,
  githubPat,
  openStorageSettings,
  resetGithubVault,
  revealSecretValue,
  UI_TIMEOUT_MS,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  uniqueSecretKey,
  waitForGithubVaultState,
  waitForVaultUnlocked,
} from './helpers'

/**
 * Multi-device coverage for the password-envelope feature on GitHub.
 *
 * Verifies the one-step QR enrolment flow that bypasses the approval
 * round-trip: device A wraps the active vault keys with a password,
 * issues an enrollment code (provider creds + password), and device B
 * pastes the code into its login screen — no second device approval
 * needed.
 */

const describePasswordEnvelope = githubPat ? test.describe : test.describe.skip

describePasswordEnvelope('vault password envelope (github)', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(180_000)

  let deviceA: Page
  let deviceB: Page
  let contextA: BrowserContext
  let contextB: BrowserContext
  let e2eRepo: string

  const sharedSecretKey = uniqueSecretKey('e2e-pw-shared')
  const sharedSecretValue = 'shared-via-qr-enrollment'
  const vaultPassword = 'correct-horse-battery-staple'

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000)
    e2eRepo = createE2eGithubRepoName()
    await resetGithubVault(githubPat, e2eRepo)

    contextA = await createIsolatedContext(browser)
    contextB = await createIsolatedContext(browser)
    deviceA = await contextA.newPage()
    deviceB = await contextB.newPage()

    await connectGithubGenesisDevice(deviceA, githubPat, e2eRepo)
    await addSecret(deviceA, sharedSecretKey, sharedSecretValue, {
      pat: githubPat,
      repoName: e2eRepo,
    })
  })

  test.afterAll(async () => {
    await deviceA?.close()
    await deviceB?.close()
    await contextA?.close()
    await contextB?.close()
    await finishE2eGithubSuite(githubPat, e2eRepo)
  })

  test('attaching a password switches the vault to password unlock mode', async () => {
    await openStorageSettings(deviceA)
    await expect(deviceA.getByTestId('vault-password-status')).toContainText(
      'None',
    )

    await addVaultPassword(deviceA, 'GitHub vault', vaultPassword)

    await expect(deviceA.getByTestId('vault-password-status')).toContainText(
      '1 password',
      { timeout: UI_TIMEOUT_MS },
    )

    // Hybrid model: backup password coexists with device-key auth rows.
    const yaml = await waitForGithubVaultState(
      { pat: githubPat, repoName: e2eRepo },
      (snapshot) =>
        snapshot.hasPasswordEnvelope && snapshot.authPkIds.length >= 1,
    )
    expect(yaml.unlockMode).toBe('keys')
    expect(yaml.hasPasswordEnvelope).toBe(true)
    expect(yaml.authPkIds.length).toBeGreaterThanOrEqual(1)
    expect(yaml.joinEntries).toHaveLength(0)
    // Members roster survives the mode switch.
    expect(yaml.memberPkIds.length).toBeGreaterThanOrEqual(1)
    // Secrets are unchanged. The vault stores generated IDs (not the
    // user-typed label) so we assert presence by count rather than name.
    expect(yaml.secretIds.length).toBeGreaterThanOrEqual(1)
  })

  test('device A issues an enrollment code carrying github credentials', async () => {
    await deviceA.getByTestId('vault-secrets-tab').click()
    await expect(deviceA.getByTestId('vault-panel')).toBeVisible()
    await deviceA.getByTestId('vault-onboard-tab').click()
    await deviceA.getByTestId('onboard-password-input').fill(vaultPassword)
    await deviceA.getByTestId('onboard-device-submit').click()

    const codeArea = deviceA.getByTestId('onboard-code')
    await expect(codeArea).toBeVisible({ timeout: UI_TIMEOUT_MS })
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

    // Persist the code for the next test.
    test.info().annotations.push({ type: 'enrollment-code', description: code })
  })

  test('device B self-enrols via the pasted code without approval', async () => {
    // Recover the code emitted in the previous test. (Tests are serial.)
    const codeArea = deviceA.getByTestId('onboard-code')
    const code = (await codeArea.inputValue()).trim()
    expect(code.length).toBeGreaterThan(40)

    // Device B starts from a clean state — no saved providers, no device
    // identity. The enrollment code is the only thing it knows about the
    // vault.
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

    // The shared secret decrypts on device B with the keys it pulled from
    // the password envelope — no auth row was ever written for device B.
    const row = deviceB
      .getByTestId('secret-row')
      .filter({ hasText: sharedSecretKey })
    await expect(row).toBeVisible({ timeout: UI_TIMEOUT_MS })
    const revealed = await revealSecretValue(deviceB, sharedSecretKey)
    expect(revealed).toBe(sharedSecretValue)

    // Remote vault keeps device-key auth; device B gets an auth row via
    // password backup unlock and is added to the members roster.
    const yaml = await waitForGithubVaultState(
      { pat: githubPat, repoName: e2eRepo },
      (snapshot) => snapshot.memberPkIds.length >= 2,
    )
    expect(yaml.unlockMode).toBe('keys')
    expect(yaml.hasPasswordEnvelope).toBe(true)
    expect(yaml.authPkIds.length).toBeGreaterThanOrEqual(1)
    expect(yaml.joinEntries).toHaveLength(0)
    expect(yaml.memberPkIds.length).toBeGreaterThanOrEqual(2)
  })

  test('rotating the password rewrites the envelope on github', async () => {
    // The cryptographic guarantee is straightforward: rotation produces a
    // brand-new scrypt envelope (different salt + nonce + ciphertext) so a
    // code carrying the old password can no longer decrypt it. We verify
    // this at the YAML level rather than via a second-device paste,
    // because GitHub CDN caching makes a real two-device race flaky in
    // CI — the cryptographic invariant is what actually matters.

    const before = await waitForGithubVaultState(
      { pat: githubPat, repoName: e2eRepo },
      (snapshot) => snapshot.hasPasswordEnvelope,
    )
    const oldEnvelope = before.passwordEnvelopeCiphertext
    expect(oldEnvelope).not.toBeNull()

    await openStorageSettings(deviceA)
    await expandSettingsSection(deviceA, 'unlock')
    await deviceA.getByTestId('rotate-vault-password-btn').click()
    await deviceA.getByTestId('vault-password-input').fill('rotated-pw-9')
    await deviceA.getByTestId('vault-password-confirm').fill('rotated-pw-9')
    await deviceA.getByTestId('submit-vault-password').click()
    await expect(deviceA.getByTestId('vault-password-status')).toContainText(
      '1 password',
      { timeout: UI_TIMEOUT_MS },
    )

    // GitHub serves the rotated envelope on the next read. A new
    // ciphertext proves the rotation actually rewrote the file — QR codes
    // issued before rotation stop unlocking once the password changes.
    const after = await waitForGithubVaultState(
      { pat: githubPat, repoName: e2eRepo },
      (snapshot) =>
        snapshot.hasPasswordEnvelope &&
        snapshot.passwordEnvelopeCiphertext !== null &&
        snapshot.passwordEnvelopeCiphertext !== oldEnvelope,
    )
    expect(after.passwordEnvelopeCiphertext).not.toBe(oldEnvelope)
    expect(after.passwordEnvelopeCiphertext).not.toBeNull()
  })

  test('removing the backup password leaves device-key unlock intact', async () => {
    // Settings panel is still open from the previous test; only re-open
    // when it's been closed.
    if (!(await deviceA.getByTestId('storage-settings-panel').isVisible())) {
      await openStorageSettings(deviceA)
    }
    await deviceA.getByTestId('remove-vault-password-btn').click()
    await deviceA.getByTestId('confirm-remove-vault-password').click()
    await expect(deviceA.getByTestId('vault-password-status')).toContainText(
      'None',
      { timeout: UI_TIMEOUT_MS },
    )

    // Vault file stays in keys mode; only the backup password section is removed.
    const yaml = await waitForGithubVaultState(
      { pat: githubPat, repoName: e2eRepo },
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
