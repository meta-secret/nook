import { Effect } from 'effect'
import {
  decode_extension_vault_event_log_grant,
  decode_extension_vault_event_log_response,
  type ExtensionVaultEventLogRequestMessage,
  type ExtensionVaultEventLogResponse,
  type ExtensionVaultEventLogFailure,
  type ExtensionEventLogRecord,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { ExtensionSessionMessageType } from '../../lib/extension-session-message-type'
import {
  extensionSessionInteractiveDeadline,
  MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
} from '../../offscreen/session-request-adapter'
import type { ExtensionSessionTransportRequest } from '../../offscreen/session-request-adapter'
import type { ExtensionSessionResponse } from '../../offscreen/session'
import type {
  ExtensionSessionTransportDelivery,
  ExtensionSessionTransportResult,
} from './session-document'
import type { ExtensionPairingItems } from '../pairing-grants'
import { extensionSessionLifecycle } from './session-lifecycle'
import { ExtensionPairingStorage } from './pairing-identity-storage'

type VaultEventLogExportDependencies = {
  readonly loadPairingStorage: () => Promise<ExtensionPairingItems>
  readonly openSessionDocument: typeof extensionSessionLifecycle.openSessionDocument
}
type ExportRejected = Extract<
  ExtensionVaultEventLogResponse,
  { reason: ExtensionVaultEventLogFailure }
>
type ExportTransportAttempt<Value> = {
  readonly try: () => Promise<Value>
  readonly catch: () => ExportRejected
}

/** Resolves the real stored grant through Rust before asking the protected session to export. */
export class ExtensionVaultEventLogExport {
  constructor(private readonly dependencies: VaultEventLogExportDependencies) {}

  static create(): ExtensionVaultEventLogExport {
    const storage = new ExtensionPairingStorage()
    const dependencies: VaultEventLogExportDependencies = {
      loadPairingStorage: storage.getPairingStorage.bind(storage),
      openSessionDocument: extensionSessionLifecycle.openSessionDocument.bind(
        extensionSessionLifecycle,
      ),
    }
    return new ExtensionVaultEventLogExport(dependencies)
  }

  run(
    message: ExtensionVaultEventLogRequestMessage,
  ): Effect.Effect<ExtensionVaultEventLogResponse> {
    return Effect.gen(this.exportProgram.bind(this, message)).pipe(
      Effect.catch((failure) => Effect.succeed(failure)),
    )
  }

  private *exportProgram(
    message: ExtensionVaultEventLogRequestMessage,
  ): Effect.fn.Return<ExtensionVaultEventLogResponse, ExportRejected> {
    const storage: ExportTransportAttempt<ExtensionPairingItems> = {
      try: this.dependencies.loadPairingStorage,
      catch: () => ({ kind: 'Rejected', reason: 'Failed' }),
    }
    const stored = yield* Effect.tryPromise(storage)
    const authorityRequest: ExtensionSessionTransportRequest = {
      type: ExtensionSessionMessageType.ClassifyGrantAuthority,
      payload: {
        stored_json: JSON.stringify(stored),
        vault_store_id: message.payload.vault_store_id,
        queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
      },
    }
    const authorityResponse = yield* this.send(authorityRequest)
    const authorityAdmission: Parameters<
      typeof decode_extension_vault_event_log_grant
    >[0] = {
      authority_response: JSON.stringify(authorityResponse),
      vault_store_id: message.payload.vault_store_id,
    }
    const grantAttempt: {
      readonly try: () => ReturnType<
        typeof decode_extension_vault_event_log_grant
      >
      readonly catch: () => ExportRejected
    } = {
      try: () => decode_extension_vault_event_log_grant(authorityAdmission),
      catch: () => ({ kind: 'Rejected', reason: 'Failed' }),
    }
    const authority = yield* Effect.try(grantAttempt)
    switch (authority.kind) {
      case 'NotPaired':
        return { kind: 'NotPaired' }
      case 'Rejected':
        return authority
      case 'Authorized':
        break
    }
    const request: ExtensionSessionTransportRequest = {
      type: ExtensionSessionMessageType.ExportVaultEventLog,
      payload: {
        vault_store_id: authority.grant.grant.vaultStoreId,
        app_id: authority.grant.grant.deviceId,
        app_public_key: authority.grant.grant.devicePublicKey,
        app_signing_public_key: authority.grant.grant.deviceSigningPublicKey,
        queue: extensionSessionInteractiveDeadline(Date.now() + 5_000),
      },
    }
    const response = yield* this.send(request)
    const admission: {
      readonly response: ExtensionSessionResponse
      readonly vault_store_id: ExtensionVaultEventLogRequestMessage['payload']['vault_store_id']
    } = {
      response,
      vault_store_id: message.payload.vault_store_id,
    }
    const responseAttempt: {
      readonly try: () => ExtensionVaultEventLogResponse
      readonly catch: () => ExportRejected
    } = {
      try: () => {
        // The offscreen response remains untrusted until canonical Rust admission.
        /* eslint-disable @typescript-eslint/no-unsafe-type-assertion, @typescript-eslint/no-restricted-types -- Raw Chrome response is admitted immediately by the generated Rust decoder. */
        return decode_extension_vault_event_log_response(
          admission as unknown as Parameters<
            typeof decode_extension_vault_event_log_response
          >[0],
        )
        /* eslint-enable @typescript-eslint/no-unsafe-type-assertion, @typescript-eslint/no-restricted-types */
      },
      catch: () => ({ kind: 'Rejected', reason: 'Failed' }),
    }
    const decoded = yield* Effect.try(responseAttempt)
    switch (decoded.kind) {
      case 'NotPaired':
      case 'Rejected':
        return decoded
      case 'Exported': {
        // Preserve the original Chrome wire array only after complete Rust admission.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Rust has admitted this exact exported response.
        const exported = response as Extract<
          ExtensionVaultEventLogResponse,
          { event_log_records: ExtensionEventLogRecord[] }
        >
        return { ...decoded, event_log_records: exported.event_log_records }
      }
    }
  }

  private send(
    message: ExtensionSessionTransportRequest,
  ): Effect.Effect<ExtensionSessionResponse, ExportRejected> {
    return Effect.gen(this.sendProgram.bind(this, message))
  }

  private *sendProgram(
    message: ExtensionSessionTransportRequest,
  ): Effect.fn.Return<ExtensionSessionResponse, ExportRejected> {
    const documentAttempt: ExportTransportAttempt<
      Awaited<
        ReturnType<VaultEventLogExportDependencies['openSessionDocument']>
      >
    > = {
      try: this.dependencies.openSessionDocument,
      catch: () => ({ kind: 'Rejected', reason: 'Unavailable' }),
    }
    const document = yield* Effect.tryPromise(documentAttempt)
    const unavailable: ExportRejected = {
      kind: 'Rejected',
      reason: 'Unavailable',
    }
    const opened = yield* document.match(Effect.succeed, () =>
      Effect.fail(unavailable),
    )
    const request: ExtensionSessionTransportDelivery = {
      message,
    }
    const deliveryAttempt: ExportTransportAttempt<ExtensionSessionTransportResult> =
      {
        try: () => opened.sendMessage(request),
        catch: () => ({ kind: 'Rejected', reason: 'Unavailable' }),
      }
    const delivery = yield* Effect.tryPromise(deliveryAttempt)
    return yield* delivery.match(Effect.succeed, () => Effect.fail(unavailable))
  }
}
