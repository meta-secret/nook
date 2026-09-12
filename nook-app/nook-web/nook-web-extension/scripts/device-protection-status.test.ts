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

function installSessionResponses(responses: unknown[]): void {
  const runtime = {
    sendMessage: (...parameters: [unknown, (response: unknown) => void]) => {
      parameters[1](responses.shift())
    },
  }
  Object.assign(globalThis, { chrome: { runtime } })
}

describe('extensionDeviceProtectionStatus', () => {
  test('rejects an unrecognized status from the extension session', async () => {
    const responses: unknown[] = [
      { ok: true },
      { ok: true, status: 'future-protection-state' },
    ]
    installSessionResponses(responses)

    let rejected = false
    try {
      await extensionWasmRuntime.extensionDeviceProtectionStatus()
    } catch (failure) {
      rejected = true
      expect(failure).toBeInstanceOf(Error)
    }
    expect(rejected).toBe(true)
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
    installSessionResponses(responses)

    let rejected = false
    try {
      await extensionWasmRuntime.extensionSessionDevice()
    } catch (failure) {
      rejected = true
      expect(failure).toBeInstanceOf(Error)
    }
    expect(rejected).toBe(true)
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
    installSessionResponses(responses)

    let rejected = false
    try {
      await extensionWasmRuntime.extensionSessionDevice()
    } catch (failure) {
      rejected = true
      expect(failure).toBeInstanceOf(Error)
    }
    expect(rejected).toBe(true)
  })
})
