import type { OAuthFailure } from "$lib/auth/oauth-failure";
import { NativeVaultStorageFailure } from "$lib/runtime/storage-failure";
import { err as storageErr, ok as storageOk, type Result } from "neverthrow";
import {
  VaultStorageFailure as StorageOperationFailure,
  VaultStorageFailureKind as StorageOperationFailureKind,
} from "$lib/runtime/storage-failure";
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

export interface SentinelParticipantKeyCreationRequest {
  readonly vault: VaultState;
  readonly waitForDevice: () => void;
  readonly finishPendingCreation: () => void;
}

export type SentinelActionResult<T> = Result<
  T,
  StorageOperationFailure | OAuthFailure
>;

export enum SentinelGenesisStartOutcome {
  Started = "started",
}

export enum SentinelGenesisParticipantResponseOutcome {
  Added = "added",
}

export enum SentinelGenesisRequestMemoryOutcome {
  Remembered = "remembered",
}

export enum SentinelGenesisFinalizationOutcome {
  Finalized = "finalized",
}

enum SentinelGenesisShareAcceptanceOutcome {
  Accepted = "accepted",
}

export enum SentinelGenesisShareDeliveryOutcome {
  AcceptedAndRefreshed = "accepted-and-refreshed",
}

export enum SentinelGenesisDeliveryCompletionOutcome {
  Completed = "completed",
}

export enum SentinelOnboardingPackageAcceptanceOutcome {
  Accepted = "accepted",
}

export class SentinelParticipantKeyCreationLifecycle {
  constructor(
    private readonly request: SentinelParticipantKeyCreationRequest,
  ) {}

  async create(): Promise<SentinelActionResult<string>> {
    const { vault, waitForDevice, finishPendingCreation } = this.request;
    if (!vault.deviceProtectionReady) {
      waitForDevice();
      return storageErr(
        new StorageOperationFailure(
          StorageOperationFailureKind.DeviceAuthorizationRequired,
        ),
      );
    }
    return new SentinelGenesisActions(vault)
      .createPublicKeyAnnouncement()
      .finally(finishPendingCreation);
  }
}

/** Owns browser orchestration for one sentinel genesis context. */
export class SentinelGenesisActions {
  constructor(private readonly state: VaultState) {}

  private replaceOwnedWasmValues<T extends { free: () => void }>({
    current,
    replacement,
  }: ReplaceOwnedWasmValuesArgs<T>): T[] {
    current.forEach((value) => value.free());
    return replacement;
  }

  releaseResults(): void {
    const state = this.state;
    const replaceOwnedWasmValuesArgs: ReplaceOwnedWasmValuesArgs<NookSentinelGenesisDelivery> =
      { current: state.sentinelGenesisDeliveries, replacement: [] };
    state.sentinelGenesisDeliveries = this.replaceOwnedWasmValues(
      replaceOwnedWasmValuesArgs,
    );
    const replaceOwnedWasmValuesArgs2: ReplaceOwnedWasmValuesArgs<NookSentinelGenesisParticipantStatus> =
      { current: state.sentinelGenesisParticipants, replacement: [] };
    state.sentinelGenesisParticipants = this.replaceOwnedWasmValues(
      replaceOwnedWasmValuesArgs2,
    );
    state.sentinelGenesisParticipantCount = 0;
  }

  applyStatus({ status }: SentinelGenesisStatusUpdate): void {
    const state = this.state;
    const participants = status.participants;
    state.sentinelGenesisParticipantCount = participants.length;
    const replaceOwnedWasmValuesArgs3: ReplaceOwnedWasmValuesArgs<NookSentinelGenesisParticipantStatus> =
      {
        current: state.sentinelGenesisParticipants,
        replacement: participants,
      };
    state.sentinelGenesisParticipants = this.replaceOwnedWasmValues(
      replaceOwnedWasmValuesArgs3,
    );
    state.sentinelGenesisPhase = status.phase;
    status.free();
  }

