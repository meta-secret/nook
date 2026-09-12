import { err, ok, type Result } from 'neverthrow'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'

const createPasskeyProtection = vi.hoisted(() => vi.fn())

vi.mock('$lib/auth/passkey-device-protection', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('$lib/auth/passkey-device-protection')>()
  return {
    ...actual,
    setupDeviceProtection: createPasskeyProtection,
  }
})

vi.mock('$lib/runtime/log', () => ({
  browserLogRuntime: {
    createLogger: () => ({ warn: vi.fn(), warnWithContext: vi.fn() }),
  },
}))

import { DeviceMode, DeviceProtectionStatus, NookVaultManager } from '$app-wasm'
import {
  PasskeyCeremonyAction,
  PasskeyCeremonyFailure,
} from '$lib/auth/passkey-device-protection'
import {
  VaultStorageFailure,
  VaultStorageFailureKind,
} from '$lib/runtime/storage-failure'
import { VaultState } from '$lib/vault.svelte'
import { DeviceProtectionActions } from '$lib/vault/device-protection.svelte'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

class DeviceProtectionTestState extends VaultState {
  override async enqueueStorage<Value, Failure>(
    operation: () => Result<Value, Failure> | Promise<Result<Value, Failure>>,
  ): Promise<Result<Value, Failure | VaultStorageFailure>> {
    return operation()
  }
}

function deviceProtectionState(
  initialization: Result<void, VaultStorageFailure> = ok(),
): VaultState {
  const state = VaultStateTestFixture.createFrom(DeviceProtectionTestState)
  state.openManager(new NookVaultManager())
  state.isVerifying = false
  state.isInitializing = true
  state.deviceProtectionStatus = DeviceProtectionStatus.Passkey
  state.deviceProtectionLockedStatus = DeviceProtectionStatus.Passkey
  vi.spyOn(state, 'continueInitializationAfterDeviceUnlock').mockImplementation(
    async () => initialization,
  )
  vi.spyOn(state, 'lockDeviceProtection').mockResolvedValue(ok())
  vi.spyOn(state, 't').mockImplementation((request) =>
    typeof request === 'string'
      ? request
      : 'key' in request && request.key
        ? request.key
        : 'translated',
  )
  return state
}

describe('device protection actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createPasskeyProtection.mockReturnValue(ok())
  })

  test('publishes unlocked state after passkey authorization and initialization', async () => {
    const state = deviceProtectionState()

    await new DeviceProtectionActions(state).setupDeviceProtection({
      passkeyLabel: 'Primary passkey',
      deviceMode: DeviceMode.Standard,
      initializeSession: true,
    })

    expect(state.continueInitializationAfterDeviceUnlock).toHaveBeenCalledOnce()
    expect(state.deviceProtectionStatus).toBe(DeviceProtectionStatus.Unlocked)
    expect(state.lockDeviceProtection).not.toHaveBeenCalled()
  })

  test('relocks native identity when post-authorization initialization fails', async () => {
    const state = deviceProtectionState(
      err(new VaultStorageFailure(VaultStorageFailureKind.OperationFailed)),
    )

    await new DeviceProtectionActions(state).setupDeviceProtection({
      passkeyLabel: 'Primary passkey',
      deviceMode: DeviceMode.Standard,
      initializeSession: true,
    })
    await Promise.resolve()

    expect(state.lockDeviceProtection).toHaveBeenCalledOnce()
    expect(state.deviceProtectionStatus).not.toBe(
      DeviceProtectionStatus.Unlocked,
    )
  })

  test('offers PIN setup when passkey capability is unavailable', async () => {
    const state = deviceProtectionState()
    createPasskeyProtection.mockReturnValue(
      err(
        new PasskeyCeremonyFailure(
          PasskeyCeremonyAction.Create,
          new Error('PASSKEY_PRF_UNAVAILABLE'),
        ),
      ),
    )

    await new DeviceProtectionActions(state).setupDeviceProtection({
      passkeyLabel: 'Primary passkey',
      deviceMode: DeviceMode.Standard,
      initializeSession: true,
    })

    expect(state.deviceProtectionStatus).toBe(DeviceProtectionStatus.PinSetup)
    expect(state.continueInitializationAfterDeviceUnlock).not.toHaveBeenCalled()
  })

  test('presents a typed PIN unlock failure without initializing', async () => {
    const unlockPinDeviceIdentity = vi.fn(async () => {
      throw new Error('native PIN failure')
    })
    const state = deviceProtectionState()
    const manager = state.admitManager()
    if (manager.isErr()) expect.fail('test manager must be available')
    vi.spyOn(manager.value, 'unlock_pin_device_identity').mockImplementation(
      unlockPinDeviceIdentity,
    )

    await new DeviceProtectionActions(state).unlockPinDeviceProtection({
      pin: '000000',
      initializeSession: true,
    })

    expect(unlockPinDeviceIdentity).toHaveBeenCalledWith('000000')
    expect(state.errorMsg).toBe(I18N_KEYS.DeviceProtectionPinUnlockFailed)
    expect(state.continueInitializationAfterDeviceUnlock).not.toHaveBeenCalled()
    expect(state.deviceProtectionStatus).not.toBe(
      DeviceProtectionStatus.Unlocked,
    )
  })
})
