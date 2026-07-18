import type { VaultState } from "$lib/vault.svelte";
import type { NookSecretRecord } from "$lib/nook";
import { createLogger } from "$lib/log";
import {
  classifyVaultRecoveryError,
  JoinEnrollmentState,
  NookSentinelUnlockSessionStatus,
  VaultRecoveryErrorKind,
  type NookSentinelStoredDeliverySummary,
} from "$app-wasm";

const log = createLogger("vault-sentinel");

export type SentinelUnlockStatus =
  | "not_sentinel"
  | "unlocked"
  | "awaiting_shares"
  | "ceremony_required";

export type SentinelUnlockSessionStatus = NookSentinelUnlockSessionStatus;
export type SentinelStoredDeliverySummary = NookSentinelStoredDeliverySummary;

export function inactiveSentinelUnlockSession(): SentinelUnlockSessionStatus {
  return NookSentinelUnlockSessionStatus.inactive();
}

function replaceUnlockSession(
  state: VaultState,
  status: SentinelUnlockSessionStatus,
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
  if (state.vaultArchitecture.vault_type === "sentinel") return true;
  if (!state.manager) return false;
  try {
    return state.manager.sentinelUnlockStatus() !== "not_sentinel";
  } catch {
    return false;
  }
}

export async function getSentinelUnlockStatus(
  state: VaultState,
): Promise<SentinelUnlockStatus> {
  if (!state.manager) return "not_sentinel";
  try {
    const status = await state.enqueueStorage(() =>
      state.manager!.sentinelUnlockStatus(),
    );
    switch (status) {
      case "unlocked":
      case "awaiting_shares":
      case "ceremony_required":
      case "not_sentinel":
        return status;
      default:
        return "not_sentinel";
    }
  } catch {
    return "not_sentinel";
  }
}

export async function refreshSentinelUnlockStatus(
  state: VaultState,
): Promise<SentinelUnlockStatus> {
  let status = await getSentinelUnlockStatus(state);
  if (
    !state.isAuthenticated &&
    status === "not_sentinel" &&
    state.vaultArchitecture.vault_type === "sentinel"
  ) {
    await ensureSentinelCeremonyHydrated(state);
    status = await getSentinelUnlockStatus(state);
  }
  state.sentinelUnlockStatus = status;
  if (status === "ceremony_required" || status === "awaiting_shares") {
    state.sentinelCeremonyPrompt = true;
    state.loginPasswordPrompt = false;
  } else if (status === "unlocked") {
    state.sentinelCeremonyPrompt = false;
  } else if (
    status === "not_sentinel" &&
    state.vaultArchitecture.vault_type === "sentinel"
  ) {
    state.sentinelCeremonyPrompt = true;
    state.sentinelUnlockStatus = "ceremony_required";
    return "ceremony_required";
  } else if (status === "not_sentinel") {
    state.sentinelCeremonyPrompt = false;
  }
  return state.sentinelUnlockStatus;
}

/** Hydrate encrypted Sentinel metadata without attempting to bypass quorum. */
export async function ensureSentinelCeremonyHydrated(
  state: VaultState,
): Promise<void> {
  if (!state.manager || state.isAuthenticated || state.isVerifying) return;
  await state.initDeviceIdentity();
  try {
    await state.syncFromStorage({ force: true });
  } catch {
    // A locked Sentinel sync may fail closed until its local share is selected.
  }
  const status = await getSentinelUnlockStatus(state);
  if (status === "ceremony_required" || status === "awaiting_shares") {
    state.refreshVaultArchitectureFromManager();
    state.sentinelCeremonyPrompt = true;
    state.loginPasswordPrompt = false;
    return;
  }
  try {
    await state.enqueueStorage(async () => {
      const connectArgs = state.connectStorageArgs();
      await state.manager!.connect(...connectArgs);
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
  if (!state.manager || state.isVerifying) return;
  state.errorMsg = "";
  await ensureSentinelCeremonyHydrated(state);
  const status = await state.enqueueStorage(() =>
    state.manager!.startSentinelUnlock(),
  );
  replaceUnlockSession(state, status);
  state.sentinelUnlockRequest = await state.enqueueStorage(() =>
    state.manager!.sentinelUnlockRequestJson(),
  );
}

export async function addSentinelUnlockResponse(
  state: VaultState,
  response: string,
): Promise<void> {
  if (!state.manager || !response.trim()) return;
  const status = await state.enqueueStorage(() =>
    state.manager!.addSentinelUnlockResponse(response.trim()),
  );
  replaceUnlockSession(state, status);
}

export async function refreshSentinelUnlockSession(
  state: VaultState,
): Promise<void> {
  if (!state.manager) return;
  const status = await state.enqueueStorage(() =>
    state.manager!.sentinelUnlockSessionStatus(),
  );
  replaceUnlockSession(state, status);
  if (state.sentinelUnlockSession.active && !state.sentinelUnlockRequest) {
    state.sentinelUnlockRequest = await state.enqueueStorage(() =>
      state.manager!.sentinelUnlockRequestJson(),
    );
  }
}

export async function listSentinelStoredDeliveries(
  state: VaultState,
): Promise<SentinelStoredDeliverySummary[]> {
  if (!state.manager) return [];
  await state.initDeviceIdentity();
  const summaries = await state.enqueueStorage(() =>
    state.manager!.listSentinelGenesisShareDeliveries(),
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
  if (!state.manager) throw new Error("Vault engine is not available.");
  if (!storeId.trim() || !request.trim()) return "";
  await state.initDeviceIdentity();
  return state.enqueueStorage(async () => {
    await state.manager!.loadSentinelGenesisShareDelivery(storeId.trim());
    state.refreshVaultArchitectureFromManager();
    return state.manager!.respondToSentinelUnlockRequest(request.trim());
  });
}

export async function finalizeSentinelUnlock(state: VaultState): Promise<void> {
  if (
    !state.manager ||
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
      state.manager!.finalizeSentinelUnlock(),
    )) as NookSecretRecord[];
    for (const record of rawRecords) record.free();
    await state.loadSecretPage("", 0);
    state.sentinelCeremonyPrompt = false;
    state.sentinelUnlockRequest = "";
    replaceUnlockSession(state, inactiveSentinelUnlockSession());
    state.sentinelUnlockStatus = "unlocked";
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
    state.showSuccess(state.t("toasts.vault_unlocked"));
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
        : state.t("architecture_modes.sentinel_unlock_failed");
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
  if (status === "ceremony_required" || status === "awaiting_shares") {
    state.sentinelCeremonyPrompt = true;
    state.loginPasswordPrompt = false;
    state.errorMsg = "";
    return true;
  }
  return isSentinelCeremonyRequiredError(err);
}
