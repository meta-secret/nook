import {
  decode_storage_providers,
  DeviceProtectionStatus,
  NookExternalEventLogRecords,
  NookVaultManager,
  provider_wasm_args,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import type {
  AuthProvidersSnapshot,
  StorageProvider,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import { scrubProviderCredentials } from '../lib/provider-credential-staging'
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

export type PasskeyEventProviderFlushRequest = {
  activeManager: NookVaultManager
  vaultStoreId: string
}

export type ActivatedExtensionIdentityOperation<Result> = {
  activeManager: NookVaultManager
  deviceId: string
  operation: () => Promise<Result>
}

export async function withActivatedExtensionIdentity<Result>({
  activeManager,
  deviceId,
  operation,
}: ActivatedExtensionIdentityOperation<Result>): Promise<Result> {
  const previousDeviceId = activeManager.device_id
  const previousProtection = await activeManager.device_protection_status()
  if (
    previousProtection === DeviceProtectionStatus.Unlocked &&
    previousDeviceId !== deviceId
  ) {
    throw new Error(
      'Lock the active local identity before importing another identity.',
    )
  }
  const restorePreviousSelection =
    previousDeviceId.length > 0 && previousDeviceId !== deviceId
  await activeManager.activate_local_identity_for_app_id(deviceId)
  try {
    return await operation()
  } catch (error) {
    if (restorePreviousSelection) {
      await activeManager.activate_local_identity_for_app_id(previousDeviceId)
    }
    throw error
  }
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
  const payload = message.payload
  const grant = extensionVaultGrant(payload)
  const records = payload.eventLogRecords
  const providers = payload.providers
  if (!Array.isArray(records) || !Array.isArray(providers)) {
    throw new Error('Extension session received an invalid vault import.')
  }
  const providerSnapshot: AuthProvidersSnapshot = {
    providers: providers as StorageProvider[],
    activeVaultStoreId: { state: 'unselected' },
  }
  const grantedProviders = dependencies.decodeProviders(providerSnapshot)
  try {
    const recordValues = dependencies.createRecords(records)
    const operation = async () => {
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
      return { ok: true, status }
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
    scrubProviderCredentials(grantedProviders)
  }
}

export async function openPasskeyVault({
  activeManager,
  grant,
}: OpenPasskeyVaultRequest): Promise<void> {
  await activeManager.open_extension_passkey_vault_js(
    grant.vaultStoreId,
    grant.deviceId,
    grant.devicePublicKey,
    grant.deviceSigningPublicKey,
  )
}

export async function flushPasskeyEventToProviders({
  activeManager,
  vaultStoreId,
}: PasskeyEventProviderFlushRequest): Promise<void> {
  const snapshot = await activeManager.load_auth_providers_snapshot()
  const providers = snapshot.providers.filter(
    (provider) =>
      provider.storeId.state === 'storeId' &&
      provider.storeId.value === vaultStoreId &&
      provider.type !== 'local' &&
      provider.type !== 'local-folder',
  )
  await Promise.allSettled(
    providers.map(async (provider) => {
      const args = provider_wasm_args(provider)
      try {
        await activeManager.flush_event_outbox_for_provider(
          args.mode,
          args.pat,
          args.repo,
        )
      } finally {
        args.free()
      }
    }),
  )
}
