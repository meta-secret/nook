import {
  decodeStorageProviders,
  DeviceProtectionStatus,
  NookExternalEventLogRecords,
  NookVaultManager,
  providerWasmArgs,
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
  decodeProviders: (snapshot) => decodeStorageProviders(snapshot).providers,
  createRecords: (records) => NookExternalEventLogRecords.fromArray(records),
}

export type ImportExtensionVaultWithDependenciesArgs =
  ImportExtensionVaultArgs & {
    dependencies: ImportExtensionVaultDependencies
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
    const statusValue = await activeManager.importExtensionEventLogRecords(
      grant.vaultStoreId,
      grant.deviceId,
      grant.devicePublicKey,
      grant.deviceSigningPublicKey,
      recordValues,
    )
    const status = statusValue.toObject()
    statusValue.free()
    const protection = await activeManager.deviceProtectionStatus()
    if (protection === DeviceProtectionStatus.Unlocked) {
      const replaceArgs: Parameters<
        typeof activeManager.replaceAuthProvidersForVault
      >[0] = {
        providers: grantedProviders,
        activeVaultStoreId: {
          state: 'storeId',
          value: grant.vaultStoreId,
        },
      }
      await activeManager.replaceAuthProvidersForVault(replaceArgs)
    } else {
      // Pairing may race a closed/locked offscreen session. Website grants are
      // already sealed for this device public key, so replace this vault's
      // complete provider set without unlock, including an empty set.
      const lockedManager = activeManager as NookVaultManager & {
        savePresealedAuthProviders: (
          snapshot: AuthProvidersSnapshot,
        ) => Promise<void>
      }
      const saveArgs: Parameters<
        typeof lockedManager.savePresealedAuthProviders
      >[0] = {
        providers: grantedProviders,
        activeVaultStoreId: {
          state: 'storeId',
          value: grant.vaultStoreId,
        },
      }
      await lockedManager.savePresealedAuthProviders(saveArgs)
    }
    return { ok: true, status }
  } finally {
    scrubProviderCredentials(grantedProviders)
  }
}

export async function openPasskeyVault({
  activeManager,
  grant,
}: {
  activeManager: NookVaultManager
  grant: ExtensionVaultGrant
}): Promise<void> {
  await activeManager.openExtensionPasskeyVault(
    grant.vaultStoreId,
    grant.deviceId,
    grant.devicePublicKey,
    grant.deviceSigningPublicKey,
  )
}

export async function flushPasskeyEventToProviders({
  activeManager,
  vaultStoreId,
}: {
  activeManager: NookVaultManager
  vaultStoreId: string
}): Promise<void> {
  const snapshot = await activeManager.loadAuthProviders()
  const providers = snapshot.providers.filter(
    (provider) =>
      provider.storeId.state === 'storeId' &&
      provider.storeId.value === vaultStoreId &&
      provider.type !== 'local' &&
      provider.type !== 'local-folder',
  )
  await Promise.allSettled(
    providers.map(async (provider) => {
      const args = providerWasmArgs(provider)
      try {
        await activeManager.flushEventOutboxForProvider(
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
