import { describe, expect, test } from 'vitest'
import { DeviceProtectionStatus } from '$app-wasm'
import {
  DeviceRecoveryKind,
  DeviceRecoveryOffer,
  type DeviceRecoveryRequest,
} from '$lib/components/device-recovery'

function offer(request: DeviceRecoveryRequest): DeviceRecoveryKind {
  return new DeviceRecoveryOffer(request).kind
}

describe('device recovery offer', () => {
  test('offers the passkey or PIN reset only after that unlock fails', () => {
    const passkeyBefore: DeviceRecoveryRequest = {
      status: DeviceProtectionStatus.Passkey,
      unlockFailed: false,
    }
    const passkeyAfter: DeviceRecoveryRequest = {
      status: DeviceProtectionStatus.Passkey,
      unlockFailed: true,
    }
    const pinAfter: DeviceRecoveryRequest = {
      status: DeviceProtectionStatus.Pin,
      unlockFailed: true,
    }

    expect(offer(passkeyBefore)).toBe(DeviceRecoveryKind.None)
    expect(offer(passkeyAfter)).toBe(DeviceRecoveryKind.Passkey)
    expect(offer(pinAfter)).toBe(DeviceRecoveryKind.Pin)
  })

  test('offers a reset at once when the key cannot be read', () => {
    const unreadable: DeviceRecoveryRequest = {
      status: DeviceProtectionStatus.Error,
      unlockFailed: false,
    }

    expect(offer(unreadable)).toBe(DeviceRecoveryKind.Unavailable)
  })

  test('offers nothing once the key is unlocked or not yet protected', () => {
    for (const status of [
      DeviceProtectionStatus.Unlocked,
      DeviceProtectionStatus.Missing,
      DeviceProtectionStatus.PinSetup,
      DeviceProtectionStatus.Loading,
    ]) {
      const request: DeviceRecoveryRequest = { status, unlockFailed: true }
      expect(offer(request)).toBe(DeviceRecoveryKind.None)
    }
  })
})
