import { err, ok } from 'neverthrow'
import { describe, expect, mock, test } from 'bun:test'
import type { StoredExtensionPairingGrant } from '../src/background/pairing-grants'
import type { WebsitePasskeyOptionsDependencies } from '../src/background/service-worker/passkey-operations'
import {
  WebsitePasskeyCeremony,
  WebsitePasskeyOptionsStatus,
} from '../src/lib/webauthn-messages'
import { companionWasmReady } from '../../nook-web-shared/src/extension/companion-ready'
import type { WebsitePasskeyRequestContext } from '../src/background/service-worker/pairing-identity'
import type {
  DecodedExtensionSessionTransportDelivery,
  ExtensionSessionTransport,
  ExtensionSessionTransportDelivery,
  ExtensionSessionTransportFailure,
  ExtensionSessionTransportResult,
} from '../src/background/service-worker/session-document'
import type { ExtensionSessionResponse } from '../src/offscreen/session'
import type { ExtensionSessionTransportRequest } from '../src/offscreen/session-request-adapter'

Object.assign(globalThis, {
  __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
})

await companionWasmReady

const unusedSessionTransport: ExtensionSessionTransport = {
  sendMessage: async () => {
    throw new Error('passkey fixture session transport must not send directly')
  },
}

type PasskeySessionTransportFixtureArgs = {
  responses: ExtensionSessionResponse[]
}

class PasskeySessionTransportFixture implements ExtensionSessionTransport {
  deliveryCount = 0

  constructor(private readonly args: PasskeySessionTransportFixtureArgs) {}

  sendMessage(
    delivery: ExtensionSessionTransportDelivery,
  ): Promise<ExtensionSessionTransportResult<ExtensionSessionResponse>>
  sendMessage<Response, DecodeFailure>(
    delivery: DecodedExtensionSessionTransportDelivery<Response, DecodeFailure>,
  ): Promise<ExtensionSessionTransportResult<Response, DecodeFailure>>
  async sendMessage<Response = ExtensionSessionResponse, DecodeFailure = never>(
    delivery:
      | ExtensionSessionTransportDelivery
      | DecodedExtensionSessionTransportDelivery<Response, DecodeFailure>,
  ): Promise<
    | ExtensionSessionTransportResult<ExtensionSessionResponse>
    | ExtensionSessionTransportResult<Response, DecodeFailure>
  > {
    this.deliveryCount += 1
    const response = this.args.responses.shift()
    if (!response) throw new Error('passkey session fixture exhausted')
    if (!('decodeResponse' in delivery))
      return ok<ExtensionSessionResponse, ExtensionSessionTransportFailure>(
        response,
      )
    const decoded = delivery.decodeResponse(response)
    return decoded.match(
      (value) =>
        ok<Response, ExtensionSessionTransportFailure | DecodeFailure>(value),
      (failure) =>
        err<Response, ExtensionSessionTransportFailure | DecodeFailure>(
          failure,
        ),
    )
  }
}

function pairingGrant(id: string): StoredExtensionPairingGrant {
  return {
    vaultType: 'simple',
    vaultStoreId: id,
    vaultName: `Vault ${id}`,
    deviceId: `device-${id}`,
    devicePublicKey: `public-${id}`,
    deviceSigningPublicKey: `signing-${id}`,
    deviceLabel: `device-${id}`,
    approvedAt: 1_786_320_000_000,
    scopes: [],
    syncProviderCount: 0,
    eventCount: 0,
    eventLogHeads: [],
    lastLocalSyncAt: '',
  }
}

describe('website passkey options', () => {
  test('rejects all vault options when any vault returns a malformed list', async () => {
    const [{ websitePasskeyRequests }, { WebsitePasskeyRequestContextKind }] =
      await Promise.all([
        import('../src/background/service-worker/passkey-operations'),
        import('../src/background/service-worker/pairing-identity'),
      ])
    const sessionResponses: ExtensionSessionResponse[] = [
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
      {
        ok: true,
        accounts: [
          { credentialId: '', userName: 'invalid', userDisplayName: 'Invalid' },
        ],
      },
    ]
    const sessionTransport = new PasskeySessionTransportFixture({
      responses: sessionResponses,
    })
    const dependencies: WebsitePasskeyOptionsDependencies = {
      ensureExtensionSessionDocument: mock(() =>
        Promise.resolve(ok(unusedSessionTransport)),
      ),
      isAuthorizedWebsiteSender: mock(() => true),
      isUnlockedSessionStatus: mock(() => true),
      passkeyPairingGrants: mock(() =>
        Promise.resolve([pairingGrant('a'), pairingGrant('b')]),
      ),
      requestOriginAndRpId: mock(
        async (): Promise<WebsitePasskeyRequestContext> => ({
          kind: WebsitePasskeyRequestContextKind.Validated,
          origin: 'https://example.test',
          rpId: 'example.test',
          request: {
            ceremony: WebsitePasskeyCeremony.Get,
            value: {
              origin: 'https://example.test',
              rpId: 'example.test',
              challenge: 'challenge',
              userVerificationRequired: false,
              allowCredentials: [],
            },
          },
        }),
      ),
      sendSessionMessage: (message: ExtensionSessionTransportRequest) =>
        sessionTransport.sendMessage({ message }),
    }
    const args: Parameters<
      typeof websitePasskeyRequests.websitePasskeyOptions
    >[0] = {
      message: {
        payload: {
          requestId: 'atomic-passkey-request',
          ceremony: WebsitePasskeyCeremony.Get,
          requestJson: '{}',
          expiresAt: Date.now() + 60_000,
        },
      },
      sender: { id: 'nook-extension' },
      dependencies,
    }

    expect(await websitePasskeyRequests.websitePasskeyOptions(args)).toEqual({
      ok: true,
      status: WebsitePasskeyOptionsStatus.Invalid,
      options: [],
    })
    expect(sessionTransport.deliveryCount).toBe(3)
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
