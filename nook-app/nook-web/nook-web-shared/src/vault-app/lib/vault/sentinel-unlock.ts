import { I18N_KEYS } from "../../../generated/i18n-keys";
import { VaultType } from "$lib/vault/architecture-model";
import type { VaultState } from "$lib/vault.svelte";
import type { NookSecretRecord } from "$lib/nook";
import {
  createLogger,
  runtimeFailure,
  type RuntimeFailure,
} from "$lib/runtime/log";
import {
  classify_vault_recovery_error,
  JoinEnrollmentState,
  NookSentinelUnlockSessionStatus,
  ProviderSyncFreshness,
  SentinelVaultUnlockState,
  VaultRecoveryErrorKind,
  type NookSentinelStoredDeliverySummary as SentinelStoredDeliverySummary,
} from "$app-wasm";

const log = createLogger("vault-sentinel");

export type {
  NookSentinelStoredDeliverySummary as SentinelStoredDeliverySummary,
  NookSentinelUnlockSessionStatus as SentinelUnlockSessionStatus,
} from "$app-wasm";

export function inactiveSentinelUnlockSession(): NookSentinelUnlockSessionStatus {
  return NookSentinelUnlockSessionStatus.inactive();
}

type UnlockSessionReplacement = {
  readonly state: VaultState;
  readonly status: NookSentinelUnlockSessionStatus;
};

function replaceUnlockSession({
  state,
  status,
}: UnlockSessionReplacement): void {
  const previous = state.sentinelUnlockSession;
  state.sentinelUnlockSession = status;
  if (previous !== status) previous.free();
}

export function isSentinelCeremonyRequiredError(
  failure: RuntimeFailure,
): boolean {
  return (
    classify_vault_recovery_error(failure.message) ===
    VaultRecoveryErrorKind.SentinelCeremonyRequired
  );
}

export function isSentinelPasswordUnlockForbiddenError(
  failure: RuntimeFailure,
): boolean {
  return (
    classify_vault_recovery_error(failure.message) ===
    VaultRecoveryErrorKind.SentinelPasswordUnlockForbidden
  );
}

export function isSentinelVault(state: VaultState): boolean {
  if (state.vaultArchitecture.vault_type === VaultType.Sentinel) return true;
  if (!state.hasManager) return false;
  try {
    return (
      state.requireManager().sentinel_unlock_status() !==
      SentinelVaultUnlockState.NotSentinel
    );
  } catch {
    return false;
  }
}

async function getSentinelUnlockStatus(
  state: VaultState,
): Promise<SentinelVaultUnlockState> {
  if (!state.hasManager) return SentinelVaultUnlockState.NotSentinel;
  try {
    return await state.enqueueStorage(() =>
      state.requireManager().sentinel_unlock_status(),
    );
  } catch {
    return SentinelVaultUnlockState.NotSentinel;
  }
}

export async function refreshSentinelUnlockStatus(
  state: VaultState,
): Promise<SentinelVaultUnlockState> {
  let status = await getSentinelUnlockStatus(state);
  if (
    !state.isAuthenticated &&
    status === SentinelVaultUnlockState.NotSentinel &&
    state.vaultArchitecture.vault_type === VaultType.Sentinel
  ) {
    await ensureSentinelCeremonyHydrated(state);
    status = await getSentinelUnlockStatus(state);
  }
  state.sentinelUnlockStatus = status;
  if (
    status === SentinelVaultUnlockState.CeremonyRequired ||
    status === SentinelVaultUnlockState.AwaitingShares
  ) {
    state.sentinelCeremonyPrompt = true;
    state.loginPasswordPrompt = false;
  } else if (status === SentinelVaultUnlockState.Unlocked) {
    state.sentinelCeremonyPrompt = false;
  } else if (
    status === SentinelVaultUnlockState.NotSentinel &&
    state.vaultArchitecture.vault_type === VaultType.Sentinel
  ) {
    state.sentinelCeremonyPrompt = true;
    state.sentinelUnlockStatus = SentinelVaultUnlockState.CeremonyRequired;
    return SentinelVaultUnlockState.CeremonyRequired;
  } else if (status === SentinelVaultUnlockState.NotSentinel) {
    state.sentinelCeremonyPrompt = false;
  }
  return state.sentinelUnlockStatus;
}

/** Hydrate encrypted Sentinel metadata without attempting to bypass quorum. */
export async function ensureSentinelCeremonyHydrated(
  state: VaultState,
): Promise<void> {
  if (!state.hasManager || state.isAuthenticated || state.isVerifying) return;
  await state.initDeviceIdentity();
  try {
    await state.syncFromStorage(ProviderSyncFreshness.Forced);
  } catch {
    // A locked Sentinel sync may fail closed until its local share is selected.
  }
  const status = await getSentinelUnlockStatus(state);
  if (
    status === SentinelVaultUnlockState.CeremonyRequired ||
    status === SentinelVaultUnlockState.AwaitingShares
  ) {
    state.refreshVaultArchitectureFromManager();
    state.sentinelCeremonyPrompt = true;
    state.loginPasswordPrompt = false;
    return;
  }
  try {
    await state.enqueueStorage(async () => {
      const connectArgs = state.connectStorageArgs();
      await state.requireManager().connect(...connectArgs);
    });
  } catch (e) {
    if (isSentinelCeremonyRequiredError(runtimeFailure(e))) {
      state.refreshVaultArchitectureFromManager();
      state.sentinelCeremonyPrompt = true;
      state.loginPasswordPrompt = false;
    }
  }
}

