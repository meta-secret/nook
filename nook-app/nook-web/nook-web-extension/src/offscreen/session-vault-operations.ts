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
    if (protection === DeviceProtectionStatus.Unlocked) {
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
      // Pairing may race a closed/locked offscreen session. Website grants are
      // already sealed for this device public key, so replace this vault's
      // complete provider set without unlock, including an empty set.
      const lockedManager = activeManager as NookVaultManager & {
        save_presealed_auth_providers_snapshot: (
          snapshot: AuthProvidersSnapshot,
        ) => Promise<void>
      }
      const saveArgs: Parameters<
        typeof lockedManager.save_presealed_auth_providers_snapshot
      >[0] = {
        providers: grantedProviders,
        activeVaultStoreId: {
          state: 'storeId',
          value: grant.vaultStoreId,
        },
      }
      await lockedManager.save_presealed_auth_providers_snapshot(saveArgs)
    }
    return { ok: true, status }
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
