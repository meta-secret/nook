import { I18N_KEYS } from "../../../generated/i18n-keys";
import {
  set_active_vault,
  type NookSentinelGenesisDelivery,
  type NookSentinelGenesisFinalizeResult,
  type NookSentinelGenesisParticipantStatus,
  type NookSentinelGenesisStatus,
  type StartSentinelGenesisArgs,
} from "$app-wasm";
import type { VaultState } from "$lib/vault.svelte";
import type { VaultArchitecture } from "$lib/vault/architecture-model";
import { SentinelUnlockActions } from "$lib/vault/sentinel-unlock";
import { LocalLoginPreparationState } from "$lib/vault/state/provider.svelte";
import { SentinelGenesisTargetKind } from "$lib/vault/state/sentinel.svelte";

type ReplaceOwnedWasmValuesArgs<T extends { free: () => void }> = {
  readonly current: T[];
  readonly replacement: T[];
};

export interface SentinelGenesisStatusUpdate {
  readonly status: NookSentinelGenesisStatus;
}

export interface SentinelGenesisFinalization {
  readonly result: NookSentinelGenesisFinalizeResult;
}

export interface SentinelGenesisStart {
  readonly args: StartSentinelGenesisArgs;
}

export interface SentinelGenesisParticipantResponseAddition {
  readonly payload: string;
  readonly participantLabel: string;
}

export interface SentinelGenesisRequestPayload {
  readonly requestPayload: string;
}

export interface SentinelGenesisShareDelivery {
  readonly payload: string;
}

export interface SentinelOnboardingPackageAcceptance {
  readonly packageJson: string;
}

/** Owns browser orchestration for one sentinel genesis context. */
export class SentinelGenesisActions {
  constructor(private readonly state: VaultState) {}

  private static replaceOwnedWasmValues<T extends { free: () => void }>({
    current,
    replacement,
  }: ReplaceOwnedWasmValuesArgs<T>): T[] {
    current.forEach((value) => value.free());
    return replacement;
  }

  releaseResults(): void {
    const state = state;
    const replaceOwnedWasmValuesArgs: ReplaceOwnedWasmValuesArgs<NookSentinelGenesisDelivery> =
      { current: state.sentinelGenesisDeliveries, replacement: [] };
    state.sentinelGenesisDeliveries =
      SentinelGenesisActions.replaceOwnedWasmValues(replaceOwnedWasmValuesArgs);
    const replaceOwnedWasmValuesArgs2: ReplaceOwnedWasmValuesArgs<NookSentinelGenesisParticipantStatus> =
      { current: state.sentinelGenesisParticipants, replacement: [] };
    state.sentinelGenesisParticipants =
      SentinelGenesisActions.replaceOwnedWasmValues(
        replaceOwnedWasmValuesArgs2,
      );
    state.sentinelGenesisParticipantCount = 0;
  }

  applyStatus({ status }: SentinelGenesisStatusUpdate): void {
    const state = state;
    const participants = status.participants;
    state.sentinelGenesisParticipantCount = participants.length;
    const replaceOwnedWasmValuesArgs3: ReplaceOwnedWasmValuesArgs<NookSentinelGenesisParticipantStatus> =
      {
        current: state.sentinelGenesisParticipants,
        replacement: participants,
      };
    state.sentinelGenesisParticipants =
      SentinelGenesisActions.replaceOwnedWasmValues(
        replaceOwnedWasmValuesArgs3,
      );
    state.sentinelGenesisPhase = status.phase;
    status.free();
  }

  applyFinalizeResult({ result }: SentinelGenesisFinalization): void {
    const state = state;
    state.sentinelGenesisPhase = result.phase;
    state.selectSentinelGenesisStore(result.storeId);
    state.openActiveVault(result.storeId);
    state.replaceVaultArchitecture(result.architecture as VaultArchitecture);
    const replaceOwnedWasmValuesArgs4: ReplaceOwnedWasmValuesArgs<NookSentinelGenesisDelivery> =
      {
        current: state.sentinelGenesisDeliveries,
        replacement: result.participantDeliveries,
      };
    state.sentinelGenesisDeliveries =
      SentinelGenesisActions.replaceOwnedWasmValues(
        replaceOwnedWasmValuesArgs4,
      );
    result.free();
  }

  async start({ args }: SentinelGenesisStart): Promise<void> {
    const state = state;
    if (!state.hasManager) throw new Error("Vault engine is not available.");
    if (state.isVerifying) return;
    state.isVerifying = true;
    state.errorMsg = "";
    state.dismissSuccess();
    this.releaseResults();
    state.clearSentinelGenesisStore();
    try {
      await state.initDeviceIdentity();
      const status = await state.enqueueStorage(() =>
        state.requireManager().start_sentinel_genesis(args),
      );
      state.sentinelGenesisRequest = state
        .requireManager()
        .sentinel_genesis_request_json();
      const applyStatusArgs: Parameters<
        SentinelGenesisActions["applyStatus"]
      >[0] = {
        status,
      };
      this.applyStatus(applyStatusArgs);
    } catch (error) {
      const statusUpdate: SentinelGenesisStatusUpdate = {
        state,
        status: state.requireManager().sentinel_genesis_status(),
      };
      this.applyStatus(statusUpdate);
      state.errorMsg =
        error instanceof Error
          ? error.message
          : "Failed to start Sentinel setup.";
      throw error;
    } finally {
      state.isVerifying = false;
    }
  }

