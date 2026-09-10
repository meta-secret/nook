import { err, ok, type Result } from 'neverthrow'
import { beforeEach, describe, expect, test, vi } from 'vitest'

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

import { DeviceMode, DeviceProtectionStatus } from '$app-wasm'
import {
  PasskeyCeremonyAction,
  PasskeyCeremonyFailure,
} from '$lib/auth/passkey-device-protection'
import {
  VaultStorageFailure,
  VaultStorageFailureKind,
} from '$lib/runtime/storage-failure'
import type { VaultState } from '$lib/vault.svelte'
import { DeviceProtectionActions } from '$lib/vault/device-protection.svelte'

function deviceProtectionState(
  initialization: Result<void, VaultStorageFailure> = ok(),
): VaultState {
  return {
    hasManager: true,
    isVerifying: false,
    isInitializing: true,
    errorMsg: '',
    deviceAuthorizationInProgress: false,
    deviceProtectionStatus: DeviceProtectionStatus.Passkey,
    deviceProtectionLockedStatus: DeviceProtectionStatus.Passkey,
    deviceId: '',
    devicePublicKey: '',
    admitManager: () => ok({}),
    enqueueStorage: async <Value, Failure>(
      operation: () => Result<Value, Failure> | Promise<Result<Value, Failure>>,
    ) => operation(),
    continueInitializationAfterDeviceUnlock: vi.fn(async () => initialization),
    lockDeviceProtection: vi.fn(async () => ok()),
    t: vi.fn((request: { key?: string } | string) =>
      typeof request === 'string'
        ? request
        : 'key' in request && request.key
          ? request.key
          : 'translated',
    ),
  } as unknown as VaultState
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
})
