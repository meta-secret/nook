import { describe, expect, test } from 'bun:test'
import type {
  CompanionExtensionPresence,
  CompanionIdentityDiscoveryObservation,
  CompanionIdentityHandoffAuthorization,
  CompanionIdentityHandoffRequest,
} from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import type { StoredExtensionPairingGrant } from '../src/background/pairing-grants'
import { websiteLoginRevealSessionRequest } from '../src/background/service-worker/session-request-projections'
import { ExtensionSessionMessageType } from '../src/lib/extension-session-message-type'
import {
  COMPANION_IDENTITY_DISCOVERY_SESSION_MESSAGE_TYPE,
  COMPANION_IDENTITY_HANDOFF_SESSION_MESSAGE_TYPE,
  ExtensionSessionQueueKind,
  isCompanionIdentityDiscoverySessionTransportRequest,
  isCompanionIdentityHandoffSessionTransportRequest,
  type CompanionIdentityDiscoverySessionTransportRequest,
  type CompanionIdentityHandoffSessionTransportRequest,
} from '../src/offscreen/session-request-adapter'

describe('extension session request projections', () => {
  test('keeps generated companion values structural across offscreen delivery', () => {
    const appKey = {
      appId: 'app',
      encryptionPublicKey: 'public',
      signingPublicKey: 'signing',
      installationLabel: 'Extension',
    }
    const presence = {
      kind: 'unlocked',
      vault_type: 'simple',
      vault_store_id: 'vault',
      vault_name: 'Vault',
      app_key: {
        extensionRuntimeId: 'runtime',
        appKey,
        nonce: 'nonce',
        scopes: ['vault-access'],
      },
    } satisfies CompanionExtensionPresence
    const discovery = {
      request: {
        requestId: 'request',
        vaultStoreId: 'vault',
        expiresAt: 200,
      },
      observedAt: 100,
    } satisfies CompanionIdentityDiscoveryObservation
    const request = {
      transaction: {
        discovery,
        status: {
          status: 'unlocked',
          request_id: 'request',
          vault_store_id: 'vault',
          app_key: presence.app_key,
        },
        admittedAt: 110,
      },
      recipientPublicKey: 'recipient',
    } satisfies CompanionIdentityHandoffRequest
    const authorization = {
      request,
      observedAt: 120,
      presence,
    } satisfies CompanionIdentityHandoffAuthorization
    const discoveryDelivery = {
      type: COMPANION_IDENTITY_DISCOVERY_SESSION_MESSAGE_TYPE,
      payload: { presence, discovery },
    } satisfies CompanionIdentityDiscoverySessionTransportRequest
    const delivery = {
      type: COMPANION_IDENTITY_HANDOFF_SESSION_MESSAGE_TYPE,
      payload: { authorization },
    } satisfies CompanionIdentityHandoffSessionTransportRequest

    expect(
      isCompanionIdentityDiscoverySessionTransportRequest(discoveryDelivery),
    ).toBe(true)
    expect(discoveryDelivery).toEqual({
      type: 'nook:extension-session-discover-companion-identity',
      payload: { presence, discovery },
    })
    expect(isCompanionIdentityHandoffSessionTransportRequest(delivery)).toBe(
      true,
    )
    expect(delivery).toEqual({
      type: 'nook:extension-session-authorize-companion-identity-handoff',
      payload: { authorization },
    })
    expect(
      isCompanionIdentityHandoffSessionTransportRequest({
        type: COMPANION_IDENTITY_HANDOFF_SESSION_MESSAGE_TYPE,
        payload: { request },
      }),
    ).toBe(false)
    expect(
      isCompanionIdentityDiscoverySessionTransportRequest({
        type: COMPANION_IDENTITY_DISCOVERY_SESSION_MESSAGE_TYPE,
        payload: { presence },
      }),
    ).toBe(false)
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
