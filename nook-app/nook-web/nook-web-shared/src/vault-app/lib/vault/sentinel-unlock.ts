import type { OAuthFailure } from "$lib/auth/oauth-failure";
import type { SentinelActionResult } from "./sentinel-genesis";
import { NativeVaultStorageFailure } from "$lib/runtime/storage-failure";
import { err as storageErr, ok as storageOk, type Result } from "neverthrow";
import {
  VaultStorageFailure as StorageOperationFailure,
  VaultStorageFailureKind as StorageOperationFailureKind,
} from "$lib/runtime/storage-failure";
import { I18N_KEYS } from "../../../generated/i18n-keys";
import { VaultType } from "$lib/vault/architecture-model";
import type { VaultState } from "$lib/vault.svelte";
import { browserLogRuntime } from "$lib/runtime/log";
import {
  JoinEnrollmentState,
  NookSentinelUnlockSessionStatus,
  ProviderSyncFreshness,
  SentinelVaultUnlockState,
  VaultRecoveryErrorKind,
  type NookSecretRecord,
  type NookSentinelStoredDeliverySummary as SentinelStoredDeliverySummary,
} from "$app-wasm";

export enum SentinelCeremonyVisibility {
  Hidden = "hidden",
  Visible = "visible",
}

const log = browserLogRuntime.createLogger("vault-sentinel");

export type {
  NookSentinelStoredDeliverySummary as SentinelStoredDeliverySummary,
  NookSentinelUnlockSessionStatus as SentinelUnlockSessionStatus,
} from "$app-wasm";

type UnlockSessionReplacement = {
  readonly status: NookSentinelUnlockSessionStatus;
};

type SentinelUnlockResponseSubmission = {
  readonly response: string;
};

type SentinelUnlockResponseCreation = {
  readonly storeId: string;
  readonly request: string;
};

type SentinelCeremonyPresentation = {
  readonly recoveryKind: VaultRecoveryErrorKind;
};

/** Owns browser orchestration for one sentinel unlock context. */
export class SentinelUnlockActions {
  constructor(private readonly state: VaultState) {}

  static inactiveSentinelUnlockSession(): NookSentinelUnlockSessionStatus {
    return NookSentinelUnlockSessionStatus.inactive();
  }

  private replaceUnlockSession({ status }: UnlockSessionReplacement): void {
    const state = this.state;
    const previous = state.sentinelUnlockSession;
    state.sentinelUnlockSession = status;
    if (previous !== status) previous.free();
  }

  vaultType(): Result<VaultType, StorageOperationFailure> {
    const state = this.state;
    let kind: VaultType;
    try {
      kind = state.vaultArchitecture.vault_type;
    } catch (failure) {
      return storageErr(new NativeVaultStorageFailure(failure));
    }
    if (kind === VaultType.Sentinel || !state.hasManager)
      return storageOk(kind);
    const manager = state.admitManager();
    if (manager.isErr()) return storageErr(manager.error);
    try {
      return storageOk(
        manager.value.sentinel_unlock_status() ===
          SentinelVaultUnlockState.NotSentinel
          ? kind
          : VaultType.Sentinel,
      );
    } catch (failure) {
      return storageErr(new NativeVaultStorageFailure(failure));
    }
  }

  ceremonyVisibility(): Result<
    SentinelCeremonyVisibility,
    StorageOperationFailure
  > {
    const state = this.state;
    if (
      state.isAuthenticated ||
      state.sentinelUnlockStatus === SentinelVaultUnlockState.Unlocked
    )
      return storageOk(SentinelCeremonyVisibility.Hidden);
    if (
      state.sentinelUnlockStatus === SentinelVaultUnlockState.AwaitingShares &&
      state.hasManager
    ) {
      const manager = state.admitManager();
      if (manager.isErr()) return storageErr(manager.error);
      try {
        if (
          !state.sentinelUnlockSession.active &&
          manager.value.vaultStoreId === ""
        )
          return storageOk(SentinelCeremonyVisibility.Hidden);
      } catch (failure) {
        return storageErr(new NativeVaultStorageFailure(failure));
      }
    }
    if (
      state.sentinelCeremonyPrompt ||
      state.sentinelUnlockStatus ===
        SentinelVaultUnlockState.CeremonyRequired ||
      state.sentinelUnlockStatus === SentinelVaultUnlockState.AwaitingShares
    )
      return storageOk(SentinelCeremonyVisibility.Visible);
    return this.vaultType().map((kind) =>
      kind === VaultType.Sentinel
        ? SentinelCeremonyVisibility.Visible
        : SentinelCeremonyVisibility.Hidden,
    );
  }

