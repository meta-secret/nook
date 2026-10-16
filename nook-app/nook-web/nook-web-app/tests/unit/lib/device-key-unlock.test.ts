import { describe, expect, test } from 'vitest'
import { DeviceProtectionStatus } from '$app-wasm'
import {
  DeviceKeyUnlockPresentation,
  deviceKeySheetShown,
  type DeviceKeySheetRequest,
} from '$lib/vault/device-key-unlock'

function sheet(request: DeviceKeySheetRequest): boolean {
  return deviceKeySheetShown(request)
}

describe('device key unlock presentation', () => {
  test('a card unlocks an existing key without the page sheet', () => {
    for (const status of [
      DeviceProtectionStatus.Passkey,
      DeviceProtectionStatus.Pin,
      DeviceProtectionStatus.Error,
    ]) {
      const request: DeviceKeySheetRequest = {
        presentation: DeviceKeyUnlockPresentation.Card,
        status,
      }
      expect(sheet(request)).toBe(false)
    }
  })

  test('setting up a key this browser lacks uses the sheet, even from a card', () => {
    for (const status of [
      DeviceProtectionStatus.Missing,
      DeviceProtectionStatus.Plaintext,
      DeviceProtectionStatus.PinSetup,
    ]) {
      const request: DeviceKeySheetRequest = {
        presentation: DeviceKeyUnlockPresentation.Card,
        status,
      }
      expect(sheet(request)).toBe(true)
    }
  })

  test('restore and join flows keep the sheet', () => {
    const request: DeviceKeySheetRequest = {
      presentation: DeviceKeyUnlockPresentation.Sheet,
      status: DeviceProtectionStatus.Passkey,
    }
    expect(sheet(request)).toBe(true)
  })
})
