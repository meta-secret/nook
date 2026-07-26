import type { ExtensionPairingApprovedGrant } from '../../../nook-web-shared/src/extension/runtime-messages'

export const setupStorageKey = 'nook:extension-setup'

export type StoredExtensionPairingGrant = Omit<
  ExtensionPairingApprovedGrant,
  'providers'
> & {
  syncProviderCount: number
  eventCount: number
  eventLogHeads: string[]
  lastLocalSyncAt: string
}

export function pairingGrantStorageKey(vaultStoreId: string): string {
  return `nook:extension-pairing-grant:${vaultStoreId}`
}

export type ExtensionReadySetupState = {
  status: 'ready'
  deviceLabel: string
  pairedVaults: string[]
  selectedVaultStoreId: string
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
  if (!value || typeof value !== 'object') return false
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
    grant.syncProviderCount >= 0 &&
    typeof grant.eventCount === 'number' &&
    Number.isInteger(grant.eventCount) &&
    grant.eventCount > 0 &&
    Array.isArray(grant.eventLogHeads) &&
    grant.eventLogHeads.length > 0 &&
    grant.eventLogHeads.every((head) => typeof head === 'string') &&
    typeof grant.lastLocalSyncAt === 'string' &&
    grant.lastLocalSyncAt.length > 0
  )
}

