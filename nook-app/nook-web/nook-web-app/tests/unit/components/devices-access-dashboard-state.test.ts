import { describe, expect, test } from 'vitest'
import {
  DevicesAccessNudgePreference,
  DevicesAccessNudgeStorageKind,
  StoredDevicesAccessNudge,
  DevicesAccessNudgeStorage,
  DevicesAccessNudgePresentation,
} from '../../../../nook-web-shared/src/vault-app/lib/components/devices-access-dashboard-state'

describe('Devices & access dashboard state', () => {
  test('normalizes persisted nudge preferences into explicit enum members', () => {
    localStorage.clear()
    const storageKey = 'devices-access-test-preference'
    expect(
      new StoredDevicesAccessNudge(
        new DevicesAccessNudgeStorage({
          storage: localStorage,
          storageKey: storageKey,
        }).state,
      ).preference,
    ).toBe(DevicesAccessNudgePreference.Visible)

    localStorage.setItem(storageKey, DevicesAccessNudgePreference.Dismissed)
    expect(
      new StoredDevicesAccessNudge(
        new DevicesAccessNudgeStorage({
          storage: localStorage,
          storageKey: storageKey,
        }).state,
      ).preference,
    ).toBe(DevicesAccessNudgePreference.Dismissed)

    localStorage.setItem(storageKey, 'unexpected')
    expect(
      new StoredDevicesAccessNudge(
        new DevicesAccessNudgeStorage({
          storage: localStorage,
          storageKey: storageKey,
        }).state,
      ).preference,
    ).toBe(DevicesAccessNudgePreference.Visible)
  })

  test('names missing and stored browser states at the boundary', () => {
    localStorage.clear()
    const storageKey = 'devices-access-test-storage-state'
    expect(
      new DevicesAccessNudgeStorage({
        storage: localStorage,
        storageKey: storageKey,
      }).state,
    ).toEqual({
      kind: DevicesAccessNudgeStorageKind.Missing,
    })
    localStorage.setItem(storageKey, 'saved')
    expect(
      new DevicesAccessNudgeStorage({
        storage: localStorage,
        storageKey: storageKey,
      }).state,
    ).toEqual({
      kind: DevicesAccessNudgeStorageKind.Stored,
      serialized: 'saved',
    })
  })

  test('preserves the legacy dismissal preference at the storage boundary', () => {
    expect(
      new StoredDevicesAccessNudge({
        kind: DevicesAccessNudgeStorageKind.Stored,
        serialized: '1',
      }).preference,
    ).toBe(DevicesAccessNudgePreference.Dismissed)
  })

  test('offers the first-run nudge only before any local vault exists', () => {
    expect(
      new DevicesAccessNudgePresentation({
        hasActiveLocalVault: false,
        localVaultCount: 0,
        preference: DevicesAccessNudgePreference.Visible,
      }).visible,
    ).toBe(true)
    expect(
      new DevicesAccessNudgePresentation({
        hasActiveLocalVault: false,
        localVaultCount: 1,
        preference: DevicesAccessNudgePreference.Visible,
      }).visible,
    ).toBe(false)
    expect(
      new DevicesAccessNudgePresentation({
        hasActiveLocalVault: true,
        localVaultCount: 1,
        preference: DevicesAccessNudgePreference.Visible,
      }).visible,
    ).toBe(false)
    expect(
      new DevicesAccessNudgePresentation({
        hasActiveLocalVault: false,
        localVaultCount: 0,
        preference: DevicesAccessNudgePreference.Dismissed,
      }).visible,
    ).toBe(false)
  })
})
