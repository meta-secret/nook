import { describe, expect, spyOn, test } from 'bun:test'
import { ok } from 'neverthrow'
import { companionWasmReady } from '../../nook-web-shared/src/extension/companion-ready'
import { DeviceProtectionStatus } from '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import { WebsiteAuthenticatorResponseStatus } from '../src/lib/login-fill-messages'
import { OpenCompanionLauncherIntent } from '../../nook-web-shared/src/extension/companion-launcher-message'
import type { StoredExtensionPairingGrant } from '../src/background/pairing-grants'
import type { ExtensionSessionResponse } from '../src/offscreen/session'

await companionWasmReady

function authorizedWebsiteSender(): chrome.runtime.MessageSender {
  return {
    id: 'nook-extension',
    url: 'https://example.test/login',
    tab: {
      id: 42,
      index: 0,
      pinned: false,
      highlighted: false,
      windowId: 1,
      active: true,
      incognito: false,
      selected: true,
      discarded: false,
      autoDiscardable: true,
      frozen: false,
      lastAccessed: 0,
      groupId: -1,
    },
  }
}

const storedPasswordGrant: StoredExtensionPairingGrant = {
  vaultType: 'simple',
  vaultStoreId: 'store_abcdefghijk',
  deviceId: 'device-1',
  devicePublicKey: 'device-public-key',
  deviceSigningPublicKey: 'device-signing-key',
  vaultName: 'Personal',
  deviceLabel: 'Laptop',
  approvedAt: 1_786_320_000_000,
  scopes: ['password-filling'],
  syncProviderCount: 0,
  eventCount: 1,
  eventLogHeads: ['event-1'],
  lastLocalSyncAt: '2026-08-10T00:00:00Z',
}

describe('passive website session status transport', () => {
  test('accepts only complete successful locked and unlocked responses', async () => {
    Object.assign(globalThis, {
      __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
    })
    const { ExtensionSessionStatusAvailability, extensionPairingIdentity } =
      await import('../src/background/service-worker/pairing-identity')
    for (const malformed of [
      { ok: false, status: DeviceProtectionStatus.Pin },
      { ok: true },
      { ok: true, status: 'future-protection-state' },
      { ok: true, status: DeviceProtectionStatus.Error },
      { ok: true, status: DeviceProtectionStatus.Loading },
      { ok: true, status: DeviceProtectionStatus.PinSetup },
      { ok: true, status: DeviceProtectionStatus.Unlocked },
    ]) {
      expect(
        extensionPairingIdentity.websiteSessionStatusTransport(malformed),
      ).toBe(ExtensionSessionStatusAvailability.Unavailable)
    }

    expect(
      extensionPairingIdentity.websiteSessionStatusTransport({
        ok: true,
        status: DeviceProtectionStatus.Pin,
      }),
    ).toBe(ExtensionSessionStatusAvailability.Locked)

    expect(
      extensionPairingIdentity.websiteSessionStatusTransport({
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

  test('opens PilotAuth when available website grants find a locked session', async () => {
    Object.assign(globalThis, {
      __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
      chrome: { runtime: { id: 'nook-extension' } },
    })
    const { ExtensionSessionStatusAvailability, extensionPairingIdentity } =
      await import('../src/background/service-worker/pairing-identity')
    const { extensionSessionLifecycle } =
      await import('../src/background/service-worker/session-lifecycle')
    const grants = spyOn(
      extensionPairingIdentity,
      'passwordPairingGrants',
    ).mockResolvedValue([storedPasswordGrant])
    const sessionResponse: ExtensionSessionResponse = { ok: true }
    const status = spyOn(
      extensionPairingIdentity,
      'sendSessionMessage',
    ).mockResolvedValue(ok(sessionResponse))
    const sessionAvailability = spyOn(
      extensionPairingIdentity,
      'websiteSessionStatusTransport',
    ).mockReturnValue(ExtensionSessionStatusAvailability.Locked)
    const sender = authorizedWebsiteSender()
    const openLauncher = spyOn(
      extensionSessionLifecycle,
      'openCompanionLauncherBestEffort',
    )

    try {
      const response = await extensionPairingIdentity.availableWebsiteGrants({
        origin: 'https://example.test',
        sender,
        forbiddenReason: 'website-sender-not-authorized',
      })

      expect(response).toEqual({
        response: {
          ok: true,
          status: WebsiteAuthenticatorResponseStatus.Locked,
        },
      })
      expect(status).toHaveBeenCalledTimes(1)
      expect(sessionAvailability).toHaveBeenCalledWith(sessionResponse)
      expect(openLauncher).toHaveBeenCalledTimes(1)
      expect(openLauncher).toHaveBeenCalledWith(
        OpenCompanionLauncherIntent.PilotAuth,
        sender.tab,
      )
    } finally {
      openLauncher.mockRestore()
      sessionAvailability.mockRestore()
      status.mockRestore()
      grants.mockRestore()
    }
  })
})
