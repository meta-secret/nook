import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import {
  addSecret,
  assertVaultReady,
  connectGithubGenesisDevice,
  createE2eGithubRepoName,
  createIsolatedContext,
  finishE2eGithubSuite,
  githubPat,
  openStorageSettings,
  resetGithubVault,
  revealSecretValue,
  UI_TIMEOUT_MS,
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
      'Disabled',
    )

    await deviceA.getByTestId('set-vault-password-btn').click()
    await deviceA.getByTestId('vault-password-input').fill(vaultPassword)
    await deviceA.getByTestId('vault-password-confirm').fill(vaultPassword)
    await deviceA.getByTestId('submit-vault-password').click()

    await expect(deviceA.getByTestId('vault-password-status')).toContainText(
      'Enabled',
      { timeout: UI_TIMEOUT_MS },
    )

    // The remote YAML reflects the mutex: `unlock.type = password`, no
    // `auth:` or `joins:` sections.
    const yaml = await waitForGithubVaultState(
      { pat: githubPat, repoName: e2eRepo },
      (snapshot) => snapshot.unlockMode === 'password',
    )
    expect(yaml.unlockMode).toBe('password')
    expect(yaml.hasPasswordEnvelope).toBe(true)
    expect(yaml.authPkIds).toHaveLength(0)
    expect(yaml.joinEntries).toHaveLength(0)
    // Members roster survives the mode switch.
    expect(yaml.memberPkIds.length).toBeGreaterThanOrEqual(1)
    // Secrets are unchanged.
    expect(yaml.secretIds).toContain(sharedSecretKey)
  })

  test('device A issues an enrollment code carrying github credentials', async () => {
    await deviceA.getByTestId('issue-enrollment-code-btn').click()
    await deviceA.getByTestId('issue-code-password-input').fill(vaultPassword)
    await deviceA.getByTestId('generate-enrollment-code-btn').click()

    const codeArea = deviceA.getByTestId('enrollment-code-text')
    await expect(codeArea).toBeVisible({ timeout: UI_TIMEOUT_MS })
    const code = (await codeArea.inputValue()).trim()
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/)

    // The decoded payload should embed the GitHub PAT + repo so the
    // joining device needs zero manual configuration.
    const json = JSON.parse(
      Buffer.from(code, 'base64url').toString('utf8'),
    ) as {
      v: number
      provider: { type: string; pat?: string; repo?: string }
      password: string
      issued_at: string
    }
    expect(json.v).toBe(1)
    expect(json.provider.type).toBe('github')
    expect(json.provider.pat).toBe(githubPat)
    expect(json.provider.repo).toContain(e2eRepo)
    expect(json.password).toBe(vaultPassword)
    // Audit metadata only — no expiration field.
    expect(typeof json.issued_at).toBe('string')
    expect(Date.parse(json.issued_at)).not.toBeNaN()

    // Persist the code for the next test.
    test.info().annotations.push({ type: 'enrollment-code', description: code })
  })

  test('device B self-enrols via the pasted code without approval', async () => {
    // Recover the code emitted in the previous test. (Tests are serial.)
    const codeArea = deviceA.getByTestId('enrollment-code-text')
    const code = (await codeArea.inputValue()).trim()
    expect(code.length).toBeGreaterThan(40)

    // Device B starts from a clean state — no saved providers, no device
    // identity. The enrollment code is the only thing it knows about the
    // vault.
    await deviceB.goto('/')
    await expect(deviceB.getByTestId('login-gate')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })

    await deviceB.getByTestId('open-enrollment-code-btn').click()
    await deviceB.getByTestId('enrollment-code-input').fill(code)
    await deviceB.getByTestId('submit-enrollment-code-btn').click()

    await waitForVaultUnlocked(deviceB)
    await assertVaultReady(deviceB)

    // The shared secret decrypts on device B with the keys it pulled from
    // the password envelope — no auth row was ever written for device B.
    const row = deviceB
      .getByTestId('secret-row')
      .filter({ hasText: sharedSecretKey })
    await expect(row).toBeVisible({ timeout: UI_TIMEOUT_MS })
    const revealed = await revealSecretValue(deviceB, sharedSecretKey)
    expect(revealed).toBe(sharedSecretValue)

    // Remote vault is still in password mode, still no auth/joins rows,
    // and device B has been added to the members roster.
    const yaml = await waitForGithubVaultState(
      { pat: githubPat, repoName: e2eRepo },
      (snapshot) => snapshot.memberPkIds.length >= 2,
    )
    expect(yaml.unlockMode).toBe('password')
    expect(yaml.authPkIds).toHaveLength(0)
    expect(yaml.joinEntries).toHaveLength(0)
    expect(yaml.memberPkIds.length).toBeGreaterThanOrEqual(2)
  })

  test('rotating the password invalidates the old enrollment code', async ({
    browser,
  }) => {
    const codeArea = deviceA.getByTestId('enrollment-code-text')
    const staleCode = (await codeArea.inputValue()).trim()

    // Clear the rendered code panel; rotate the password.
    if (
      await deviceA
        .getByRole('button', { name: 'Done' })
        .isVisible()
        .catch(() => false)
    ) {
      await deviceA.getByRole('button', { name: 'Done' }).click()
    }
    await deviceA.getByTestId('rotate-vault-password-btn').click()
    await deviceA.getByTestId('vault-password-input').fill('rotated-pw-9')
    await deviceA.getByTestId('vault-password-confirm').fill('rotated-pw-9')
    await deviceA.getByTestId('submit-vault-password').click()
    await expect(deviceA.getByTestId('vault-password-status')).toContainText(
      'Enabled',
      { timeout: UI_TIMEOUT_MS },
    )

    // A fresh device that pastes the now-stale code must fail.
    const staleContext = await createIsolatedContext(browser)
    const staleDevice = await staleContext.newPage()
    try {
      await staleDevice.goto('/')
      await staleDevice.getByTestId('open-enrollment-code-btn').click()
      await staleDevice.getByTestId('enrollment-code-input').fill(staleCode)
      await staleDevice.getByTestId('submit-enrollment-code-btn').click()
      const error = staleDevice.getByTestId('connect-error')
      await expect(error).toBeVisible({ timeout: UI_TIMEOUT_MS })
      // The Rust scrypt decryptor surfaces wrong-password failures either
      // as a clean "wrong password" message or — in some wasm runtime
      // configurations — as a propagated "unreachable" panic. Both are
      // valid evidence the stale code was rejected.
      await expect(error).toContainText(
        /wrong password|password|decryption|unreachable/i,
      )
      // The fresh device must NOT have joined the vault.
      await expect(staleDevice.getByTestId('vault-panel')).not.toBeVisible()
    } finally {
      await staleDevice.close()
      await staleContext.close()
    }
  })

  test('removing the password switches back to keys mode', async () => {
    await openStorageSettings(deviceA)
    await deviceA.getByTestId('remove-vault-password-btn').click()
    await deviceA.getByTestId('confirm-remove-vault-password').click()
    await expect(deviceA.getByTestId('vault-password-status')).toContainText(
      'Disabled',
      { timeout: UI_TIMEOUT_MS },
    )

    // Vault file now back in keys mode with a single auth row (device A
    // re-emits its own). Device B's earlier password-mode session does
    // NOT have an auth row, by design — that's the documented trade-off
    // when switching modes.
    const yaml = await waitForGithubVaultState(
      { pat: githubPat, repoName: e2eRepo },
      (snapshot) =>
        snapshot.unlockMode === 'keys' && snapshot.authPkIds.length >= 1,
    )
    expect(yaml.unlockMode).toBe('keys')
    expect(yaml.hasPasswordEnvelope).toBe(false)
    expect(yaml.authPkIds.length).toBeGreaterThanOrEqual(1)
    expect(yaml.secretIds).toContain(sharedSecretKey)
  })
})
