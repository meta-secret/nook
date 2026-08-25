import { describe, expect, test } from 'bun:test'
import {
  DeviceProtectionStatus,
  extensionDeviceProtectionStatus,
  extensionSessionDevice,
  ExtensionSessionDeviceStateKind,
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

  test('rejects empty unlocked device identity fields', async () => {
    const responses: unknown[] = [
      { ok: true },
      {
        ok: true,
        status: DeviceProtectionStatus.Unlocked,
        device: {
          deviceId: '',
          devicePublicKey: 'public-key',
          deviceSigningPublicKey: 'signing-key',
        },
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

  test('preserves the current protection state when the session locks', async () => {
    const responses: unknown[] = [
      { ok: true },
      {
        ok: true,
        status: DeviceProtectionStatus.Pin,
        device: {},
      },
    ]
    globalThis.chrome = {
      runtime: {
        sendMessage: (_message, callback) => callback(responses.shift()),
      },
    } as typeof chrome

    await expect(extensionSessionDevice()).resolves.toEqual({
      kind: ExtensionSessionDeviceStateKind.Locked,
      protectionStatus: DeviceProtectionStatus.Pin,
    })
  })

  test('rejects a transient protection state during session lookup', async () => {
    const responses: unknown[] = [
      { ok: true },
      {
        ok: true,
        status: DeviceProtectionStatus.Loading,
        device: {},
      },
    ]
    globalThis.chrome = {
      runtime: {
        sendMessage: (_message, callback) => callback(responses.shift()),
      },
    } as typeof chrome

    await expect(extensionSessionDevice()).rejects.toThrow(
      `Unsupported extension device protection status: ${DeviceProtectionStatus.Loading}`,
    )
  })
})
