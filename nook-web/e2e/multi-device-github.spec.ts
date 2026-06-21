import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import {
  addSecret,
  approveJoinFromBanner,
  approveJoinFromSettings,
  assertEnrolledVaultOnGithub,
  assertVaultReady,
  connectGithubGenesisDevice,
  connectGithubJoinerDevice,
  createE2eGithubRepoName,
  createIsolatedContext,
  githubPat,
  openStorageSettings,
  resetGithubVault,
  cleanupE2eGithubRepo,
  revealSecretValue,
  sendJoinRequest,
  unlockGithubVault,
  uniqueSecretKey,
  UI_TIMEOUT_MS,
  NOTIFICATION_TIMEOUT_MS,
  waitForSecretOnDevice,
  waitForVaultYaml,
} from './helpers'
import { parseVaultYamlSnapshot, assertGenesisVaultYaml } from './vault-yaml'

const describeMultiDevice = githubPat ? test.describe : test.describe.skip

describeMultiDevice('multi-device github vault', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(60_000)

  let deviceA: Page
  let deviceB: Page
  let contextA: BrowserContext
  let contextB: BrowserContext
  let e2eRepo: string

  const genesisSecretKey = uniqueSecretKey('e2e-md-genesis')
  const genesisSecretValue = 'genesis-device-password'
  const joinerSecretKey = uniqueSecretKey('e2e-md-joiner')
  const joinerSecretValue = 'joiner-device-password-пароль'

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(60_000)
    e2eRepo = createE2eGithubRepoName()
    console.log(`[e2e] multi-device repo: ${e2eRepo}`)
    await resetGithubVault(githubPat, e2eRepo)

    contextA = await createIsolatedContext(browser)
    contextB = await createIsolatedContext(browser)
    deviceA = await contextA.newPage()
    deviceB = await contextB.newPage()

    await connectGithubGenesisDevice(deviceA, githubPat, e2eRepo)
    await addSecret(deviceA, genesisSecretKey, genesisSecretValue)

    const genesisYaml = await waitForVaultYaml(
      githubPat,
      e2eRepo,
      (yaml) =>
        yaml.authPkIds.length >= 1 &&
        yaml.memberPkIds.length >= 1 &&
        (yaml.secretLabels.includes(genesisSecretKey) ||
          yaml.raw.includes(genesisSecretKey)),
    )
    assertGenesisVaultYaml(genesisYaml)
    expect(genesisYaml.authPkIds).toHaveLength(1)
    expect(genesisYaml.memberPkIds).toHaveLength(1)
  })

  test.afterAll(async () => {
    await deviceA?.close()
    await deviceB?.close()
    await contextA?.close()
    await contextB?.close()
    await cleanupE2eGithubRepo(githubPat, e2eRepo)
  })

  test('device B sees join dialog and sends a join request', async () => {
    await connectGithubJoinerDevice(deviceB, githubPat, e2eRepo)
    const join = await sendJoinRequest(deviceB, githubPat, e2eRepo)

    expect(join.deviceId).toMatch(/^[a-f0-9]{16}$/)
    expect(join.publicKey).toMatch(/^age1/)

    const yaml = await waitForVaultYaml(
      githubPat,
      e2eRepo,
      (snapshot) => snapshot.joinEntries.length === 1,
    )
    expect(yaml.joinEntries[0].deviceId).toBe(join.deviceId)
    expect(yaml.joinEntries[0].publicKey).toBe(join.publicKey)
  })

  test('device A sees pending join after manual vault refresh', async () => {
    const join = (
      await waitForVaultYaml(
        githubPat,
        e2eRepo,
        (snapshot) => snapshot.joinEntries.length === 1,
      )
    ).joinEntries[0]

    await deviceA.getByTestId('vault-sync-refresh-btn').click()
    await expect(deviceA.getByTestId('vault-last-sync')).toContainText(
      /just now|s ago/,
      { timeout: UI_TIMEOUT_MS },
    )
    await expect(deviceA.getByTestId('pending-joins-banner')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await expect(deviceA.getByTestId('pending-joins-badge')).toBeVisible()
    await expect(
      deviceA.getByTestId('device-join-row').filter({ hasText: join.deviceId }),
    ).toBeVisible()
  })

  test('device A sees pending join badge and approves from banner', async () => {
    const join = (
      await waitForVaultYaml(
        githubPat,
        e2eRepo,
        (snapshot) => snapshot.joinEntries.length === 1,
      )
    ).joinEntries[0]

    await expect(deviceA.getByTestId('pending-joins-badge')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await expect(deviceA.getByTestId('pending-joins-banner')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })

    await approveJoinFromBanner(deviceA, join.deviceId)

    const enrolledYaml = await assertEnrolledVaultOnGithub(
      githubPat,
      e2eRepo,
      2,
    )
    expect(enrolledYaml.secretLabels).toContain(genesisSecretKey)
    expect(enrolledYaml.authPkIds).toHaveLength(2)
    expect(enrolledYaml.memberPkIds).toHaveLength(2)
    expect(new Set(enrolledYaml.authPkIds).size).toBe(2)
    expect(new Set(enrolledYaml.memberPkIds).size).toBe(2)
  })

  test('device B unlocks and reads genesis secret', async () => {
    await unlockGithubVault(deviceB)
    await assertVaultReady(deviceB)

    await waitForSecretOnDevice(deviceB, genesisSecretKey)
    const revealed = await revealSecretValue(deviceB, genesisSecretKey)
    expect(revealed).toBe(genesisSecretValue)
  })

  test('both devices can add secrets and see shared vault state', async () => {
    await addSecret(deviceB, joinerSecretKey, joinerSecretValue)

    const yaml = await waitForVaultYaml(githubPat, e2eRepo, (snapshot) =>
      snapshot.secretLabels.includes(joinerSecretKey),
    )
    expect(yaml.secretLabels).toEqual(
      expect.arrayContaining([genesisSecretKey, joinerSecretKey]),
    )

    await waitForSecretOnDevice(deviceA, joinerSecretKey)
    const revealed = await revealSecretValue(deviceA, joinerSecretKey)
    expect(revealed).toBe(joinerSecretValue)
  })

  test('storage settings lists enrolled members with public key fingerprints', async () => {
    await openStorageSettings(deviceA)
    await expect(deviceA.getByTestId('device-enrollment-panel')).toBeVisible()
    await expect(deviceA.getByTestId('vault-members-list')).toBeVisible()
    await expect(deviceA.getByTestId('vault-member-row')).toHaveCount(2)
    await expect(deviceA.getByText('(this browser)')).toBeVisible()

    await deviceA.getByTestId('device-details-toggle').click()
    await expect(deviceA.getByTestId('device-id')).not.toHaveText('—')
    await expect(deviceA.getByTestId('device-public-key')).not.toHaveText('—')

    await deviceA.getByTestId('storage-settings-close').click()
    await assertVaultReady(deviceA)
  })
})

