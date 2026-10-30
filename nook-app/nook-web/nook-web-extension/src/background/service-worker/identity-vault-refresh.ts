import type {
  StoredExtensionKeyring,
  StoredExtensionPairingGrant,
} from '../pairing-grants'
import { ExtensionSessionMessageType } from '../../lib/extension-session-message-type'
import { MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE } from '../../offscreen/session-request-adapter'
import {
  IdentityVaultPairing,
  IdentityVaultSourceKind,
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
  /** Every keyring the extension joined. */
  readonly keyrings: readonly StoredExtensionKeyring[]
  /** Every vault grant the extension holds. */
  readonly grants: readonly StoredExtensionPairingGrant[]
  readonly importVault: PairedVaultImport
  readonly sendSessionMessage: IdentitySessionSend
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
      /** The identity's sync providers; the first one opens the vaults. */
      readonly mountProviderIds: string[]
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
  // Vaults to pair need a provider to open them with.
  if (toPair.length > 0 && mountProviderIds.length === 0) return rejectedRefresh
  const decoded: RefreshReply = {
    kind: RefreshReplyKind.Decoded,
    toPair,
    awaitingGrant,
    mountProviderIds,
  }
  return decoded
}

/**
 * When the extension unlocks, it brings its keyring's log up to date and
 * pairs every vault of the keyring it holds no grant for: the vaults other
 * apps created since it joined, the first ones included when it joined a
 * keyring with no vault. Each pairs under the extension's app in that
 * keyring, beside the paired vaults. A refresh or a vault that fails ends
 * with that failure.
 */
export class IdentityVaultRefresh {
  constructor(private readonly request: IdentityVaultRefreshRequest) {}

  async refresh(): Promise<IdentityVaultRefreshResult> {
    const { deviceId, keyrings, grants, importVault, sendSessionMessage } =
      this.request
    const keyring = keyrings.find((joined) => joined.deviceId === deviceId)
    // An extension key that joined no keyring has nothing to refresh.
    if (!keyring) return { ok: true, paired: 0, awaitingGrant: 0 }
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
    const pairingRequest: IdentityVaultPairingRequest = {
      importVault,
      sendSessionMessage,
    }
    const pairing = new IdentityVaultPairing(pairingRequest)
    // The keyring's first sync provider opens the vaults; it stays saved
    // in the session, so no credential travels here.
    for (const mountProviderId of reply.mountProviderIds.slice(0, 1)) {
      const fromMount = (vaultStoreId: string): IdentityVaultPair => ({
        vaultStoreId,
        source: { kind: IdentityVaultSourceKind.Mount, mountProviderId },
        keyring,
        syncProviderCount: reply.mountProviderIds.length,
      })
      for (const vaultStoreId of reply.toPair) {
        const imported = await pairing.pair(fromMount(vaultStoreId))
        if (!imported.ok) return imported
      }
      // The keyring's other apps keep writing to the vaults the extension
      // already holds: each unlock reads them again through the keyring's
      // provider, so the extension syncs without the web app open.
      for (const paired of grants) {
        if (paired.deviceId !== deviceId) continue
        if (reply.toPair.includes(paired.vaultStoreId)) continue
        const synced = await pairing.pair(fromMount(paired.vaultStoreId))
        if (!synced.ok) return synced
      }
    }
    return {
      ok: true,
      paired: reply.toPair.length,
      awaitingGrant: reply.awaitingGrant.length,
    }
  }
}
