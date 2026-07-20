import type { ExtensionEventLogRecord } from '../../../nook-web-shared/src/extension/runtime-messages'
import initNookWasm, {
  authenticationWorkflowSnapshot as wasmAuthenticationWorkflowSnapshot,
  configureVaultApplication,
  NookAuthenticationPageObservation,
  NookExternalEventLogRecords,
  NookVaultManager,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import type { AuthenticationWorkflowSnapshotView } from '../lib/auth-workflow-messages'
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

export async function authenticationWorkflowSnapshot(observation: {
  usernameFieldCount: number
  currentPasswordFieldCount: number
  newPasswordFieldCount: number
  genericPasswordFieldCount: number
  oneTimeCodeFieldCount: number
}): Promise<AuthenticationWorkflowSnapshotView | undefined> {
  await ensureExtensionWasm()
  const input = new NookAuthenticationPageObservation(
    observation.usernameFieldCount,
    observation.currentPasswordFieldCount,
    observation.newPasswordFieldCount,
    observation.genericPasswordFieldCount,
    observation.oneTimeCodeFieldCount,
  )
  try {
    const snapshot = wasmAuthenticationWorkflowSnapshot(input) ?? undefined
    if (!snapshot) return undefined
    try {
      return {
        kind: snapshot.kindName,
        stage: snapshot.stageName,
        action: snapshot.actionName,
        currentStep: snapshot.currentStep,
        totalSteps: snapshot.totalSteps,
        requiresHumanApproval: snapshot.requiresHumanApproval,
      }
    } finally {
      snapshot.free()
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