describeMultiDevice('multi-device approve from settings', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(60_000)

  let deviceA: Page
  let deviceB: Page
  let contextA: BrowserContext
  let contextB: BrowserContext
  let e2eRepo: string

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(60_000)
    e2eRepo = createE2eGithubRepoName()
    console.log(`[e2e] multi-device settings repo: ${e2eRepo}`)
    await resetGithubVault(githubPat, e2eRepo)

    contextA = await createIsolatedContext(browser)
    contextB = await createIsolatedContext(browser)
    deviceA = await contextA.newPage()
    deviceB = await contextB.newPage()

    await connectGithubGenesisDevice(deviceA, githubPat, e2eRepo)
  })

  test.afterAll(async () => {
    await deviceA?.close()
    await deviceB?.close()
    await contextA?.close()
    await contextB?.close()
    await cleanupE2eGithubRepo(githubPat, e2eRepo)
  })

  test('approves join from Storage & devices panel', async () => {
    await connectGithubJoinerDevice(deviceB, githubPat, e2eRepo)
    const join = await sendJoinRequest(deviceB, githubPat, e2eRepo)

    await approveJoinFromSettings(deviceA, join.deviceId)

    const enrolledYaml = await assertEnrolledVaultOnGithub(
      githubPat,
      e2eRepo,
      2,
    )
    const parsed = parseVaultYamlSnapshot(enrolledYaml.raw)
    expect(parsed.joinEntries).toHaveLength(0)
    expect(parsed.authPkIds).toHaveLength(2)
    expect(parsed.memberPkIds).toHaveLength(2)

    await unlockGithubVault(deviceB)
    await assertVaultReady(deviceB)
  })
})

describeMultiDevice('multi-device join background sync', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(60_000)

  let deviceA: Page
  let deviceB: Page
  let contextA: BrowserContext
  let contextB: BrowserContext
  let e2eRepo: string

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(60_000)
    e2eRepo = createE2eGithubRepoName()
    console.log(`[e2e] join background sync repo: ${e2eRepo}`)
    await resetGithubVault(githubPat, e2eRepo)

    contextA = await createIsolatedContext(browser)
    contextB = await createIsolatedContext(browser)
    deviceA = await contextA.newPage()
    deviceB = await contextB.newPage()

    await connectGithubGenesisDevice(deviceA, githubPat, e2eRepo)
  })

  test.afterAll(async () => {
    await deviceA?.close()
    await deviceB?.close()
    await contextA?.close()
    await contextB?.close()
    await cleanupE2eGithubRepo(githubPat, e2eRepo)
  })

  test('device A eventually sees pending join without manual refresh', async () => {
    await connectGithubJoinerDevice(deviceB, githubPat, e2eRepo)
    const join = await sendJoinRequest(deviceB, githubPat, e2eRepo)

    await waitForVaultYaml(
      githubPat,
      e2eRepo,
      (snapshot) => snapshot.joinEntries.length === 1,
    )

    await expect(deviceA.getByTestId('pending-joins-badge')).toBeVisible({
      timeout: NOTIFICATION_TIMEOUT_MS,
    })
    await expect(deviceA.getByTestId('pending-joins-banner')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await expect(
      deviceA.getByTestId('device-join-row').filter({ hasText: join.deviceId }),
    ).toBeVisible()
  })
})
