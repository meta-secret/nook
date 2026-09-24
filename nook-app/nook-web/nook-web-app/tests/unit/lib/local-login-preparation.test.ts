import { err, ok } from 'neverthrow'
import { describe, expect, test, vi } from 'vitest'
import {
  DeviceProtectionStatus,
  NookVaultManager,
  type NookPasswordEntrySummary,
} from '$app-wasm'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import {
  NativeVaultStorageFailure,
  VaultStorageFailure,
  VaultStorageFailureKind,
} from '$lib/runtime/storage-failure'
import { VaultLoginActions } from '$lib/vault/local-login'
import { LocalLoginPreparationState } from '$lib/vault/state/provider.svelte'
import type { PasswordEntriesRefreshSnapshot } from '$lib/vault/action-contexts'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

describe('local login preparation', () => {
  test('prepares password entries while device identity is locked without assessing access', async () => {
    const state = VaultStateTestFixture.create()
    state.openManager(new NookVaultManager())
    state.deviceProtectionStatus = DeviceProtectionStatus.Passkey
    state.localVaultPresent = true
    state.localLoginPreparation = LocalLoginPreparationState.Idle
    state.refreshPasswordEntriesList = vi.fn(async () => ok({ entries: [] }))
    const assessVaultConnectStatus = vi
      .spyOn(state, 'assessVaultConnectStatus')
      .mockResolvedValue(
        err(
          new VaultStorageFailure(
            VaultStorageFailureKind.DeviceAuthorizationRequired,
          ),
        ),
      )

    await new VaultLoginActions(state).prepareLocalLogin()

    expect(state.refreshPasswordEntriesList).toHaveBeenCalledTimes(1)
    expect(assessVaultConnectStatus).not.toHaveBeenCalled()
    expect(state.errorMsg).toBe('')
    expect(state.localLoginPreparation).toBe(LocalLoginPreparationState.Ready)
  })

  test('identifies an unlock metadata failure without a lower-level diagnostic', async () => {
    const state = VaultStateTestFixture.create()
    state.localVaultPresent = true
    state.localLoginPreparation = LocalLoginPreparationState.Idle
    state.refreshPasswordEntriesList = vi.fn(async () =>
      err(new VaultStorageFailure(VaultStorageFailureKind.OperationFailed)),
    )

    await new VaultLoginActions(state).prepareLocalLogin()

    expect(state.errorMsg).toBe(
      state.t(I18N_KEYS.ErrorsVaultUnlockMetadataUnavailable),
    )
    expect(state.errorMsg).not.toBe(state.t(I18N_KEYS.AuthStorageSyncFailed))
    expect(state.localLoginPreparation).toBe(LocalLoginPreparationState.Idle)
  })

  test('clears a stale unlock metadata alert after a successful preparation retry', async () => {
    const state = VaultStateTestFixture.create()
    state.localVaultPresent = true
    state.localLoginPreparation = LocalLoginPreparationState.Idle
    const passwordEntry = {
      id: 'password_backup',
      label: 'Backup',
      createdAt: '2026-09-23T00:00:00Z',
      free: vi.fn(),
      [Symbol.dispose]: vi.fn(),
    } satisfies NookPasswordEntrySummary
    const passwordEntries = [passwordEntry]
    const emptySnapshot: PasswordEntriesRefreshSnapshot = { entries: [] }
    const loadedSnapshot: PasswordEntriesRefreshSnapshot = {
      entries: passwordEntries,
    }
    const refreshPasswordEntriesList = vi
      .fn(async (): ReturnType<typeof state.refreshPasswordEntriesList> =>
        ok(emptySnapshot),
      )
      .mockResolvedValueOnce(
        err(new VaultStorageFailure(VaultStorageFailureKind.OperationFailed)),
      )
      .mockImplementationOnce(async () => {
        state.passwordEntries = passwordEntries
        return ok(loadedSnapshot)
      })
    state.refreshPasswordEntriesList = refreshPasswordEntriesList
    const actions = new VaultLoginActions(state)

    await actions.prepareLocalLogin()

    expect(state.errorMsg).toBe(
      state.t(I18N_KEYS.ErrorsVaultUnlockMetadataUnavailable),
    )
    expect(state.localLoginPreparation).toBe(LocalLoginPreparationState.Idle)

    await actions.prepareLocalLogin()

    expect(refreshPasswordEntriesList).toHaveBeenCalledTimes(2)
    expect(state.localLoginPreparation).toBe(LocalLoginPreparationState.Ready)
    expect(state.passwordEntries).toHaveLength(1)
    expect(state.passwordEntries[0]).toMatchObject({
      id: passwordEntry.id,
      label: passwordEntry.label,
      createdAt: passwordEntry.createdAt,
    })
    expect(state.errorMsg).toBe('')
  })

  test('keeps a native metadata failure localized and out of the ready state', async () => {
    const state = VaultStateTestFixture.create()
    state.localVaultPresent = true
    state.localLoginPreparation = LocalLoginPreparationState.Idle
    state.refreshPasswordEntriesList = vi.fn(async () =>
      err(
        new NativeVaultStorageFailure(
          new Error('native vault metadata diagnostic'),
        ),
      ),
    )

    await new VaultLoginActions(state).prepareLocalLogin()

    expect(state.errorMsg).toBe(
      state.t(I18N_KEYS.ErrorsVaultUnlockMetadataUnavailable),
    )
    expect(state.errorMsg).not.toContain('native vault metadata diagnostic')
    expect(state.localLoginPreparation).toBe(LocalLoginPreparationState.Idle)
  })

  test('discards a stale metadata failure after the vault session unlocks', async () => {
    const state = VaultStateTestFixture.create()
    state.localVaultPresent = true
    state.localLoginPreparation = LocalLoginPreparationState.Idle
    let rejectRefresh: () => void = () => {}
    const refreshResult = new Promise<
      Awaited<ReturnType<typeof state.refreshPasswordEntriesList>>
    >((resolve) => {
      rejectRefresh = () =>
        resolve(
          err(new VaultStorageFailure(VaultStorageFailureKind.OperationFailed)),
        )
    })
    state.refreshPasswordEntriesList = vi.fn(async () => refreshResult)

    const preparation = new VaultLoginActions(state).prepareLocalLogin()
    state.sessionEpoch += 1
    state.isAuthenticated = true
    rejectRefresh()
    await preparation

    expect(state.errorMsg).toBe('')
    expect(state.localLoginPreparation).toBe(LocalLoginPreparationState.Idle)
  })

  test('discards a metadata failure during device authorization', async () => {
    const state = VaultStateTestFixture.create()
    state.localVaultPresent = true
    state.localLoginPreparation = LocalLoginPreparationState.Idle
    let rejectRefresh: () => void = () => {}
    const refreshResult = new Promise<
      Awaited<ReturnType<typeof state.refreshPasswordEntriesList>>
    >((resolve) => {
      rejectRefresh = () =>
        resolve(
          err(new VaultStorageFailure(VaultStorageFailureKind.OperationFailed)),
        )
    })
    state.refreshPasswordEntriesList = vi.fn(async () => refreshResult)

    const preparation = new VaultLoginActions(state).prepareLocalLogin()
    state.isVerifying = true
    rejectRefresh()
    await preparation

    expect(state.errorMsg).toBe('')
    expect(state.localLoginPreparation).toBe(LocalLoginPreparationState.Idle)
  })
})
