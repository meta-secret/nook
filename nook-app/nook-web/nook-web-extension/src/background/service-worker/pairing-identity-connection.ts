import { Effect } from 'effect'
import {
  ExtensionEventLogRecord as ExtensionEventLogRecordSchema,
  type ExtensionEventLogRecord,
} from '../../../../nook-web-shared/src/extension/lifecycle-runtime-messages'
import type {
  ExtensionPairingApprovedGrant,
  ExtensionPairingApprovedMessage,
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

export enum PairingIdentityConnectionFailure {
  JoinFailed = 'identity-join-failed',
  VaultConnectFailed = 'identity-vault-connect-failed',
}

export type PairingIdentityImportResult =
  { ok: true; eventCount: number } | { ok: false; reason: string }

export type PairedVaultImportRequest = {
  readonly message: ExtensionPairingApprovedMessage
  readonly providers: StorageProvider[]
}

/** Imports one approved vault, as the pairing pipeline does for each. */
export type PairedVaultImport = (
  request: PairedVaultImportRequest,
) => Promise<PairingIdentityImportResult>

/** Sends one request to the extension's offscreen session. */
export type IdentitySessionSend = (
  ...request: SessionMessageRequest
) => Promise<ExtensionSessionTransportResult<ExtensionSessionResponse>>

export type PairingIdentityConnectionRequest = {
  /** The approval the extension just imported for one vault. */
  readonly message: ExtensionPairingApprovedMessage
  /** The approval's providers, staged; cleared by the caller. */
  readonly providers: StorageProvider[]
  readonly importVault: PairedVaultImport
  readonly sendSessionMessage: IdentitySessionSend
}

enum DecodedReplyKind {
  Decoded = 'decoded',
  Rejected = 'rejected',
}

type JoinReply =
  | { readonly kind: DecodedReplyKind.Decoded; readonly storeIds: string[] }
  | { readonly kind: DecodedReplyKind.Rejected }

type ConnectReply =
  | {
      readonly kind: DecodedReplyKind.Decoded
      readonly vaultName: string
      readonly eventLogRecords: ExtensionEventLogRecord[]
    }
  | { readonly kind: DecodedReplyKind.Rejected }

const rejectedJoin: JoinReply = { kind: DecodedReplyKind.Rejected }
const rejectedConnect: ConnectReply = { kind: DecodedReplyKind.Rejected }

/** The offscreen session's reply to joining an identity. */
function decodeJoinReply(response: unknown): JoinReply {
  if (!response || typeof response !== 'object') return rejectedJoin
  if (!('ok' in response) || response.ok !== true) return rejectedJoin
  if (!('vaults' in response) || !Array.isArray(response.vaults))
    return rejectedJoin
  const storeIds: string[] = []
  for (const entry of response.vaults) {
    const vault: unknown = entry
    if (!vault || typeof vault !== 'object' || !('storeId' in vault))
      return rejectedJoin
    const { storeId } = vault
    if (typeof storeId !== 'string') return rejectedJoin
    storeIds.push(storeId)
  }
  const decoded: JoinReply = { kind: DecodedReplyKind.Decoded, storeIds }
  return decoded
}

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
    kind: DecodedReplyKind.Decoded,
    vaultName: response.vaultName,
    eventLogRecords: records,
  }
  return decoded
}

/**
 * After a vault is approved, the extension joins that vault's identity as a
 * member, the way a new phone or computer does, then pairs every other vault
 * of the identity through the same import as an approved one. Without an
 * invite (an identity with no cloud sync provider, or an older web app) only
 * the approved vault is paired. A join or a vault that fails ends the import
 * with that failure, so it is never reported as connected.
 */
export class PairingIdentityConnection {
  constructor(private readonly request: PairingIdentityConnectionRequest) {}

  async connect(
    approvedEventCount: number,
  ): Promise<PairingIdentityImportResult> {
    const { message, providers, importVault, sendSessionMessage } = this.request
    const invite = message.payload.identityInvite
    const approved: PairingIdentityImportResult = {
      ok: true,
      eventCount: approvedEventCount,
    }
    if (invite.kind !== ExtensionIdentityInviteWireKind.Invited) {
      console.info('Extension connects only the approved vault', invite.kind)
      return approved
    }
    const joinMessage: Parameters<IdentitySessionSend>[0] = {
      type: ExtensionSessionMessageType.JoinIdentity,
      payload: {
        identityId: invite.identityId,
        memberLabel: message.payload.deviceLabel,
        code: invite.code,
        sealedPassphrase: invite.sealedPassphrase,
        mountProviderId: invite.mountProviderId,
        queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
      },
    }
    const joined = await sendSessionMessage(joinMessage)
    const join = joined.isOk() ? decodeJoinReply(joined.value) : rejectedJoin
    if (join.kind === DecodedReplyKind.Rejected) {
      console.warn('Extension could not join the identity')
      const failure: PairingIdentityImportResult = {
        ok: false,
        reason: PairingIdentityConnectionFailure.JoinFailed,
      }
      return failure
    }
    const vaultFailure: PairingIdentityImportResult = {
      ok: false,
      reason: PairingIdentityConnectionFailure.VaultConnectFailed,
    }
    console.info(
      'Extension joined the identity',
      `${join.storeIds.length} vaults`,
    )
    let eventCount = approvedEventCount
    for (const vaultStoreId of join.storeIds) {
      if (vaultStoreId === message.payload.vaultStoreId) continue
      const connectMessage: Parameters<IdentitySessionSend>[0] = {
        type: ExtensionSessionMessageType.ConnectIdentityVault,
        payload: {
          vaultStoreId,
          mountProviderId: invite.mountProviderId,
          queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
        },
      }
      const connected = await sendSessionMessage(connectMessage)
      const vault = connected.isOk()
        ? decodeConnectReply(connected.value)
        : rejectedConnect
      if (vault.kind === DecodedReplyKind.Rejected) return vaultFailure
      // The vault arrives as an approved one would: under the same identity,
      // scopes and extension device, with its own event log.
      const notOffered: ExtensionIdentityInviteWire = {
        kind: ExtensionIdentityInviteWireKind.NotOffered,
      }
      const payload: ExtensionPairingApprovedGrant = {
        ...message.payload,
        vaultStoreId,
        vaultName: vault.vaultName,
        identityLabel: invite.identityLabel,
        providers: [],
        identityInvite: notOffered,
      }
      const vaultMessage: ExtensionPairingApprovedMessage = {
        type: message.type,
        payload,
        eventLogRecords: vault.eventLogRecords,
      }
      const vaultProviders = structuredClone(providers)
      try {
        const importRequest: PairedVaultImportRequest = {
          message: vaultMessage,
          providers: vaultProviders,
        }
        const imported = await importVault(importRequest)
        if (!imported.ok) return imported
        eventCount += imported.eventCount
      } finally {
        new ProviderCredentialBuffer(vaultProviders).clear()
      }
    }
    const connectedAll: PairingIdentityImportResult = { ok: true, eventCount }
    return connectedAll
  }
}
