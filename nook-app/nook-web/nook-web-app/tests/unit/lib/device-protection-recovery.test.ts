import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('$app-wasm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$app-wasm')>()
  return {
    ...actual,
    set_vault_session_locked: vi.fn(),
  }
})

vi.mock('$lib/runtime/browser-data', () => ({
  quiesceOtherTabsForLocalRecovery: vi.fn(async () => {}),
  reloadQuiescedTabsAfterLocalRecovery: vi.fn(async () => {}),
}))

import { DeviceProtectionStatus } from '$app-wasm'
import {
  resetDeviceProtectionForRecovery,
  type DeviceProtectionRecoveryRequest,
} from '../../../../nook-web-shared/src/vault-app/lib/vault/device-protection.svelte'

describe('device protection recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('adopts a surviving identity protection status after cleanup fails', async () => {
    const manager = {
      local_identity_recovery_app_id: vi.fn(async () => '0123456789abcdef'),
      reset_device_protection_for_recovery: vi.fn(async () => {
        throw new Error('provider cleanup failed')
      }),
      device_protection_status: vi.fn(async () => DeviceProtectionStatus.Pin),
    }
    const state = {
      hasManager: true,
      isVerifying: false,
      errorMsg: '',
      deviceProtectionStatus: DeviceProtectionStatus.Passkey,
      deviceProtectionLockedStatus: DeviceProtectionStatus.Passkey,
      deviceId: 'retired',
      devicePublicKey: 'retired-key',
      providers: [],
      providersLoaded: false,
      githubPat: '',
      storageMode: 'local',
      enqueueExclusiveStorage: async <Value>(
        operation: () => Promise<Value>,
      ): Promise<Value> => operation(),
      requireManager: () => manager,
      adoptLocalDataStorageGeneration: vi.fn(),
      clearUnlockedSession: vi.fn(),
      clearOauthFile: vi.fn(),
      clearLocalFolder: vi.fn(),
      showSuccess: vi.fn(),
      t: vi.fn(() => 'Recovery failed'),
    } satisfies DeviceProtectionRecoveryRequest['state']

    const request: DeviceProtectionRecoveryRequest = {
      state,
      expectedAppId: '0123456789abcdef',
    }
    await resetDeviceProtectionForRecovery(request)

    expect(manager.device_protection_status).toHaveBeenCalledOnce()
    expect(state.deviceProtectionStatus).toBe(DeviceProtectionStatus.Pin)
    expect(state.deviceProtectionLockedStatus).toBe(DeviceProtectionStatus.Pin)
    expect(state.errorMsg).toBe('Recovery failed')
    expect(state.adoptLocalDataStorageGeneration).toHaveBeenCalledTimes(2)
  })
})
