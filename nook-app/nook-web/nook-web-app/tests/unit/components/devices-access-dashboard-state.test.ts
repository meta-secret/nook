import { describe, expect, test } from 'vitest'
import {
  DashboardElementKind,
  DevicesAccessNudgePreference,
  DevicesAccessNudgeStorageKind,
  parseDevicesAccessNudgePreference,
  providerSaveFocus,
  ProviderSaveFocusKind,
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

  test('returns focus to the selected link when a save outlives its panel', () => {
    const control = document.createElement('input')
    expect(
      providerSaveFocus({
        unlockSelected: true,
        control: {
          kind: DashboardElementKind.Mounted,
          element: control,
        },
      }),
    ).toEqual({ kind: ProviderSaveFocusKind.Control, element: control })
    // Selecting another link unmounts the input mid-save; focus must not be
    // dropped on the document body.
    expect(
      providerSaveFocus({
        unlockSelected: false,
        control: {
          kind: DashboardElementKind.Mounted,
          element: control,
        },
      }),
    ).toEqual({ kind: ProviderSaveFocusKind.SelectedChainLink })
    expect(
      providerSaveFocus({
        unlockSelected: true,
        control: { kind: DashboardElementKind.Missing },
      }),
    ).toEqual({ kind: ProviderSaveFocusKind.SelectedChainLink })
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
