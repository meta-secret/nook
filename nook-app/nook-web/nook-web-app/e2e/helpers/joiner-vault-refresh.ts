import type { ProviderSyncFreshness } from '$app-wasm'
import type { VaultDebugWindow } from '$lib/app/browser-lifecycle'

/** Force the approved joiner's browser-owned vault to read its provider. */
export type RefreshJoinerVaultOnLoginGateArgs = {
  freshness: ProviderSyncFreshness
  authStorageSyncFailedKey: string
}

export enum RefreshJoinerVaultOnLoginGateOutcome {
  Refreshed = 'refreshed',
  Busy = 'busy',
}

export async function refreshJoinerVaultOnLoginGate(
  args: RefreshJoinerVaultOnLoginGateArgs,
): Promise<void> {
  const { freshness, authStorageSyncFailedKey } = args
  const vault = (window as VaultDebugWindow).__nookVault
  if (!vault) throw new Error('joiner-vault-runtime-unavailable')
  const refreshed = await vault.syncFromStorage(freshness)
  if (refreshed.isErr()) {
    if (refreshed.error.translationKey === authStorageSyncFailedKey) return
    throw new Error(
      `joiner-vault-refresh-rejected:${refreshed.error.translationKey}`,
    )
  }
}

/**
 * Refresh only when an auto-connect is not already verifying the vault.
 *
 * This check and the refresh start in the same browser evaluation, so a
 * forced polling refresh cannot re-enter the storage flow after auto-connect
 * has begun.
 */
export async function refreshJoinerVaultOnLoginGateIfIdle(
  args: RefreshJoinerVaultOnLoginGateArgs,
): Promise<RefreshJoinerVaultOnLoginGateOutcome> {
  const vault = (window as VaultDebugWindow).__nookVault
  if (vault?.isVerifying) return RefreshJoinerVaultOnLoginGateOutcome.Busy
  await refreshJoinerVaultOnLoginGate(args)
  return RefreshJoinerVaultOnLoginGateOutcome.Refreshed
}
