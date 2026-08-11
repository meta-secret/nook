import type { NookVaultManager } from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import { ExtensionSessionMessageType } from './session-message-dispatch'
import {
  type ExtensionSessionRequest,
  ExtensionSessionQueueKind,
} from './session-request-adapter'
import {
  flushPasskeyEventToProviders,
  openPasskeyVault,
} from './session-vault-operations'
import { extensionVaultGrant } from './session-vault-grant'

type CancelPasskeyRequest = Extract<
  ExtensionSessionRequest,
  { type: ExtensionSessionMessageType.CancelPasskey }
>
type RegisterPasskeyRequest = Extract<
  ExtensionSessionRequest,
  { type: ExtensionSessionMessageType.RegisterPasskey }
>
type AssertPasskeyRequest = Extract<
  ExtensionSessionRequest,
  { type: ExtensionSessionMessageType.AssertPasskey }
>

type WebsitePasskeyRequest =
  | CancelPasskeyRequest
  | RegisterPasskeyRequest
  | AssertPasskeyRequest

export type WebsitePasskeyOperationArgs = {
  message: WebsitePasskeyRequest
  getManager: () => Promise<NookVaultManager>
}

const canceledWebsitePasskeyRequests = new Set<string>()

export function clearWebsitePasskeyRequests(): void {
  canceledWebsitePasskeyRequests.clear()
}

export async function handleWebsitePasskeyOperation({
  message,
  getManager,
}: WebsitePasskeyOperationArgs): Promise<object> {
  switch (message.type) {
    case ExtensionSessionMessageType.CancelPasskey: {
      const payload = message.payload
      if (typeof payload.requestId !== 'string') {
        throw new Error(
          'Extension session received an invalid passkey cancellation.',
        )
      }
      canceledWebsitePasskeyRequests.add(payload.requestId)
      return { ok: true }
    }
    case ExtensionSessionMessageType.RegisterPasskey: {
      const payload = message.payload
      const grant = extensionVaultGrant(payload)
      if (
        typeof payload.requestId !== 'string' ||
        typeof payload.requestJson !== 'string' ||
        payload.queue.kind !== ExtensionSessionQueueKind.Deadline
      ) {
        throw new Error('Extension session received an invalid registration.')
      }
      const queueExpiresAt = payload.queue.expiresAt
      const activeManager = await getManager()
      const openArgs: Parameters<typeof openPasskeyVault>[0] = {
        activeManager,
        grant,
      }
      await openPasskeyVault(openArgs)
      try {
        const registration = await activeManager.registerWebsitePasskey(
          payload.requestJson,
          () =>
            Date.now() < queueExpiresAt &&
            !canceledWebsitePasskeyRequests.has(payload.requestId as string),
        )
        try {
          const flushArgs: Parameters<
            typeof flushPasskeyEventToProviders
          >[0] = {
            activeManager,
            vaultStoreId: grant.vaultStoreId,
          }
          await flushPasskeyEventToProviders(flushArgs)
          return {
            ok: true,
            credentialId: registration.credentialId,
            clientDataJSON: registration.clientDataJSON,
            attestationObject: registration.attestationObject,
            transports: registration.transports,
          }
        } finally {
          registration.free()
        }
      } finally {
        canceledWebsitePasskeyRequests.delete(payload.requestId)
      }
    }
    case ExtensionSessionMessageType.AssertPasskey: {
      const payload = message.payload
      const grant = extensionVaultGrant(payload)
      if (
        typeof payload.requestId !== 'string' ||
        typeof payload.requestJson !== 'string' ||
        payload.queue.kind !== ExtensionSessionQueueKind.Deadline
      ) {
        throw new Error('Extension session received an invalid assertion.')
      }
      const queueExpiresAt = payload.queue.expiresAt
      const activeManager = await getManager()
      const openArgs: Parameters<typeof openPasskeyVault>[0] = {
        activeManager,
        grant,
      }
      await openPasskeyVault(openArgs)
      try {
        const assertion = await activeManager.assertWebsitePasskey(
          payload.requestJson,
          () =>
            Date.now() < queueExpiresAt &&
            !canceledWebsitePasskeyRequests.has(payload.requestId as string),
        )
        try {
          const flushArgs: Parameters<
            typeof flushPasskeyEventToProviders
          >[0] = {
            activeManager,
            vaultStoreId: grant.vaultStoreId,
          }
          await flushPasskeyEventToProviders(flushArgs)
          return {
            ok: true,
            credentialId: assertion.credentialId,
            clientDataJSON: assertion.clientDataJSON,
            authenticatorData: assertion.authenticatorData,
            signature: assertion.signature,
            userHandle: assertion.userHandle,
          }
        } finally {
          assertion.free()
        }
      } finally {
        canceledWebsitePasskeyRequests.delete(payload.requestId)
      }
    }
  }
}