  private async getSentinelUnlockStatus(): Promise<
    SentinelActionResult<SentinelVaultUnlockState>
  > {
    return this.state.enqueueStorage<
      SentinelVaultUnlockState,
      StorageOperationFailure
    >(async () => {
      const manager = this.state.admitManager();
      if (manager.isErr()) return storageErr(manager.error);
      try {
        return storageOk(manager.value.sentinel_unlock_status());
      } catch (failure) {
        return storageErr(new NativeVaultStorageFailure(failure));
      }
    });
  }

  async refreshSentinelUnlockStatus(): Promise<
    SentinelActionResult<SentinelVaultUnlockState>
  > {
    const state = this.state;
    let read = await this.getSentinelUnlockStatus();
    if (read.isErr()) return storageErr(read.error);
    let status = read.value;
    if (
      !state.isAuthenticated &&
      status === SentinelVaultUnlockState.NotSentinel &&
      state.vaultArchitecture.vault_type === VaultType.Sentinel
    ) {
      const hydrated = await this.ensureSentinelCeremonyHydrated();
      if (hydrated.isErr()) return storageErr(hydrated.error);
      read = await this.getSentinelUnlockStatus();
      if (read.isErr()) return storageErr(read.error);
      status = read.value;
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
      return storageOk(SentinelVaultUnlockState.CeremonyRequired);
    } else if (status === SentinelVaultUnlockState.NotSentinel) {
      state.sentinelCeremonyPrompt = false;
    }
    return storageOk(state.sentinelUnlockStatus);
  }

  async ensureSentinelCeremonyHydrated(): Promise<SentinelActionResult<void>> {
    const state = this.state;
    if (state.isAuthenticated || state.isVerifying) return storageOk();
    const initialized = await state.initDeviceIdentity();
    if (initialized.isErr()) return storageErr(initialized.error);
    const synchronized = await state.syncFromStorage(
      ProviderSyncFreshness.Forced,
    );
    if (synchronized.isErr()) return storageErr(synchronized.error);
    const read = await this.getSentinelUnlockStatus();
    if (read.isErr()) return storageErr(read.error);
    if (
      read.value === SentinelVaultUnlockState.CeremonyRequired ||
      read.value === SentinelVaultUnlockState.AwaitingShares
    ) {
      const architecture = state.refreshVaultArchitectureFromManager();
      if (architecture.isErr()) return storageErr(architecture.error);
      state.sentinelCeremonyPrompt = true;
      state.loginPasswordPrompt = false;
      return storageOk();
    }
    const connected = await state.enqueueStorage(async () => {
      const manager = state.admitManager();
      if (manager.isErr()) return storageErr(manager.error);
      const args = state.connectStorageArgs();
      try {
        return storageOk(
          await manager.value.connect(args.mode, args.pat, args.repo),
        );
      } catch (failure) {
        return storageErr(new NativeVaultStorageFailure(failure));
      }
    });
    if (connected.isErr()) {
      if (
        connected.error.recoveryKind !==
        VaultRecoveryErrorKind.SentinelCeremonyRequired
      )
        return storageErr(connected.error);
      const architecture = state.refreshVaultArchitectureFromManager();
      if (architecture.isErr()) return storageErr(architecture.error);
      state.sentinelCeremonyPrompt = true;
      state.loginPasswordPrompt = false;
      return storageOk();
    }
    for (const record of connected.value) record.free();
    return storageOk();
  }

  async startSentinelUnlock(): Promise<SentinelActionResult<void>> {
    const state = this.state;
    if (!state.hasManager || state.isVerifying)
      return storageErr(
        new StorageOperationFailure(
          StorageOperationFailureKind.ManagerUnavailable,
        ),
      );
    state.errorMsg = "";
    const hydrated = await this.ensureSentinelCeremonyHydrated();
    if (hydrated.isErr()) return storageErr(hydrated.error);
    const status = await state.enqueueStorage(async () => {
      const admittedManager = state.admitManager();
      if (admittedManager.isErr()) return storageErr(admittedManager.error);
      try {
        return storageOk(await admittedManager.value.start_sentinel_unlock());
      } catch (nativeFailure) {
        return storageErr(new NativeVaultStorageFailure(nativeFailure));
      }
    });
    if (status.isErr()) return storageErr(status.error);
    const replaceUnlockSessionArgs: Parameters<
      SentinelUnlockActions["replaceUnlockSession"]
    >[0] = {
      status: status.value,
    };
    this.replaceUnlockSession(replaceUnlockSessionArgs);
    const request = await state.enqueueStorage(async () => {
      const admittedManager = state.admitManager();
      if (admittedManager.isErr()) return storageErr(admittedManager.error);
      try {
        return storageOk(
          await admittedManager.value.sentinel_unlock_request_json(),
        );
      } catch (nativeFailure) {
        return storageErr(new NativeVaultStorageFailure(nativeFailure));
      }
    });
    if (request.isErr()) return storageErr(request.error);
    state.sentinelUnlockRequest = request.value;
    return storageOk();
  }

