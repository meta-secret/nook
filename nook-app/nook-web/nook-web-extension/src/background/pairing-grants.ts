import { companionWasmReady } from '../../../nook-web-shared/src/extension/companion-ready'
import {
  createExtensionPairingState,
  extensionPairingGrantStorageKey,
  extensionSetupAfterPairingGrantRemoval,
  firstExtensionPairingGrant,
  isExtensionReadySetupJson,
  isStoredExtensionPairingGrantJson,
  migrateLegacyExtensionPairingStateJson,
  orderedExtensionPairingGrants,
  refreshExtensionPairingGrant,
  selectedExtensionPairingGrant,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import type {
  CreateExtensionPairingStateInput,
  ExtensionPairingGrantApproval,
  ExtensionPairingGrantRemovalInput,
  ExtensionPairingRecord,
  ExtensionPairingState,
  ExtensionReadySetup,
  ExtensionSetupAfterRemoval,
  ImportedExtensionEventLog,
  RefreshExtensionPairingGrantInput,
  SelectedExtensionPairingGrant,
  StoredExtensionPairingGrant,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

void companionWasmReady

export const setupStorageKey = 'nook:extension-setup'

export type ExtensionReadySetupState = ExtensionReadySetup
export type ImportedEventLogState = ImportedExtensionEventLog
export type PairingSetupAfterRemoval = ExtensionSetupAfterRemoval
export type SelectedPairingGrant = SelectedExtensionPairingGrant
export type { StoredExtensionPairingGrant }
export type ExtensionPairingItems = Record<string, ExtensionPairingRecord>

function stateFromItems(items: ExtensionPairingItems): ExtensionPairingState {
  return {
    entries: Object.entries(items).map(([key, record]) => ({ key, record })),
  }
}

function itemsFromState(state: ExtensionPairingState): ExtensionPairingItems {
  return Object.fromEntries(
    state.entries.map(({ key, record }) => [key, record]),
  )
}

enum TransportJsonResultKind {
  Serialized = 'serialized',
  SerializationFailed = 'serialization-failed',
}

type TransportJsonResult =
  | { kind: TransportJsonResultKind.Serialized; json: string }
  | { kind: TransportJsonResultKind.SerializationFailed }

function transportJson(value: unknown): TransportJsonResult {
  try {
    return {
      kind: TransportJsonResultKind.Serialized,
      json: JSON.stringify(value),
    }
  } catch {
    return { kind: TransportJsonResultKind.SerializationFailed }
  }
}

export function pairingGrantStorageKey(vaultStoreId: string): string {
  return extensionPairingGrantStorageKey(vaultStoreId)
}

export function isStoredExtensionPairingGrant(
  value: unknown,
): value is StoredExtensionPairingGrant {
  const result = transportJson(value)
  return (
    result.kind === TransportJsonResultKind.Serialized &&
    isStoredExtensionPairingGrantJson(result.json)
  )
}

export function isExtensionReadySetupState(
  value: unknown,
): value is ExtensionReadySetupState {
  const result = transportJson(value)
  return (
    result.kind === TransportJsonResultKind.Serialized &&
    isExtensionReadySetupJson(result.json)
  )
}

type ExtensionPairingGrantStorageItemsArgs = {
  grant: ExtensionPairingGrantApproval
  imported: ImportedEventLogState
}

export function extensionPairingGrantStorageItems(
  args: ExtensionPairingGrantStorageItemsArgs,
): ExtensionPairingItems {
  const input: CreateExtensionPairingStateInput = {
    grant: args.grant,
    imported: args.imported,
    observedAt: new Date().toISOString(),
  }
  return itemsFromState(createExtensionPairingState(input))
}

type ExtensionStoredPairingGrantStorageItemsArgs = {
  grant: StoredExtensionPairingGrant
  imported: ImportedEventLogState
  select: boolean
}

export function extensionStoredPairingGrantStorageItems(
  args: ExtensionStoredPairingGrantStorageItemsArgs,
): ExtensionPairingItems {
  const input: RefreshExtensionPairingGrantInput = {
    ...args,
    observedAt: new Date().toISOString(),
  }
  return itemsFromState(refreshExtensionPairingGrant(input))
}

type SetupAfterPairingGrantRemovalArgs = {
  stored: ExtensionPairingItems
  removedVaultStoreId: string
}

export function setupAfterPairingGrantRemoval(
  args: SetupAfterPairingGrantRemovalArgs,
): PairingSetupAfterRemoval {
  const input: ExtensionPairingGrantRemovalInput = {
    state: stateFromItems(args.stored),
    removedVaultStoreId: args.removedVaultStoreId,
  }
  return extensionSetupAfterPairingGrantRemoval(input)
}

export function selectedPairingGrantFirst(
  stored: ExtensionPairingItems,
): StoredExtensionPairingGrant[] {
  return orderedExtensionPairingGrants(stateFromItems(stored))
}

export function selectedPairingGrant(
  stored: ExtensionPairingItems,
): SelectedPairingGrant {
  return selectedExtensionPairingGrant(stateFromItems(stored))
}

export function firstStoredPairingGrant(
  stored: ExtensionPairingItems,
): SelectedPairingGrant {
  return firstExtensionPairingGrant(stateFromItems(stored))
}

export function migratedLegacyPairingStorageItems(
  legacy: Record<string, unknown>,
): ExtensionPairingItems {
  const result = transportJson(legacy)
  if (result.kind === TransportJsonResultKind.SerializationFailed) return {}
  try {
    return itemsFromState(migrateLegacyExtensionPairingStateJson(result.json))
  } catch {
    return {}
  }
}
