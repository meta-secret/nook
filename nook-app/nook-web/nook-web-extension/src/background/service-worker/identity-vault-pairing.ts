import { Effect } from 'effect'
import {
  ExtensionEventLogRecord as ExtensionEventLogRecordSchema,
  type ExtensionEventLogRecord,
} from '../../../../nook-web-shared/src/extension/lifecycle-runtime-messages'
import {
  ExtensionPairingApprovedMessageType,
  type ExtensionPairingApprovedGrant,
  type ExtensionPairingApprovedMessage,
} from '../../../../nook-web-shared/src/extension/runtime-messages'
import {
  ExtensionIdentityInviteWireKind,
  type ExtensionIdentityInviteWire,
} from '../../../../nook-web-shared/src/extension/identity-invite-wire'
import type { StorageProvider } from '../../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import { ProviderCredentialBuffer } from '../../lib/provider-credential-staging'
import { ExtensionSessionMessageType } from '../../lib/extension-session-message-type'
import { MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE } from '../../offscreen/session-request-adapter'
import type { SessionMessageRequest } from './pairing-identity'
import type { ExtensionSessionTransportResult } from './session-document'
import type { ExtensionSessionResponse } from '../../offscreen/session'

export type PairingIdentityImportResult =
  { ok: true; eventCount: number } | { ok: false; reason: string }

export type PairedVaultImportRequest = {
  readonly message: ExtensionPairingApprovedMessage
  readonly providers: StorageProvider[]
  /** Sync providers the vault replicates through, recorded on its grant. */
  readonly syncProviderCount: number
}

/** Imports one approved vault, as the pairing pipeline does for each. */
export type PairedVaultImport = (
  request: PairedVaultImportRequest,
) => Promise<PairingIdentityImportResult>

/** Sends one request to the extension's offscreen session. */
export type IdentitySessionSend = (
  ...request: SessionMessageRequest
) => Promise<ExtensionSessionTransportResult<ExtensionSessionResponse>>

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

export type IdentityVaultPair = {
  readonly vaultStoreId: string
  /** The identity's sync provider the session opens the vault through. */
  readonly mountProviderId: string
  /** A grant of this extension device in the identity: same device,
   * scopes and approval, for another vault. */
  readonly template: ExtensionPairingApprovedGrant
  readonly identityLabel: string
  readonly providers: StorageProvider[]
  readonly syncProviderCount: number
}

/**
 * Pairs one vault of an identity the extension is a member of: the
 * offscreen session opens it with the key the identity grants this
 * installation, then it is imported as an approved vault would be. It never
 * becomes the vault the extension fills from by default.
 */
export class IdentityVaultPairing {
  constructor(private readonly request: IdentityVaultPairingRequest) {}

  async pair(vault: IdentityVaultPair): Promise<PairingIdentityImportResult> {
    const connectMessage: Parameters<IdentitySessionSend>[0] = {
      type: ExtensionSessionMessageType.ConnectIdentityVault,
      payload: {
        vaultStoreId: vault.vaultStoreId,
        mountProviderId: vault.mountProviderId,
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
    const notOffered: ExtensionIdentityInviteWire = {
      kind: ExtensionIdentityInviteWireKind.NotOffered,
    }
    const payload: ExtensionPairingApprovedGrant = {
      ...vault.template,
      vaultStoreId: vault.vaultStoreId,
      vaultName: reply.vaultName,
      identityLabel: vault.identityLabel,
      providers: [],
      identityInvite: notOffered,
    }
    const message: ExtensionPairingApprovedMessage = {
      type: ExtensionPairingApprovedMessageType.NookExtensionPairingApproved,
      payload,
      eventLogRecords: reply.eventLogRecords,
    }
    const vaultProviders = structuredClone(vault.providers)
    try {
      const importRequest: PairedVaultImportRequest = {
        message,
        providers: vaultProviders,
        syncProviderCount: vault.syncProviderCount,
      }
      return await this.request.importVault(importRequest)
    } finally {
      new ProviderCredentialBuffer(vaultProviders).clear()
    }
  }
}
