import { err } from 'neverthrow'
import { describe, expect, test, vi } from 'vitest'
import { DeviceProtectionStatus, NookVaultManager } from '$app-wasm'
import {
  VaultStorageFailure,
  VaultStorageFailureKind,
} from '$lib/runtime/storage-failure'
import { VaultLoginActions } from '$lib/vault/local-login'
import { LocalLoginPreparationState } from '$lib/vault/state/local-login-preparation-state'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

describe('local login preparation', () => {
  test('points the gate at this browser while the device identity is locked, without assessing access', async () => {
    const state = VaultStateTestFixture.create()
    state.openManager(new NookVaultManager())
    state.deviceProtectionStatus = DeviceProtectionStatus.Passkey
    state.localVaultPresent = true
    state.localLoginPreparation = LocalLoginPreparationState.Idle
    const useThisBrowser = vi.spyOn(state, 'useThisBrowser')
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

    expect(useThisBrowser).toHaveBeenCalledTimes(1)
    expect(assessVaultConnectStatus).not.toHaveBeenCalled()
    expect(state.errorMsg).toBe('')
    expect(state.localLoginPreparation).toBe(LocalLoginPreparationState.Ready)
  })

  test('prepares once per session', async () => {
    const state = VaultStateTestFixture.create()
    state.localVaultPresent = true
    state.localLoginPreparation = LocalLoginPreparationState.Idle
    const useThisBrowser = vi.spyOn(state, 'useThisBrowser')
    const actions = new VaultLoginActions(state)

    await actions.prepareLocalLogin()
    await actions.prepareLocalLogin()

    expect(useThisBrowser).toHaveBeenCalledTimes(1)
    expect(state.localLoginPreparation).toBe(LocalLoginPreparationState.Ready)
  })

  test('leaves a browser without a local vault unprepared', async () => {
    const state = VaultStateTestFixture.create()
    state.localVaultPresent = false
    state.localLoginPreparation = LocalLoginPreparationState.Idle
    const useThisBrowser = vi.spyOn(state, 'useThisBrowser')

    await new VaultLoginActions(state).prepareLocalLogin()

    expect(useThisBrowser).not.toHaveBeenCalled()
    expect(state.localLoginPreparation).toBe(LocalLoginPreparationState.Idle)
  })
})
