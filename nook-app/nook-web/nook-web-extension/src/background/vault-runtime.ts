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
  NookAuthenticationOutcomeObservation,
  NookAuthenticationPageObservation,
  NookAuthenticationPageObservations,
  NookExternalEventLogRecords,
  NookVaultManager,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import type {
  AuthenticationPageObservationView,
  AuthenticationWorkflowSnapshotView,
} from '../lib/auth-workflow-messages'
import type {
  AuthenticationOutcomeObservationView,
  AuthenticationOutcomeVerdictView,
} from '../lib/outcome-evidence-messages'
import { isAuthenticationOutcomeVerdictName } from '../lib/outcome-evidence-messages'
import type { ImportedEventLogState } from './pairing-grants'

let initPromise: Promise<unknown> | undefined

function ensureExtensionWasm(): Promise<unknown> {
  initPromise ??= initNookWasm({
    module_or_path: chrome.runtime.getURL('background/nook_wasm_bg.wasm'),
  }).then((value) => {
    configureVaultApplication('extension')
    return value
  })
  return initPromise
}

export async function authenticationWorkflowSnapshot(
  observations: AuthenticationPageObservationView[],
): Promise<AuthenticationWorkflowSnapshotView | undefined> {
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
      )
      try {
        inputs.add(input)
      } finally {
        input.free()
      }
    }
    const snapshot = wasmAuthenticationWorkflowSnapshot(inputs) ?? undefined
    if (!snapshot) return undefined
    try {
      return {
        kind: snapshot.kindName,
        stage: snapshot.stageName,
        action: snapshot.actionName,
        currentStep: snapshot.currentStep,
        totalSteps: snapshot.totalSteps,
        requiresHumanApproval: snapshot.requiresHumanApproval,
        observationIndex: snapshot.observationIndex,
      }
    } finally {
      snapshot.free()
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
    const verdict = wasmClassifyAuthenticationOutcome(
      input,
      timeoutMs === undefined ? undefined : Math.max(1, Math.floor(timeoutMs)),
    )
    try {
      const name = verdict.name
      if (!isAuthenticationOutcomeVerdictName(name)) {
        return { name: 'insufficient', allowsCredentialCommit: false }
      }
      return {
        name,
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
  if (typeof value !== 'object' || value === null) return false
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
