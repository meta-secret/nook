import type { ExtensionEventLogRecord } from '../../../nook-web-shared/src/extension/runtime-messages'
import {
  defaultPasswordGenerationOptions,
  generatePasswordWithOptions,
} from '../../../nook-web-shared/src/password/generator'
import initNookWasm, {
  authenticationWorkflowSnapshot as wasmAuthenticationWorkflowSnapshot,
  classifyAuthenticationOutcome as wasmClassifyAuthenticationOutcome,
  configureVaultApplication,
  generatePassword as wasmGeneratePassword,
  readExtensionPairingState as wasmReadExtensionPairingState,
  reconcileExtensionPairingState as wasmReconcileExtensionPairingState,
  removeExtensionPairingState as wasmRemoveExtensionPairingState,
  writeExtensionPairingState as wasmWriteExtensionPairingState,
  NookAuthenticationOutcomeObservation,
  NookAuthenticationPageObservation,
  NookAuthenticationPageObservations,
  NookAuthenticationWorkflowMatchState,
  NookExtensionPairingState,
  NookExternalEventLogRecords,
  NookVaultManager,
  VaultApplication,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import type {
  AuthenticationPageObservationView,
  AuthenticationWorkflowSnapshotView,
} from '../lib/auth-workflow-messages'
import type {
  AuthenticationOutcomeObservationView,
  AuthenticationOutcomeVerdictView,
} from '../lib/outcome-evidence-messages'
import type { ImportedEventLogState } from './pairing-grants'

enum BackgroundWasmStartupKind {
  NotStarted = 'not-started',
  Initializing = 'initializing',
}

type BackgroundWasmStartup =
  | { kind: BackgroundWasmStartupKind.NotStarted }
  | {
      kind: BackgroundWasmStartupKind.Initializing
      operation: Promise<unknown>
    }

let backgroundWasmStartup: BackgroundWasmStartup = {
  kind: BackgroundWasmStartupKind.NotStarted,
}

function ensureExtensionWasm(): Promise<unknown> {
  if (backgroundWasmStartup.kind === BackgroundWasmStartupKind.Initializing) {
    return backgroundWasmStartup.operation
  }
  const operation = initNookWasm({
    module_or_path: chrome.runtime.getURL('background/nook_wasm_bg.wasm'),
  }).then((value) => {
    configureVaultApplication(VaultApplication.Extension)
    return value
  })
  backgroundWasmStartup = {
    kind: BackgroundWasmStartupKind.Initializing,
    operation,
  }
  return operation
}

export async function readExtensionPairingState(): Promise<
  Record<string, unknown>
> {
  await ensureExtensionWasm()
  const state = await wasmReadExtensionPairingState()
  try {
    return state.toObject() as Record<string, unknown>
  } finally {
    state.free()
  }
}

export async function writeExtensionPairingState(
  entries: Record<string, unknown>,
): Promise<void> {
  await ensureExtensionWasm()
  const state = NookExtensionPairingState.fromObject(entries)
  try {
    await wasmWriteExtensionPairingState(state)
  } finally {
    state.free()
  }
}

export async function removeExtensionPairingState(
  keys: string[],
): Promise<void> {
  await ensureExtensionWasm()
  await wasmRemoveExtensionPairingState(keys)
}

export async function reconcileExtensionPairingState(
  entries: Record<string, unknown>,
  removedKeys: string[],
): Promise<void> {
  await ensureExtensionWasm()
  const state = NookExtensionPairingState.fromObject(entries)
  try {
    await wasmReconcileExtensionPairingState(state, removedKeys)
  } finally {
    state.free()
  }
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
  await ensureExtensionWasm()
  const inputs = new NookAuthenticationPageObservations()
  try {
    for (const observation of observations) {
      const input = new NookAuthenticationPageObservation(
        observation.usernameFieldCount,
        observation.currentPasswordFieldCount,
        observation.newPasswordFieldCount,
        observation.genericPasswordFieldCount,
        observation.oneTimeCodeFieldCount,
        observation.manualCheckpointPresent,
        observation.authenticatorSetupHint,
        observation.backupCodesHint,
        observation.passkeyControlPresent,
        observation.matchingPasskeyAccountCount,
      )
      try {
        inputs.add(input)
      } finally {
        input.free()
      }
    }
    const workflowMatch = wasmAuthenticationWorkflowSnapshot(inputs)
    try {
      if (
        workflowMatch.state === NookAuthenticationWorkflowMatchState.NoMatch
      ) {
        return { kind: AuthenticationWorkflowSnapshotKind.NoMatch }
      }
      const snapshot = workflowMatch.snapshot()
      try {
        return {
          kind: AuthenticationWorkflowSnapshotKind.Matched,
          snapshot: {
            kind: snapshot.kindName,
            stage: snapshot.stageName,
            action: snapshot.actionName,
            currentStep: snapshot.currentStep,
            totalSteps: snapshot.totalSteps,
            requiresHumanApproval: snapshot.requiresHumanApproval,
            observationIndex: snapshot.observationIndex,
          },
        }
      } finally {
        snapshot.free()
      }
    } finally {
      workflowMatch.free()
    }
  } finally {
    inputs.free()
  }
}

export async function generateSuggestedPassword(): Promise<string> {
  await ensureExtensionWasm()
  return generatePasswordWithOptions(
    wasmGeneratePassword,
    defaultPasswordGenerationOptions,
  )
}

export async function classifyAuthenticationOutcome(
  observation: AuthenticationOutcomeObservationView,
  timeoutMs?: number,
): Promise<AuthenticationOutcomeVerdictView> {
  await ensureExtensionWasm()
  const input = new NookAuthenticationOutcomeObservation(
    observation.navigatedAwayFromAuthPath,
    observation.authFieldsPresent,
    observation.successMarkerPresent,
    observation.errorMarkerPresent,
    observation.sameDocumentMutation,
    observation.inIframe,
    Math.max(0, Math.floor(observation.elapsedMs)),
  )
  try {
    const verdict =
      typeof timeoutMs === 'number' && Number.isFinite(timeoutMs)
        ? wasmClassifyAuthenticationOutcome(
            input,
            Math.max(1, Math.floor(timeoutMs)),
          )
        : wasmClassifyAuthenticationOutcome(input)
    try {
      return {
        verdict: verdict.verdict,
        allowsCredentialCommit: verdict.allowsCredentialCommit === true,
      }
    } finally {
      verdict.free()
    }
  } finally {
    input.free()
  }
}

function isImportedEventLogState(
  value: unknown,
): value is ImportedEventLogState {
  if (!value || typeof value !== 'object') return false
  const status = value as Record<string, unknown>
  return (
    typeof status.vaultStoreId === 'string' &&
    typeof status.eventCount === 'number' &&
    Number.isInteger(status.eventCount) &&
    status.eventCount > 0 &&
    typeof status.accessGranted === 'boolean' &&
    Array.isArray(status.heads) &&
    status.heads.length > 0 &&
    status.heads.every((head) => typeof head === 'string')
  )
}

export async function importExtensionEventLog(
  grant: {
    vaultStoreId: string
    deviceId: string
    devicePublicKey: string
    deviceSigningPublicKey: string
  },
  records: ExtensionEventLogRecord[],
): Promise<ImportedEventLogState> {
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
