import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import {
  approveJoinLocalE2eFromBanner,
  assertVaultReady,
  connectLocalE2eJoinerDevice,
  connectLocalVaultLegacy,
  createIsolatedContext,
  createLocalE2eGithubVaultStub,
  E2E_GITHUB_ONBOARD_PROVIDER,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  readLocalVaultYamlFromIdb,
  reloadUnlockLocalVaultWithGithubSync,
  sendJoinRequestLocalE2e,
} from './helpers'
import { joinCountFromYaml, parseVaultYamlSnapshot } from './vault-yaml'

test.describe('multi-device local vault with sync provider', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(120_000)

  const repoName = E2E_GITHUB_ONBOARD_PROVIDER.githubRepo
  let deviceA: Page
  let deviceB: Page
  let contextA: BrowserContext
  let contextB: BrowserContext
  let stub: ReturnType<typeof createLocalE2eGithubVaultStub>

  test.beforeAll(async ({ browser }) => {
    contextA = await createIsolatedContext(browser)
    contextB = await createIsolatedContext(browser)
    deviceA = await contextA.newPage()
    deviceB = await contextB.newPage()

    await connectLocalVaultLegacy(deviceA)
    await assertVaultReady(deviceA)

    const genesisYaml = await readLocalVaultYamlFromIdb(deviceA)
    stub = createLocalE2eGithubVaultStub(genesisYaml)
    await stub.install(deviceA, { repoName, vaultYaml: genesisYaml })
    await stub.install(deviceB, { repoName, vaultYaml: genesisYaml })

    await reloadUnlockLocalVaultWithGithubSync(deviceA)
    await deviceA.getByTestId('vault-sync-refresh-btn').click()
    await expect(deviceA.getByTestId('vault-last-sync')).toContainText(
      /just now|s ago/,
      { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    expect(stub.getVaultYaml().trim().length).toBeGreaterThan(0)
  })

  test.afterAll(async () => {
    await deviceA?.close()
    await deviceB?.close()
    await contextA?.close()
    await contextB?.close()
  })

  test('joiner sends a request to the stubbed sync provider', async () => {
    await connectLocalE2eJoinerDevice(deviceB, repoName)
    const join = await sendJoinRequestLocalE2e(deviceB, stub)

    expect(join.deviceId).toMatch(/^[a-f0-9]{16}$/)
    expect(join.publicKey).toMatch(/^age1/)
    expect(joinCountFromYaml(stub.getVaultYaml())).toBe(1)
  })

  test('genesis device sees pending join after sync refresh', async () => {
    const join = parseJoinFromStub(stub)

    await deviceA.getByTestId('vault-sync-refresh-btn').click()
    await expect(deviceA.getByTestId('pending-joins-banner')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(
      deviceA.getByTestId('device-join-row').filter({ hasText: join.deviceId }),
    ).toBeVisible()
  })

  test('genesis device approves join and fan-out updates the stub', async () => {
    const join = parseJoinFromStub(stub)

    await approveJoinLocalE2eFromBanner(deviceA, join.deviceId, stub, 2)
  })

  test('genesis device eventually sees pending join without manual refresh', async () => {
    await connectLocalE2eJoinerDevice(deviceB, repoName)
    const join = await sendJoinRequestLocalE2e(deviceB, stub)

    await expect
      .poll(() => joinCountFromYaml(stub.getVaultYaml()), {
        timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
      })
      .toBeGreaterThanOrEqual(1)

    await expect(deviceA.getByTestId('pending-joins-banner')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(
      deviceA.getByTestId('device-join-row').filter({ hasText: join.deviceId }),
    ).toBeVisible()
  })
})

function parseJoinFromStub(
  stub: ReturnType<typeof createLocalE2eGithubVaultStub>,
) {
  const snapshot = parseVaultYamlSnapshot(stub.getVaultYaml())
  if (snapshot.joinEntries.length === 0) {
    throw new Error('Expected a pending join entry in stub vault YAML')
  }
  return snapshot.joinEntries[0]!
}