  async addSentinelUnlockResponse({
    response,
  }: SentinelUnlockResponseSubmission): Promise<SentinelActionResult<void>> {
    const state = this.state;
    if (!state.hasManager)
      return storageErr(
        new StorageOperationFailure(
          StorageOperationFailureKind.ManagerUnavailable,
        ),
      );
    const status = await state.enqueueStorage(async () => {
      const admittedManager = state.admitManager();
      if (admittedManager.isErr()) return storageErr(admittedManager.error);
      try {
        return storageOk(
          await admittedManager.value.add_sentinel_unlock_response(
            response.trim(),
          ),
        );
      } catch (nativeFailure) {
        return storageErr(new NativeVaultStorageFailure(nativeFailure));
      }
    });
    if (status.isErr()) return storageErr(status.error);
    const replaceUnlockSessionArgs2: Parameters<
      SentinelUnlockActions["replaceUnlockSession"]
    >[0] = { status: status.value };
    this.replaceUnlockSession(replaceUnlockSessionArgs2);
    return storageOk();
  }

  async listSentinelStoredDeliveries(): Promise<
    SentinelActionResult<SentinelStoredDeliverySummary[]>
  > {
    const state = this.state;
    const initialized = await state.initDeviceIdentity();
    if (initialized.isErr()) return storageErr(initialized.error);
    const summaries = await state.enqueueStorage(async () => {
      const manager = state.admitManager();
      if (manager.isErr()) return storageErr(manager.error);
      try {
        return storageOk(
          await manager.value.list_sentinel_genesis_share_deliveries(),
        );
      } catch (failure) {
        return storageErr(new NativeVaultStorageFailure(failure));
      }
    });
    if (summaries.isErr()) return storageErr(summaries.error);
    for (const previous of state.sentinelStoredDeliveries) previous.free();
    state.sentinelStoredDeliveries = summaries.value;
    return summaries;
  }

  async createSentinelUnlockResponse({
    storeId,
    request,
  }: SentinelUnlockResponseCreation): Promise<SentinelActionResult<string>> {
    const state = this.state;
    const initialized = await state.initDeviceIdentity();
    if (initialized.isErr()) return storageErr(initialized.error);
    const response = await state.enqueueStorage(async () => {
      const manager = state.admitManager();
      if (manager.isErr()) return storageErr(manager.error);
      try {
        await manager.value.load_sentinel_genesis_share_delivery(
          storeId.trim(),
        );
        return storageOk(
          await manager.value.respond_to_sentinel_unlock_request(
            request.trim(),
          ),
        );
      } catch (failure) {
        return storageErr(new NativeVaultStorageFailure(failure));
      }
    });
    if (response.isErr()) return storageErr(response.error);
    const architecture = state.refreshVaultArchitectureFromManager();
    if (architecture.isErr()) return storageErr(architecture.error);
    return response;
  }

  presentFinalizationFailure(
    failure: StorageOperationFailure | OAuthFailure,
  ): void {
    const state = this.state;
    state.errorMsg =
      failure instanceof StorageOperationFailure &&
      failure.recoveryKind ===
        VaultRecoveryErrorKind.SentinelCeremonyRequired &&
      state.sentinelUnlockStatus !== SentinelVaultUnlockState.Unlocked
        ? ""
        : state.t(failure.translationKey);
  }

  private restoreFinalizationFailure(
    failure: StorageOperationFailure | OAuthFailure,
  ): SentinelActionResult<void> {
    const state = this.state;
    state.isAuthenticated = false;
    const manager = state.admitManager();
    if (manager.isErr()) return storageErr(manager.error);
    try {
      const status = manager.value.sentinel_unlock_session_status();
      this.replaceUnlockSession({ status });
      if (!status.active) state.sentinelUnlockRequest = "";
      state.sentinelUnlockStatus = manager.value.sentinel_unlock_status();
    } catch (nativeFailure) {
      return storageErr(new NativeVaultStorageFailure(nativeFailure));
    }
    state.sentinelCeremonyPrompt =
      state.sentinelUnlockStatus !== SentinelVaultUnlockState.Unlocked;
    return storageErr(failure);
  }

