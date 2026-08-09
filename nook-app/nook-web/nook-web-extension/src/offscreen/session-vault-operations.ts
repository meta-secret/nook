import {
  NookVaultManager,
  providerWasmArgs,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'

export interface ExtensionVaultGrant {
  vaultStoreId: string
  deviceId: string
  devicePublicKey: string
  deviceSigningPublicKey: string
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