  applyFinalizeResult({ result }: SentinelGenesisFinalization): void {
    const state = this.state;
    state.sentinelGenesisPhase = result.phase;
    state.selectSentinelGenesisStore(result.storeId);
    state.openActiveVault(result.storeId);
    state.replaceVaultArchitecture(result.architecture as VaultArchitecture);
    const replaceOwnedWasmValuesArgs4: ReplaceOwnedWasmValuesArgs<NookSentinelGenesisDelivery> =
      {
        current: state.sentinelGenesisDeliveries,
        replacement: result.participantDeliveries,
      };
    state.sentinelGenesisDeliveries = this.replaceOwnedWasmValues(
      replaceOwnedWasmValuesArgs4,
    );
    result.free();
  }

  private restoreStatus(): void {
    const admitted = this.state.admitManager();
    if (admitted.isErr()) return;
    let status: NookSentinelGenesisStatus;
    try {
      status = admitted.value.sentinel_genesis_status();
    } catch {
      return;
    }
    const statusUpdate: Parameters<typeof this.applyStatus>[0] = { status };
    this.applyStatus(statusUpdate);
  }

  async start({
    args,
  }: SentinelGenesisStart): Promise<
    Result<SentinelGenesisStartOutcome, StorageOperationFailure>
  > {
    const state = this.state;
    if (state.isVerifying)
      return storageErr(
        new StorageOperationFailure(
          StorageOperationFailureKind.OperationFailed,
        ),
      );
    state.isVerifying = true;
    state.errorMsg = "";
    state.dismissSuccess();
    this.releaseResults();
    state.clearSentinelGenesisStore();
    try {
      const initialized = await state.initDeviceIdentity();
      if (initialized.isErr()) return storageErr(initialized.error);
      const status = await state.enqueueStorage(async () => {
        const admitted = state.admitManager();
        if (admitted.isErr()) return storageErr(admitted.error);
        try {
          return storageOk(await admitted.value.start_sentinel_genesis(args));
        } catch (failure) {
          return storageErr(new NativeVaultStorageFailure(failure));
        }
      });
      if (status.isErr()) {
        this.restoreStatus();
        return storageErr(status.error);
      }
      const statusUpdate: Parameters<typeof this.applyStatus>[0] = {
        status: status.value,
      };
      this.applyStatus(statusUpdate);
      const admitted = state.admitManager();
      if (admitted.isErr()) return storageErr(admitted.error);
      try {
        state.sentinelGenesisRequest =
          admitted.value.sentinel_genesis_request_json();
      } catch (failure) {
        return storageErr(new NativeVaultStorageFailure(failure));
      }
      return storageOk(SentinelGenesisStartOutcome.Started);
    } finally {
      state.isVerifying = false;
    }
  }

  async addParticipantResponse({
    payload,
    participantLabel,
  }: SentinelGenesisParticipantResponseAddition): Promise<
    Result<SentinelGenesisParticipantResponseOutcome, StorageOperationFailure>
  > {
    const state = this.state;
    if (state.isVerifying)
      return storageErr(
        new StorageOperationFailure(
          StorageOperationFailureKind.OperationFailed,
        ),
      );
    state.isVerifying = true;
    state.errorMsg = "";
    try {
      const status = await state.enqueueStorage(async () => {
        const admitted = state.admitManager();
        if (admitted.isErr()) return storageErr(admitted.error);
        try {
          return storageOk(
            admitted.value.add_sentinel_genesis_participant_response(
              payload.trim(),
              participantLabel.trim(),
            ),
          );
        } catch (failure) {
          return storageErr(new NativeVaultStorageFailure(failure));
        }
      });
      if (status.isErr()) return storageErr(status.error);
      const statusUpdate: Parameters<typeof this.applyStatus>[0] = {
        status: status.value,
      };
      this.applyStatus(statusUpdate);
      return storageOk(SentinelGenesisParticipantResponseOutcome.Added);
    } finally {
      state.isVerifying = false;
    }
  }

