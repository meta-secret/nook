import { ok } from 'neverthrow'
import initNookWasm from '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
beforeAll(async () => {
  const bytes = await Bun.file(
    new URL(
      '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm_bg.wasm',
      import.meta.url,
    ),
  ).arrayBuffer()
  await initNookWasm({ module_or_path: bytes })
})
import { beforeAll, describe, expect, test } from 'bun:test'
import type { NookVaultManager } from '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import { ExtensionSessionMessageType } from '../src/offscreen/session-message-dispatch'
import {
  extensionSessionPasskeyCeremonyDeadline,
  ExtensionSessionQueueKind,
} from '../src/offscreen/session-request-adapter'
import {
  type AssertPasskeyRequest,
  type CancelPasskeyRequest,
  type RegisterPasskeyRequest,
  type WebsitePasskeyOperationArgs,
  type WebsitePasskeyRequestActivityArgs,
  sessionWebsitePasskeys,
} from '../src/offscreen/session-website-passkey-operations'

type MockManagerState = {
  registrationContinuationObserved: boolean
  assertionContinuationObserved: boolean
  registrationFreed: boolean
  assertionFreed: boolean
}

function mockManager(state: MockManagerState): NookVaultManager {
  return {
    register_website_passkey: async (
      ...args: Parameters<NookVaultManager['register_website_passkey']>
    ) => {
      const [, shouldContinue] = args
      state.registrationContinuationObserved = shouldContinue()
      return {
        credentialId: 'registration-credential',
        clientDataJSON: 'registration-client-data',
        attestationObject: 'registration-attestation',
        transports: ['internal'],
        free: () => {
          state.registrationFreed = true
        },
      }
    },
    assert_website_passkey: async (
      ...args: Parameters<NookVaultManager['assert_website_passkey']>
    ) => {
      const [, shouldContinue] = args
      state.assertionContinuationObserved = shouldContinue()
      return {
        credentialId: 'assertion-credential',
        clientDataJSON: 'assertion-client-data',
        authenticatorData: 'assertion-authenticator-data',
        signature: 'assertion-signature',
        userHandle: 'assertion-user-handle',
        free: () => {
          state.assertionFreed = true
        },
      }
    },
  } as NookVaultManager
}

function cancelRequest(requestId: string): CancelPasskeyRequest {
  return {
    type: ExtensionSessionMessageType.CancelPasskey,
    payload: {
      requestId,
      queue: { kind: ExtensionSessionQueueKind.MessageDefault },
    },
  }
}

function registerRequest(requestId: string): RegisterPasskeyRequest {
  return {
    type: ExtensionSessionMessageType.RegisterPasskey,
    payload: {
      vaultStoreId: 'vault',
      deviceId: 'device',
      devicePublicKey: 'public',
      deviceSigningPublicKey: 'signing',
      requestId,
      requestJson: JSON.stringify({
        origin: 'https://example.test',
        challenge: 'challenge',
        relyingParty: { id: 'example.test', name: 'Example' },
        user: { id: 'user', name: 'user', displayName: 'User' },
        algorithms: [-7],
        excludeCredentials: [],
        residentKeyRequired: false,
        userVerificationRequired: false,
      }),
      queue: extensionSessionPasskeyCeremonyDeadline(Date.now() + 60_000),
    },
  }
}

function assertRequest(requestId: string): AssertPasskeyRequest {
  return {
    type: ExtensionSessionMessageType.AssertPasskey,
    payload: {
      vaultStoreId: 'vault',
      deviceId: 'device',
      devicePublicKey: 'public',
      deviceSigningPublicKey: 'signing',
      requestId,
      requestJson: JSON.stringify({
        origin: 'https://example.test',
        challenge: 'challenge',
        rpId: 'example.test',
        allowCredentials: [],
        userVerificationRequired: false,
      }),
      queue: extensionSessionPasskeyCeremonyDeadline(Date.now() + 60_000),
    },
  }
}

describe('website passkey session operations', () => {
  test('cancellation blocks a ceremony until session reset cleanup', async () => {
    sessionWebsitePasskeys.clearWebsitePasskeyRequests()
    const state: MockManagerState = {
      registrationContinuationObserved: false,
      assertionContinuationObserved: false,
      registrationFreed: false,
      assertionFreed: false,
    }
    const manager = mockManager(state)
    const cancellationArgs: WebsitePasskeyOperationArgs = {
      message: cancelRequest('request-cancel'),
      getManager: async () => manager,
      openVault: async () => {
        return ok()
      },
      flushEvent: async () => {
        return ok()
      },
    }

    await expect(
      sessionWebsitePasskeys.handleWebsitePasskeyOperation(cancellationArgs),
    ).resolves.toEqual(ok({ ok: true }))
    const canceledActivity: WebsitePasskeyRequestActivityArgs = {
      requestId: 'request-cancel',
      expiresAt: Date.now() + 60_000,
    }
    expect(
      sessionWebsitePasskeys.websitePasskeyRequestIsActive(canceledActivity),
    ).toBe(false)

    sessionWebsitePasskeys.clearWebsitePasskeyRequests()
    expect(
      sessionWebsitePasskeys.websitePasskeyRequestIsActive(canceledActivity),
    ).toBe(true)
  })

  test('routes registration and assertion through the vault dependencies', async () => {
    sessionWebsitePasskeys.clearWebsitePasskeyRequests()
    const state: MockManagerState = {
      registrationContinuationObserved: false,
      assertionContinuationObserved: false,
      registrationFreed: false,
      assertionFreed: false,
    }
    const manager = mockManager(state)
    let openCount = 0
    let flushCount = 0
    const openVault: WebsitePasskeyOperationArgs['openVault'] = async () => {
      openCount += 1

      return ok()
    }
    const flushEvent: WebsitePasskeyOperationArgs['flushEvent'] = async () => {
      flushCount += 1

      return ok()
    }
    const getManager = async () => manager
    const registrationArgs: WebsitePasskeyOperationArgs = {
      message: registerRequest('request-register'),
      getManager,
      openVault,
      flushEvent,
    }
    const assertionArgs: WebsitePasskeyOperationArgs = {
      message: assertRequest('request-assert'),
      getManager,
      openVault,
      flushEvent,
    }

    await expect(
      sessionWebsitePasskeys.handleWebsitePasskeyOperation(registrationArgs),
    ).resolves.toEqual(
      ok({
        ok: true,
        credentialId: 'registration-credential',
        clientDataJSON: 'registration-client-data',
        attestationObject: 'registration-attestation',
        transports: ['internal'],
      }),
    )
    await expect(
      sessionWebsitePasskeys.handleWebsitePasskeyOperation(assertionArgs),
    ).resolves.toEqual(
      ok({
        ok: true,
        credentialId: 'assertion-credential',
        clientDataJSON: 'assertion-client-data',
        authenticatorData: 'assertion-authenticator-data',
        signature: 'assertion-signature',
        userHandle: 'assertion-user-handle',
      }),
    )
    expect(openCount).toBe(2)
    expect(flushCount).toBe(2)
    expect(state.registrationContinuationObserved).toBe(true)
    expect(state.assertionContinuationObserved).toBe(true)
    expect(state.registrationFreed).toBe(true)
    expect(state.assertionFreed).toBe(true)
  })
})
