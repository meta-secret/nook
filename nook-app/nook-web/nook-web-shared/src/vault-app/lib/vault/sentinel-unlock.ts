import { I18N_KEYS } from "../../../generated/i18n-keys";
import { VaultType } from "$lib/vault/architecture-model";
import type { VaultState } from "$lib/vault.svelte";
import { type RuntimeFailure, browserLogRuntime } from "$lib/runtime/log";
import {
  JoinEnrollmentState,
  NookSentinelUnlockSessionStatus,
  ProviderSyncFreshness,
  SentinelVaultUnlockState,
  VaultRecoveryErrorKind,
  type NookSentinelStoredDeliverySummary as SentinelStoredDeliverySummary,
} from "$app-wasm";

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
  readonly failure: RuntimeFailure;
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

  isSentinelVault(): boolean {
    const state = this.state;
    if (state.vaultArchitecture.vault_type === VaultType.Sentinel)
      return true;
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

  sentinelCeremonyIsVisible(): boolean {
    const state = this.state;
    if (
      state.isAuthenticated ||
      state.sentinelUnlockStatus === SentinelVaultUnlockState.Unlocked
    )
      return false;
    if (
      state.sentinelUnlockStatus ===
        SentinelVaultUnlockState.AwaitingShares &&
      !state.sentinelUnlockSession.active &&
      state.hasManager &&
      state.requireManager().vaultStoreId === ""
    )
      return false;
    return (
      state.sentinelCeremonyPrompt ||
      state.sentinelUnlockStatus ===
        SentinelVaultUnlockState.CeremonyRequired ||
      state.sentinelUnlockStatus ===
        SentinelVaultUnlockState.AwaitingShares ||
      this.isSentinelVault()
    );
  }

  private async getSentinelUnlockStatus(): Promise<SentinelVaultUnlockState> {
    const state = this.state;
    if (!state.hasManager) return SentinelVaultUnlockState.NotSentinel;
    try {
      return await state.enqueueStorage(() =>
        state.requireManager().sentinel_unlock_status(),
      );
    } catch {
      return SentinelVaultUnlockState.NotSentinel;
    }
  }

  async refreshSentinelUnlockStatus(): Promise<SentinelVaultUnlockState> {
    const state = this.state;
    let status = await this.getSentinelUnlockStatus();
    if (
      !state.isAuthenticated &&
      status === SentinelVaultUnlockState.NotSentinel &&
      state.vaultArchitecture.vault_type === VaultType.Sentinel
    ) {
      await this.ensureSentinelCeremonyHydrated();
      status = await this.getSentinelUnlockStatus();
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

  async ensureSentinelCeremonyHydrated(): Promise<void> {
    const state = this.state;
    if (!state.hasManager || state.isAuthenticated || state.isVerifying)
      return;
    await state.initDeviceIdentity();
    try {
      await state.syncFromStorage(ProviderSyncFreshness.Forced);
    } catch {
      // A locked Sentinel sync may fail closed until its local share is selected.
    }
    const status = await this.getSentinelUnlockStatus();
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
        await state
          .requireManager()
          .connect(connectArgs.mode, connectArgs.pat, connectArgs.repo);
      });
    } catch (e) {
      if (
        browserLogRuntime.runtimeFailure(e).vaultRecoveryKind() ===
        VaultRecoveryErrorKind.SentinelCeremonyRequired
      ) {
        state.refreshVaultArchitectureFromManager();
        state.sentinelCeremonyPrompt = true;
        state.loginPasswordPrompt = false;
      }
    }
  }

  async startSentinelUnlock(): Promise<void> {
    const state = this.state;
    if (!state.hasManager || state.isVerifying) return;
    state.errorMsg = "";
    await this.ensureSentinelCeremonyHydrated();
    const status = await state.enqueueStorage(() =>
      state.requireManager().start_sentinel_unlock(),
    );
    const replaceUnlockSessionArgs: Parameters<
      SentinelUnlockActions["replaceUnlockSession"]
    >[0] = {
      status,
    };
    this.replaceUnlockSession(replaceUnlockSessionArgs);
    state.sentinelUnlockRequest = await state.enqueueStorage(() =>
      state.requireManager().sentinel_unlock_request_json(),
    );
  }

  async addSentinelUnlockResponse({
    response,
  }: SentinelUnlockResponseSubmission): Promise<void> {
    const state = this.state;
    if (!state.hasManager || !response.trim()) return;
    const status = await state.enqueueStorage(() =>
      state.requireManager().add_sentinel_unlock_response(response.trim()),
    );
    const replaceUnlockSessionArgs2: Parameters<
      SentinelUnlockActions["replaceUnlockSession"]
    >[0] = { status };
    this.replaceUnlockSession(replaceUnlockSessionArgs2);
  }

  async listSentinelStoredDeliveries(): Promise<
    SentinelStoredDeliverySummary[]
  > {
    const state = this.state;
    if (!state.hasManager) return [];
    await state.initDeviceIdentity();
    const summaries = await state.enqueueStorage(() =>
      state.requireManager().list_sentinel_genesis_share_deliveries(),
    );
    for (const previous of state.sentinelStoredDeliveries) previous.free();
    state.sentinelStoredDeliveries = summaries;
    return summaries;
  }

  async createSentinelUnlockResponse({
    storeId,
    request,
  }: SentinelUnlockResponseCreation): Promise<string> {
    const state = this.state;
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

  async finalizeSentinelUnlock(): Promise<void> {
    const state = this.state;
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
      const rawRecords = await state.enqueueStorage(() =>
        state.requireManager().finalize_sentinel_unlock(),
      );
      for (const record of rawRecords) record.free();
      const loadPageArgs: Parameters<typeof state.loadSecretPage>[0] = {
        query: "",
        requestedOffset: 0,
      };
      await state.loadSecretPage(loadPageArgs);
      state.sentinelCeremonyPrompt = false;
      state.sentinelUnlockRequest = "";
      const replaceUnlockSessionArgs3: Parameters<
        SentinelUnlockActions["replaceUnlockSession"]
      >[0] = {
        status: SentinelUnlockActions.inactiveSentinelUnlockSession(),
      };
      this.replaceUnlockSession(replaceUnlockSessionArgs3);
      state.sentinelUnlockStatus = SentinelVaultUnlockState.Unlocked;
      await state.ensureProviderSaved();
      const providerLoadOptions: Parameters<typeof state.loadProviders>[0] = {
        ensureLocalRow: false,
      };
      await state.loadProviders(providerLoadOptions);
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
      const status = state.requireManager().sentinel_unlock_session_status();
      const replacement: UnlockSessionReplacement = { status };
      this.replaceUnlockSession(replacement);
      if (!status.active) state.sentinelUnlockRequest = "";
      state.sentinelUnlockStatus = state
        .requireManager()
        .sentinel_unlock_status();
      if (state.sentinelUnlockStatus === SentinelVaultUnlockState.Unlocked) {
        state.sentinelCeremonyPrompt = false;
      } else if (
        browserLogRuntime.runtimeFailure(e).vaultRecoveryKind() ===
        VaultRecoveryErrorKind.SentinelCeremonyRequired
      ) {
        state.sentinelCeremonyPrompt = true;
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

  async surfaceSentinelCeremonyIfNeeded({
    failure,
  }: SentinelCeremonyPresentation): Promise<boolean> {
    const state = this.state;
    if (
      failure.vaultRecoveryKind() !==
        VaultRecoveryErrorKind.SentinelCeremonyRequired &&
      !this.isSentinelVault()
    ) {
      return false;
    }
    state.refreshVaultArchitectureFromManager();
    const status = await this.refreshSentinelUnlockStatus();
    if (
      status === SentinelVaultUnlockState.CeremonyRequired ||
      status === SentinelVaultUnlockState.AwaitingShares
    ) {
      state.sentinelCeremonyPrompt = true;
      state.loginPasswordPrompt = false;
      state.errorMsg = "";
      return true;
    }
    return (
      failure.vaultRecoveryKind() ===
      VaultRecoveryErrorKind.SentinelCeremonyRequired
    );
  }
}
