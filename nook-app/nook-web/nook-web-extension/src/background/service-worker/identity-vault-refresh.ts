import type { StoredExtensionPairingGrant } from '../pairing-grants'
import type { ExtensionPairingApprovedGrant } from '../../../../nook-web-shared/src/extension/runtime-messages'
import { ExtensionIdentityInviteWireKind } from '../../../../nook-web-shared/src/extension/identity-invite-wire'
import { ExtensionSessionMessageType } from '../../lib/extension-session-message-type'
import { MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE } from '../../offscreen/session-request-adapter'
import {
  IdentityVaultPairing,
  type IdentitySessionSend,
  type IdentityVaultPair,
  type IdentityVaultPairingRequest,
  type PairedVaultImport,
} from './identity-vault-pairing'

export enum IdentityVaultRefreshFailure {
  RefreshFailed = 'identity-refresh-failed',
}

export type IdentityVaultRefreshResult =
  | {
      readonly ok: true
      /** Vaults paired now. */
      readonly paired: number
      /** Vaults of the identity that do not grant this extension yet. */
      readonly awaitingGrant: number
    }
  | { readonly ok: false; readonly reason: string }

export type IdentityVaultRefreshRequest = {
  /** The unlocked extension device (its app id). */
  readonly deviceId: string
  /** Every vault grant the extension holds. */
  readonly grants: readonly StoredExtensionPairingGrant[]
  readonly importVault: PairedVaultImport
  readonly sendSessionMessage: IdentitySessionSend
  readonly now: () => number
}

enum RefreshReplyKind {
  Decoded = 'decoded',
  Rejected = 'rejected',
}

type RefreshReply =
  | {
      readonly kind: RefreshReplyKind.Decoded
      readonly toPair: string[]
      readonly awaitingGrant: string[]
      /** The identity's first sync provider, which opens the vaults. */
      readonly mountProviderId: string
      readonly syncProviderCount: number
    }
  | { readonly kind: RefreshReplyKind.Rejected }

const rejectedRefresh: RefreshReply = { kind: RefreshReplyKind.Rejected }

function stringList(value: unknown): string[] | RefreshReplyKind.Rejected {
  if (!Array.isArray(value)) return RefreshReplyKind.Rejected
  const strings: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') return RefreshReplyKind.Rejected
    strings.push(entry)
  }
  return strings
}

/** The offscreen session's reply to refreshing the unlocked identity. */
function decodeRefreshReply(response: unknown): RefreshReply {
  if (!response || typeof response !== 'object') return rejectedRefresh
  if (!('ok' in response) || response.ok !== true) return rejectedRefresh
  if (
    !('toPair' in response) ||
    !('awaitingGrant' in response) ||
    !('mountProviderIds' in response)
  )
    return rejectedRefresh
  const toPair = stringList(response.toPair)
  const awaitingGrant = stringList(response.awaitingGrant)
  const mountProviderIds = stringList(response.mountProviderIds)
  if (
    toPair === RefreshReplyKind.Rejected ||
    awaitingGrant === RefreshReplyKind.Rejected ||
    mountProviderIds === RefreshReplyKind.Rejected
  )
    return rejectedRefresh
  const [mountProviderId] = mountProviderIds
  if (mountProviderId === undefined) {
    // Nothing to open, or vaults to pair and no provider to open them with.
    if (toPair.length > 0) return rejectedRefresh
    const nothingToPair: RefreshReply = {
      kind: RefreshReplyKind.Decoded,
      toPair,
      awaitingGrant,
      mountProviderId: '',
      syncProviderCount: 0,
    }
    return nothingToPair
  }
  const decoded: RefreshReply = {
    kind: RefreshReplyKind.Decoded,
    toPair,
    awaitingGrant,
    mountProviderId,
    syncProviderCount: mountProviderIds.length,
  }
  return decoded
}

/**
 * When the extension unlocks, it brings its identity's log up to date and
 * pairs every vault of the identity it holds no grant for, the vaults other
 * members created since it joined. Each arrives under an existing grant's
 * device, scopes and identity, beside the paired vaults. A refresh or a
 * vault that fails ends with that failure.
 */
export class IdentityVaultRefresh {
  constructor(private readonly request: IdentityVaultRefreshRequest) {}

  async refresh(): Promise<IdentityVaultRefreshResult> {
    const { deviceId, grants, importVault, sendSessionMessage, now } =
      this.request
    const own = grants.find((grant) => grant.deviceId === deviceId)
    // An extension key with no vault yet has joined no identity.
    if (!own) return { ok: true, paired: 0, awaitingGrant: 0 }
    const refreshMessage: Parameters<IdentitySessionSend>[0] = {
      type: ExtensionSessionMessageType.RefreshIdentityVaults,
      payload: {
        pairedVaultStoreIds: grants.map((grant) => grant.vaultStoreId),
        queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
      },
    }
    const refreshed = await sendSessionMessage(refreshMessage)
    const reply = refreshed.isOk()
      ? decodeRefreshReply(refreshed.value)
      : rejectedRefresh
    if (reply.kind === RefreshReplyKind.Rejected)
      return { ok: false, reason: IdentityVaultRefreshFailure.RefreshFailed }
    // Grants stored before identities were recorded read back without one.
    const identityLabel = ((v) => (v ? v : ''))(own.identityLabel)
    const template: ExtensionPairingApprovedGrant = {
      vaultType: own.vaultType,
      deviceId: own.deviceId,
      devicePublicKey: own.devicePublicKey,
      deviceSigningPublicKey: own.deviceSigningPublicKey,
      deviceLabel: own.deviceLabel,
      vaultStoreId: own.vaultStoreId,
      vaultName: own.vaultName,
      identityLabel,
      approvedAt: now(),
      scopes: own.scopes,
      providers: [],
      identityInvite: { kind: ExtensionIdentityInviteWireKind.NotOffered },
    }
    const pairingRequest: IdentityVaultPairingRequest = {
      importVault,
      sendSessionMessage,
    }
    const pairing = new IdentityVaultPairing(pairingRequest)
    for (const vaultStoreId of reply.toPair) {
      // The identity's sync provider stays saved in the session; the vault
      // replicates through it without its credentials travelling here.
      const vault: IdentityVaultPair = {
        vaultStoreId,
        mountProviderId: reply.mountProviderId,
        template,
        identityLabel,
        providers: [],
        syncProviderCount: reply.syncProviderCount,
      }
      const imported = await pairing.pair(vault)
      if (!imported.ok) return imported
    }
    return {
      ok: true,
      paired: reply.toPair.length,
      awaitingGrant: reply.awaitingGrant.length,
    }
  }
}
