import { err, ok, type Result } from 'neverthrow'
import {
  decode_storage_providers,
  list_local_vaults,
  NookExternalEventLogRecords,
  provider_wasm_args,
  type EventLogStorageRecord,
  type NookSecretPage,
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
  | 'join_identity_from_log'
  | 'identity_control_snapshot'
  | 'connect_identity_vault'
  | 'connect_identity_vault_from_records'
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

/** The identity join failed; the reason is the domain message, with no key
 * material, so the extension can say why. */
export type JoinIdentityRefusal = {
  readonly ok: false
  readonly reason: string
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
 * Join the keyring the web app just added this app to, from the keyring's
 * log the approval carried: this app's key is a member there already, so
 * its local identity takes the keyring's id. Lists the keyring's vaults, so
 * each can be opened with the key the keyring grants this app.
 */
export async function joinExtensionIdentity({
  manager,
  message,
}: JoinExtensionIdentityRequest): Promise<
  Result<JoinIdentityResponse | JoinIdentityRefusal, SessionOperationFailure>
> {
  const { identityId, memberLabel, identityEvents } = message.payload
  try {
    await manager.join_identity_from_log(
      identityId,
      memberLabel,
      identityEvents,
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
  } catch (failure) {
    const refusal: JoinIdentityRefusal = {
      ok: false,
      reason: failure instanceof Error ? failure.message : '',
    }
    return ok(refusal)
  }
}

/** Open the vault from where its source says, with the keyring's key. */
async function openIdentityVault({
  manager,
  message,
}: ConnectExtensionIdentityVaultRequest): Promise<
  Result<NookSecretPage, SessionOperationFailure>
> {
  const { vaultStoreId, source } = message.payload
  switch (source.kind) {
    case 'records':
      return ok(
        await manager.connect_identity_vault_from_records(
          vaultStoreId,
          NookExternalEventLogRecords.from_array(source.eventLogRecords),
          1,
        ),
      )
    case 'mount': {
      const mountRequest: IdentityMountRequest = {
        manager,
        mountProviderId: source.mountProviderId,
      }
      const args = await mountArgs(mountRequest)
      if (args.isErr()) return err(args.error)
      return ok(
        await manager.connect_identity_vault(
          args.value.mode,
          args.value.pat,
          args.value.repo,
          vaultStoreId,
          1,
        ),
      )
    }
  }
}

/**
 * Open one vault of the joined keyring with the key the keyring grants
 * this app, from the records the web app handed over or a keyring sync
 * provider, enroll in it, and hand back its event log, which the extension
 * imports like an approved vault's.
 */
export async function connectExtensionIdentityVault({
  manager,
  message,
}: ConnectExtensionIdentityVaultRequest): Promise<
  Result<ConnectIdentityVaultResponse, SessionOperationFailure>
> {
  const { vaultStoreId } = message.payload
  try {
    const opening: ConnectExtensionIdentityVaultRequest = { manager, message }
    const page = await openIdentityVault(opening)
    if (page.isErr()) return err(page.error)
    page.value.free()
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
  } catch (failure) {
    console.error(
      'Extension could not open an identity vault',
      failure instanceof Error ? failure.message : '',
    )
    return err(failed())
  }
}
