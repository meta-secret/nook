import { describe, expect, test } from 'vitest'
import {
  DevicesAccessNudgePreference,
  DevicesAccessNudgeStorageKind,
  parseDevicesAccessNudgePreference,
  readDevicesAccessNudgeStorage,
} from '../../../../nook-web-shared/src/vault-app/lib/components/devices-access-dashboard-state'

describe('Devices & access dashboard state', () => {
  test('normalizes persisted nudge preferences into explicit enum members', () => {
    localStorage.clear()
    const storageKey = 'devices-access-test-preference'
    expect(
      parseDevicesAccessNudgePreference(
        readDevicesAccessNudgeStorage(localStorage, storageKey),
      ),
    ).toBe(DevicesAccessNudgePreference.Visible)

    localStorage.setItem(storageKey, DevicesAccessNudgePreference.Dismissed)
    expect(
      parseDevicesAccessNudgePreference(
        readDevicesAccessNudgeStorage(localStorage, storageKey),
      ),
    ).toBe(DevicesAccessNudgePreference.Dismissed)

    localStorage.setItem(storageKey, 'unexpected')
    expect(
      parseDevicesAccessNudgePreference(
        readDevicesAccessNudgeStorage(localStorage, storageKey),
      ),
    ).toBe(DevicesAccessNudgePreference.Visible)
  })

  test('names missing and stored browser states at the boundary', () => {
    localStorage.clear()
    const storageKey = 'devices-access-test-storage-state'
    expect(readDevicesAccessNudgeStorage(localStorage, storageKey)).toEqual({
      kind: DevicesAccessNudgeStorageKind.Missing,
    })
    localStorage.setItem(storageKey, 'saved')
    expect(readDevicesAccessNudgeStorage(localStorage, storageKey)).toEqual({
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
})
