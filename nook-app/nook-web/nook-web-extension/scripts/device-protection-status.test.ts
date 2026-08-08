import { describe, expect, test } from 'bun:test'
import {
  DeviceProtectionStatus,
  extensionDeviceProtectionStatus,
  extensionSessionDevice,
} from '../src/lib/nook-wasm'

describe('extensionDeviceProtectionStatus', () => {
  test('rejects an unrecognized status from the extension session', async () => {
    const responses: unknown[] = [
      { ok: true },
      { ok: true, status: 'future-protection-state' },
    ]
    globalThis.chrome = {
      runtime: {
        sendMessage: (_message, callback) => callback(responses.shift()),
      },
    } as typeof chrome

    await expect(extensionDeviceProtectionStatus()).rejects.toThrow(
      'Unsupported extension device protection status.',
    )
  })

  test('rejects malformed unlocked device identity', async () => {
    const responses: unknown[] = [
      { ok: true },
      {
        ok: true,
        status: DeviceProtectionStatus.Unlocked,
        device: { deviceId: 'device-without-public-keys' },
      },
    ]
    globalThis.chrome = {
      runtime: {
        sendMessage: (_message, callback) => callback(responses.shift()),
      },
    } as typeof chrome

    await expect(extensionSessionDevice()).rejects.toThrow(
      'Extension session returned malformed device identity.',
    )
  })
})
