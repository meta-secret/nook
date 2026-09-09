import initNookWasm from '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import { beforeAll, describe, expect, test } from 'bun:test'
import {
  DeviceProtectionStatus,
  extensionWasmRuntime,
} from '../src/lib/nook-wasm'

beforeAll(async () => {
  await initNookWasm({
    module_or_path: await Bun.file(
      new URL(
        '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm_bg.wasm',
        import.meta.url,
      ),
    ).arrayBuffer(),
  })
})

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

    await expect(
      extensionWasmRuntime.extensionDeviceProtectionStatus(),
    ).rejects.toThrow()
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

    await expect(
      extensionWasmRuntime.extensionSessionDevice(),
    ).rejects.toThrow()
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

    await expect(
      extensionWasmRuntime.extensionSessionDevice(),
    ).rejects.toThrow()
  })
})