  async finalizeSentinelUnlock(): Promise<SentinelActionResult<void>> {
    const state = this.state;
    if (
      !state.hasManager ||
      state.isVerifying ||
      !state.sentinelUnlockSession.ready
    ) {
      return storageErr(
        new StorageOperationFailure(
          StorageOperationFailureKind.OperationFailed,
        ),
      );
    }
    state.errorMsg = "";
    state.dismissSuccess();
    state.isVerifying = true;
    try {
      const rawRecords = await state.enqueueStorage<
        NookSecretRecord[],
        StorageOperationFailure
      >(async () => {
        const admittedManager = state.admitManager();
        if (admittedManager.isErr()) return storageErr(admittedManager.error);
        try {
          return storageOk(
            await admittedManager.value.finalize_sentinel_unlock(),
          );
        } catch (nativeFailure) {
          return storageErr(new NativeVaultStorageFailure(nativeFailure));
        }
      });
      if (rawRecords.isErr())
        return this.restoreFinalizationFailure(rawRecords.error);
      for (const record of rawRecords.value) record.free();
      const loadPageArgs: Parameters<typeof state.loadSecretPage>[0] = {
        query: "",
        requestedOffset: 0,
      };
      const secretRefresh1 = await state.loadSecretPage(loadPageArgs);
      if (secretRefresh1.isErr()) {
        return this.restoreFinalizationFailure(secretRefresh1.error);
      }
      state.sentinelCeremonyPrompt = false;
      state.sentinelUnlockRequest = "";
      const replaceUnlockSessionArgs3: Parameters<
        SentinelUnlockActions["replaceUnlockSession"]
      >[0] = {
        status: SentinelUnlockActions.inactiveSentinelUnlockSession(),
      };
      this.replaceUnlockSession(replaceUnlockSessionArgs3);
      state.sentinelUnlockStatus = SentinelVaultUnlockState.Unlocked;
      const savedProvider1 = await state.ensureProviderSaved();
      if (savedProvider1.isErr()) {
        return this.restoreFinalizationFailure(savedProvider1.error);
      }
      const providerLoadOptions: Parameters<typeof state.loadProviders>[0] = {
        ensureLocalRow: false,
      };
      const loadedProviders1 = await state.loadProviders(providerLoadOptions);
      if (loadedProviders1.isErr()) {
        return this.restoreFinalizationFailure(loadedProviders1.error);
      }
      const passwordRefresh1 = await state.refreshPasswordEntriesList();
      if (passwordRefresh1.isErr()) {
        return this.restoreFinalizationFailure(passwordRefresh1.error);
      }
      const rosterRefresh1 = await state.hydrateMultiDeviceState();
      if (rosterRefresh1.isErr()) {
        return this.restoreFinalizationFailure(rosterRefresh1.error);
      }
      const unlocked = state.markVaultUnlocked();
      if (unlocked.isErr()) {
        return this.restoreFinalizationFailure(unlocked.error);
      }
      log.info("vault unlocked with sentinel quorum");
      state.joinEnrollmentPrompt = JoinEnrollmentState.None;
      state.loginPasswordPrompt = false;
      state.showSuccess(state.t(I18N_KEYS.ToastsVaultUnlocked));
      state.startIdleSessionTracking();
      state.startVaultSync();
      return storageOk();
    } finally {
      state.isVerifying = false;
    }
  }

  async surfaceSentinelCeremonyIfNeeded({
    recoveryKind,
  }: SentinelCeremonyPresentation): Promise<boolean> {
    const state = this.state;
    const vaultType = this.vaultType();
    if (vaultType.isErr()) {
      state.errorMsg = state.t(vaultType.error.translationKey);
      return false;
    }
    if (
      recoveryKind !== VaultRecoveryErrorKind.SentinelCeremonyRequired &&
      vaultType.value !== VaultType.Sentinel
    ) {
      return false;
    }
    const architecture = state.refreshVaultArchitectureFromManager();
    if (architecture.isErr()) {
      state.errorMsg = state.t(architecture.error.translationKey);
      return false;
    }
    const refreshed = await this.refreshSentinelUnlockStatus();
    if (refreshed.isErr()) {
      state.errorMsg = state.t(refreshed.error.translationKey);
      return false;
    }
    const status = refreshed.value;
    if (
      status === SentinelVaultUnlockState.CeremonyRequired ||
      status === SentinelVaultUnlockState.AwaitingShares
    ) {
      state.sentinelCeremonyPrompt = true;
      state.loginPasswordPrompt = false;
      state.errorMsg = "";
      return true;
    }
    return recoveryKind === VaultRecoveryErrorKind.SentinelCeremonyRequired;
  }
}