  async createPublicKeyAnnouncement(): Promise<
    Result<string, StorageOperationFailure>
  > {
    const state = this.state;
    if (state.isVerifying)
      return storageErr(
        new StorageOperationFailure(
          StorageOperationFailureKind.OperationFailed,
        ),
      );
    state.isVerifying = true;
    state.errorMsg = "";
    try {
      const initialized = await state.initDeviceIdentity();
      if (initialized.isErr()) return storageErr(initialized.error);
      const label = state.t(I18N_KEYS.DeviceProtectionPasskeyLabelPlaceholder);
      return await state.enqueueStorage(async () => {
        const admitted = state.admitManager();
        if (admitted.isErr()) return storageErr(admitted.error);
        try {
          return storageOk(
            await admitted.value.create_sentinel_genesis_public_key_announcement(
              label,
            ),
          );
        } catch (failure) {
          return storageErr(new NativeVaultStorageFailure(failure));
        }
      });
    } finally {
      state.isVerifying = false;
    }
  }

  async rememberRequest({
    requestPayload,
  }: SentinelGenesisRequestPayload): Promise<
    Result<SentinelGenesisRequestMemoryOutcome, StorageOperationFailure>
  > {
    const state = this.state;
    if (state.isVerifying)
      return storageErr(
        new StorageOperationFailure(
          StorageOperationFailureKind.OperationFailed,
        ),
      );
    state.isVerifying = true;
    state.errorMsg = "";
    try {
      return await state.enqueueStorage(async () => {
        const admitted = state.admitManager();
        if (admitted.isErr()) return storageErr(admitted.error);
        try {
          admitted.value.remember_sentinel_genesis_request(
            requestPayload.trim(),
          );
          return storageOk(SentinelGenesisRequestMemoryOutcome.Remembered);
        } catch (failure) {
          return storageErr(new NativeVaultStorageFailure(failure));
        }
      });
    } finally {
      state.isVerifying = false;
    }
  }

  async createParticipantResponse({
    requestPayload,
  }: SentinelGenesisRequestPayload): Promise<
    Result<string, StorageOperationFailure>
  > {
    const state = this.state;
    if (state.isVerifying)
      return storageErr(
        new StorageOperationFailure(
          StorageOperationFailureKind.OperationFailed,
        ),
      );
    state.isVerifying = true;
    state.errorMsg = "";
    try {
      const initialized = await state.initDeviceIdentity();
      if (initialized.isErr()) return storageErr(initialized.error);
      const label = state.t(I18N_KEYS.DeviceProtectionPasskeyLabelPlaceholder);
      return await state.enqueueStorage(async () => {
        const admitted = state.admitManager();
        if (admitted.isErr()) return storageErr(admitted.error);
        try {
          return storageOk(
            await admitted.value.respond_to_sentinel_genesis_request(
              requestPayload.trim(),
              label,
            ),
          );
        } catch (failure) {
          return storageErr(new NativeVaultStorageFailure(failure));
        }
      });
    } finally {
      state.isVerifying = false;
    }
  }

  async finalize(): Promise<
    Result<SentinelGenesisFinalizationOutcome, StorageOperationFailure>
  > {
    const state = this.state;
    if (state.isVerifying)
      return storageErr(
        new StorageOperationFailure(
          StorageOperationFailureKind.OperationFailed,
        ),
      );
    state.isVerifying = true;
    state.errorMsg = "";
    try {
      const result = await state.enqueueStorage(async () => {
        const admitted = state.admitManager();
        if (admitted.isErr()) return storageErr(admitted.error);
        try {
          return storageOk(await admitted.value.finalize_sentinel_genesis());
        } catch (failure) {
          return storageErr(new NativeVaultStorageFailure(failure));
        }
      });
      if (result.isErr()) {
        this.restoreStatus();
        return storageErr(result.error);
      }
      const finalization: Parameters<typeof this.applyFinalizeResult>[0] = {
        result: result.value,
      };
      this.applyFinalizeResult(finalization);
      return storageOk(SentinelGenesisFinalizationOutcome.Finalized);
    } finally {
      state.isVerifying = false;
    }
  }