export async function startSentinelUnlock(state: VaultState): Promise<void> {
  if (!state.hasManager || state.isVerifying) return;
  state.errorMsg = "";
  await ensureSentinelCeremonyHydrated(state);
  const status = await state.enqueueStorage(() =>
    state.requireManager().start_sentinel_unlock(),
  );
  const replaceUnlockSessionArgs: Parameters<typeof replaceUnlockSession>[0] = {
    state,
    status,
  };
  replaceUnlockSession(replaceUnlockSessionArgs);
  state.sentinelUnlockRequest = await state.enqueueStorage(() =>
    state.requireManager().sentinel_unlock_request_json(),
  );
}

type SentinelUnlockResponseSubmission = {
  readonly state: VaultState;
  readonly response: string;
};

export async function addSentinelUnlockResponse({
  state,
  response,
}: SentinelUnlockResponseSubmission): Promise<void> {
  if (!state.hasManager || !response.trim()) return;
  const status = await state.enqueueStorage(() =>
    state.requireManager().add_sentinel_unlock_response(response.trim()),
  );
  const replaceUnlockSessionArgs2: Parameters<typeof replaceUnlockSession>[0] =
    { state, status };
  replaceUnlockSession(replaceUnlockSessionArgs2);
}

export async function listSentinelStoredDeliveries(
  state: VaultState,
): Promise<SentinelStoredDeliverySummary[]> {
  if (!state.hasManager) return [];
  await state.initDeviceIdentity();
  const summaries = await state.enqueueStorage(() =>
    state.requireManager().list_sentinel_genesis_share_deliveries(),
  );
  for (const previous of state.sentinelStoredDeliveries) previous.free();
  state.sentinelStoredDeliveries = summaries;
  return summaries;
}

type SentinelUnlockResponseCreation = {
  readonly state: VaultState;
  readonly storeId: string;
  readonly request: string;
};

export async function createSentinelUnlockResponse({
  state,
  storeId,
  request,
}: SentinelUnlockResponseCreation): Promise<string> {
  if (!state.hasManager) throw new Error("Vault engine is not available.");
  if (!storeId.trim() || !request.trim()) return "";
  await state.initDeviceIdentity();
  return state.enqueueStorage(async () => {
    await state
      .requireManager()
      .load_sentinel_genesis_share_delivery(storeId.trim());
    state.refreshVaultArchitectureFromManager();
    return state
      .requireManager()
      .respond_to_sentinel_unlock_request(request.trim());
  });
}

export async function finalizeSentinelUnlock(state: VaultState): Promise<void> {
  if (
    !state.hasManager ||
    state.isVerifying ||
    !state.sentinelUnlockSession.ready
  ) {
    return;
  }
  state.errorMsg = "";
  state.dismissSuccess();
  state.isVerifying = true;
  try {
    const rawRecords = (await state.enqueueStorage(() =>
      state.requireManager().finalize_sentinel_unlock(),
    )) as NookSecretRecord[];
    for (const record of rawRecords) record.free();
    const loadPageArgs: Parameters<typeof state.loadSecretPage>[0] = {
      query: "",
      requestedOffset: 0,
    };
    await state.loadSecretPage(loadPageArgs);
    state.sentinelCeremonyPrompt = false;
    state.sentinelUnlockRequest = "";
    const replaceUnlockSessionArgs3: Parameters<
      typeof replaceUnlockSession
    >[0] = { state, status: inactiveSentinelUnlockSession() };
    replaceUnlockSession(replaceUnlockSessionArgs3);
    state.sentinelUnlockStatus = SentinelVaultUnlockState.Unlocked;
    await state.ensureProviderSaved();
    await state.loadProviders();
    await state.refreshPasswordEntriesList();
    void state.hydrateMultiDeviceState();
    state.markVaultUnlocked();
    log.info("vault unlocked with sentinel quorum");
    state.joinEnrollmentPrompt = JoinEnrollmentState.None;
    state.loginPasswordPrompt = false;
    state.showSuccess(state.t(I18N_KEYS.ToastsVaultUnlocked));
    state.startIdleSessionTracking();
    state.startVaultSync();
  } catch (e) {
    state.isAuthenticated = false;
    if (isSentinelCeremonyRequiredError(runtimeFailure(e))) {
      state.sentinelCeremonyPrompt = true;
      await refreshSentinelUnlockStatus(state);
      state.errorMsg = "";
      return;
    }
    state.errorMsg =
      e instanceof Error
        ? state.resolveErrorMessage(e.message)
        : state.t(I18N_KEYS.ArchitectureModesSentinelUnlockFailed);
  } finally {
    state.isVerifying = false;
  }
}

type SentinelCeremonyPresentation = {
  readonly state: VaultState;
  readonly failure: RuntimeFailure;
};

export async function surfaceSentinelCeremonyIfNeeded({
  state,
  failure,
}: SentinelCeremonyPresentation): Promise<boolean> {
  if (!isSentinelCeremonyRequiredError(failure) && !isSentinelVault(state)) {
    return false;
  }
  state.refreshVaultArchitectureFromManager();
  const status = await refreshSentinelUnlockStatus(state);
  if (
    status === SentinelVaultUnlockState.CeremonyRequired ||
    status === SentinelVaultUnlockState.AwaitingShares
  ) {
    state.sentinelCeremonyPrompt = true;
    state.loginPasswordPrompt = false;
    state.errorMsg = "";
    return true;
  }
  return isSentinelCeremonyRequiredError(failure);
}
