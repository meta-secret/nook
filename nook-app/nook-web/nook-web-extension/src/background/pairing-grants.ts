import { companionWasmReady } from '../../../nook-web-shared/src/extension/companion-ready'
import {
  create_extension_pairing_state,
  extension_pairing_grant_storage_key,
  extension_setup_after_pairing_grant_removal,
  first_extension_pairing_grant,
  is_extension_ready_setup_json,
  is_stored_extension_pairing_grant_json,
  migrate_legacy_extension_pairing_state_json,
  ordered_extension_pairing_grants,
  refresh_extension_pairing_grant,
  selected_extension_pairing_grant,
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

export const setupStorageKey = 'nook:extension-setup'

export type ExtensionReadySetupState = ExtensionReadySetup
export type ImportedEventLogState = ImportedExtensionEventLog
export type PairingSetupAfterRemoval = ExtensionSetupAfterRemoval
export type SelectedPairingGrant = SelectedExtensionPairingGrant
export type { StoredExtensionPairingGrant }
export type ExtensionPairingItems = Record<string, ExtensionPairingRecord>

export type ExtensionSessionGrantIdentity = Pick<
  StoredExtensionPairingGrant,
  'vaultStoreId' | 'deviceId' | 'devicePublicKey' | 'deviceSigningPublicKey'
>

export function extensionSessionGrantIdentity(
  grant: StoredExtensionPairingGrant,
): ExtensionSessionGrantIdentity {
  return {
    vaultStoreId: grant.vaultStoreId,
    deviceId: grant.deviceId,
    devicePublicKey: grant.devicePublicKey,
    deviceSigningPublicKey: grant.deviceSigningPublicKey,
  }
}

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
    const json = JSON.stringify(value)
    if (typeof json !== 'string') {
      return { kind: TransportJsonResultKind.SerializationFailed }
    }
    return {
      kind: TransportJsonResultKind.Serialized,
      json,
    }
  } catch {
    return { kind: TransportJsonResultKind.SerializationFailed }
  }
}

function pairingGrantStorageKey(vaultStoreId: string): string {
  return extension_pairing_grant_storage_key(vaultStoreId)
}

function isStoredExtensionPairingGrant(
  value: unknown,
): value is StoredExtensionPairingGrant {
  const result = transportJson(value)
  return (
    result.kind === TransportJsonResultKind.Serialized &&
    is_stored_extension_pairing_grant_json(result.json)
  )
}

function isExtensionReadySetupState(
  value: unknown,
): value is ExtensionReadySetupState {
  const result = transportJson(value)
  return (
    result.kind === TransportJsonResultKind.Serialized &&
    is_extension_ready_setup_json(result.json)
  )
}

type ExtensionPairingGrantStorageItemsArgs = {
  grant: ExtensionPairingGrantApproval
  imported: ImportedEventLogState
}

function extensionPairingGrantStorageItems(
  args: ExtensionPairingGrantStorageItemsArgs,
): ExtensionPairingItems {
  const input: CreateExtensionPairingStateInput = {
    grant: args.grant,
    imported: args.imported,
    observedAt: new Date().toISOString(),
  }
  return itemsFromState(create_extension_pairing_state(input))
}

type ExtensionStoredPairingGrantStorageItemsArgs = {
  grant: StoredExtensionPairingGrant
  imported: ImportedEventLogState
  select: boolean
}

function extensionStoredPairingGrantStorageItems(
  args: ExtensionStoredPairingGrantStorageItemsArgs,
): ExtensionPairingItems {
  const input: RefreshExtensionPairingGrantInput = {
    ...args,
    observedAt: new Date().toISOString(),
  }
  return itemsFromState(refresh_extension_pairing_grant(input))
}

type SetupAfterPairingGrantRemovalArgs = {
  stored: ExtensionPairingItems
  removedVaultStoreId: string
}

function setupAfterPairingGrantRemoval(
  args: SetupAfterPairingGrantRemovalArgs,
): PairingSetupAfterRemoval {
  const input: ExtensionPairingGrantRemovalInput = {
    state: stateFromItems(args.stored),
    removedVaultStoreId: args.removedVaultStoreId,
  }
  return extension_setup_after_pairing_grant_removal(input)
}

function selectedPairingGrantFirst(
  stored: ExtensionPairingItems,
): StoredExtensionPairingGrant[] {
  return ordered_extension_pairing_grants(stateFromItems(stored))
}

function selectedPairingGrant(
  stored: ExtensionPairingItems,
): SelectedPairingGrant {
  return selected_extension_pairing_grant(stateFromItems(stored))
}

function firstStoredPairingGrant(
  stored: ExtensionPairingItems,
): SelectedPairingGrant {
  return first_extension_pairing_grant(stateFromItems(stored))
}

function migratedLegacyPairingStorageItems(
  legacy: Record<string, unknown>,
): ExtensionPairingItems {
  const result = transportJson(legacy)
  if (result.kind === TransportJsonResultKind.SerializationFailed) return {}
  try {
    return itemsFromState(
      migrate_legacy_extension_pairing_state_json(result.json),
    )
  } catch {
    return {}
  }
}

export type ExtensionPairingGrantPolicy = {
  pairingGrantStorageKey: typeof pairingGrantStorageKey
  isStoredExtensionPairingGrant: typeof isStoredExtensionPairingGrant
  isExtensionReadySetupState: typeof isExtensionReadySetupState
  extensionPairingGrantStorageItems: typeof extensionPairingGrantStorageItems
  extensionStoredPairingGrantStorageItems: typeof extensionStoredPairingGrantStorageItems
  setupAfterPairingGrantRemoval: typeof setupAfterPairingGrantRemoval
  selectedPairingGrantFirst: typeof selectedPairingGrantFirst
  selectedPairingGrant: typeof selectedPairingGrant
  firstStoredPairingGrant: typeof firstStoredPairingGrant
  migratedLegacyPairingStorageItems: typeof migratedLegacyPairingStorageItems
}

export const extensionPairingGrantPolicyReady: Promise<ExtensionPairingGrantPolicy> =
  companionWasmReady.then(() => ({
    pairingGrantStorageKey,
    isStoredExtensionPairingGrant,
    isExtensionReadySetupState,
    extensionPairingGrantStorageItems,
    extensionStoredPairingGrantStorageItems,
    setupAfterPairingGrantRemoval,
    selectedPairingGrantFirst,
    selectedPairingGrant,
    firstStoredPairingGrant,
    migratedLegacyPairingStorageItems,
  }))
