import { describe, expect, test } from 'bun:test'
import type { StoredExtensionPairingGrant } from '../src/background/pairing-grants'
import { websiteLoginRevealSessionRequest } from '../src/background/service-worker/session-request-projections'
import { ExtensionSessionMessageType } from '../src/lib/extension-session-message-type'
import { ExtensionSessionQueueKind } from '../src/offscreen/session-request-adapter'

describe('extension session request projections', () => {
  test('removes stored-grant metadata from login reveal', () => {
    const grant = {
      vaultType: 'simple',
      vaultStoreId: 'vault',
      deviceId: 'device',
      devicePublicKey: 'public',
      deviceSigningPublicKey: 'signing',
      vaultName: 'Private vault',
      deviceLabel: 'Laptop',
      approvedAt: 1_786_320_000_000,
      scopes: ['password-filling'],
      syncProviderCount: 0,
      eventCount: 1,
      eventLogHeads: ['event-1'],
      lastLocalSyncAt: '2026-08-10T00:00:00Z',
    } satisfies StoredExtensionPairingGrant
    const args: Parameters<typeof websiteLoginRevealSessionRequest>[0] = {
      grant,
      origin: 'https://example.com',
      secretId: 'secret',
    }
    const expected: ReturnType<typeof websiteLoginRevealSessionRequest> = {
      type: ExtensionSessionMessageType.RevealLogin,
      payload: {
        vaultStoreId: 'vault',
        deviceId: 'device',
        devicePublicKey: 'public',
        deviceSigningPublicKey: 'signing',
        origin: 'https://example.com',
        secretId: 'secret',
        queue: { kind: ExtensionSessionQueueKind.MessageDefault },
      },
    }

    expect(websiteLoginRevealSessionRequest(args)).toEqual(expected)
  })
})