  async acceptShareDelivery({
    payload,
  }: SentinelGenesisShareDelivery): Promise<
    SentinelActionResult<SentinelGenesisShareDeliveryOutcome>
  > {
    const state = this.state;
    if (state.isVerifying)
      return storageErr(
        new StorageOperationFailure(
          StorageOperationFailureKind.OperationFailed,
        ),
      );
    state.isVerifying = true;
    state.errorMsg = "";
    try {
      const accepted = await state.enqueueStorage(async () => {
        const admitted = state.admitManager();
        if (admitted.isErr()) return storageErr(admitted.error);
        try {
          await admitted.value.accept_sentinel_genesis_share_delivery(
            payload.trim(),
          );
          return storageOk(SentinelGenesisShareAcceptanceOutcome.Accepted);
        } catch (failure) {
          return storageErr(new NativeVaultStorageFailure(failure));
        }
      });
      if (accepted.isErr()) return storageErr(accepted.error);
      const deliveries = await new SentinelUnlockActions(
        state,
      ).listSentinelStoredDeliveries();
      if (deliveries.isErr()) return storageErr(deliveries.error);
      state.showSuccess(
        state.t(I18N_KEYS.LoginSentinelGenesisReceiveShareSuccess),
      );
      return storageOk(
        SentinelGenesisShareDeliveryOutcome.AcceptedAndRefreshed,
      );
    } finally {
      state.isVerifying = false;
    }
  }

  async completeDelivery(): Promise<
    Result<SentinelGenesisDeliveryCompletionOutcome, StorageOperationFailure>
  > {
    const state = this.state;
    if (
      state.sentinelGenesisTarget.kind !== SentinelGenesisTargetKind.Selected ||
      state.isVerifying
    )
      return storageErr(
        new StorageOperationFailure(
          StorageOperationFailureKind.OperationFailed,
        ),
      );
    const storeId = state.sentinelGenesisTarget.storeId;
    state.isVerifying = true;
    try {
      try {
        await set_active_vault(storeId);
      } catch (failure) {
        return storageErr(new NativeVaultStorageFailure(failure));
      }
      const catalogRefresh1 = await state.refreshLocalVaultCatalog();
      if (catalogRefresh1.isErr()) {
        return storageErr(catalogRefresh1.error);
      }
      state.selectLoginVault(storeId);
      state.localLoginPreparation = LocalLoginPreparationState.Idle;
      state.sentinelCeremonyPrompt = true;
      const admitted = state.admitManager();
      if (admitted.isErr()) return storageErr(admitted.error);
      try {
        state.sentinelGenesisPhase =
          admitted.value.complete_sentinel_genesis_delivery();
      } catch (failure) {
        return storageErr(new NativeVaultStorageFailure(failure));
      }
      return storageOk(SentinelGenesisDeliveryCompletionOutcome.Completed);
    } finally {
      state.isVerifying = false;
    }
  }

  async acceptOnboardingPackage({
    packageJson,
  }: SentinelOnboardingPackageAcceptance): Promise<
    Result<SentinelOnboardingPackageAcceptanceOutcome, StorageOperationFailure>
  > {
    const state = this.state;
    state.errorMsg = "";
    const storeId = await state.enqueueStorage(async () => {
      const admitted = state.admitManager();
      if (admitted.isErr()) return storageErr(admitted.error);
      try {
        return storageOk(
          await admitted.value.accept_sentinel_onboarding_package(packageJson),
        );
      } catch (failure) {
        return storageErr(new NativeVaultStorageFailure(failure));
      }
    });
    if (storeId.isErr()) return storageErr(storeId.error);
    try {
      await set_active_vault(storeId.value);
    } catch (failure) {
      return storageErr(new NativeVaultStorageFailure(failure));
    }
    state.openActiveVault(storeId.value);
    const providerLoad: Parameters<typeof state.loadProviders>[0] = {
      ensureLocalRow: false,
    };
    const loadedProviders1 = await state.loadProviders(providerLoad);
    if (loadedProviders1.isErr()) {
      return storageErr(loadedProviders1.error);
    }
    state.applyActiveProviderCredentials();
    await state.loadDb();
    const admitted = state.admitManager();
    if (admitted.isErr()) return storageErr(admitted.error);
    try {
      state.sentinelGenesisPhase = admitted.value.sentinelGenesisPhase;
    } catch (failure) {
      return storageErr(new NativeVaultStorageFailure(failure));
    }
    return storageOk(SentinelOnboardingPackageAcceptanceOutcome.Accepted);
  }
}