export function isExtensionReadySetupState(
  value: unknown,
): value is ExtensionReadySetupState {
  if (!value || typeof value !== 'object') return false

  const state = value as Record<string, unknown>
  return (
    state.status === 'ready' &&
    typeof state.deviceLabel === 'string' &&
    Array.isArray(state.pairedVaults) &&
    state.pairedVaults.length > 0 &&
    state.pairedVaults.every((vault) => typeof vault === 'string') &&
    typeof state.selectedVaultStoreId === 'string' &&
    state.selectedVaultStoreId.length > 0 &&
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
): ExtensionReadySetupState {
  return {
    status: 'ready',
    deviceLabel: grant.deviceLabel,
    pairedVaults: [grant.vaultName],
    selectedVaultStoreId: grant.vaultStoreId,
    selectedVaultName: grant.vaultName,
    syncProviderCount: grant.syncProviderCount,
    eventCount: grant.eventCount,
    eventLogHeads: grant.eventLogHeads,
    lastLocalSyncAt: grant.lastLocalSyncAt,
  }
}

function storedPairingGrant(
  grant: Omit<
    StoredExtensionPairingGrant,
    'eventCount' | 'eventLogHeads' | 'lastLocalSyncAt'
  >,
  imported: ImportedEventLogState,
): StoredExtensionPairingGrant {
  if (imported.vaultStoreId !== grant.vaultStoreId) {
    throw new Error('Imported event log does not match the approved vault.')
  }
  if (!imported.accessGranted) {
    throw new Error('Imported event log does not grant this extension access.')
  }
  return {
    ...grant,
    eventCount: imported.eventCount,
    eventLogHeads: imported.heads,
    lastLocalSyncAt: new Date().toISOString(),
  }
}

export function extensionPairingGrantStorageItems(
  grant: ExtensionPairingApprovedGrant,
  imported: ImportedEventLogState,
): Record<string, unknown> {
  const storedGrant = storedPairingGrant(
    {
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
    },
    imported,
  )
  return {
    [pairingGrantStorageKey(storedGrant.vaultStoreId)]: storedGrant,
    [setupStorageKey]: setupStateFromPairingGrant(storedGrant),
  }
}

export function extensionStoredPairingGrantStorageItems(
  grant: StoredExtensionPairingGrant,
  imported: ImportedEventLogState,
  select: boolean,
): Record<string, unknown> {
  const updatedGrant = storedPairingGrant(grant, imported)
  return {
    [pairingGrantStorageKey(updatedGrant.vaultStoreId)]: updatedGrant,
    ...(select
      ? { [setupStorageKey]: setupStateFromPairingGrant(updatedGrant) }
      : {}),
  }
}

export function setupAfterPairingGrantRemoval(
  stored: Record<string, unknown>,
  removedVaultStoreId: string,
): ExtensionReadySetupState | undefined {
  const current = stored[setupStorageKey]
  if (
    isExtensionReadySetupState(current) &&
    current.selectedVaultStoreId !== removedVaultStoreId
  ) {
    return current
  }
  const remaining = Object.entries(stored)
    .filter(
      ([key, value]) =>
        key !== pairingGrantStorageKey(removedVaultStoreId) &&
        key.startsWith('nook:extension-pairing-grant:') &&
        isStoredExtensionPairingGrant(value),
    )
    .map(([, grant]) => grant as StoredExtensionPairingGrant)
    .sort((left, right) => right.approvedAt.localeCompare(left.approvedAt))
  return remaining[0] ? setupStateFromPairingGrant(remaining[0]) : undefined
}

export function selectedPairingGrantFirst(
  stored: Record<string, unknown>,
  grants: StoredExtensionPairingGrant[],
): StoredExtensionPairingGrant[] {
  const setup = stored[setupStorageKey]
  const selectedVaultStoreId = isExtensionReadySetupState(setup)
    ? setup.selectedVaultStoreId
    : undefined
  return [...grants].sort((left, right) => {
    const leftSelected = left.vaultStoreId === selectedVaultStoreId
    const rightSelected = right.vaultStoreId === selectedVaultStoreId
    if (leftSelected !== rightSelected) return leftSelected ? -1 : 1
    return right.approvedAt.localeCompare(left.approvedAt)
  })
}

export function selectedPairingGrant(
  stored: Record<string, unknown>,
): StoredExtensionPairingGrant | undefined {
  const setup = stored[setupStorageKey]
  if (!isExtensionReadySetupState(setup)) return undefined
  const grant = stored[pairingGrantStorageKey(setup.selectedVaultStoreId)]
  return isStoredExtensionPairingGrant(grant) ? grant : undefined
}

type LegacyStoredExtensionPairingGrant = Omit<
  StoredExtensionPairingGrant,
  'eventCount' | 'eventLogHeads' | 'lastLocalSyncAt'
>

type LegacyExtensionReadySetupState = Omit<
  ExtensionReadySetupState,
  'selectedVaultStoreId'
>

function isLegacyStoredExtensionPairingGrant(
  value: unknown,
): value is LegacyStoredExtensionPairingGrant {
  if (!value || typeof value !== 'object') return false
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

function isLegacyExtensionReadySetupState(
  value: unknown,
): value is LegacyExtensionReadySetupState {
  if (!value || typeof value !== 'object') return false
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
    typeof state.lastLocalSyncAt === 'string' &&
    state.lastLocalSyncAt.length > 0
  )
}

export function migratedLegacyPairingStorageItems(
  legacy: Record<string, unknown>,
): Record<string, unknown> {
  const setup = legacy[setupStorageKey]
  if (!isLegacyExtensionReadySetupState(setup)) return {}
  const selected = Object.entries(legacy).filter(
    ([key, value]) =>
      key.startsWith('nook:extension-pairing-grant:') &&
      isLegacyStoredExtensionPairingGrant(value) &&
      value.vaultName === setup.selectedVaultName,
  )
  if (
    selected.length !== 1 ||
    !selected[0] ||
    !isLegacyStoredExtensionPairingGrant(selected[0][1])
  ) {
    return {}
  }
  const [key, grant] = selected[0]
  const migrated: StoredExtensionPairingGrant = {
    ...grant,
    eventCount: setup.eventCount,
    eventLogHeads: setup.eventLogHeads,
    lastLocalSyncAt: setup.lastLocalSyncAt,
  }
  return {
    [key]: migrated,
    [setupStorageKey]: setupStateFromPairingGrant(migrated),
  }
}
