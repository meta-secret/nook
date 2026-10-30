import type { ExtensionKeyringApproval } from '../../../../nook-web-shared/src/extension/runtime-messages'
import type { StoredExtensionKeyring } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
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
  ProvidersNotTaken = 'keyring-providers-not-taken',
  KeyringNotRecorded = 'keyring-not-recorded',
}

export type PairingIdentityConnectionRequest = {
  /** The keyring the web app just added the extension to. */
  readonly approval: ExtensionKeyringApproval
  readonly importVault: PairedVaultImport
  readonly sendSessionMessage: IdentitySessionSend
  /** Rust takes the keyring's providers sealed to this extension; answers
   * how many it took. */
  readonly takeKeyringProviders: (
    shares: ExtensionKeyringApproval['providers'],
  ) => Promise<number>
  /** Store the keyring the extension joined. */
  readonly recordKeyring: (keyring: StoredExtensionKeyring) => Promise<void>
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

/** The keyring joined: the vaults its log lists for this extension, the
 * extension's app in it, and the providers it took. */
export type JoinedKeyring = {
  readonly storeIds: readonly string[]
  readonly keyring: StoredExtensionKeyring
  readonly syncProviderCount: number
}

export type PairingIdentityJoin =
  | { readonly ok: true; readonly joined: JoinedKeyring }
  | { readonly ok: false; readonly reason: PairingIdentityConnectionFailure }

/**
 * After the web app approves the extension, the extension is an app of the
 * keyring with its own key: the web app already added it, with every
 * vault's DEK encrypted to that key. The extension joins from the keyring's
 * log the approval carries, before anything is stored, takes the keyring's
 * providers and records the keyring: it is connected now, even to a
 * keyring with no vault yet. Then it pairs each vault the web app handed
 * over from its records; the keyring's other vaults pair on the next unlock
 * through its providers. A join or a vault that fails ends the import with
 * that failure, and a join that fails leaves nothing behind.
 */
export class PairingIdentityConnection {
  constructor(private readonly request: PairingIdentityConnectionRequest) {}

  async join(): Promise<PairingIdentityJoin> {
    const { approval, sendSessionMessage } = this.request
    const joinMessage: Parameters<IdentitySessionSend>[0] = {
      type: ExtensionSessionMessageType.JoinIdentity,
      payload: {
        identityId: approval.identityId,
        memberLabel: approval.deviceLabel,
        identityEvents: approval.identityEvents,
        queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
      },
    }
    const joined = await sendSessionMessage(joinMessage)
    const join = joined.isOk() ? decodeJoinReply(joined.value) : rejectedJoin
    if (join.kind === JoinReplyKind.Rejected) {
      console.warn('Extension could not join the identity', join.reason)
      return { ok: false, reason: PairingIdentityConnectionFailure.JoinFailed }
    }
    let syncProviderCount: number
    try {
      syncProviderCount = await this.request.takeKeyringProviders(
        approval.providers,
      )
    } catch {
      return {
        ok: false,
        reason: PairingIdentityConnectionFailure.ProvidersNotTaken,
      }
    }
    const keyring: StoredExtensionKeyring = {
      identityId: approval.identityId,
      identityLabel: approval.identityLabel,
      deviceId: approval.deviceId,
      devicePublicKey: approval.devicePublicKey,
      deviceSigningPublicKey: approval.deviceSigningPublicKey,
      deviceLabel: approval.deviceLabel,
      approvedAt: approval.approvedAt,
      scopes: approval.scopes,
    }
    try {
      await this.request.recordKeyring(keyring)
    } catch {
      return {
        ok: false,
        reason: PairingIdentityConnectionFailure.KeyringNotRecorded,
      }
    }
    const keyringJoined: PairingIdentityJoin = {
      ok: true,
      joined: { storeIds: join.storeIds, keyring, syncProviderCount },
    }
    return keyringJoined
  }

  /** Pair each vault the web app handed over that the joined keyring
   * lists; a keyring with no vault has none, and is connected all the same. */
  async pairVaults(
    joined: JoinedKeyring,
  ): Promise<PairingIdentityImportResult> {
    const { approval, importVault, sendSessionMessage } = this.request
    const pairingRequest: IdentityVaultPairingRequest = {
      importVault,
      sendSessionMessage,
    }
    const pairing = new IdentityVaultPairing(pairingRequest)
    let eventCount = 0
    for (const keyringVault of approval.vaults) {
      // A vault the keyring no longer lists is not paired.
      if (!joined.storeIds.includes(keyringVault.storeId)) continue
      const vault: IdentityVaultPair = {
        vaultStoreId: keyringVault.storeId,
        source: {
          kind: IdentityVaultSourceKind.Records,
          eventLogRecords: keyringVault.eventLogRecords,
        },
        keyring: joined.keyring,
        syncProviderCount: joined.syncProviderCount,
      }
      const imported = await pairing.pair(vault)
      if (!imported.ok) return imported
      eventCount += imported.eventCount
    }
    const connectedAll: PairingIdentityImportResult = { ok: true, eventCount }
    return connectedAll
  }
}
