import type { ExtensionPairingApprovedMessage } from '../../../../nook-web-shared/src/extension/runtime-messages'
import { ExtensionKeyringGrantKind } from '../../../../nook-web-shared/src/extension/keyring-grant-wire'
import type { StorageProvider } from '../../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import { ExtensionSessionMessageType } from '../../lib/extension-session-message-type'
import { MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE } from '../../offscreen/session-request-adapter'
import {
  IdentityVaultPairing,
  IdentityVaultSourceKind,
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

/** The keyring joined: the vaults its log lists for this extension. */
export type JoinedKeyring = { readonly storeIds: readonly string[] }

export type PairingIdentityJoin =
  | { readonly ok: true; readonly joined: JoinedKeyring }
  | { readonly ok: false; readonly reason: PairingIdentityConnectionFailure }

/** The other vaults to pair once the approved one is imported. */
export type OtherVaultsPairing = {
  readonly approvedEventCount: number
  readonly joined: JoinedKeyring
}

/**
 * After the web app approves the extension, the extension is an app of the
 * vault's keyring with its own key: the web app already added it, with
 * every vault's DEK encrypted to that key. The extension first joins from
 * the keyring's log the approval carries, before anything is stored, then
 * pairs each other vault from its records through the same import as the
 * approved one; nothing is read from a sync provider. A join or a vault
 * that fails ends the import with that failure, so it is never reported as
 * connected, and a join that fails leaves nothing behind.
 */
export class PairingIdentityConnection {
  constructor(private readonly request: PairingIdentityConnectionRequest) {}

  /** Join the keyring; one the extension already belongs to has nothing to
   * join and nothing else to pair. */
  async join(): Promise<PairingIdentityJoin> {
    const { message, sendSessionMessage } = this.request
    const keyring = message.payload.keyring
    if (keyring.kind !== ExtensionKeyringGrantKind.Added) {
      const member: PairingIdentityJoin = { ok: true, joined: { storeIds: [] } }
      return member
    }
    const joinMessage: Parameters<IdentitySessionSend>[0] = {
      type: ExtensionSessionMessageType.JoinIdentity,
      payload: {
        identityId: keyring.identityId,
        memberLabel: message.payload.deviceLabel,
        identityEvents: keyring.identityEvents,
        queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
      },
    }
    const joined = await sendSessionMessage(joinMessage)
    const join = joined.isOk() ? decodeJoinReply(joined.value) : rejectedJoin
    if (join.kind === JoinReplyKind.Rejected) {
      console.warn('Extension could not join the identity', join.reason)
      const failure: PairingIdentityJoin = {
        ok: false,
        reason: PairingIdentityConnectionFailure.JoinFailed,
      }
      return failure
    }
    const keyringJoined: PairingIdentityJoin = {
      ok: true,
      joined: { storeIds: join.storeIds },
    }
    return keyringJoined
  }

  /** Pair each vault the joined keyring lists besides the approved one. */
  async pairOthers({
    approvedEventCount,
    joined,
  }: OtherVaultsPairing): Promise<PairingIdentityImportResult> {
    const { message, providers, importVault, sendSessionMessage } = this.request
    const keyring = message.payload.keyring
    const approved: PairingIdentityImportResult = {
      ok: true,
      eventCount: approvedEventCount,
    }
    if (keyring.kind !== ExtensionKeyringGrantKind.Added) return approved
    const pairingRequest: IdentityVaultPairingRequest = {
      importVault,
      sendSessionMessage,
    }
    const pairing = new IdentityVaultPairing(pairingRequest)
    let eventCount = approvedEventCount
    for (const keyringVault of keyring.vaults) {
      if (keyringVault.storeId === message.payload.vaultStoreId) continue
      // A vault the keyring no longer lists is not paired.
      if (!joined.storeIds.includes(keyringVault.storeId)) continue
      // The vault arrives as an approved one would: under the same keyring,
      // scopes and extension app, with its own event log.
      const vault: IdentityVaultPair = {
        vaultStoreId: keyringVault.storeId,
        source: {
          kind: IdentityVaultSourceKind.Records,
          eventLogRecords: keyringVault.eventLogRecords,
        },
        template: message.payload,
        identityLabel: keyring.identityLabel,
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
