import { describe, expect, test } from 'bun:test'
import type { NookVaultManager } from '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import { ExtensionSessionMessageType } from '../src/offscreen/session-message-dispatch'
import {
  extensionSessionPasskeyCeremonyDeadline,
  ExtensionSessionQueueKind,
} from '../src/offscreen/session-request-adapter'
import {
  clearWebsitePasskeyRequests,
  handleWebsitePasskeyOperation,
  type AssertPasskeyRequest,
  type CancelPasskeyRequest,
  type RegisterPasskeyRequest,
  type WebsitePasskeyOperationArgs,
  websitePasskeyRequestIsActive,
  type WebsitePasskeyRequestActivityArgs,
} from '../src/offscreen/session-website-passkey-operations'

type MockManagerState = {
  registrationContinuationObserved: boolean
  assertionContinuationObserved: boolean
  registrationFreed: boolean
  assertionFreed: boolean
}

function mockManager(state: MockManagerState): NookVaultManager {
  return {
    registerWebsitePasskey: async (
      ...args: Parameters<NookVaultManager['registerWebsitePasskey']>
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
    assertWebsitePasskey: async (
      ...args: Parameters<NookVaultManager['assertWebsitePasskey']>
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
      requestJson: '{}',
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
      requestJson: '{}',
      queue: extensionSessionPasskeyCeremonyDeadline(Date.now() + 60_000),
    },
  }
}

describe('website passkey session operations', () => {
  test('cancellation blocks a ceremony until session reset cleanup', async () => {
    clearWebsitePasskeyRequests()
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
      openVault: async () => {},
      flushEvent: async () => {},
    }

    await expect(
      handleWebsitePasskeyOperation(cancellationArgs),
    ).resolves.toEqual({ ok: true })
    const canceledActivity: WebsitePasskeyRequestActivityArgs = {
      requestId: 'request-cancel',
      expiresAt: Date.now() + 60_000,
    }
    expect(websitePasskeyRequestIsActive(canceledActivity)).toBe(false)

    clearWebsitePasskeyRequests()
    expect(websitePasskeyRequestIsActive(canceledActivity)).toBe(true)
  })

  test('routes registration and assertion through the vault dependencies', async () => {
    clearWebsitePasskeyRequests()
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
    }
    const flushEvent: WebsitePasskeyOperationArgs['flushEvent'] = async () => {
      flushCount += 1
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
      handleWebsitePasskeyOperation(registrationArgs),
    ).resolves.toEqual({
      ok: true,
      credentialId: 'registration-credential',
      clientDataJSON: 'registration-client-data',
      attestationObject: 'registration-attestation',
      transports: ['internal'],
    })
    await expect(handleWebsitePasskeyOperation(assertionArgs)).resolves.toEqual(
      {
        ok: true,
        credentialId: 'assertion-credential',
        clientDataJSON: 'assertion-client-data',
        authenticatorData: 'assertion-authenticator-data',
        signature: 'assertion-signature',
        userHandle: 'assertion-user-handle',
      },
    )
    expect(openCount).toBe(2)
    expect(flushCount).toBe(2)
    expect(state.registrationContinuationObserved).toBe(true)
    expect(state.assertionContinuationObserved).toBe(true)
    expect(state.registrationFreed).toBe(true)
    expect(state.assertionFreed).toBe(true)
  })
})
