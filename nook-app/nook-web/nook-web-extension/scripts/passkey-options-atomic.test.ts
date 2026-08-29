import { describe, expect, mock, test } from 'bun:test'
import type { StoredExtensionPairingGrant } from '../src/background/pairing-grants'
import type { WebsitePasskeyOptionsDependencies } from '../src/background/service-worker/passkey-operations'
import {
  WebsitePasskeyCeremony,
  WebsitePasskeyOptionsMessageType,
  WebsitePasskeyOptionsStatus,
} from '../src/lib/webauthn-messages'

Object.assign(globalThis, {
  __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
})

function pairingGrant(id: string): StoredExtensionPairingGrant {
  return {
    vaultStoreId: id,
    vaultName: `Vault ${id}`,
    deviceId: `device-${id}`,
    devicePublicKey: `public-${id}`,
    deviceSigningPublicKey: `signing-${id}`,
  } as StoredExtensionPairingGrant
}

describe('website passkey options', () => {
  test('rejects all vault options when any vault returns a malformed list', async () => {
    const [{ websitePasskeyOptions }, { WebsitePasskeyRequestContextKind }] =
      await Promise.all([
        import('../src/background/service-worker/passkey-operations'),
        import('../src/background/service-worker/pairing-identity'),
      ])
    const sessionResponses: unknown[] = [
      { ok: true },
      {
        ok: true,
        accounts: [
          {
            credentialId: 'credential-a',
            userName: 'person@example.test',
            userDisplayName: 'Person',
          },
        ],
      },
      { ok: true, accounts: [{ credentialId: '' }] },
    ]
    const sendSessionMessage = mock(() =>
      Promise.resolve(sessionResponses.shift()),
    )
    const dependencies: WebsitePasskeyOptionsDependencies = {
      ensureExtensionSessionDocument: mock(() => Promise.resolve()),
      isAuthorizedWebsiteSender: mock(() => true),
      isUnlockedSessionStatus: mock(() => true),
      passkeyPairingGrants: mock(() =>
        Promise.resolve([pairingGrant('a'), pairingGrant('b')]),
      ),
      requestOriginAndRpId: mock(() => ({
        kind: WebsitePasskeyRequestContextKind.Validated,
        origin: 'https://example.test',
        rpId: 'example.test',
        request: {
          ceremony: WebsitePasskeyCeremony.Get,
          origin: 'https://example.test',
          rpId: 'example.test',
          requestJson: '{}',
        },
      })),
      sendSessionMessage,
    }
    const args: Parameters<typeof websitePasskeyOptions>[0] = {
      message: {
        type: WebsitePasskeyOptionsMessageType.NookWebsitePasskeyOptions,
        payload: {
          requestId: 'atomic-passkey-request',
          ceremony: WebsitePasskeyCeremony.Get,
          requestJson: '{}',
          expiresAt: Date.now() + 60_000,
        },
      },
      sender: { id: 'nook-extension', tab: { id: 42 } },
      dependencies,
    }

    await expect(websitePasskeyOptions(args)).resolves.toEqual({
      ok: true,
      status: WebsitePasskeyOptionsStatus.Unavailable,
      options: [],
    })
    expect(sendSessionMessage).toHaveBeenCalledTimes(3)
  })

  test('classifies unavailable passkey lookup as closed passkey evidence', async () => {
    const {
      MatchingPasskeyAvailabilityKind,
      passkeyAccountCountForClassification,
    } = await import('../src/background/service-worker/passkey-operations')
    const args: Parameters<typeof passkeyAccountCountForClassification>[0] = {
      needsPasskeyLookup: true,
      availability: { kind: MatchingPasskeyAvailabilityKind.Unavailable },
    }

    expect(passkeyAccountCountForClassification(args)).toBe(0)

    expect(
      passkeyAccountCountForClassification({
        needsPasskeyLookup: true,
        availability: {
          kind: MatchingPasskeyAvailabilityKind.Ready,
          accountCount: 0,
        },
      }),
    ).toBe(0)
  })
})
