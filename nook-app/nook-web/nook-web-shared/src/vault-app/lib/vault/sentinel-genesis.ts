import { I18N_KEYS } from "../../../generated/i18n-keys";
import {
  setActiveVault,
  type NookSentinelGenesisDelivery,
  type NookSentinelGenesisFinalizeResult,
  type NookSentinelGenesisParticipantStatus,
  type NookSentinelGenesisStatus,
  type StartSentinelGenesisArgs,
} from "$app-wasm";
import type { VaultState } from "$lib/vault.svelte";
import type { VaultArchitecture } from "$lib/vault/architecture-model";
import { listSentinelStoredDeliveries } from "$lib/vault/sentinel-unlock";
import { LocalLoginPreparationState } from "$lib/vault/state/provider.svelte";
import { SentinelGenesisTargetKind } from "$lib/vault/state/sentinel.svelte";

type ReplaceOwnedWasmValuesArgs<T extends { free: () => void }> = {
  readonly current: T[];
  readonly replacement: T[];
};

function replaceOwnedWasmValues<T extends { free: () => void }>({
  current,
  replacement,
}: ReplaceOwnedWasmValuesArgs<T>): T[] {
  current.forEach((value) => value.free());
  return replacement;
}

export function releaseResults(state: VaultState): void {
  const replaceOwnedWasmValuesArgs: ReplaceOwnedWasmValuesArgs<NookSentinelGenesisDelivery> =
    { current: state.sentinelGenesisDeliveries, replacement: [] };
  state.sentinelGenesisDeliveries = replaceOwnedWasmValues(
    replaceOwnedWasmValuesArgs,
  );
  const replaceOwnedWasmValuesArgs2: ReplaceOwnedWasmValuesArgs<NookSentinelGenesisParticipantStatus> =
    { current: state.sentinelGenesisParticipants, replacement: [] };
  state.sentinelGenesisParticipants = replaceOwnedWasmValues(
    replaceOwnedWasmValuesArgs2,
  );
  state.sentinelGenesisParticipantCount = 0;
}

export function applyStatus({
  state,
  status,
}: {
  readonly state: VaultState;
  readonly status: NookSentinelGenesisStatus;
}): void {
  const participants = status.participants;
  state.sentinelGenesisParticipantCount = participants.length;
  const replaceOwnedWasmValuesArgs3: ReplaceOwnedWasmValuesArgs<NookSentinelGenesisParticipantStatus> =
    {
      current: state.sentinelGenesisParticipants,
      replacement: participants,
    };
  state.sentinelGenesisParticipants = replaceOwnedWasmValues(
    replaceOwnedWasmValuesArgs3,
  );
  state.sentinelGenesisPhase = status.phase;
  status.free();
}

export function applyFinalizeResult({
  state,
  result,
}: {
  readonly state: VaultState;
  readonly result: NookSentinelGenesisFinalizeResult;
}): void {
  state.sentinelGenesisPhase = result.phase;
  state.selectSentinelGenesisStore(result.storeId);
  state.openActiveVault(result.storeId);
  state.replaceVaultArchitecture(result.architecture as VaultArchitecture);
  const replaceOwnedWasmValuesArgs4: ReplaceOwnedWasmValuesArgs<NookSentinelGenesisDelivery> =
    {
      current: state.sentinelGenesisDeliveries,
      replacement: result.participantDeliveries,
    };
  state.sentinelGenesisDeliveries = replaceOwnedWasmValues(
    replaceOwnedWasmValuesArgs4,
  );
  result.free();
}

export async function start({
  state,
  args,
}: {
  readonly state: VaultState;
  readonly args: StartSentinelGenesisArgs;
}): Promise<void> {
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
    const applyStatusArgs: Parameters<typeof applyStatus>[0] = {
      state,
      status,
    };
    applyStatus(applyStatusArgs);
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

export async function addParticipantResponse({
  state,
  payload,
  participantLabel,
}: {
  readonly state: VaultState;
  readonly payload: string;
  readonly participantLabel: string;
}): Promise<void> {
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
    const applyStatusArgs2: Parameters<typeof applyStatus>[0] = {
      state,
      status,
    };
    applyStatus(applyStatusArgs2);
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
          state.t(I18N_KEYS.DeviceProtectionPasskeyLabelPlaceholder),
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

export async function rememberRequest({
  state,
  requestPayload,
}: {
  readonly state: VaultState;
  readonly requestPayload: string;
}): Promise<void> {
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

export async function createParticipantResponse({
  state,
  requestPayload,
}: {
  readonly state: VaultState;
  readonly requestPayload: string;
}): Promise<string> {
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
          state.t(I18N_KEYS.DeviceProtectionPasskeyLabelPlaceholder),
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
    const applyFinalizeResultArgs: Parameters<typeof applyFinalizeResult>[0] = {
      state,
      result,
    };
    applyFinalizeResult(applyFinalizeResultArgs);
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

export async function acceptShareDelivery({
  state,
  payload,
}: {
  readonly state: VaultState;
  readonly payload: string;
}): Promise<void> {
  if (!state.hasManager) throw new Error("Vault engine is not available.");
  if (state.isVerifying) return;
  state.isVerifying = true;
  state.errorMsg = "";
  try {
    await state.enqueueStorage(() =>
      state.requireManager().acceptSentinelGenesisShareDelivery(payload.trim()),
    );
    await listSentinelStoredDeliveries(state);
    state.showSuccess(
      state.t(I18N_KEYS.LoginSentinelGenesisReceiveShareSuccess),
    );
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
    state.localLoginPreparation = LocalLoginPreparationState.Idle;
    state.sentinelCeremonyPrompt = true;
    state.sentinelGenesisPhase = state
      .requireManager()
      .completeSentinelGenesisDelivery();
  } finally {
    state.isVerifying = false;
  }
}

export async function acceptOnboardingPackage({
  state,
  packageJson,
}: {
  readonly state: VaultState;
  readonly packageJson: string;
}): Promise<void> {
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
