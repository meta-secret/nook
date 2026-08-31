import { AccountPickerAuthorizationLifecycle } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
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
  | Promise<AccountPickerAuthorizationLifecycle>
  | AccountPickerAuthorizationAvailability =
  AccountPickerAuthorizationAvailability.Unavailable

async function initializedAccountPickerAuthorizationState(): Promise<AccountPickerAuthorizationLifecycle> {
  if (
    accountPickerAuthorizationState !==
    AccountPickerAuthorizationAvailability.Unavailable
  ) {
    return accountPickerAuthorizationState
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
      return new AccountPickerAuthorizationLifecycle(wasmEpoch)
    })()
  }
  try {
    accountPickerAuthorizationState =
      await accountPickerAuthorizationStatePromise
  } catch (error) {
    accountPickerAuthorizationStatePromise =
      AccountPickerAuthorizationAvailability.Unavailable
    throw error
  }
  return accountPickerAuthorizationState
}

export async function accountPickerAuthorizationGeneration(): Promise<string> {
  return (await initializedAccountPickerAuthorizationState()).snapshot()
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
  const state = await initializedAccountPickerAuthorizationState()
  const generation = state.begin_cleanup(crypto.randomUUID())
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
  const state = await initializedAccountPickerAuthorizationState()
  try {
    if (state.is_final_cleanup(authorizationGeneration, fullCleanupCompleted)) {
      await removeSessionStorage(ACCOUNT_PICKER_CLEANUP_STORAGE_KEY)
    }
    state.complete_cleanup(authorizationGeneration, fullCleanupCompleted)
  } catch (error) {
    state.release_cleanup(authorizationGeneration)
    throw error
  }
}

export function releaseAccountPickerAuthorizationCleanup(
  authorizationGeneration: string,
): void {
  if (
    accountPickerAuthorizationState !==
    AccountPickerAuthorizationAvailability.Unavailable
  ) {
    accountPickerAuthorizationState.release_cleanup(authorizationGeneration)
  }
}

export async function accountPickerAuthorizationCleanupPending(): Promise<boolean> {
  const cleanupStorage = await getSessionStorage(
    ACCOUNT_PICKER_CLEANUP_STORAGE_KEY,
  )
  return cleanupStorage[ACCOUNT_PICKER_CLEANUP_STORAGE_KEY] === true
}
