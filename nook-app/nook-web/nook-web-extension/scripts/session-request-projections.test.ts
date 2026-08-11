import { describe, expect, test } from 'bun:test'
import {
  ExtensionPairedVaultIdentityHandoffRequestMessageType,
  type ExtensionPairedVaultIdentityHandoffRequestMessage,
} from '../../nook-web-shared/src/extension/runtime-messages'
import type { StoredExtensionPairingGrant } from '../src/background/pairing-grants'
import {
  identityHandoffSessionRequest,
  websiteLoginRevealSessionRequest,
} from '../src/background/service-worker/session-request-projections'
import { ExtensionSessionMessageType } from '../src/lib/extension-session-message-type'
import { ExtensionSessionQueueKind } from '../src/offscreen/session-request-adapter'

describe('extension session request projections', () => {
  test('removes paired-vault routing fields from identity handoff', () => {
    const message: ExtensionPairedVaultIdentityHandoffRequestMessage = {
      type: ExtensionPairedVaultIdentityHandoffRequestMessageType.NookExtensionPairedVaultIdentityHandoffRequest,
      payload: {
        recipientPublicKey: 'recipient',
        nonce: 'nonce',
        expectedDeviceId: 'device',
        expectedDevicePublicKey: 'public',
        expectedDeviceSigningPublicKey: 'signing',
        vaultStoreId: 'vault-routing-only',
      },
    }
    const expected = {
      type: ExtensionSessionMessageType.SealIdentityHandoff,
      payload: {
        recipientPublicKey: 'recipient',
        nonce: 'nonce',
        expectedDeviceId: 'device',
        expectedDevicePublicKey: 'public',
        expectedDeviceSigningPublicKey: 'signing',
        queue: { kind: ExtensionSessionQueueKind.MessageDefault },
      },
    }

    expect(identityHandoffSessionRequest(message)).toEqual(expected)
  })

  test('removes stored-grant metadata from login reveal', () => {
    const grant = {
      vaultStoreId: 'vault',
      deviceId: 'device',
      devicePublicKey: 'public',
      deviceSigningPublicKey: 'signing',
      vaultName: 'Private vault',
      deviceLabel: 'Laptop',
      approvedAt: '2026-08-10T00:00:00Z',
    } as StoredExtensionPairingGrant
    const args: Parameters<typeof websiteLoginRevealSessionRequest>[0] = {
      grant,
      origin: 'https://example.com',
      secretId: 'secret',
    }
    const expected = {
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
