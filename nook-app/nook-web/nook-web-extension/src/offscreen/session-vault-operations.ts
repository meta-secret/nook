import { err, ok, type Result, type Err } from 'neverthrow'
import {
  SessionOperationFailure,
  SessionOperationFailureKind,
} from '../lib/session-operation-queue'
import {
  decode_storage_providers,
  DeviceProtectionStatus,
  NookExternalEventLogRecords,
  NookVaultManager,
  provider_wasm_args,
  select_remote_event_flush_providers,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import type {
  AuthProvidersSnapshot,
  NookCompanionExtensionEndpoint,
  NookDiscoveredCompanionExtensionEndpoint,
  StorageProvider,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import type {
  CompanionExtensionPresence,
  CompanionIdentityDiscoveryObservation,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { ProviderCredentialBuffer } from '../lib/provider-credential-staging'
import { ExtensionSessionMessageType } from '../lib/extension-session-message-type'
import type { ExtensionSessionRequest } from './session-request-adapter'
import { extensionVaultGrant } from './session-vault-grant'

export interface ExtensionVaultGrant {
  vaultStoreId: string
  deviceId: string
  devicePublicKey: string
  deviceSigningPublicKey: string
}

type ImportVaultRequest = Extract<
  ExtensionSessionRequest,
  { type: ExtensionSessionMessageType.ImportVault }
>

export type ImportExtensionVaultArgs = {
  activeManager: NookVaultManager
  message: ImportVaultRequest
}

export type ImportExtensionVaultDependencies = {
  decodeProviders: (snapshot: AuthProvidersSnapshot) => StorageProvider[]
  createRecords: (
    records: ImportVaultRequest['payload']['eventLogRecords'],
  ) => NookExternalEventLogRecords
}

const importExtensionVaultDependencies: ImportExtensionVaultDependencies = {
  decodeProviders: (snapshot) => decode_storage_providers(snapshot).providers,
  createRecords: (records) => NookExternalEventLogRecords.from_array(records),
}

export type ImportExtensionVaultWithDependenciesArgs =
  ImportExtensionVaultArgs & {
    dependencies: ImportExtensionVaultDependencies
  }

export type OpenPasskeyVaultRequest = {
  activeManager: NookVaultManager
  grant: ExtensionVaultGrant
}

export type CompanionDiscoveryEndpoint =
  | {
      kind: CompanionDiscoveryEndpointKind.Initial
      endpoint: NookCompanionExtensionEndpoint
    }
  | {
      kind: CompanionDiscoveryEndpointKind.Discovered
      endpoint: NookDiscoveredCompanionExtensionEndpoint
    }
export enum CompanionDiscoveryEndpointKind {
  Initial = 'initial',
  Discovered = 'discovered',
}

export type CompanionVaultDiscoveryArgs = {
  activeManager: NookVaultManager
  endpoint: CompanionDiscoveryEndpoint
  presence: CompanionExtensionPresence
}

export type PasskeyEventProviderFlushRequest = {
  activeManager: NookVaultManager
  vaultStoreId: string
}

export type ActivatedExtensionIdentityOperation<
  // eslint-disable-next-line @typescript-eslint/no-restricted-types -- Foreign browser data is narrowed at this adapter boundary.
  Outcome extends Result<unknown, SessionOperationFailure>,
> = {
  activeManager: NookVaultManager
  deviceId: string
  operation: () => Promise<Outcome>
}

export async function withActivatedExtensionIdentity<
  // eslint-disable-next-line @typescript-eslint/no-restricted-types -- Foreign browser data is narrowed at this adapter boundary.
  Outcome extends Result<unknown, SessionOperationFailure>,
>({
  activeManager,
  deviceId,
  operation,
}: ActivatedExtensionIdentityOperation<Outcome>): Promise<
  Outcome | Err<never, SessionOperationFailure>
> {
  let previousDeviceId: string
  let previousProtection: DeviceProtectionStatus
  try {
    previousDeviceId = activeManager.device_id
    previousProtection = await activeManager.device_protection_status()
  } catch {
    return err<never, SessionOperationFailure>(
      new SessionOperationFailure(SessionOperationFailureKind.Failed),
    )
  }
  if (
    previousProtection === DeviceProtectionStatus.Unlocked &&
    previousDeviceId !== deviceId
  )
    return err<never, SessionOperationFailure>(
      new SessionOperationFailure(SessionOperationFailureKind.Locked),
    )
  let persistedPreviousDeviceId: string
  try {
    persistedPreviousDeviceId =
      await activeManager.activate_local_identity_for_app_id(deviceId)
  } catch {
    return err<never, SessionOperationFailure>(
      new SessionOperationFailure(SessionOperationFailureKind.Failed),
    )
  }
  const previousSelection =
    previousProtection === DeviceProtectionStatus.Unlocked
      ? previousDeviceId
      : persistedPreviousDeviceId
  const outcome = await operation()
  if (
    outcome.isErr() &&
    previousSelection.length > 0 &&
    previousSelection !== deviceId
  ) {
    try {
      await activeManager.activate_local_identity_for_app_id(previousSelection)
    } catch {
      return err<never, SessionOperationFailure>(
        new SessionOperationFailure(SessionOperationFailureKind.Failed),
      )
    }
  }
  return outcome
}

export function importExtensionVault(
  args: ImportExtensionVaultArgs,
): ReturnType<typeof importExtensionVaultWithDependencies> {
  const operationArgs: ImportExtensionVaultWithDependenciesArgs = {
    ...args,
    dependencies: importExtensionVaultDependencies,
  }
  return importExtensionVaultWithDependencies(operationArgs)
}

export async function importExtensionVaultWithDependencies({
  activeManager,
  message,
  dependencies,
}: ImportExtensionVaultWithDependenciesArgs) {
  try {
    const payload = message.payload
    const grant = extensionVaultGrant(payload)
    const records = payload.eventLogRecords
    const providers = payload.providers
    if (!Array.isArray(records) || !Array.isArray(providers)) {
      return err(
        new SessionOperationFailure(SessionOperationFailureKind.InvalidRequest),
      )
    }
    const providerSnapshot: AuthProvidersSnapshot = {
      providers,
      activeVaultStoreId: { state: 'unselected' },
    }
    const grantedProviders = dependencies.decodeProviders(providerSnapshot)
    try {
      const recordValues = dependencies.createRecords(records)
      const operation = async () => {
        try {
          const statusValue =
            await activeManager.import_extension_event_log_records_js(
              grant.vaultStoreId,
              grant.deviceId,
              grant.devicePublicKey,
              grant.deviceSigningPublicKey,
              recordValues,
            )
          const status = statusValue.to_object()
          statusValue.free()
          const protection = await activeManager.device_protection_status()
          const grantMatchesUnlockedIdentity =
            protection === DeviceProtectionStatus.Unlocked &&
            activeManager.device_id === grant.deviceId
          if (grantMatchesUnlockedIdentity) {
            const replaceArgs: Parameters<
              typeof activeManager.replace_auth_providers_for_vault
            >[0] = {
              providers: grantedProviders,
              activeVaultStoreId: {
                state: 'storeId',
                value: grant.vaultStoreId,
              },
            }
            await activeManager.replace_auth_providers_for_vault(replaceArgs)
          } else {
            // Website grants are already sealed for the granted device public
            // key, so replace this vault's complete provider set through its
            // explicit app scope, including an empty set.
            const saveArgs: Parameters<
              typeof activeManager.save_presealed_auth_providers_snapshot
            >[1] = {
              providers: grantedProviders,
              activeVaultStoreId: {
                state: 'storeId',
                value: grant.vaultStoreId,
              },
            }
            await activeManager.save_presealed_auth_providers_snapshot(
              grant.deviceId,
              saveArgs,
            )
          }
          // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
          return ok({ ok: true, status })
        } catch {
          return err(
            new SessionOperationFailure(SessionOperationFailureKind.Failed),
          )
        }
      }
      const activationArgs: ActivatedExtensionIdentityOperation<
        Awaited<ReturnType<typeof operation>>
      > = {
        activeManager,
        deviceId: grant.deviceId,
        operation,
      }
      return await withActivatedExtensionIdentity(activationArgs)
    } finally {
      new ProviderCredentialBuffer(grantedProviders).clear()
    }
  } catch {
    return err(new SessionOperationFailure(SessionOperationFailureKind.Failed))
  }
}

export async function openPasskeyVault({
  activeManager,
  grant,
}: OpenPasskeyVaultRequest): Promise<Result<void, SessionOperationFailure>> {
  try {
    await activeManager.open_extension_passkey_vault_js(
      grant.vaultStoreId,
      grant.deviceId,
      grant.devicePublicKey,
      grant.deviceSigningPublicKey,
    )
    return ok()
  } catch {
    return err(new SessionOperationFailure(SessionOperationFailureKind.Failed))
  }
}

enum CompanionDiscoveryUse {
  Pending = 'pending',
  Consumed = 'consumed',
}

export class CompanionVaultDiscovery {
  private use = CompanionDiscoveryUse.Pending
  constructor(private readonly args: CompanionVaultDiscoveryArgs) {}

  async discover(
    discovery: CompanionIdentityDiscoveryObservation,
  ): Promise<
    Result<NookDiscoveredCompanionExtensionEndpoint, SessionOperationFailure>
  > {
    if (this.use !== CompanionDiscoveryUse.Pending)
      return err(
        new SessionOperationFailure(SessionOperationFailureKind.Consumed),
      )
    this.use = CompanionDiscoveryUse.Consumed
    const { activeManager, endpoint, presence } = this.args
    try {
      if (presence.kind === 'unlocked') {
        const grant: ExtensionVaultGrant = {
          vaultStoreId: presence.vault_store_id,
          deviceId: presence.app_key.appKey.appId,
          devicePublicKey: presence.app_key.appKey.encryptionPublicKey,
          deviceSigningPublicKey: presence.app_key.appKey.signingPublicKey,
        }
        const openArgs: OpenPasskeyVaultRequest = { activeManager, grant }
        const opened = await openPasskeyVault(openArgs)
        if (opened.isErr()) {
          endpoint.endpoint.free()
          return err(opened.error)
        }
      }
    } catch {
      endpoint.endpoint.free()
      return err(
        new SessionOperationFailure(SessionOperationFailureKind.Failed),
      )
    }
    try {
      return ok(
        endpoint.kind === CompanionDiscoveryEndpointKind.Initial
          ? endpoint.endpoint.discover(discovery)
          : endpoint.endpoint.rediscover(discovery),
      )
    } catch {
      return err(
        new SessionOperationFailure(SessionOperationFailureKind.Failed),
      )
    }
  }
}

export async function flushPasskeyEventToProviders({
  activeManager,
  vaultStoreId,
}: PasskeyEventProviderFlushRequest): Promise<
  Result<void, SessionOperationFailure>
> {
  try {
    const snapshot = await activeManager.load_auth_providers_snapshot()
    // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
    const providers = select_remote_event_flush_providers({
      snapshot,
      vaultStoreId,
    })
    const deliveries = await Promise.allSettled(
      providers.map(async (provider) => {
        const args = provider_wasm_args(provider)
        try {
          await activeManager.flush_event_outbox_for_provider(
            args.mode,
            args.pat,
            args.repo,
          )
        } finally {
          args.pat = ''
        }
      }),
    )
    if (deliveries.some((delivery) => delivery.status === 'rejected'))
      return err(
        new SessionOperationFailure(SessionOperationFailureKind.Failed),
      )
    return ok()
  } catch {
    return err(new SessionOperationFailure(SessionOperationFailureKind.Failed))
  }
}
