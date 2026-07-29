import {
  setActiveVault,
  type NookSentinelGenesisFinalizeResult,
  type NookSentinelGenesisStatus,
  type StartSentinelGenesisArgs,
} from "$app-wasm";
import type { VaultState } from "$lib/vault.svelte";
import type { VaultArchitecture } from "$lib/vault-architecture";
import { listSentinelStoredDeliveries } from "$lib/vault/sentinel-unlock";
import { SentinelGenesisTargetKind } from "$lib/vault/state/sentinel.svelte";

function replaceOwnedWasmValues<T extends { free: () => void }>(
  current: T[],
  replacement: T[],
): T[] {
  current.forEach((value) => value.free());
  return replacement;
}

export function releaseResults(state: VaultState): void {
  state.sentinelGenesisDeliveries = replaceOwnedWasmValues(
    state.sentinelGenesisDeliveries,
    [],
  );
  state.sentinelGenesisParticipants = replaceOwnedWasmValues(
    state.sentinelGenesisParticipants,
    [],
  );
  state.sentinelGenesisParticipantCount = 0;
}

export function applyStatus(
  state: VaultState,
  status: NookSentinelGenesisStatus,
): void {
  const participants = status.participants;
  state.sentinelGenesisParticipantCount = participants.length;
  state.sentinelGenesisParticipants = replaceOwnedWasmValues(
    state.sentinelGenesisParticipants,
    participants,
  );
  state.sentinelGenesisPhase = status.phase;
  status.free();
}

export function applyFinalizeResult(
  state: VaultState,
  result: NookSentinelGenesisFinalizeResult,
): void {
  state.sentinelGenesisPhase = result.phase;
  state.selectSentinelGenesisStore(result.storeId);
  state.openActiveVault(result.storeId);
  state.replaceVaultArchitecture(result.architecture as VaultArchitecture);
  state.sentinelGenesisDeliveries = replaceOwnedWasmValues(
    state.sentinelGenesisDeliveries,
    result.participantDeliveries,
  );
  result.free();
}

export async function start(
  state: VaultState,
  args: StartSentinelGenesisArgs,
): Promise<void> {
  if (!state.hasManager) throw new Error("Vault engine is not available.");
  if (state.isVerifying) return;
  state.isVerifying = true;
  state.errorMsg = "";
  state.dismissSuccess();
  releaseResults(state);
  state.clearSentinelGenesisStore();
  try {
    await state.initDeviceIdentity();
    const status = await state.enqueueStorage(() =>
      state.requireManager().startSentinelGenesis(args),
    );
    state.sentinelGenesisRequest = state
      .requireManager()
      .sentinelGenesisRequestJson();
    applyStatus(state, status);
  } catch (error) {
    state.sentinelGenesisPhase = state.requireManager().sentinelGenesisPhase;
    state.errorMsg =
      error instanceof Error
        ? error.message
        : "Failed to start Sentinel setup.";
    throw error;
  } finally {
    state.isVerifying = false;
  }
}

export async function addParticipantResponse(
  state: VaultState,
  payload: string,
  participantLabel = "",
): Promise<void> {
  if (!state.hasManager) throw new Error("Vault engine is not available.");
  if (state.isVerifying) return;
  state.isVerifying = true;
  state.errorMsg = "";
  try {
    const status = await state.enqueueStorage(() =>
      state
        .requireManager()
        .addSentinelGenesisParticipantResponse(
          payload.trim(),
          participantLabel.trim(),
        ),
    );
    applyStatus(state, status);
  } catch (error) {
    state.errorMsg =
      error instanceof Error
        ? error.message
        : "Failed to add Sentinel participant.";
    throw error;
  } finally {
    state.isVerifying = false;
  }
}

export async function createPublicKeyAnnouncement(
  state: VaultState,
): Promise<string> {
  if (!state.hasManager) throw new Error("Vault engine is not available.");
  if (state.isVerifying) return "";
  state.isVerifying = true;
  state.errorMsg = "";
  try {
    await state.initDeviceIdentity();
    return await state.enqueueStorage(() =>
      state
        .requireManager()
        .createSentinelGenesisPublicKeyAnnouncement(
          state.t("device_protection.passkey_label_placeholder"),
        ),
    );
  } catch (error) {
    state.errorMsg =
      error instanceof Error
        ? error.message
        : "Failed to create Sentinel public key announcement.";
    throw error;
  } finally {
    state.isVerifying = false;
  }
}

