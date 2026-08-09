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
  classifyVaultRecoveryError,
  JoinEnrollmentState,
  NookSentinelUnlockSessionStatus,
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

function replaceUnlockSession({
  state,
  status,
}: {
  readonly state: VaultState;
  readonly status: NookSentinelUnlockSessionStatus;
}): void {
  const previous = state.sentinelUnlockSession;
  state.sentinelUnlockSession = status;
  if (previous !== status) previous.free();
}

export function isSentinelCeremonyRequiredError(
  failure: RuntimeFailure,
): boolean {
  return (
    classifyVaultRecoveryError(failure.message) ===
    VaultRecoveryErrorKind.SentinelCeremonyRequired
  );
}

export function isSentinelPasswordUnlockForbiddenError(
  failure: RuntimeFailure,
): boolean {
  return (
    classifyVaultRecoveryError(failure.message) ===
    VaultRecoveryErrorKind.SentinelPasswordUnlockForbidden
  );
}

export function isSentinelVault(state: VaultState): boolean {
  if (state.vaultArchitecture.vault_type === VaultType.Sentinel) return true;
  if (!state.hasManager) return false;
  try {
    return (
      state.requireManager().sentinelUnlockStatus() !==
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
      state.requireManager().sentinelUnlockStatus(),
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
    const syncFromStorageArgs: Parameters<typeof state.syncFromStorage>[0] = {
      force: true,
    };
    await state.syncFromStorage(syncFromStorageArgs);
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
    state.requireManager().startSentinelUnlock(),
  );
  const replaceUnlockSessionArgs: Parameters<typeof replaceUnlockSession>[0] = {
    state,
    status,
  };
  replaceUnlockSession(replaceUnlockSessionArgs);
  state.sentinelUnlockRequest = await state.enqueueStorage(() =>
    state.requireManager().sentinelUnlockRequestJson(),
  );
}

export async function addSentinelUnlockResponse({
  state,
  response,
}: {
  readonly state: VaultState;
  readonly response: string;
}): Promise<void> {
  if (!state.hasManager || !response.trim()) return;
  const status = await state.enqueueStorage(() =>
    state.requireManager().addSentinelUnlockResponse(response.trim()),
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
    state.requireManager().listSentinelGenesisShareDeliveries(),
  );
  for (const previous of state.sentinelStoredDeliveries) previous.free();
  state.sentinelStoredDeliveries = summaries;
  return summaries;
}

export async function createSentinelUnlockResponse({
  state,
  storeId,
  request,
}: {
  readonly state: VaultState;
  readonly storeId: string;
  readonly request: string;
}): Promise<string> {
  if (!state.hasManager) throw new Error("Vault engine is not available.");
  if (!storeId.trim() || !request.trim()) return "";
  await state.initDeviceIdentity();
  return state.enqueueStorage(async () => {
    await state
      .requireManager()
      .loadSentinelGenesisShareDelivery(storeId.trim());
    state.refreshVaultArchitectureFromManager();
    return state
      .requireManager()
      .respondToSentinelUnlockRequest(request.trim());
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
      state.requireManager().finalizeSentinelUnlock(),
    )) as NookSecretRecord[];
    for (const record of rawRecords) record.free();
    await state.loadSecretPage("", 0);
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
    const infoArgs: Parameters<typeof log.info>[1] = {
      mode: state.storageMode,
      secrets: rawRecords.length,
    };
    log.info("vault unlocked with sentinel quorum", infoArgs);
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

export async function surfaceSentinelCeremonyIfNeeded({
  state,
  failure,
}: {
  readonly state: VaultState;
  readonly failure: RuntimeFailure;
}): Promise<boolean> {
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
