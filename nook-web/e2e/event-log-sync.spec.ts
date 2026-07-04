import { expect, test } from './fixtures'
import {
  addSecret,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  assertNoVaultError,
  assertVaultReady,
  connectGithubGenesisDevice,
  createLocalE2eGithubVaultStub,
  createLocalVaultOnLogin,
  expectAppLogMilestones,
  reloadUnlockWithSyncProvider,
  triggerVaultSyncRefresh,
  uniqueSecretKey,
  waitForVaultOperationsIdle,
} from './helpers'
import { createE2eStubRepoName, E2E_STUB_PAT } from './sync-stub'

test.describe('event-log sync then add', () => {
  test.describe.configure({ mode: 'serial' })

  test('sync-then-add secure note after github provider connect', async ({
    page,
  }) => {
    await page.goto('/')
    await createLocalVaultOnLogin(page)
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })

    await reloadUnlockWithSyncProvider(page)

    await triggerVaultSyncRefresh(page)
    await assertNoVaultError(page)
    await assertVaultReady(page)
    await waitForVaultOperationsIdle(page)

    const manualSyncMilestone = {
      scope: 'vault-sync',
      level: 'info',
      messageIncludes: 'manual sync started',
    }
    await expectAppLogMilestones(page, [manualSyncMilestone])

    const title = uniqueSecretKey('e2e-event-log-note')
    const noteBody = '# Post-sync note\n\nSaved after provider sync.'

    await page.getByTestId('add-secret-btn').click()
    await page.getByTestId('item-type-secure-note').click()
    await page.getByTestId('secret-label').fill(title)
    await page.getByTestId('secret-value').fill(noteBody)
    await page.getByTestId('save-secret-btn').click()

    await assertNoVaultError(page)
    const row = page.getByTestId('secret-row').filter({ hasText: title })
    await expect(row).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
    await expect(page.getByTestId('vault-group-secure-note')).toBeVisible()

    await expectAppLogMilestones(page, [
      manualSyncMilestone,
      { scope: 'connect', level: 'info', messageIncludes: 'secret added' },
    ])
  })

  test('saving an event-backed secret appends only events and leaves a stale GitHub vault blob untouched', async ({
    page,
  }) => {
    const stub = createLocalE2eGithubVaultStub()
    const repoName = createE2eStubRepoName('nook-stale-github')

    await connectGithubGenesisDevice(page, E2E_STUB_PAT, repoName, stub)
    await assertVaultReady(page)
    await waitForVaultOperationsIdle(page)

    expect(stub.getVaultYaml()).toBe('')
    const eventFilesBeforeSave = stub.getEventFileCount()
    expect(eventFilesBeforeSave).toBeGreaterThan(0)

    const staleVaultYaml =
      'schema_version: 1\nstore_id: store_stalee2evnt\nsecrets: []\n# e2e remote stale branch\n'
    stub.setVaultYaml(staleVaultYaml)
    const vaultRevisionBeforeSave = stub.getVaultRevision()

    const title = uniqueSecretKey('e2e-stale-github-save')
    await addSecret(page, title, 'event-log-save-value')

    await assertNoVaultError(page)
    await expect(page.getByTestId('vault-error')).toHaveCount(0)
    await expect
      .poll(() => stub.getEventFileCount(), {
        timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
      })
      .toBeGreaterThan(eventFilesBeforeSave)
    expect(stub.getEventFilePaths()).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^nook-log\/v1\/events\/[a-f0-9]{64}\.yaml$/),
      ]),
    )
    expect(stub.getEventFilePaths()).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^nook-log\/v1\/events\/[a-f0-9]{2}\//),
      ]),
    )
    expect(stub.getEventFileContents()).toEqual(
      expect.arrayContaining([expect.stringContaining('schema_version:')]),
    )
    expect(stub.getVaultYaml()).toBe(staleVaultYaml)
    expect(stub.getVaultRevision()).toBe(vaultRevisionBeforeSave)
  })
})
