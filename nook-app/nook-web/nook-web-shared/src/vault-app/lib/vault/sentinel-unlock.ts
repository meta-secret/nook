import { I18N_KEYS } from "../../../generated/i18n-keys";
import { VaultType } from "$lib/vault/architecture-model";
import type { VaultState } from "$lib/vault.svelte";
import type { NookSecretRecord } from "$lib/nook";
import { createLogger } from "$lib/runtime/log";
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

function replaceUnlockSession(
  state: VaultState,
  status: NookSentinelUnlockSessionStatus,
): void {
  const previous = state.sentinelUnlockSession;
  state.sentinelUnlockSession = status;
  if (previous !== status) previous.free();
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err ?? "");
}

export function isSentinelCeremonyRequiredError(err: unknown): boolean {
  return (
    classifyVaultRecoveryError(errorMessage(err)) ===
    VaultRecoveryErrorKind.SentinelCeremonyRequired
  );
}

export function isSentinelPasswordUnlockForbiddenError(err: unknown): boolean {
  return (
    classifyVaultRecoveryError(errorMessage(err)) ===
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
    await state.syncFromStorage({ force: true });
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
  } catch (e: unknown) {
    if (isSentinelCeremonyRequiredError(e)) {
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
  replaceUnlockSession(state, status);
  state.sentinelUnlockRequest = await state.enqueueStorage(() =>
    state.requireManager().sentinelUnlockRequestJson(),
  );
}

export async function addSentinelUnlockResponse(
  state: VaultState,
  response: string,
): Promise<void> {
  if (!state.hasManager || !response.trim()) return;
  const status = await state.enqueueStorage(() =>
    state.requireManager().addSentinelUnlockResponse(response.trim()),
  );
  replaceUnlockSession(state, status);
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

export async function createSentinelUnlockResponse(
  state: VaultState,
  storeId: string,
  request: string,
): Promise<string> {
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
    replaceUnlockSession(state, inactiveSentinelUnlockSession());
    state.sentinelUnlockStatus = SentinelVaultUnlockState.Unlocked;
    await state.ensureProviderSaved();
    await state.loadProviders();
    await state.refreshPasswordEntriesList();
    void state.hydrateMultiDeviceState();
    state.markVaultUnlocked();
    log.info("vault unlocked with sentinel quorum", {
      mode: state.storageMode,
      secrets: rawRecords.length,
    });
    state.joinEnrollmentPrompt = JoinEnrollmentState.None;
    state.loginPasswordPrompt = false;
    state.showSuccess(state.t(I18N_KEYS.ToastsVaultUnlocked));
    state.startIdleSessionTracking();
    state.startVaultSync();
  } catch (e: unknown) {
    state.isAuthenticated = false;
    if (isSentinelCeremonyRequiredError(e)) {
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

export async function surfaceSentinelCeremonyIfNeeded(
  state: VaultState,
  err: unknown,
): Promise<boolean> {
  if (!isSentinelCeremonyRequiredError(err) && !isSentinelVault(state)) {
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
  return isSentinelCeremonyRequiredError(err);
}
