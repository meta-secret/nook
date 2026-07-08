import type { ExtensionPairingApprovedGrant } from '../../../nook-web-shared/src/extension/runtime-messages'

export const setupStorageKey = 'nook:extension-setup'

export function pairingGrantStorageKey(vaultStoreId: string): string {
  return `nook:extension-pairing-grant:${vaultStoreId}`
}

export type ExtensionReadySetupState = {
  status: 'ready'
  deviceLabel: string
  pairedVaults: string[]
  selectedVaultName: string
  syncStatus: string
}

export function setupStateFromPairingGrant(
  grant: ExtensionPairingApprovedGrant,
): ExtensionReadySetupState {
  return {
    status: 'ready',
    deviceLabel: grant.deviceLabel,
    pairedVaults: [grant.vaultName],
    selectedVaultName: grant.vaultName,
    syncStatus:
      grant.providers.length > 0
        ? `${grant.providers.length} sync provider${grant.providers.length === 1 ? '' : 's'} granted`
        : 'Vault access granted',
  }
}

export function extensionPairingGrantStorageItems(
  grant: ExtensionPairingApprovedGrant,
): Record<string, unknown> {
  return {
    [pairingGrantStorageKey(grant.vaultStoreId)]: grant,
    [setupStorageKey]: setupStateFromPairingGrant(grant),
  }
}
