import { err, ok } from 'neverthrow'
import { describe, expect, test, vi } from 'vitest'
import {
  DeviceProtectionStatus,
  NookClientRunModeUtil,
  NookRuntimeConfig,
  JoinEnrollmentState,
  ProviderSyncFreshness,
} from '$app-wasm'
import {
  VaultSyncActions,
  type VaultSynchronizationResult,
} from '$lib/vault/sync.svelte'
import type { SyncScheduleRequest } from '$lib/vault/action-contexts'
import { ProviderSyncOutcome } from '$lib/vault/provider-sync.svelte'
import {
  VaultStorageFailure,
  VaultStorageFailureKind,
} from '$lib/runtime/storage-failure'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'

describe('resolveVaultSyncIntervalMs', () => {
  test('production build ignores fast-sync env and uses 60s', () => {
    const config = new NookRuntimeConfig(
      NookClientRunModeUtil.parse('production'),
      false,
    )
    expect(config.resolve_vault_sync_interval_ms('1000')).toBe(60_000)
  })

  test('e2e build honors VITE_VAULT_SYNC_INTERVAL_MS', () => {
    const config = new NookRuntimeConfig(
      NookClientRunModeUtil.parse('production'),
      true,
    )
    expect(config.resolve_vault_sync_interval_ms('1000')).toBe(1000)
  })

  test('dev mode honors VITE_VAULT_SYNC_INTERVAL_MS', () => {
    const config = new NookRuntimeConfig(
      NookClientRunModeUtil.parse('development'),
      false,
    )
    expect(config.resolve_vault_sync_interval_ms('500')).toBe(500)
  })
})

