import { err, ok } from 'neverthrow'
import {
  SessionOperationFailure,
  SessionOperationFailureKind,
} from '../lib/session-operation-queue'
import {
  decode_website_passkey_registration_request,
  decode_website_passkey_assertion_request,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
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
  { type: typeof ExtensionSessionMessageType.CancelPasskey }
>

export type RegisterPasskeyRequest = Extract<
  ExtensionSessionRequest,
  { type: typeof ExtensionSessionMessageType.RegisterPasskey }
>

export type AssertPasskeyRequest = Extract<
  ExtensionSessionRequest,
  { type: typeof ExtensionSessionMessageType.AssertPasskey }
>

type WebsitePasskeyRequest =
  CancelPasskeyRequest | RegisterPasskeyRequest | AssertPasskeyRequest

type WebsitePasskeyManager = Pick<
  NookVaultManager,
  | 'open_extension_passkey_vault_js'
  | 'load_auth_providers_snapshot'
  | 'flush_event_outbox_for_provider'
  | 'register_website_passkey'
  | 'assert_website_passkey'
>

export type WebsitePasskeyOperationArgs = {
  message: WebsitePasskeyRequest
  getManager: () => Promise<WebsitePasskeyManager>
  openVault: typeof openPasskeyVault
  flushEvent: typeof flushPasskeyEventToProviders
}

export type WebsitePasskeyRequestActivityArgs = {
  requestId: string
  expiresAt: number
}

export type WebsitePasskeyOperationResponse = Awaited<
  ReturnType<typeof sessionWebsitePasskeys.handleWebsitePasskeyOperation>
>

type PasskeyCancellationResponse = { readonly ok: true }
type PasskeyRegistrationResponse = {
  readonly ok: true
  readonly credentialId: string
  readonly clientDataJSON: string
  readonly attestationObject: string
  readonly transports: string[]
}
type PasskeyAssertionResponse = {
  readonly ok: true
  readonly credentialId: string
  readonly clientDataJSON: string
  readonly authenticatorData: string
  readonly signature: string
  readonly userHandle: string
}

/** Owns the browser runtime resources shared by these interactions. */
class SessionWebsitePasskeys {
  private canceledWebsitePasskeyRequests = new Set<string>()
  clearWebsitePasskeyRequests(): void {
    this.canceledWebsitePasskeyRequests.clear()
  }

  websitePasskeyRequestIsActive({
    requestId,
    expiresAt,
  }: WebsitePasskeyRequestActivityArgs): boolean {
    return (
      Date.now() < expiresAt &&
      !this.canceledWebsitePasskeyRequests.has(requestId)
    )
  }

  async handleWebsitePasskeyOperation({
    message,
    getManager,
    openVault,
    flushEvent,
  }: WebsitePasskeyOperationArgs) {
    try {
      switch (message.type) {
        case ExtensionSessionMessageType.CancelPasskey: {
          const payload = message.payload
          if (typeof payload.requestId !== 'string') {
            return err(
              new SessionOperationFailure(
                SessionOperationFailureKind.InvalidRequest,
              ),
            )
          }
          this.canceledWebsitePasskeyRequests.add(payload.requestId)
          const response: PasskeyCancellationResponse = { ok: true }
          return ok(response)
        }
        case ExtensionSessionMessageType.RegisterPasskey: {
          const payload = message.payload
          const grant = extensionVaultGrant(payload)
          if (
            typeof payload.requestId !== 'string' ||
            typeof payload.requestJson !== 'string' ||
            payload.queue.kind !== ExtensionSessionQueueKind.Deadline
          ) {
            return err(
              new SessionOperationFailure(
                SessionOperationFailureKind.InvalidRequest,
              ),
            )
          }
          const queueExpiresAt = payload.queue.expiresAt
          const activeManager = await getManager()
          const openArgs: Parameters<typeof openVault>[0] = {
            activeManager,
            grant,
          }
          const admission0 = await openVault(openArgs)
          if (admission0.isErr()) return err(admission0.error)
          try {
            const registration = await activeManager.register_website_passkey(
              decode_website_passkey_registration_request(payload.requestJson),
              () => {
                const activityArgs: WebsitePasskeyRequestActivityArgs = {
                  requestId: payload.requestId as string,
                  expiresAt: queueExpiresAt,
                }
                return this.websitePasskeyRequestIsActive(activityArgs)
              },
            )
            try {
              const flushArgs: Parameters<typeof flushEvent>[0] = {
                activeManager,
                vaultStoreId: grant.vaultStoreId,
              }
              const admission1 = await flushEvent(flushArgs)
              if (admission1.isErr()) return err(admission1.error)
              const response: PasskeyRegistrationResponse = {
                ok: true,
                credentialId: registration.credentialId,
                clientDataJSON: registration.clientDataJSON,
                attestationObject: registration.attestationObject,
                transports: registration.transports,
              }
              return ok(response)
            } finally {
              registration.free()
            }
          } finally {
            this.canceledWebsitePasskeyRequests.delete(payload.requestId)
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
            return err(
              new SessionOperationFailure(
                SessionOperationFailureKind.InvalidRequest,
              ),
            )
          }
          const queueExpiresAt = payload.queue.expiresAt
          const activeManager = await getManager()
          const openArgs: Parameters<typeof openVault>[0] = {
            activeManager,
            grant,
          }
          const admission2 = await openVault(openArgs)
          if (admission2.isErr()) return err(admission2.error)
          try {
            const assertion = await activeManager.assert_website_passkey(
              decode_website_passkey_assertion_request(payload.requestJson),
              () => {
                const activityArgs: WebsitePasskeyRequestActivityArgs = {
                  requestId: payload.requestId as string,
                  expiresAt: queueExpiresAt,
                }
                return this.websitePasskeyRequestIsActive(activityArgs)
              },
            )
            try {
              const flushArgs: Parameters<typeof flushEvent>[0] = {
                activeManager,
                vaultStoreId: grant.vaultStoreId,
              }
              const admission3 = await flushEvent(flushArgs)
              if (admission3.isErr()) return err(admission3.error)
              const response: PasskeyAssertionResponse = {
                ok: true,
                credentialId: assertion.credentialId,
                clientDataJSON: assertion.clientDataJSON,
                authenticatorData: assertion.authenticatorData,
                signature: assertion.signature,
                userHandle: assertion.userHandle,
              }
              return ok(response)
            } finally {
              assertion.free()
            }
          } finally {
            this.canceledWebsitePasskeyRequests.delete(payload.requestId)
          }
        }
      }
      return err(
        new SessionOperationFailure(SessionOperationFailureKind.InvalidRequest),
      )
    } catch {
      return err(
        new SessionOperationFailure(SessionOperationFailureKind.Failed),
      )
    }
  }
}

export const sessionWebsitePasskeys = new SessionWebsitePasskeys()
