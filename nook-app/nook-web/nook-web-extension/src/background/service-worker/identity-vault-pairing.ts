import { Effect } from 'effect'
import {
  ExtensionEventLogRecord as ExtensionEventLogRecordSchema,
  type ExtensionEventLogRecord,
} from '../../../../nook-web-shared/src/extension/lifecycle-runtime-messages'
import type {
  ExtensionPairingGrantApproval,
  ExtensionPairingVaultType,
  StoredExtensionKeyring,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { ExtensionSessionMessageType } from '../../lib/extension-session-message-type'
import { MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE } from '../../offscreen/session-request-adapter'
import type { SessionMessageRequest } from './pairing-identity'
import type { ExtensionSessionTransportResult } from './session-document'
import type { ExtensionSessionResponse } from '../../offscreen/session'

export type PairingIdentityImportResult =
  { ok: true; eventCount: number } | { ok: false; reason: string }

/** One vault of a keyring the extension belongs to, opened and enrolled in,
 * to import as a paired vault. */
export type PairedVaultImportRequest = {
  readonly grant: ExtensionPairingGrantApproval
  readonly eventLogRecords: ExtensionEventLogRecord[]
}

/** Imports one keyring vault, as the pairing pipeline does for each. */
export type PairedVaultImport = (
  request: PairedVaultImportRequest,
) => Promise<PairingIdentityImportResult>

/** Sends one request to the extension's offscreen session. */
export type IdentitySessionSend = (
  ...request: SessionMessageRequest
) => Promise<ExtensionSessionTransportResult<ExtensionSessionResponse>>

/** Every vault the extension pairs is a Simple vault. */
const simpleVault: ExtensionPairingVaultType = 'simple'

export enum IdentityVaultPairingFailure {
  VaultConnectFailed = 'identity-vault-connect-failed',
}

enum ConnectReplyKind {
  Decoded = 'decoded',
  Rejected = 'rejected',
}

type ConnectReply =
  | {
      readonly kind: ConnectReplyKind.Decoded
      readonly vaultName: string
      readonly eventLogRecords: ExtensionEventLogRecord[]
    }
  | { readonly kind: ConnectReplyKind.Rejected }

const rejectedConnect: ConnectReply = { kind: ConnectReplyKind.Rejected }

/** The offscreen session's reply to opening one identity vault. */
function decodeConnectReply(response: unknown): ConnectReply {
  if (!response || typeof response !== 'object') return rejectedConnect
  if (!('ok' in response) || response.ok !== true) return rejectedConnect
  if (!('vaultName' in response) || typeof response.vaultName !== 'string')
    return rejectedConnect
  if (
    !('eventLogRecords' in response) ||
    !Array.isArray(response.eventLogRecords) ||
    response.eventLogRecords.length === 0
  )
    return rejectedConnect
  const records: ExtensionEventLogRecord[] = []
  for (const candidate of response.eventLogRecords) {
    const record = Effect.runSync(
      Effect.result(ExtensionEventLogRecordSchema.decode(candidate)),
    )
    if (record._tag === 'Failure') return rejectedConnect
    records.push(record.success)
  }
  const decoded: ConnectReply = {
    kind: ConnectReplyKind.Decoded,
    vaultName: response.vaultName,
    eventLogRecords: records,
  }
  return decoded
}

export type IdentityVaultPairingRequest = {
  readonly importVault: PairedVaultImport
  readonly sendSessionMessage: IdentitySessionSend
}

export enum IdentityVaultSourceKind {
  /** The records the web app handed over when it added the extension. */
  Records = 'records',
  /** A sync provider of the keyring the session holds, by id. */
  Mount = 'mount',
}

/** Where the session reads one keyring vault from. */
export type IdentityVaultSource =
  | {
      readonly kind: IdentityVaultSourceKind.Records
      readonly eventLogRecords: ExtensionEventLogRecord[]
    }
  | {
      readonly kind: IdentityVaultSourceKind.Mount
      readonly mountProviderId: string
    }

export type IdentityVaultPair = {
  readonly vaultStoreId: string
  readonly source: IdentityVaultSource
  /** The extension's app in the keyring: every vault of the keyring pairs
   * under its key, scopes and approval. */
  readonly keyring: StoredExtensionKeyring
  readonly syncProviderCount: number
}

/**
 * Pairs one vault of a keyring the extension is a member of: the offscreen
 * session opens it with the key the keyring grants this installation and
 * enrolls in it, then it is imported as a paired vault. No vault of the
 * keyring has to be paired first.
 */
export class IdentityVaultPairing {
  constructor(private readonly request: IdentityVaultPairingRequest) {}

  async pair(vault: IdentityVaultPair): Promise<PairingIdentityImportResult> {
    const connectMessage: Parameters<IdentitySessionSend>[0] = {
      type: ExtensionSessionMessageType.ConnectIdentityVault,
      payload: {
        vaultStoreId: vault.vaultStoreId,
        source: vault.source,
        queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
      },
    }
    const connected = await this.request.sendSessionMessage(connectMessage)
    const reply = connected.isOk()
      ? decodeConnectReply(connected.value)
      : rejectedConnect
    if (reply.kind === ConnectReplyKind.Rejected) {
      const failure: PairingIdentityImportResult = {
        ok: false,
        reason: IdentityVaultPairingFailure.VaultConnectFailed,
      }
      return failure
    }
    const { keyring } = vault
    const grant: ExtensionPairingGrantApproval = {
      vaultType: simpleVault,
      deviceId: keyring.deviceId,
      devicePublicKey: keyring.devicePublicKey,
      deviceSigningPublicKey: keyring.deviceSigningPublicKey,
      deviceLabel: keyring.deviceLabel,
      vaultStoreId: vault.vaultStoreId,
      vaultName: reply.vaultName,
      identityLabel: keyring.identityLabel,
      approvedAt: keyring.approvedAt,
      scopes: keyring.scopes,
      syncProviderCount: vault.syncProviderCount,
    }
    const importRequest: PairedVaultImportRequest = {
      grant,
      eventLogRecords: reply.eventLogRecords,
    }
    return this.request.importVault(importRequest)
  }
}