describe('automatic vault sync', () => {
  test('clears a scheduled generation-unavailable alert after guarded sync succeeds', async () => {
    const state = VaultStateTestFixture.create()
    state.isAuthenticated = true
    state.localVaultPresent = true
    state.deviceProtectionStatus = DeviceProtectionStatus.Unlocked
    state.syncFromStorage = vi
      .fn()
      .mockResolvedValueOnce(
        err(
          new VaultStorageFailure(
            VaultStorageFailureKind.GenerationUnavailable,
          ),
        ),
      )
      .mockResolvedValueOnce(ok(ProviderSyncOutcome.Synced))
    state.scheduleSync = vi.fn()

    new VaultSyncActions(state).startVaultSync()
    await Promise.resolve()
    await Promise.resolve()

    expect(state.errorMsg).toBe(
      state.t(I18N_KEYS.ErrorsValidationLocalDataChangedInAnotherTab),
    )

    new VaultSyncActions(state).startVaultSync()
    await Promise.resolve()
    await Promise.resolve()

    expect(state.errorMsg).toBe('')
  })

  test.each([
    ['generation changed', VaultStorageFailureKind.GenerationChanged],
    ['deletion active', VaultStorageFailureKind.DeletionActive],
  ] as const)(
    'preserves a %s alert after a later successful scheduled sync',
    async (_label, failureKind) => {
      const state = VaultStateTestFixture.create()
      state.isAuthenticated = true
      state.localVaultPresent = true
      state.deviceProtectionStatus = DeviceProtectionStatus.Unlocked
      state.syncFromStorage = vi
        .fn()
        .mockResolvedValueOnce(err(new VaultStorageFailure(failureKind)))
        .mockResolvedValueOnce(ok(ProviderSyncOutcome.Synced))
      state.scheduleSync = vi.fn()

      new VaultSyncActions(state).startVaultSync()
      await Promise.resolve()
      await Promise.resolve()
      new VaultSyncActions(state).startVaultSync()
      await Promise.resolve()
      await Promise.resolve()

      expect(state.errorMsg).toBe(
        state.t(I18N_KEYS.ErrorsValidationLocalDataChangedInAnotherTab),
      )
    },
  )

  test.each([
    {
      label: 'a skipped sync',
      laterResult: ok(ProviderSyncOutcome.Skipped),
      expectedErrorKey: I18N_KEYS.ErrorsValidationLocalDataChangedInAnotherTab,
    },
    {
      label: 'a captured provider failure',
      laterResult: ok(ProviderSyncOutcome.FailureCaptured),
      expectedErrorKey: I18N_KEYS.ErrorsValidationLocalDataChangedInAnotherTab,
    },
    {
      label: 'an unavailable sync',
      laterResult: err(
        new VaultStorageFailure(VaultStorageFailureKind.ManagerUnavailable),
      ),
      expectedErrorKey: I18N_KEYS.ErrorsEngineUnavailable,
    },
  ])(
    'does not treat $label as successful recovery',
    async ({ laterResult, expectedErrorKey }) => {
      const state = VaultStateTestFixture.create()
      state.isAuthenticated = true
      state.localVaultPresent = true
      state.deviceProtectionStatus = DeviceProtectionStatus.Unlocked
      state.syncFromStorage = vi
        .fn()
        .mockResolvedValueOnce(
          err(
            new VaultStorageFailure(
              VaultStorageFailureKind.GenerationUnavailable,
            ),
          ),
        )
        .mockResolvedValueOnce(laterResult)
      state.scheduleSync = vi.fn()

      new VaultSyncActions(state).startVaultSync()
      await Promise.resolve()
      await Promise.resolve()
      new VaultSyncActions(state).startVaultSync()
      await Promise.resolve()
      await Promise.resolve()

      expect(state.errorMsg).toBe(state.t(expectedErrorKey))
    },
  )

  test.each([
    [
      'session changed',
      (state: ReturnType<typeof VaultStateTestFixture.create>) => {
        state.sessionEpoch += 1
      },
    ],
    [
      'scheduled sync became ineligible',
      (state: ReturnType<typeof VaultStateTestFixture.create>) => {
        state.isAuthenticated = false
      },
    ],
    [
      'local data deletion started',
      (state: ReturnType<typeof VaultStateTestFixture.create>) => {
        state.localDataDeletionStarted = true
      },
    ],
  ])(
    'preserves the generation-unavailable alert when %s before success',
    async (_label, invalidateClearance) => {
      const state = VaultStateTestFixture.create()
      state.isAuthenticated = true
      state.localVaultPresent = true
      state.deviceProtectionStatus = DeviceProtectionStatus.Unlocked
      state.syncFromStorage = vi
        .fn()
        .mockResolvedValueOnce(
          err(
            new VaultStorageFailure(
              VaultStorageFailureKind.GenerationUnavailable,
            ),
          ),
        )
        .mockImplementationOnce(async () => {
          invalidateClearance(state)
          return ok(ProviderSyncOutcome.Synced)
        })
      state.scheduleSync = vi.fn()

      new VaultSyncActions(state).startVaultSync()
      await Promise.resolve()
      await Promise.resolve()
      new VaultSyncActions(state).startVaultSync()
      await Promise.resolve()
      await Promise.resolve()

      expect(state.errorMsg).toBe(
        state.t(I18N_KEYS.ErrorsValidationLocalDataChangedInAnotherTab),
      )
    },
  )

  test('preserves an unrelated error assigned before scheduled success', async () => {
    const state = VaultStateTestFixture.create()
    state.isAuthenticated = true
    state.localVaultPresent = true
    state.deviceProtectionStatus = DeviceProtectionStatus.Unlocked
    state.syncFromStorage = vi
      .fn()
      .mockResolvedValueOnce(
        err(
          new VaultStorageFailure(
            VaultStorageFailureKind.GenerationUnavailable,
          ),
        ),
      )
      .mockImplementationOnce(async () => {
        state.errorMsg = state.t(I18N_KEYS.AuthStorageSyncFailed)
        return ok(ProviderSyncOutcome.Synced)
      })
    state.scheduleSync = vi.fn()

    new VaultSyncActions(state).startVaultSync()
    await Promise.resolve()
    await Promise.resolve()
    new VaultSyncActions(state).startVaultSync()
    await Promise.resolve()
    await Promise.resolve()

    expect(state.errorMsg).toBe(state.t(I18N_KEYS.AuthStorageSyncFailed))
  })

  test('preserves a newer assignment of the same invalidation message', async () => {
    const state = VaultStateTestFixture.create()
    state.isAuthenticated = true
    state.localVaultPresent = true
    state.deviceProtectionStatus = DeviceProtectionStatus.Unlocked
    state.syncFromStorage = vi
      .fn()
      .mockResolvedValueOnce(
        err(
          new VaultStorageFailure(
            VaultStorageFailureKind.GenerationUnavailable,
          ),
        ),
      )
      .mockImplementationOnce(async () => {
        state.errorMsg = state.t(
          I18N_KEYS.ErrorsValidationLocalDataChangedInAnotherTab,
        )
        return ok(ProviderSyncOutcome.Synced)
      })
    state.scheduleSync = vi.fn()

    new VaultSyncActions(state).startVaultSync()
    await Promise.resolve()
    await Promise.resolve()
    new VaultSyncActions(state).startVaultSync()
    await Promise.resolve()
    await Promise.resolve()

    expect(state.errorMsg).toBe(
      state.t(I18N_KEYS.ErrorsValidationLocalDataChangedInAnotherTab),
    )
  })

  test('does not let an earlier scheduled success clear a newer invalidation alert', async () => {
    const state = VaultStateTestFixture.create()
    state.isAuthenticated = true
    state.localVaultPresent = true
    state.deviceProtectionStatus = DeviceProtectionStatus.Unlocked
    const pendingSynchronizations: Array<
      (result: VaultSynchronizationResult) => void
    > = []
    state.syncFromStorage = vi.fn(
      () =>
        new Promise<VaultSynchronizationResult>((resolve) => {
          pendingSynchronizations.push(resolve)
        }),
    )
    state.scheduleSync = vi.fn()

    const syncActions = new VaultSyncActions(state)
    syncActions.startVaultSync()
    syncActions.startVaultSync()
    const resolveB = pendingSynchronizations[1]
    if (!resolveB) throw new Error('Second scheduled sync is missing.')
    resolveB(
      err(
        new VaultStorageFailure(VaultStorageFailureKind.GenerationUnavailable),
      ),
    )
    await Promise.resolve()
    await Promise.resolve()

    expect(state.errorMsg).toBe(
      state.t(I18N_KEYS.ErrorsValidationLocalDataChangedInAnotherTab),
    )

    const resolveA = pendingSynchronizations[0]
    if (!resolveA) throw new Error('First scheduled sync is missing.')
    resolveA(ok(ProviderSyncOutcome.Synced))
    await Promise.resolve()
    await Promise.resolve()

    expect(state.errorMsg).toBe(
      state.t(I18N_KEYS.ErrorsValidationLocalDataChangedInAnotherTab),
    )

    syncActions.startVaultSync()
    const resolveC = pendingSynchronizations[2]
    if (!resolveC) throw new Error('Third scheduled sync is missing.')
    resolveC(ok(ProviderSyncOutcome.Synced))
    await Promise.resolve()
    await Promise.resolve()

    expect(state.errorMsg).toBe('')
  })

  test('skips the interval sync when no sync providers are configured', async () => {
    const state = VaultStateTestFixture.create()
    state.isAuthenticated = true
    state.localVaultPresent = true
    state.deviceProtectionStatus = DeviceProtectionStatus.Unlocked
    state.syncFromStorage = vi.fn(async () => ok(ProviderSyncOutcome.Synced))
    let scheduledCallback!: SyncScheduleRequest['callback']
    state.scheduleSync = vi.fn((request: SyncScheduleRequest) => {
      scheduledCallback = request.callback
    })

    new VaultSyncActions(state).startVaultSync()
    await Promise.resolve()
    await Promise.resolve()

    expect(state.syncProviders).toHaveLength(0)
    expect(state.syncFromStorage).toHaveBeenCalledTimes(1)
    scheduledCallback()
    await Promise.resolve()
    await Promise.resolve()

    expect(state.syncFromStorage).toHaveBeenCalledTimes(1)
    expect(state.syncFromStorage).toHaveBeenCalledWith(
      ProviderSyncFreshness.Scheduled,
    )
  })

  test('keeps a join-approval polling failure visible while unauthenticated', async () => {
    const state = VaultStateTestFixture.create()
    state.isAuthenticated = false
    state.joinEnrollmentPrompt = JoinEnrollmentState.Pending
    state.syncFromStorage = vi.fn(async () =>
      err(new VaultStorageFailure(VaultStorageFailureKind.OperationFailed)),
    )
    state.scheduleSync = vi.fn((request: SyncScheduleRequest) =>
      request.callback(),
    )

    new VaultSyncActions(state).startVaultSync()
    await Promise.resolve()
    await Promise.resolve()

    expect(state.errorMsg).toBe(state.t(I18N_KEYS.AuthStorageSyncFailed))
  })

  test('does not carry a join polling failure into the newly unlocked session', async () => {
    const state = VaultStateTestFixture.create()
    state.isAuthenticated = false
    state.joinEnrollmentPrompt = JoinEnrollmentState.Pending
    state.syncFromStorage = vi.fn(async () => {
      state.sessionEpoch += 1
      state.isAuthenticated = true
      state.joinEnrollmentPrompt = JoinEnrollmentState.None
      return err(
        new VaultStorageFailure(VaultStorageFailureKind.OperationFailed),
      )
    })
    state.scheduleSync = vi.fn((request: SyncScheduleRequest) =>
      request.callback(),
    )

    new VaultSyncActions(state).startVaultSync()
    await Promise.resolve()
    await Promise.resolve()

    expect(state.errorMsg).toBe('')
  })

  test('keeps an actionable background failure visible while unlocked', async () => {
    const state = VaultStateTestFixture.create()
    state.isAuthenticated = true
    state.deviceProtectionStatus = DeviceProtectionStatus.Unlocked
    state.syncFromStorage = vi.fn(async () =>
      err(new VaultStorageFailure(VaultStorageFailureKind.OperationFailed)),
    )
    state.scheduleSync = vi.fn()

    new VaultSyncActions(state).startVaultSync()
    await Promise.resolve()
    await Promise.resolve()

    expect(state.errorMsg).toBe(state.t(I18N_KEYS.AuthStorageSyncFailed))
  })

  test('does not promote a late background failure into a replacement session', async () => {
    const state = VaultStateTestFixture.create()
    state.isAuthenticated = true
    state.deviceProtectionStatus = DeviceProtectionStatus.Unlocked
    state.errorMsg = ''
    state.syncFromStorage = vi.fn(async () => {
      state.sessionEpoch += 1
      return err(
        new VaultStorageFailure(VaultStorageFailureKind.OperationFailed),
      )
    })
    state.scheduleSync = vi.fn()

    new VaultSyncActions(state).startVaultSync()
    await Promise.resolve()
    await Promise.resolve()

    expect(state.syncFromStorage).toHaveBeenCalledWith(
      ProviderSyncFreshness.Scheduled,
    )
    expect(state.errorMsg).toBe('')
  })
})
