import type { ExtensionEventLogRecord } from '../../../nook-web-shared/src/extension/runtime-messages'
import { companionWasmReady } from '../../../nook-web-shared/src/extension/companion-ready'
import {
  classify_companion_authentication_outcome,
  classify_companion_authentication_outcome_with_default_timeout,
  classify_companion_authentication_workflow,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import type {
  AuthenticationOutcomeClassification,
  AuthenticationOutcomeObservation,
  AuthenticationPageObservations,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import initNookWasm, {
  configure_vault_application,
  decode_storage_providers,
  default_password_generation_options,
  generate_password,
  read_extension_pairing_state,
  reconcile_extension_pairing_state,
  remove_extension_pairing_state,
  write_extension_pairing_state,
  NookExternalEventLogRecords,
  NookVaultManager,
  VaultApplication,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import type {
  AuthProvidersSnapshot,
  ExtensionPairingState,
  StorageProvider,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import type { AuthenticationWorkflowSnapshotView } from '../lib/auth-workflow-messages'
import type {
  AuthenticationOutcomeObservationView,
  AuthenticationOutcomeVerdictView,
} from '../lib/outcome-evidence-messages'
import type { SerializedStorageProvider } from '../lib/provider-credential-staging'
import type {
  ExtensionSessionGrantIdentity,
  ExtensionPairingItems,
  ImportedEventLogState,
} from './pairing-grants'

enum BackgroundWasmStartupKind {
  NotStarted = 'not-started',
  Initializing = 'initializing',
}

type BackgroundWasmStartup =
  | { kind: BackgroundWasmStartupKind.NotStarted }
  | {
      kind: BackgroundWasmStartupKind.Initializing
      operation: Promise<void>
    }

let backgroundWasmStartup: BackgroundWasmStartup = {
  kind: BackgroundWasmStartupKind.NotStarted,
}

function ensureExtensionWasm(): Promise<void> {
  if (backgroundWasmStartup.kind === BackgroundWasmStartupKind.Initializing) {
    return backgroundWasmStartup.operation
  }
  const nookTypedArgs0_0: Parameters<typeof initNookWasm>[0] = {
    module_or_path: chrome.runtime.getURL('background/nook_wasm_bg.wasm'),
  }
  const operation = initNookWasm(nookTypedArgs0_0).then(() => {
    configure_vault_application(VaultApplication.Extension)
  })
  backgroundWasmStartup = {
    kind: BackgroundWasmStartupKind.Initializing,
    operation,
  }
  return operation
}

function stateFromPairingItems(
  items: ExtensionPairingItems,
): ExtensionPairingState {
  return {
    entries: Object.entries(items).map(([key, record]) => ({ key, record })),
  }
}

function pairingItemsFromState(
  state: ExtensionPairingState,
): ExtensionPairingItems {
  return Object.fromEntries(
    state.entries.map(({ key, record }) => [key, record]),
  )
}

export async function loadExtensionPairingItems(): Promise<ExtensionPairingItems> {
  await ensureExtensionWasm()
  return pairingItemsFromState(await read_extension_pairing_state())
}

export async function persistExtensionPairingItems(
  items: ExtensionPairingItems,
): Promise<void> {
  await ensureExtensionWasm()
  await write_extension_pairing_state(stateFromPairingItems(items))
}

export type ExtensionPairingStorageKeys = string[]

export async function deleteExtensionPairingItems(
  keys: ExtensionPairingStorageKeys,
): Promise<void> {
  await ensureExtensionWasm()
  await remove_extension_pairing_state(keys)
}

type ReconcileExtensionPairingItemsRequest = {
  items: ExtensionPairingItems
  removedKeys: string[]
}

export async function reconcileExtensionPairingItems({
  items,
  removedKeys,
}: ReconcileExtensionPairingItemsRequest): Promise<void> {
  await ensureExtensionWasm()
  await reconcile_extension_pairing_state(
    stateFromPairingItems(items),
    removedKeys,
  )
}

export enum AuthenticationWorkflowSnapshotKind {
  Matched = 'matched',
  NoMatch = 'no-match',
}

export type AuthenticationWorkflowSnapshot =
  | { kind: AuthenticationWorkflowSnapshotKind.NoMatch }
  | {
      kind: AuthenticationWorkflowSnapshotKind.Matched
      snapshot: AuthenticationWorkflowSnapshotView
    }

export async function authenticationWorkflowSnapshot(
  input: AuthenticationPageObservations,
): Promise<AuthenticationWorkflowSnapshot> {
  await companionWasmReady
  const workflowMatch = classify_companion_authentication_workflow(input)
  if (workflowMatch.kind === AuthenticationWorkflowSnapshotKind.NoMatch) {
    return { kind: AuthenticationWorkflowSnapshotKind.NoMatch }
  }
  return {
    kind: AuthenticationWorkflowSnapshotKind.Matched,
    snapshot: workflowMatch.snapshot,
  }
}

export async function generateSuggestedPassword(): Promise<string> {
  await ensureExtensionWasm()
  return generate_password(default_password_generation_options())
}

type AuthenticationOutcomeClassificationRequest = {
  observation: AuthenticationOutcomeObservationView
  timeoutMs: number
}

export async function classifyAuthenticationOutcome({
  observation,
  timeoutMs,
}: AuthenticationOutcomeClassificationRequest): Promise<AuthenticationOutcomeVerdictView> {
  await companionWasmReady
  const boundedObservation: AuthenticationOutcomeObservation = {
    ...observation,
    elapsedMs: Math.max(0, Math.floor(observation.elapsedMs)),
  }
  const input: AuthenticationOutcomeClassification = {
    observation: boundedObservation,
    timeoutMs: Math.max(1, Math.floor(timeoutMs)),
  }
  return classify_companion_authentication_outcome(input)
}

export async function classifyAuthenticationOutcomeWithDefaultTimeout(
  observation: AuthenticationOutcomeObservationView,
): Promise<AuthenticationOutcomeVerdictView> {
  await companionWasmReady
  const boundedObservation: AuthenticationOutcomeObservation = {
    ...observation,
    elapsedMs: Math.max(0, Math.floor(observation.elapsedMs)),
  }
  return classify_companion_authentication_outcome_with_default_timeout(
    boundedObservation,
  )
}

function isImportedEventLogState(
  value: unknown,
): value is ImportedEventLogState {
  if (!value || typeof value !== 'object') return false
  const status = value as Record<string, unknown>
  if (
    typeof status.vaultStoreId !== 'string' ||
    typeof status.eventCount !== 'number' ||
    !Number.isInteger(status.eventCount) ||
    status.eventCount < 0 ||
    typeof status.accessGranted !== 'boolean' ||
    !Array.isArray(status.heads) ||
    !status.heads.every((head) => typeof head === 'string')
  ) {
    return false
  }
  // Denied imports may report zero heads after rollback; granted imports must
  // still prove a non-empty applicable projection.
  if (status.accessGranted) {
    return status.eventCount > 0 && status.heads.length > 0
  }
  return true
}

type ExtensionEventLogImportRequest = {
  grant: ExtensionSessionGrantIdentity
  records: ExtensionEventLogRecord[]
}

export async function importExtensionEventLog({
  grant,
  records,
}: ExtensionEventLogImportRequest): Promise<ImportedEventLogState> {
  await ensureExtensionWasm()
  const manager = new NookVaultManager()
  try {
    const recordValues = NookExternalEventLogRecords.from_array(records)
    const statusValue = await manager.import_extension_event_log_records_js(
      grant.vaultStoreId,
      grant.deviceId,
      grant.devicePublicKey,
      grant.deviceSigningPublicKey,
      recordValues,
    )
    const status = statusValue.to_object()
    statusValue.free()
    if (!isImportedEventLogState(status)) {
      throw new Error('Rust returned an invalid extension event-log status.')
    }
    return status
  } finally {
    manager.free()
  }
}

export type SerializedExtensionStorageProviders = SerializedStorageProvider[]

export async function decodeExtensionStorageProviders(
  providers: SerializedExtensionStorageProviders,
): Promise<StorageProvider[]> {
  await ensureExtensionWasm()
  const snapshot: AuthProvidersSnapshot = {
    providers: providers as StorageProvider[],
    activeVaultStoreId: { state: 'unselected' },
  }
  return decode_storage_providers(snapshot).providers
}
