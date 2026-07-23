import {
  setActiveVault,
  type AuthProvidersSnapshot,
  type NookSentinelGenesisFinalizeResult,
  type NookSentinelGenesisStatus,
} from "$app-wasm";
import { buildSentinelOnboardingLink } from "$lib/sentinel-onboarding-link";
import type { StartSentinelGenesisArgs, VaultState } from "$lib/vault.svelte";
import type { VaultArchitecture } from "$lib/vault-architecture";

export function applyStatus(
  state: VaultState,
  status: NookSentinelGenesisStatus,
): void {
  const participants = status.participants;
  state.sentinelGenesisParticipantCount = participants.length;
  state.sentinelGenesisParticipants = participants.map((participant) => {
    const summary = {
      participantId: participant.deviceId,
      label: participant.label,
      fingerprint: participant.fingerprint,
    };
    participant.free();
    return summary;
  });
  state.sentinelGenesisStatus = status.isComplete ? "ready" : "collecting";
  status.free();
}

export function applyFinalizeResult(
  state: VaultState,
  result: NookSentinelGenesisFinalizeResult,
): void {
  state.sentinelGenesisStoreId = result.storeId;
  state.activeVaultStoreId = result.storeId;
  state.replaceVaultArchitecture(result.architecture as VaultArchitecture);
  state.sentinelGenesisDeliveries = result.participantDeliveries.map(
    (delivery) => {
      const summary = {
        participantId: delivery.deviceId,
        fingerprint:
          delivery.fingerprint ??
          state.sentinelGenesisParticipants.find(
            (participant) => participant.participantId === delivery.deviceId,
          )?.fingerprint,
        payload: delivery.payload,
        sharePayload: delivery.payload,
      };
      delivery.free();
      return summary;
    },
  );
  result.free();
  state.sentinelGenesisStatus = "delivering";
}

export async function start(
  state: VaultState,
  args: StartSentinelGenesisArgs,
): Promise<void> {
  if (!state.manager) throw new Error("Vault engine is not available.");
  if (state.isVerifying) return;
  state.isVerifying = true;
  state.errorMsg = "";
  state.dismissSuccess();
  state.sentinelGenesisDeliveries = [];
  state.sentinelGenesisParticipants = [];
  state.sentinelGenesisParticipantCount = 0;
  state.sentinelGenesisStoreId = undefined;
  try {
    await state.initDeviceIdentity();
    state.manager.setVaultName(args.label.trim());
    const status = await state.enqueueStorage(() =>
      state.manager!.startSentinelGenesis(
        args.participantCount,
        args.threshold,
        args.label.trim(),
      ),
    );
    state.sentinelGenesisRequest = state.manager.sentinelGenesisRequestJson();
    applyStatus(state, status);
  } catch (error) {
    state.sentinelGenesisStatus = "idle";
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
  if (!state.manager) throw new Error("Vault engine is not available.");
  if (state.isVerifying) return;
  state.isVerifying = true;
  state.errorMsg = "";
  try {
    const status = await state.enqueueStorage(() =>
      state.manager!.addSentinelGenesisParticipantResponse(
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
  if (!state.manager) throw new Error("Vault engine is not available.");
  if (state.isVerifying) return "";
  state.isVerifying = true;
  state.errorMsg = "";
  try {
    await state.initDeviceIdentity();
    return await state.enqueueStorage(() =>
      state.manager!.createSentinelGenesisPublicKeyAnnouncement(
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
  if (!state.manager) throw new Error("Vault engine is not available.");
  if (state.isVerifying) return;
  state.isVerifying = true;
  state.errorMsg = "";
  try {
    await state.enqueueStorage(() =>
      state.manager!.rememberSentinelGenesisRequest(requestPayload.trim()),
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
  if (!state.manager) throw new Error("Vault engine is not available.");
  if (state.isVerifying) return "";
  state.isVerifying = true;
  state.errorMsg = "";
  try {
    await state.initDeviceIdentity();
    return await state.enqueueStorage(() =>
      state.manager!.respondToSentinelGenesisRequest(
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
  if (!state.manager) throw new Error("Vault engine is not available.");
  if (state.isVerifying) return;
  state.isVerifying = true;
  state.errorMsg = "";
  state.sentinelGenesisStatus = "finalizing";
  try {
    const result = await state.enqueueStorage(() =>
      state.manager!.finalizeSentinelGenesis(),
    );
    applyFinalizeResult(state, result);
  } catch (error) {
    state.sentinelGenesisStatus = "ready";
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
  if (!state.manager) throw new Error("Vault engine is not available.");
  if (state.isVerifying) return;
  state.isVerifying = true;
  state.errorMsg = "";
  try {
    await state.enqueueStorage(() =>
      state.manager!.acceptSentinelGenesisShareDelivery(payload.trim()),
    );
    await state.listSentinelStoredDeliveries();
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
  if (!state.sentinelGenesisStoreId || state.isVerifying) return;
  state.isVerifying = true;
  try {
    state.sentinelGenesisStatus = "complete";
    await setActiveVault(state.sentinelGenesisStoreId);
    await state.refreshLocalVaultCatalog();
    state.selectedLoginVaultStoreId = state.sentinelGenesisStoreId;
    state.localLoginPrepared = false;
    state.sentinelCeremonyPrompt = true;
  } finally {
    state.isVerifying = false;
  }
}

export async function prepareOnboardingLinks(state: VaultState): Promise<void> {
  if (!state.manager || !state.sentinelGenesisStoreId) return;
  const provider = state.syncProviders[0];
  if (!provider || provider.type === "local-folder") return;
  const providerSnapshot = JSON.parse(
    JSON.stringify({
      providers: [provider],
      activeVaultStoreId: state.sentinelGenesisStoreId,
    }),
  ) as AuthProvidersSnapshot;
  state.sentinelGenesisDeliveries = state.sentinelGenesisDeliveries.map(
    (delivery) => {
      const sharePayload = delivery.sharePayload ?? delivery.payload;
      if (delivery.participantId === state.deviceId) {
        return { ...delivery, sharePayload };
      }
      const packageJson = state.manager!.createSentinelOnboardingPackage(
        state.sentinelGenesisRequest,
        sharePayload,
        providerSnapshot,
      );
      return {
        ...delivery,
        sharePayload,
        payload: buildSentinelOnboardingLink(packageJson),
      };
    },
  );
}

export async function acceptOnboardingPackage(
  state: VaultState,
  packageJson: string,
): Promise<void> {
  if (!state.manager) throw new Error("Vault engine is not available.");
  state.errorMsg = "";
  const storeId = await state.enqueueStorage(() =>
    state.manager!.acceptSentinelOnboardingPackage(packageJson),
  );
  state.activeVaultStoreId = storeId;
  await setActiveVault(storeId);
  await state.loadProviders();
  state.applyActiveProviderCredentials();
  state.sentinelGenesisStatus = "complete";
  await state.loadDb();
}
