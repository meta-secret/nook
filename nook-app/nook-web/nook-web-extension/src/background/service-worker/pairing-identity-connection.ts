import type { ExtensionPairingApprovedMessage } from '../../../../nook-web-shared/src/extension/runtime-messages'
import { ExtensionIdentityInviteWireKind } from '../../../../nook-web-shared/src/extension/identity-invite-wire'
import type { StorageProvider } from '../../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import { ExtensionSessionMessageType } from '../../lib/extension-session-message-type'
import { MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE } from '../../offscreen/session-request-adapter'
import {
  IdentityVaultPairing,
  IdentityVaultPairingFailure,
  type IdentitySessionSend,
  type IdentityVaultPair,
  type IdentityVaultPairingRequest,
  type PairedVaultImport,
  type PairingIdentityImportResult,
} from './identity-vault-pairing'

export type {
  IdentitySessionSend,
  PairedVaultImport,
  PairedVaultImportRequest,
  PairingIdentityImportResult,
} from './identity-vault-pairing'

export enum PairingIdentityConnectionFailure {
  JoinFailed = 'identity-join-failed',
  VaultConnectFailed = IdentityVaultPairingFailure.VaultConnectFailed,
}

export type PairingIdentityConnectionRequest = {
  /** The approval the extension just imported for one vault. */
  readonly message: ExtensionPairingApprovedMessage
  /** The approval's providers, staged; cleared by the caller. */
  readonly providers: StorageProvider[]
  readonly importVault: PairedVaultImport
  readonly sendSessionMessage: IdentitySessionSend
}

enum JoinReplyKind {
  Decoded = 'decoded',
  Rejected = 'rejected',
}

type JoinReply =
  | { readonly kind: JoinReplyKind.Decoded; readonly storeIds: string[] }
  | { readonly kind: JoinReplyKind.Rejected; readonly reason: string }

const rejectedJoin: JoinReply = { kind: JoinReplyKind.Rejected, reason: '' }

/** The offscreen session's reply to joining an identity. */
function decodeJoinReply(response: unknown): JoinReply {
  if (!response || typeof response !== 'object') return rejectedJoin
  if (
    'ok' in response &&
    response.ok === false &&
    'reason' in response &&
    typeof response.reason === 'string'
  ) {
    const refused: JoinReply = {
      kind: JoinReplyKind.Rejected,
      reason: response.reason,
    }
    return refused
  }
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
  const decoded: JoinReply = { kind: JoinReplyKind.Decoded, storeIds }
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
    if (invite.kind !== ExtensionIdentityInviteWireKind.Invited) return approved
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
    if (join.kind === JoinReplyKind.Rejected) {
      console.warn('Extension could not join the identity', join.reason)
      const failure: PairingIdentityImportResult = {
        ok: false,
        reason: PairingIdentityConnectionFailure.JoinFailed,
      }
      return failure
    }
    const pairingRequest: IdentityVaultPairingRequest = {
      importVault,
      sendSessionMessage,
    }
    const pairing = new IdentityVaultPairing(pairingRequest)
    let eventCount = approvedEventCount
    for (const vaultStoreId of join.storeIds) {
      if (vaultStoreId === message.payload.vaultStoreId) continue
      // The vault arrives as an approved one would: under the same identity,
      // scopes and extension device, with its own event log.
      const vault: IdentityVaultPair = {
        vaultStoreId,
        mountProviderId: invite.mountProviderId,
        template: message.payload,
        identityLabel: invite.identityLabel,
        providers,
        syncProviderCount: providers.length,
      }
      const imported = await pairing.pair(vault)
      if (!imported.ok) return imported
      eventCount += imported.eventCount
    }
    const connectedAll: PairingIdentityImportResult = { ok: true, eventCount }
    return connectedAll
  }
}
