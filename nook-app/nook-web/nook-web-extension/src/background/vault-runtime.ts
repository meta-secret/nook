import type { ExtensionEventLogRecord } from '../../../nook-web-shared/src/extension/runtime-messages'
import { companionWasmReady } from '../../../nook-web-shared/src/extension/companion-ready'
import {
  classifyCompanionAuthenticationOutcome,
  classifyCompanionAuthenticationOutcomeWithDefaultTimeout,
  classifyCompanionAuthenticationWorkflow,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import type {
  AuthenticationOutcomeClassification,
  AuthenticationOutcomeObservation,
  AuthenticationPageObservations,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import initNookWasm, {
  configureVaultApplication,
  decodeStorageProviders as wasmDecodeStorageProviders,
  defaultPasswordGenerationOptions as wasmDefaultPasswordGenerationOptions,
  generatePassword as wasmGeneratePassword,
  readExtensionPairingState as wasmReadExtensionPairingState,
  reconcileExtensionPairingState as wasmReconcileExtensionPairingState,
  removeExtensionPairingState as wasmRemoveExtensionPairingState,
  writeExtensionPairingState as wasmWriteExtensionPairingState,
  NookExternalEventLogRecords,
  NookVaultManager,
  VaultApplication,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import type {
  AuthProvidersSnapshot,
  ExtensionPairingState,
  StorageProvider,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import type {
  AuthenticationPageObservationView,
  AuthenticationWorkflowSnapshotView,
} from '../lib/auth-workflow-messages'
import type {
  AuthenticationOutcomeObservationView,
  AuthenticationOutcomeVerdictView,
} from '../lib/outcome-evidence-messages'
import type { SerializedStorageProvider } from '../lib/provider-credential-staging'
import type {
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
    configureVaultApplication(VaultApplication.Extension)
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

export async function readExtensionPairingState(): Promise<ExtensionPairingItems> {
  await ensureExtensionWasm()
  return pairingItemsFromState(await wasmReadExtensionPairingState())
}

export async function writeExtensionPairingState(
  items: ExtensionPairingItems,
): Promise<void> {
  await ensureExtensionWasm()
  await wasmWriteExtensionPairingState(stateFromPairingItems(items))
}

export async function removeExtensionPairingState(
  keys: string[],
): Promise<void> {
  await ensureExtensionWasm()
  await wasmRemoveExtensionPairingState(keys)
}

type ReconcileExtensionPairingStateArgs = {
  items: ExtensionPairingItems
  removedKeys: string[]
}

export async function reconcileExtensionPairingState({
  items,
  removedKeys,
}: ReconcileExtensionPairingStateArgs): Promise<void> {
  await ensureExtensionWasm()
  await wasmReconcileExtensionPairingState(
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
  observations: AuthenticationPageObservationView[],
): Promise<AuthenticationWorkflowSnapshot> {
  await companionWasmReady
  const input: AuthenticationPageObservations = { observations }
  const workflowMatch = classifyCompanionAuthenticationWorkflow(input)
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
  return wasmGeneratePassword(wasmDefaultPasswordGenerationOptions())
}

export async function classifyAuthenticationOutcome({
  observation,
  timeoutMs,
}: {
  observation: AuthenticationOutcomeObservationView
  timeoutMs: number
}): Promise<AuthenticationOutcomeVerdictView> {
  await companionWasmReady
  const boundedObservation: AuthenticationOutcomeObservation = {
    ...observation,
    elapsedMs: Math.max(0, Math.floor(observation.elapsedMs)),
  }
  const input: AuthenticationOutcomeClassification = {
    observation: boundedObservation,
    timeoutMs: Math.max(1, Math.floor(timeoutMs)),
  }
  return classifyCompanionAuthenticationOutcome(input)
}

export async function classifyAuthenticationOutcomeWithDefaultTimeout(
  observation: AuthenticationOutcomeObservationView,
): Promise<AuthenticationOutcomeVerdictView> {
  await companionWasmReady
  const boundedObservation: AuthenticationOutcomeObservation = {
    ...observation,
    elapsedMs: Math.max(0, Math.floor(observation.elapsedMs)),
  }
  return classifyCompanionAuthenticationOutcomeWithDefaultTimeout(
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

export async function importExtensionEventLog({
  grant,
  records,
}: {
  grant: {
    vaultStoreId: string
    deviceId: string
    devicePublicKey: string
    deviceSigningPublicKey: string
  }
  records: ExtensionEventLogRecord[]
}): Promise<ImportedEventLogState> {
  await ensureExtensionWasm()
  const manager = new NookVaultManager()
  try {
    const recordValues = NookExternalEventLogRecords.fromArray(records)
    const statusValue = await manager.importExtensionEventLogRecords(
      grant.vaultStoreId,
      grant.deviceId,
      grant.devicePublicKey,
      grant.deviceSigningPublicKey,
      recordValues,
    )
    const status = statusValue.toObject()
    statusValue.free()
    if (!isImportedEventLogState(status)) {
      throw new Error('Rust returned an invalid extension event-log status.')
    }
    return status
  } finally {
    manager.free()
  }
}

export async function decodeExtensionStorageProviders(
  providers: SerializedStorageProvider[],
): Promise<StorageProvider[]> {
  await ensureExtensionWasm()
  const snapshot: AuthProvidersSnapshot = {
    providers: providers as StorageProvider[],
    activeVaultStoreId: { state: 'unselected' },
  }
  return wasmDecodeStorageProviders(snapshot).providers
}
