import { describe, expect, test } from 'bun:test'
import { DeviceProtectionStatus } from '../src/lib/nook-wasm'

describe('passive website session status transport', () => {
  test('accepts only complete successful locked and unlocked responses', async () => {
    Object.assign(globalThis, {
      __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
    })
    const { WebsiteSessionStatusTransportKind, websiteSessionStatusTransport } =
      await import('../src/background/service-worker/pairing-identity')
    for (const malformed of [
      { ok: false, status: DeviceProtectionStatus.Pin },
      { ok: true },
      { ok: true, status: 'future-protection-state' },
      { ok: true, status: DeviceProtectionStatus.Unlocked },
    ]) {
      expect(websiteSessionStatusTransport(malformed)).toBe(
        WebsiteSessionStatusTransportKind.Unavailable,
      )
    }

    expect(
      websiteSessionStatusTransport({
        ok: true,
        status: DeviceProtectionStatus.Pin,
      }),
    ).toBe(WebsiteSessionStatusTransportKind.Locked)

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
    ).toBe(WebsiteSessionStatusTransportKind.Unlocked)
  })
})
