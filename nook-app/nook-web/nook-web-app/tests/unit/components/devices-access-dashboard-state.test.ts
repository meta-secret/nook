import { describe, expect, test } from 'vitest'
import {
  DevicesAccessNudgePreference,
  DevicesAccessNudgeStorageKind,
  parseDevicesAccessNudgePreference,
  readDevicesAccessNudgeStorage,
  shouldShowDevicesAccessNudge,
} from '../../../../nook-web-shared/src/vault-app/lib/components/devices-access-dashboard-state'

describe('Devices & access dashboard state', () => {
  test('normalizes persisted nudge preferences into explicit enum members', () => {
    localStorage.clear()
    const storageKey = 'devices-access-test-preference'
    expect(
      parseDevicesAccessNudgePreference(
        readDevicesAccessNudgeStorage({
          storage: localStorage,
          storageKey: storageKey,
        }),
      ),
    ).toBe(DevicesAccessNudgePreference.Visible)

    localStorage.setItem(storageKey, DevicesAccessNudgePreference.Dismissed)
    expect(
      parseDevicesAccessNudgePreference(
        readDevicesAccessNudgeStorage({
          storage: localStorage,
          storageKey: storageKey,
        }),
      ),
    ).toBe(DevicesAccessNudgePreference.Dismissed)

    localStorage.setItem(storageKey, 'unexpected')
    expect(
      parseDevicesAccessNudgePreference(
        readDevicesAccessNudgeStorage({
          storage: localStorage,
          storageKey: storageKey,
        }),
      ),
    ).toBe(DevicesAccessNudgePreference.Visible)
  })

  test('names missing and stored browser states at the boundary', () => {
    localStorage.clear()
    const storageKey = 'devices-access-test-storage-state'
    expect(
      readDevicesAccessNudgeStorage({
        storage: localStorage,
        storageKey: storageKey,
      }),
    ).toEqual({
      kind: DevicesAccessNudgeStorageKind.Missing,
    })
    localStorage.setItem(storageKey, 'saved')
    expect(
      readDevicesAccessNudgeStorage({
        storage: localStorage,
        storageKey: storageKey,
      }),
    ).toEqual({
      kind: DevicesAccessNudgeStorageKind.Stored,
      serialized: 'saved',
    })
  })

  test('preserves the legacy dismissal preference at the storage boundary', () => {
    expect(
      parseDevicesAccessNudgePreference({
        kind: DevicesAccessNudgeStorageKind.Stored,
        serialized: '1',
      }),
    ).toBe(DevicesAccessNudgePreference.Dismissed)
  })

  test('offers the first-run nudge only before any local vault exists', () => {
    expect(
      shouldShowDevicesAccessNudge({
        hasActiveLocalVault: false,
        localVaultCount: 0,
        preference: DevicesAccessNudgePreference.Visible,
      }),
    ).toBe(true)
    expect(
      shouldShowDevicesAccessNudge({
        hasActiveLocalVault: false,
        localVaultCount: 1,
        preference: DevicesAccessNudgePreference.Visible,
      }),
    ).toBe(false)
    expect(
      shouldShowDevicesAccessNudge({
        hasActiveLocalVault: true,
        localVaultCount: 1,
        preference: DevicesAccessNudgePreference.Visible,
      }),
    ).toBe(false)
    expect(
      shouldShowDevicesAccessNudge({
        hasActiveLocalVault: false,
        localVaultCount: 0,
        preference: DevicesAccessNudgePreference.Dismissed,
      }),
    ).toBe(false)
  })
})
