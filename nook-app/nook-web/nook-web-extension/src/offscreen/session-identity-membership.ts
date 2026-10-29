import { err, ok, type Result } from 'neverthrow'
import {
  decode_storage_providers,
  provider_wasm_args,
  type IdentityControlStanding,
  type NookIdentityConnectionStart,
  type NookPairedVaults,
  type NookVaultManager,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import {
  SessionOperationFailure,
  SessionOperationFailureKind,
} from '../lib/session-operation-queue'
import { ProviderCredentialBuffer } from '../lib/provider-credential-staging'
import type { ExtensionSessionMessageType } from '../lib/extension-session-message-type'
import type { ExtensionSessionRequest } from './session-request-adapter'

type RefreshIdentityVaultsRequest = Extract<
  ExtensionSessionRequest,
  { type: typeof ExtensionSessionMessageType.RefreshIdentityVaults }
>
type BeginIdentityConnectionRequest = Extract<
  ExtensionSessionRequest,
  { type: typeof ExtensionSessionMessageType.BeginIdentityConnection }
>
type ActivateIdentityRequest = Extract<
  ExtensionSessionRequest,
  { type: typeof ExtensionSessionMessageType.ActivateIdentity }
>

export type ExtensionMembershipManager = Pick<
  NookVaultManager,
  | 'load_auth_providers_snapshot'
  | 'identity_control_snapshot'
  | 'identity_replication_providers'
  | 'sync_identity_log_with_provider'
  | 'identity_vault_pairing_plan'
  | 'begin_identity_connection'
  | 'cancel_local_identity_creation'
  | 'activate_local_identity_for_app_id'
>

/** The unlocked identity's vaults the extension still has to pair. Ids of
 * the identity's sync providers only: no credential leaves the session. */
export type RefreshIdentityVaultsResponse = {
  readonly ok: true
  readonly standing: IdentityControlStanding
  readonly identityLabel: string
  readonly toPair: string[]
  readonly awaitingGrant: string[]
  readonly mountProviderIds: string[]
}

export type BeginIdentityConnectionResponse = {
  readonly ok: true
  readonly start: NookIdentityConnectionStart
}

/** Each reply names what happened, so the session's inferred response
 * union keeps every richer reply instead of reducing them to `ok`. */
export type IdentityConnectionCancelled = {
  readonly ok: true
  readonly identityConnection: 'cancelled'
}

export type IdentityActivated = {
  readonly ok: true
  readonly activatedAppId: string
}

export type RefreshExtensionIdentityVaultsRequest = {
  readonly manager: ExtensionMembershipManager
  readonly message: RefreshIdentityVaultsRequest
}

export type BeginExtensionIdentityConnectionRequest = {
  readonly manager: ExtensionMembershipManager
  readonly message: BeginIdentityConnectionRequest
}

export type ActivateExtensionIdentityRequest = {
  readonly manager: ExtensionMembershipManager
  readonly message: ActivateIdentityRequest
}

const failed = (): SessionOperationFailure =>
  new SessionOperationFailure(SessionOperationFailureKind.Failed)

/**
 * Bring the unlocked identity's log up to date from every sync provider it
 * replicates through, then list the vaults the extension does not pair yet
 * and the providers the extension can open vaults through: a local folder
 * belongs to the web app's origin, so the extension reads none.
 * An installation that never joined an identity has nothing to sync. A
 * provider that fails ends the refresh with that failure.
 */
export async function refreshExtensionIdentityVaults({
  manager,
  message,
}: RefreshExtensionIdentityVaultsRequest): Promise<
  Result<RefreshIdentityVaultsResponse, SessionOperationFailure>
> {
  try {
    const providers = await manager.load_auth_providers_snapshot()
    const identity = await manager.identity_control_snapshot(providers)
    const mounts =
      identity.standing === 'notReplicated'
        ? []
        : decode_storage_providers(
            await manager.identity_replication_providers(providers),
          ).providers
    try {
      for (const mount of mounts) {
        const args = provider_wasm_args(mount)
        try {
          await manager.sync_identity_log_with_provider(
            args.mode,
            args.pat,
            args.repo,
          )
        } finally {
          args.pat = ''
        }
      }
      const paired: NookPairedVaults = {
        storeIds: message.payload.pairedVaultStoreIds,
      }
      const plan = await manager.identity_vault_pairing_plan(providers, paired)
      // The extension opens vaults only through these.
      const readable = mounts.filter((mount) => mount.type !== 'local-folder')
      if (plan.toPair.length > 0 && readable.length === 0) {
        console.error('Extension identity has vaults to pair but no provider')
        return err(failed())
      }
      const response: RefreshIdentityVaultsResponse = {
        ok: true,
        standing: plan.standing,
        identityLabel: plan.identityLabel,
        toPair: plan.toPair,
        awaitingGrant: plan.awaitingGrant,
        mountProviderIds: readable.map((mount) => mount.id),
      }
      return ok(response)
    } finally {
      new ProviderCredentialBuffer(mounts).clear()
    }
  } catch (failure) {
    console.error(
      'Extension could not refresh its identity',
      failure instanceof Error ? failure.message : '',
    )
    return err(failed())
  }
}

/**
 * Start connecting one more identity. Rust decides whether the unlocked
 * app key joins it or a new local identity is staged, whose passkey or PIN
 * setup then creates the app key the approval is sealed to.
 */
export async function beginExtensionIdentityConnection({
  manager,
  message,
}: BeginExtensionIdentityConnectionRequest): Promise<
  Result<BeginIdentityConnectionResponse, SessionOperationFailure>
> {
  try {
    const start = await manager.begin_identity_connection(message.payload.label)
    const response: BeginIdentityConnectionResponse = { ok: true, start }
    return ok(response)
  } catch (failure) {
    console.error(
      'Extension could not start an identity connection',
      failure instanceof Error ? failure.message : '',
    )
    return err(failed())
  }
}

/** Drop a staged identity whose key setup the person left. */
export function cancelExtensionIdentityConnection(
  manager: ExtensionMembershipManager,
): Result<IdentityConnectionCancelled, SessionOperationFailure> {
  manager.cancel_local_identity_creation()
  const response: IdentityConnectionCancelled = {
    ok: true,
    identityConnection: 'cancelled',
  }
  return ok(response)
}

/** Use another identity of this extension; it opens with its own unlock. */
export async function activateExtensionIdentity({
  manager,
  message,
}: ActivateExtensionIdentityRequest): Promise<
  Result<IdentityActivated, SessionOperationFailure>
> {
  try {
    await manager.activate_local_identity_for_app_id(message.payload.appId)
    const response: IdentityActivated = {
      ok: true,
      activatedAppId: message.payload.appId,
    }
    return ok(response)
  } catch (failure) {
    console.error(
      'Extension could not switch identity',
      failure instanceof Error ? failure.message : '',
    )
    return err(failed())
  }
}
