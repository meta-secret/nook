import {
  AccountPickerAuthorizationLifecycle,
  CleanupEvidence,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { companionWasmReady } from '../../../../nook-web-shared/src/extension/companion-ready'
import {
  getSessionStorage,
  removeSessionStorage,
  setSessionStorage,
} from './pairing-identity'

export const ACCOUNT_PICKER_CLEANUP_STORAGE_KEY =
  'nook.extension.account-picker-cleanup'
const ACCOUNT_PICKER_AUTHORIZATION_EPOCH_STORAGE_KEY =
  'nook.extension.account-picker-authorization-epoch'

enum AccountPickerAuthorizationAvailability {
  Unavailable = 'unavailable',
}

let accountPickerAuthorizationState:
  AccountPickerAuthorizationLifecycle | AccountPickerAuthorizationAvailability =
  AccountPickerAuthorizationAvailability.Unavailable
let accountPickerAuthorizationStatePromise:
  Promise<void> | AccountPickerAuthorizationAvailability =
  AccountPickerAuthorizationAvailability.Unavailable

async function initializedAccountPickerAuthorizationState(): Promise<void> {
  if (
    accountPickerAuthorizationState !==
    AccountPickerAuthorizationAvailability.Unavailable
  ) {
    return
  }
  if (
    accountPickerAuthorizationStatePromise ===
    AccountPickerAuthorizationAvailability.Unavailable
  ) {
    accountPickerAuthorizationStatePromise = (async () => {
      await companionWasmReady
      const stored = await getSessionStorage(
        ACCOUNT_PICKER_AUTHORIZATION_EPOCH_STORAGE_KEY,
      )
      const candidate = stored[ACCOUNT_PICKER_AUTHORIZATION_EPOCH_STORAGE_KEY]
      const epoch =
        typeof candidate === 'string' && candidate.length > 0
          ? candidate
          : crypto.randomUUID()
      if (candidate !== epoch) {
        const epochStorage: Parameters<typeof setSessionStorage>[0] = {
          [ACCOUNT_PICKER_AUTHORIZATION_EPOCH_STORAGE_KEY]: epoch,
        }
        await setSessionStorage(epochStorage)
      }
      const wasmEpoch: ConstructorParameters<
        typeof AccountPickerAuthorizationLifecycle
      >[0] = epoch
      accountPickerAuthorizationState = new AccountPickerAuthorizationLifecycle(
        wasmEpoch,
      )
    })()
  }
  try {
    await accountPickerAuthorizationStatePromise
  } catch (error) {
    accountPickerAuthorizationStatePromise =
      AccountPickerAuthorizationAvailability.Unavailable
    throw error
  }
}

// Read synchronously after each await: another cleanup may consume the handle
// while browser storage is pending. The initialization promise owns no handle.
function currentAccountPickerAuthorizationState(): AccountPickerAuthorizationLifecycle {
  if (
    accountPickerAuthorizationState ===
    AccountPickerAuthorizationAvailability.Unavailable
  ) {
    throw new Error('account picker authorization is not initialized')
  }
  return accountPickerAuthorizationState
}

export async function accountPickerAuthorizationGeneration(): Promise<string> {
  await initializedAccountPickerAuthorizationState()
  return currentAccountPickerAuthorizationState().snapshot()
}

export function accountPickerAuthorizationIsCurrent(
  authorizationGeneration: string,
): boolean {
  return (
    accountPickerAuthorizationState !==
      AccountPickerAuthorizationAvailability.Unavailable &&
    accountPickerAuthorizationState.is_current(authorizationGeneration)
  )
}

export enum AccountPickerCleanupMarkerStatus {
  Persisted = 'persisted',
  Unavailable = 'unavailable',
}

export type AccountPickerAuthorizationCleanupStart = {
  authorizationGeneration: string
  markerStatus: AccountPickerCleanupMarkerStatus
}

export async function beginAccountPickerAuthorizationCleanup(): Promise<AccountPickerAuthorizationCleanupStart> {
  await initializedAccountPickerAuthorizationState()
  accountPickerAuthorizationState = currentAccountPickerAuthorizationState()
    .begin_cleanup(crypto.randomUUID())
    .into_lifecycle()
  const generation = accountPickerAuthorizationState.snapshot()
  const cleanupStorage: Parameters<typeof setSessionStorage>[0] = {
    [ACCOUNT_PICKER_CLEANUP_STORAGE_KEY]: true,
    [ACCOUNT_PICKER_AUTHORIZATION_EPOCH_STORAGE_KEY]: generation,
  }
  try {
    await setSessionStorage(cleanupStorage)
    return {
      authorizationGeneration: generation,
      markerStatus: AccountPickerCleanupMarkerStatus.Persisted,
    }
  } catch {
    return {
      authorizationGeneration: generation,
      markerStatus: AccountPickerCleanupMarkerStatus.Unavailable,
    }
  }
}

// eslint-disable-next-line max-params -- The WASM lifecycle transition requires its epoch and completion class.
export async function completeAccountPickerAuthorizationCleanup(
  authorizationGeneration: string,
  fullCleanupCompleted: boolean,
): Promise<void> {
  await initializedAccountPickerAuthorizationState()
  const evidence = fullCleanupCompleted
    ? CleanupEvidence.Full
    : CleanupEvidence.Partial
  try {
    if (
      currentAccountPickerAuthorizationState().is_final_cleanup(
        authorizationGeneration,
        evidence,
      )
    ) {
      await removeSessionStorage(ACCOUNT_PICKER_CLEANUP_STORAGE_KEY)
    }
  } catch (error) {
    releaseAccountPickerAuthorizationCleanup(authorizationGeneration)
    throw error
  }
  accountPickerAuthorizationState = currentAccountPickerAuthorizationState()
    .complete_cleanup(authorizationGeneration, evidence)
    .into_lifecycle()
}

export function releaseAccountPickerAuthorizationCleanup(
  authorizationGeneration: string,
): void {
  if (
    accountPickerAuthorizationState !==
    AccountPickerAuthorizationAvailability.Unavailable
  ) {
    accountPickerAuthorizationState = accountPickerAuthorizationState
      .release_cleanup(authorizationGeneration)
      .into_lifecycle()
  }
}

export async function accountPickerAuthorizationCleanupPending(): Promise<boolean> {
  const cleanupStorage = await getSessionStorage(
    ACCOUNT_PICKER_CLEANUP_STORAGE_KEY,
  )
  return cleanupStorage[ACCOUNT_PICKER_CLEANUP_STORAGE_KEY] === true
}
