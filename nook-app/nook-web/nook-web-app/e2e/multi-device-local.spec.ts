import { test, expect, type BrowserContext, type Page } from './fixtures'
import {
  addSecret,
  expectIdentityMembers,
  assertVaultReady,
  connectLocalVault,
  createIsolatedContext,
  disableVaultIdleLock,
  E2E_SYNC_ONBOARD_PROVIDER,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  issueIdentityEnrollmentCode,
  localizeAppLinkForE2e,
  openVaultAfterIdentityJoin,
  readLocalVaultYamlFromIdb,
  redeemIdentityEnrollmentCode,
  reloadUnlockLocalVaultWithSync,
  triggerVaultSyncRefresh,
  uniqueSecretKey,
  UI_TIMEOUT_MS,
  waitForSyncRemoteVaultState,
  type IssuedIdentityCode,
} from './helpers'
import { createLocalE2eFileSyncVaultStub } from './file-sync-stub'

test.describe('multi-device identity with a local sync provider', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(120_000)

  const fileName = E2E_SYNC_ONBOARD_PROVIDER.fileName
  const secretKey = uniqueSecretKey('e2e-identity-join')
  let deviceA: Page
  let deviceB: Page
  let contextA: BrowserContext
  let contextB: BrowserContext
  let stub: ReturnType<typeof createLocalE2eFileSyncVaultStub>
  let issued: IssuedIdentityCode

  test.beforeAll(async ({ browser }) => {
    contextA = await createIsolatedContext(browser)
    contextB = await createIsolatedContext(browser)
    deviceA = await contextA.newPage()
    deviceB = await contextB.newPage()
    await disableVaultIdleLock(deviceB)

    await connectLocalVault(deviceA)
    await assertVaultReady(deviceA)
    await addSecret(deviceA, secretKey, 'shared-through-identity')

    const genesisYaml = await readLocalVaultYamlFromIdb(deviceA)
    stub = createLocalE2eFileSyncVaultStub(genesisYaml, fileName)
    await stub.install(deviceA, { fileName, vaultYaml: genesisYaml })
    // The invite names the shared account; the joiner signs in as it.
    await stub.install(deviceB, {
      fileName,
      vaultYaml: genesisYaml,
      accessToken: E2E_SYNC_ONBOARD_PROVIDER.accessToken,
    })

    await reloadUnlockLocalVaultWithSync(deviceA, stub)
    await triggerVaultSyncRefresh(deviceA)
    await expect(deviceA.getByTestId('vault-last-sync')).toContainText(
      /just now|s ago/,
      { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    await waitForSyncRemoteVaultState(
      stub,
      (snapshot) =>
        snapshot.authPkIds.length >= 1 && snapshot.secretIds.length >= 1,
    )
  })

  test.afterAll(async () => {
    await deviceA?.close()
    await deviceB?.close()
    await contextA?.close()
    await contextB?.close()
  })

  test('member publishes the identity log and issues an identity code', async () => {
    issued = await issueIdentityEnrollmentCode(deviceA)
    await expect
      .poll(() => stub.getIdentityEventFileCount(), {
        timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
      })
      .toBeGreaterThan(0)
  })

  test('joining app requests to join through the identity mount', async () => {
    const identityEventsBefore = stub.getIdentityEventFileCount()
    await deviceB.goto(localizeAppLinkForE2e(deviceA, issued.link))
    await expect(deviceB.getByTestId('login-gate')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await redeemIdentityEnrollmentCode(deviceB, issued.passphrase)
    await expect
      .poll(() => stub.getIdentityEventFileCount(), {
        timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
      })
      .toBeGreaterThan(identityEventsBefore)
  })

  test('member sees the invited app on Devices without approving it', async () => {
    await expectIdentityMembers(deviceA, 2)
  })

  test('joined app opens the vault with its identity grant', async () => {
    await openVaultAfterIdentityJoin(deviceB)
    await expect(
      deviceB.getByTestId('secret-row').filter({ hasText: secretKey }),
    ).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
    await waitForSyncRemoteVaultState(
      stub,
      (snapshot) => snapshot.authPkIds.length >= 2,
      { timeoutMs: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
  })
})
