import { expect, test } from './fixtures'
import {
  addSecret,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  assertNoVaultError,
  assertVaultReady,
  createLocalVaultOnLogin,
  expectAppLogMilestones,
  reloadUnlockWithSyncProvider,
  triggerVaultSyncRefresh,
  uniqueSecretKey,
  waitForVaultOperationsIdle,
} from './helpers'
import {
  connectSyncGenesisDevice,
  createSyncTarget,
  installSyncRemote,
} from './sync-provider'

test.describe('event-log sync then add', () => {
  test.describe.configure({ mode: 'serial' })

  test('sync-then-add secure note after file provider connect', async ({
    page,
  }) => {
    await page.goto('/app/')
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

  test('saving an event-backed secret appends only events and leaves a stale remote vault blob untouched', async ({
    page,
  }) => {
    const target = createSyncTarget('', 'nook-stale-file', 'file')
    const { stub } = target
    expect(stub).toBeDefined()

    await installSyncRemote(page, target)
    await connectSyncGenesisDevice(page, target)
    await assertVaultReady(page)
    await waitForVaultOperationsIdle(page)

    expect(stub!.getVaultYaml()).toBe('')
    const eventFilesBeforeSave = stub!.getEventFileCount()
    expect(eventFilesBeforeSave).toBeGreaterThan(0)

    const staleVaultYaml =
      'schema_version: 1\nstore_id: store_stalee2evnt\nsecrets: []\n# e2e remote stale branch\n'
    stub!.setVaultYaml(staleVaultYaml)

    const title = uniqueSecretKey('e2e-stale-file-save')
    await addSecret(page, title, 'event-log-save-value')

    await assertNoVaultError(page)
    await expect(page.getByTestId('vault-error')).toHaveCount(0)
    await expect
      .poll(() => stub!.getEventFileCount(), {
        timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
      })
      .toBeGreaterThan(eventFilesBeforeSave)
    expect(stub!.getEventFilePaths()).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^nook-log\/v1\/events\/[A-Za-z0-9_-]{43}\.yaml$/,
        ),
      ]),
    )
    expect(stub!.getEventFilePaths()).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^nook-log\/v1\/events\/[^/]+\//),
      ]),
    )
    expect(stub!.getEventFileContents()).toEqual(
      expect.arrayContaining([expect.stringContaining('schema_version:')]),
    )
    expect(stub!.getVaultYaml()).toBe(staleVaultYaml)
  })
})