  async addParticipantResponse({
    payload,
    participantLabel,
  }: SentinelGenesisParticipantResponseAddition): Promise<void> {
    const state = state;
    if (!state.hasManager) throw new Error("Vault engine is not available.");
    if (state.isVerifying) return;
    state.isVerifying = true;
    state.errorMsg = "";
    try {
      const status = await state.enqueueStorage(() =>
        state
          .requireManager()
          .add_sentinel_genesis_participant_response(
            payload.trim(),
            participantLabel.trim(),
          ),
      );
      const applyStatusArgs2: Parameters<
        SentinelGenesisActions["applyStatus"]
      >[0] = {
        status,
      };
      this.applyStatus(applyStatusArgs2);
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

  async createPublicKeyAnnouncement(): Promise<string> {
    const state = state;
    if (!state.hasManager) throw new Error("Vault engine is not available.");
    if (state.isVerifying) return "";
    state.isVerifying = true;
    state.errorMsg = "";
    try {
      await state.initDeviceIdentity();
      return await state.enqueueStorage(() =>
        state
          .requireManager()
          .create_sentinel_genesis_public_key_announcement(
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

  async rememberRequest({
    requestPayload,
  }: SentinelGenesisRequestPayload): Promise<void> {
    const state = state;
    if (!state.hasManager) throw new Error("Vault engine is not available.");
    if (state.isVerifying) return;
    state.isVerifying = true;
    state.errorMsg = "";
    try {
      await state.enqueueStorage(() =>
        state
          .requireManager()
          .remember_sentinel_genesis_request(requestPayload.trim()),
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

  async createParticipantResponse({
    requestPayload,
  }: SentinelGenesisRequestPayload): Promise<string> {
    const state = state;
    if (!state.hasManager) throw new Error("Vault engine is not available.");
    if (state.isVerifying) return "";
    state.isVerifying = true;
    state.errorMsg = "";
    try {
      await state.initDeviceIdentity();
      return await state.enqueueStorage(() =>
        state
          .requireManager()
          .respond_to_sentinel_genesis_request(
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

  async finalize(): Promise<void> {
    const state = state;
    if (!state.hasManager) throw new Error("Vault engine is not available.");
    if (state.isVerifying) return;
    state.isVerifying = true;
    state.errorMsg = "";
    try {
      const result = await state.enqueueStorage(() =>
        state.requireManager().finalize_sentinel_genesis(),
      );
      const applyFinalizeResultArgs: Parameters<
        SentinelGenesisActions["applyFinalizeResult"]
      >[0] = {
        result,
      };
      this.applyFinalizeResult(applyFinalizeResultArgs);
    } catch (error) {
      const statusUpdate: SentinelGenesisStatusUpdate = {
        status: state.requireManager().sentinel_genesis_status(),
      };
      this.applyStatus(statusUpdate);
      state.errorMsg =
        error instanceof Error
          ? error.message
          : "Failed to finalize Sentinel setup.";
      throw error;
    } finally {
      state.isVerifying = false;
    }
  }

  async acceptShareDelivery({
    payload,
  }: SentinelGenesisShareDelivery): Promise<void> {
    const state = state;
    if (!state.hasManager) throw new Error("Vault engine is not available.");
    if (state.isVerifying) return;
    state.isVerifying = true;
    state.errorMsg = "";
    try {
      await state.enqueueStorage(() =>
        state
          .requireManager()
          .accept_sentinel_genesis_share_delivery(payload.trim()),
      );
      await new SentinelUnlockActions(state).listSentinelStoredDeliveries();
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

  async completeDelivery(): Promise<void> {
    const state = state;
    if (!state.hasManager) throw new Error("Vault engine is not available.");
    if (
      state.sentinelGenesisTarget.kind !== SentinelGenesisTargetKind.Selected ||
      state.isVerifying
    )
      return;
    const storeId = state.sentinelGenesisTarget.storeId;
    state.isVerifying = true;
    try {
      await set_active_vault(storeId);
      await state.refreshLocalVaultCatalog();
      state.selectLoginVault(storeId);
      state.localLoginPreparation = LocalLoginPreparationState.Idle;
      state.sentinelCeremonyPrompt = true;
      state.sentinelGenesisPhase = state
        .requireManager()
        .complete_sentinel_genesis_delivery();
    } finally {
      state.isVerifying = false;
    }
  }

  async acceptOnboardingPackage({
    packageJson,
  }: SentinelOnboardingPackageAcceptance): Promise<void> {
    const state = state;
    if (!state.hasManager) throw new Error("Vault engine is not available.");
    state.errorMsg = "";
    const storeId = await state.enqueueStorage(() =>
      state.requireManager().accept_sentinel_onboarding_package(packageJson),
    );
    state.openActiveVault(storeId);
    await set_active_vault(storeId);
    const providerLoadOptions: Parameters<typeof state.loadProviders>[0] = {
      ensureLocalRow: false,
    };
    await state.loadProviders(providerLoadOptions);
    state.applyActiveProviderCredentials();
    await state.loadDb();
    state.sentinelGenesisPhase = state.requireManager().sentinelGenesisPhase;
  }
}