export async function rememberRequest(
  state: VaultState,
  requestPayload: string,
): Promise<void> {
  if (!state.hasManager) throw new Error("Vault engine is not available.");
  if (state.isVerifying) return;
  state.isVerifying = true;
  state.errorMsg = "";
  try {
    await state.enqueueStorage(() =>
      state
        .requireManager()
        .rememberSentinelGenesisRequest(requestPayload.trim()),
    );
  } catch (error) {
    state.errorMsg =
      error instanceof Error
        ? error.message
        : "Failed to remember the Sentinel initiator request.";
    throw error;
  } finally {
    state.isVerifying = false;
  }
}

export async function createParticipantResponse(
  state: VaultState,
  requestPayload: string,
): Promise<string> {
  if (!state.hasManager) throw new Error("Vault engine is not available.");
  if (state.isVerifying) return "";
  state.isVerifying = true;
  state.errorMsg = "";
  try {
    await state.initDeviceIdentity();
    return await state.enqueueStorage(() =>
      state
        .requireManager()
        .respondToSentinelGenesisRequest(
          requestPayload.trim(),
          state.t("device_protection.passkey_label_placeholder"),
        ),
    );
  } catch (error) {
    state.errorMsg =
      error instanceof Error
        ? error.message
        : "Failed to create Sentinel participant response.";
    throw error;
  } finally {
    state.isVerifying = false;
  }
}

export async function finalize(state: VaultState): Promise<void> {
  if (!state.hasManager) throw new Error("Vault engine is not available.");
  if (state.isVerifying) return;
  state.isVerifying = true;
  state.errorMsg = "";
  try {
    const result = await state.enqueueStorage(() =>
      state.requireManager().finalizeSentinelGenesis(),
    );
    applyFinalizeResult(state, result);
  } catch (error) {
    state.errorMsg =
      error instanceof Error
        ? error.message
        : "Failed to finalize Sentinel setup.";
    throw error;
  } finally {
    state.isVerifying = false;
  }
}

export async function acceptShareDelivery(
  state: VaultState,
  payload: string,
): Promise<void> {
  if (!state.hasManager) throw new Error("Vault engine is not available.");
  if (state.isVerifying) return;
  state.isVerifying = true;
  state.errorMsg = "";
  try {
    await state.enqueueStorage(() =>
      state.requireManager().acceptSentinelGenesisShareDelivery(payload.trim()),
    );
    await listSentinelStoredDeliveries(state);
    state.showSuccess(state.t("login.sentinel_genesis_receive_share_success"));
  } catch (error) {
    state.errorMsg =
      error instanceof Error
        ? error.message
        : "Failed to receive Sentinel share.";
    throw error;
  } finally {
    state.isVerifying = false;
  }
}

export async function completeDelivery(state: VaultState): Promise<void> {
  if (!state.hasManager) throw new Error("Vault engine is not available.");
  if (
    state.sentinelGenesisTarget.kind !== SentinelGenesisTargetKind.Selected ||
    state.isVerifying
  )
    return;
  const storeId = state.sentinelGenesisTarget.storeId;
  state.isVerifying = true;
  try {
    await setActiveVault(storeId);
    await state.refreshLocalVaultCatalog();
    state.selectLoginVault(storeId);
    state.localLoginPrepared = false;
    state.sentinelCeremonyPrompt = true;
    state.sentinelGenesisPhase = state
      .requireManager()
      .completeSentinelGenesisDelivery();
  } finally {
    state.isVerifying = false;
  }
}

export async function acceptOnboardingPackage(
  state: VaultState,
  packageJson: string,
): Promise<void> {
  if (!state.hasManager) throw new Error("Vault engine is not available.");
  state.errorMsg = "";
  const storeId = await state.enqueueStorage(() =>
    state.requireManager().acceptSentinelOnboardingPackage(packageJson),
  );
  state.openActiveVault(storeId);
  await setActiveVault(storeId);
  await state.loadProviders();
  state.applyActiveProviderCredentials();
  await state.loadDb();
  state.sentinelGenesisPhase = state.requireManager().sentinelGenesisPhase;
}
