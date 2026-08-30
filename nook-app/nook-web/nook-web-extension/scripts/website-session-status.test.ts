import { describe, expect, test } from 'bun:test'
import { companionWasmReady } from '../../nook-web-shared/src/extension/companion-ready'
import { DeviceProtectionStatus } from '../src/lib/nook-wasm'

await companionWasmReady

describe('passive website session status transport', () => {
  test('accepts only complete successful locked and unlocked responses', async () => {
    Object.assign(globalThis, {
      __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
    })
    const {
      ExtensionSessionStatusAvailability,
      websiteSessionStatusTransport,
    } = await import('../src/background/service-worker/pairing-identity')
    for (const malformed of [
      { ok: false, status: DeviceProtectionStatus.Pin },
      { ok: true },
      { ok: true, status: 'future-protection-state' },
      { ok: true, status: DeviceProtectionStatus.Error },
      { ok: true, status: DeviceProtectionStatus.Loading },
      { ok: true, status: DeviceProtectionStatus.PinSetup },
      { ok: true, status: DeviceProtectionStatus.Unlocked },
    ]) {
      expect(websiteSessionStatusTransport(malformed)).toBe(
        ExtensionSessionStatusAvailability.Unavailable,
      )
    }

    expect(
      websiteSessionStatusTransport({
        ok: true,
        status: DeviceProtectionStatus.Pin,
      }),
    ).toBe(ExtensionSessionStatusAvailability.Locked)

    expect(
      websiteSessionStatusTransport({
        ok: true,
        status: DeviceProtectionStatus.Unlocked,
        device: {
          deviceId: 'device-1',
          devicePublicKey: 'device-public-key',
          deviceSigningPublicKey: 'device-signing-key',
        },
      }),
    ).toBe(ExtensionSessionStatusAvailability.Unlocked)
  })
})
