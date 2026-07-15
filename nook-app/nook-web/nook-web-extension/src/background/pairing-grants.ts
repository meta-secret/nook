import type { ExtensionPairingApprovedGrant } from '../../../nook-web-shared/src/extension/runtime-messages'

export const setupStorageKey = 'nook:extension-setup'

export type StoredExtensionPairingGrant = Omit<
  ExtensionPairingApprovedGrant,
  'providers'
> & {
  syncProviderCount: number
}

export function pairingGrantStorageKey(vaultStoreId: string): string {
  return `nook:extension-pairing-grant:${vaultStoreId}`
}

export type ExtensionReadySetupState = {
  status: 'ready'
  deviceLabel: string
  pairedVaults: string[]
  selectedVaultName: string
  syncProviderCount: number
  eventCount: number
  eventLogHeads: string[]
  lastLocalSyncAt: string
}

export type ImportedEventLogState = {
  vaultStoreId: string
  eventCount: number
  heads: string[]
  accessGranted: boolean
}

export function isStoredExtensionPairingGrant(
  value: unknown,
): value is StoredExtensionPairingGrant {
  if (typeof value !== 'object' || value === null) return false
  const grant = value as Record<string, unknown>
  return (
    grant.vaultType === 'simple' &&
    typeof grant.deviceId === 'string' &&
    typeof grant.devicePublicKey === 'string' &&
    typeof grant.deviceSigningPublicKey === 'string' &&
    typeof grant.deviceLabel === 'string' &&
    typeof grant.vaultStoreId === 'string' &&
    typeof grant.vaultName === 'string' &&
    typeof grant.approvedAt === 'string' &&
    Array.isArray(grant.scopes) &&
    grant.scopes.every((scope) => typeof scope === 'string') &&
    typeof grant.syncProviderCount === 'number' &&
    Number.isInteger(grant.syncProviderCount) &&
    grant.syncProviderCount >= 0
  )
}

export function isExtensionReadySetupState(
  value: unknown,
): value is ExtensionReadySetupState {
  if (typeof value !== 'object' || value === null) return false

  const state = value as Record<string, unknown>
  return (
    state.status === 'ready' &&
    typeof state.deviceLabel === 'string' &&
    Array.isArray(state.pairedVaults) &&
    state.pairedVaults.length > 0 &&
    state.pairedVaults.every((vault) => typeof vault === 'string') &&
    typeof state.selectedVaultName === 'string' &&
    state.selectedVaultName.length > 0 &&
    typeof state.syncProviderCount === 'number' &&
    Number.isInteger(state.syncProviderCount) &&
    state.syncProviderCount >= 0 &&
    typeof state.eventCount === 'number' &&
    Number.isInteger(state.eventCount) &&
    state.eventCount > 0 &&
    Array.isArray(state.eventLogHeads) &&
    state.eventLogHeads.length > 0 &&
    state.eventLogHeads.every((head) => typeof head === 'string') &&
    typeof state.lastLocalSyncAt === 'string'
  )
}

export function setupStateFromPairingGrant(
  grant: StoredExtensionPairingGrant,
  imported: ImportedEventLogState,
): ExtensionReadySetupState {
  if (imported.vaultStoreId !== grant.vaultStoreId) {
    throw new Error('Imported event log does not match the approved vault.')
  }
  if (!imported.accessGranted) {
    throw new Error('Imported event log does not grant this extension access.')
  }
  return {
    status: 'ready',
    deviceLabel: grant.deviceLabel,
    pairedVaults: [grant.vaultName],
    selectedVaultName: grant.vaultName,
    syncProviderCount: grant.syncProviderCount,
    eventCount: imported.eventCount,
    eventLogHeads: imported.heads,
    lastLocalSyncAt: new Date().toISOString(),
  }
}

export function extensionPairingGrantStorageItems(
  grant: ExtensionPairingApprovedGrant,
  imported: ImportedEventLogState,
): Record<string, unknown> {
  const storedGrant: StoredExtensionPairingGrant = {
    vaultType: grant.vaultType,
    deviceId: grant.deviceId,
    devicePublicKey: grant.devicePublicKey,
    deviceSigningPublicKey: grant.deviceSigningPublicKey,
    deviceLabel: grant.deviceLabel,
    vaultStoreId: grant.vaultStoreId,
    vaultName: grant.vaultName,
    approvedAt: grant.approvedAt,
    scopes: grant.scopes,
    syncProviderCount: grant.providers.length,
  }
  return extensionStoredPairingGrantStorageItems(storedGrant, imported)
}

export function extensionStoredPairingGrantStorageItems(
  grant: StoredExtensionPairingGrant,
  imported: ImportedEventLogState,
): Record<string, unknown> {
  return {
    [pairingGrantStorageKey(grant.vaultStoreId)]: grant,
    [setupStorageKey]: setupStateFromPairingGrant(grant, imported),
  }
}
