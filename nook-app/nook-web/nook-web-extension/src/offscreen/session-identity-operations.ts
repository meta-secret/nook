import { err, ok, type Result } from 'neverthrow'
import {
  decode_storage_providers,
  list_local_vaults,
  provider_wasm_args,
  type EventLogStorageRecord,
  type NookVaultManager,
  type StorageConnectArgs,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import {
  SessionOperationFailure,
  SessionOperationFailureKind,
} from '../lib/session-operation-queue'
import { ProviderCredentialBuffer } from '../lib/provider-credential-staging'
import type { ExtensionSessionMessageType } from '../lib/extension-session-message-type'
import type { ExtensionSessionRequest } from './session-request-adapter'

type JoinIdentityRequest = Extract<
  ExtensionSessionRequest,
  { type: typeof ExtensionSessionMessageType.JoinIdentity }
>
type ConnectIdentityVaultRequest = Extract<
  ExtensionSessionRequest,
  { type: typeof ExtensionSessionMessageType.ConnectIdentityVault }
>

export type ExtensionIdentityManager = Pick<
  NookVaultManager,
  | 'load_auth_providers_snapshot'
  | 'join_identity_with_sealed_invite'
  | 'identity_control_snapshot'
  | 'connect_identity_vault'
  | 'export_event_log_records_js'
>

/** One vault of the joined identity, as the extension pairs it. */
export type ExtensionIdentityVault = {
  readonly storeId: string
}

export type JoinIdentityResponse = {
  readonly ok: true
  readonly identityId: string
  readonly identityLabel: string
  readonly vaults: ExtensionIdentityVault[]
}

export type ConnectIdentityVaultResponse = {
  readonly ok: true
  readonly vaultName: string
  readonly eventLogRecords: EventLogStorageRecord[]
}

type IdentityMountRequest = {
  readonly manager: ExtensionIdentityManager
  readonly mountProviderId: string
}

export type JoinExtensionIdentityRequest = {
  readonly manager: ExtensionIdentityManager
  readonly message: JoinIdentityRequest
}

export type ConnectExtensionIdentityVaultRequest = {
  readonly manager: ExtensionIdentityManager
  readonly message: ConnectIdentityVaultRequest
}

const failed = (): SessionOperationFailure =>
  new SessionOperationFailure(SessionOperationFailureKind.Failed)

/** The session's own sealed provider the identity is reached through. */
async function mountArgs({
  manager,
  mountProviderId,
}: IdentityMountRequest): Promise<
  Result<StorageConnectArgs, SessionOperationFailure>
> {
  const providers = decode_storage_providers(
    await manager.load_auth_providers_snapshot(),
  ).providers
  try {
    const mount = providers.find((provider) => provider.id === mountProviderId)
    if (!mount) return err(failed())
    return ok(provider_wasm_args(mount))
  } finally {
    new ProviderCredentialBuffer(providers).clear()
  }
}

/**
 * Join the identity of an approved vault as a new device does: this
 * installation's local identity binds to the invited one and signs itself
 * in with the invite, through the identity's sync provider. Lists the
 * identity's vaults, so each can be opened with the key the identity now
 * grants this installation.
 */
export async function joinExtensionIdentity({
  manager,
  message,
}: JoinExtensionIdentityRequest): Promise<
  Result<JoinIdentityResponse, SessionOperationFailure>
> {
  const { identityId, memberLabel, code, sealedPassphrase, mountProviderId } =
    message.payload
  try {
    const mountRequest: IdentityMountRequest = { manager, mountProviderId }
    const args = await mountArgs(mountRequest)
    if (args.isErr()) return err(args.error)
    await manager.join_identity_with_sealed_invite(
      identityId,
      memberLabel,
      code,
      sealedPassphrase,
      args.value.mode,
      args.value.pat,
      args.value.repo,
    )
    const snapshot = await manager.identity_control_snapshot(
      await manager.load_auth_providers_snapshot(),
    )
    const response: JoinIdentityResponse = {
      ok: true,
      identityId: snapshot.identityId,
      identityLabel: snapshot.identityLabel,
      vaults: snapshot.vaults.map((vault): ExtensionIdentityVault => ({
        storeId: vault.storeId,
      })),
    }
    return ok(response)
  } catch {
    return err(failed())
  }
}

/**
 * Open one vault of the joined identity with the key the identity grants
 * this installation, enroll in it, and hand back its event log, which the
 * extension imports like an approved vault's.
 */
export async function connectExtensionIdentityVault({
  manager,
  message,
}: ConnectExtensionIdentityVaultRequest): Promise<
  Result<ConnectIdentityVaultResponse, SessionOperationFailure>
> {
  const { vaultStoreId, mountProviderId } = message.payload
  try {
    const mountRequest: IdentityMountRequest = { manager, mountProviderId }
    const args = await mountArgs(mountRequest)
    if (args.isErr()) return err(args.error)
    const page = await manager.connect_identity_vault(
      args.value.mode,
      args.value.pat,
      args.value.repo,
      vaultStoreId,
      1,
    )
    page.free()
    const records = await manager.export_event_log_records_js()
    let eventLogRecords: EventLogStorageRecord[]
    try {
      eventLogRecords = records.to_array()
    } finally {
      records.free()
    }
    let vaultName = ''
    for (const entry of await list_local_vaults()) {
      if (entry.storeId === vaultStoreId) vaultName = entry.display_label('')
      entry.free()
    }
    const response: ConnectIdentityVaultResponse = {
      ok: true,
      vaultName,
      eventLogRecords,
    }
    return ok(response)
  } catch {
    return err(failed())
  }
}
