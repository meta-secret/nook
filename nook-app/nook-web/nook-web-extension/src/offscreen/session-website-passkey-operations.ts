import type { NookVaultManager } from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import { ExtensionSessionMessageType } from './session-message-dispatch'
import {
  type ExtensionSessionRequest,
  ExtensionSessionQueueKind,
} from './session-request-adapter'
import type {
  flushPasskeyEventToProviders,
  openPasskeyVault,
} from './session-vault-operations'
import { extensionVaultGrant } from './session-vault-grant'

export type CancelPasskeyRequest = Extract<
  ExtensionSessionRequest,
  { type: ExtensionSessionMessageType.CancelPasskey }
>
export type RegisterPasskeyRequest = Extract<
  ExtensionSessionRequest,
  { type: ExtensionSessionMessageType.RegisterPasskey }
>
export type AssertPasskeyRequest = Extract<
  ExtensionSessionRequest,
  { type: ExtensionSessionMessageType.AssertPasskey }
>

type WebsitePasskeyRequest =
  CancelPasskeyRequest | RegisterPasskeyRequest | AssertPasskeyRequest

export type WebsitePasskeyOperationArgs = {
  message: WebsitePasskeyRequest
  getManager: () => Promise<NookVaultManager>
  openVault: typeof openPasskeyVault
  flushEvent: typeof flushPasskeyEventToProviders
}

export type WebsitePasskeyRequestActivityArgs = {
  requestId: string
  expiresAt: number
}

const canceledWebsitePasskeyRequests = new Set<string>()

export function clearWebsitePasskeyRequests(): void {
  canceledWebsitePasskeyRequests.clear()
}

export function websitePasskeyRequestIsActive({
  requestId,
  expiresAt,
}: WebsitePasskeyRequestActivityArgs): boolean {
  return (
    Date.now() < expiresAt && !canceledWebsitePasskeyRequests.has(requestId)
  )
}

export async function handleWebsitePasskeyOperation({
  message,
  getManager,
  openVault,
  flushEvent,
}: WebsitePasskeyOperationArgs) {
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
      const openArgs: Parameters<typeof openVault>[0] = {
        activeManager,
        grant,
      }
      await openVault(openArgs)
      try {
        const registration = await activeManager.registerWebsitePasskey(
          payload.requestJson,
          () => {
            const activityArgs: WebsitePasskeyRequestActivityArgs = {
              requestId: payload.requestId as string,
              expiresAt: queueExpiresAt,
            }
            return websitePasskeyRequestIsActive(activityArgs)
          },
        )
        try {
          const flushArgs: Parameters<typeof flushEvent>[0] = {
            activeManager,
            vaultStoreId: grant.vaultStoreId,
          }
          await flushEvent(flushArgs)
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
      const openArgs: Parameters<typeof openVault>[0] = {
        activeManager,
        grant,
      }
      await openVault(openArgs)
      try {
        const assertion = await activeManager.assertWebsitePasskey(
          payload.requestJson,
          () => {
            const activityArgs: WebsitePasskeyRequestActivityArgs = {
              requestId: payload.requestId as string,
              expiresAt: queueExpiresAt,
            }
            return websitePasskeyRequestIsActive(activityArgs)
          },
        )
        try {
          const flushArgs: Parameters<typeof flushEvent>[0] = {
            activeManager,
            vaultStoreId: grant.vaultStoreId,
          }
          await flushEvent(flushArgs)
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
  throw new Error('Extension session received an unsupported passkey request.')
}

export type WebsitePasskeyOperationResponse = Awaited<
  ReturnType<typeof handleWebsitePasskeyOperation>
>
