import type { NookVaultManager } from "$app-wasm";
import {
  NativeVaultStorageFailure,
  ProviderDraftIncompleteFailure,
} from "$lib/runtime/storage-failure";
import { err as storageErr, ok as storageOk, type Result } from "neverthrow";
import { VaultStorageFailure as StorageOperationFailure } from "$lib/runtime/storage-failure";
import { ProviderFailureLogContext } from "$lib/vault/provider-failure-log-context";
import { I18N_KEYS } from "../../../generated/i18n-keys";

/** Provider actions that snapshot reactive Svelte state at WASM boundaries. */
import type {
  ActiveProviderCredentialsContext,
  ProviderActionsContext,
} from "$lib/vault/action-contexts";
import type { VaultAccessStatus } from "$lib/nook";
import {
  activeVaultScope,
  unselectedVaultScope,
  type ProviderKind,
  type StorageProvider,
  type StoredProvider,
} from "$lib/auth/providers";
import {
  active_provider_login_setup,
  active_provider_credentials_projection,
  authenticated_vault_storage_args,
  begin_provider_draft,
  draft_storage_args,
  has_local_vault,
  inactive_provider_login_setup,
  NookStagedStorageArgsState,
  provider_draft_credential_readiness,
  provider_draft_label,
  remove_local_folder_handle,
  RemoteVaultAssessDecision,
  RemoteVaultRecoveryState,
  staged_storage_args,
  local_vault_storage_args,
  type NookStorageConnection,
  type ActiveProviderCredentialsRequest,
  type ActiveProviderLoginSetup,
  type AuthProvidersSnapshot,
  type OAuthFilePreset,
  type ProviderCredentialReadiness,
  type VaultAuthenticationState,
} from "$app-wasm";
import { browserLogRuntime } from "$lib/runtime/log";
import {
  ActiveVaultKind,
  LoginVaultSelectionKind,
  LoginSetupKind,
  RemoteVaultChoices,
  StagedRemoteStorageKind,
  type StagedRemoteStorage,
} from "$lib/vault/state/provider.svelte";
import { VaultDiscoveryTimeout } from "$lib/vault/vault-discovery-timeout";
import { ProviderSelectionActions } from "$lib/vault/provider-selection.svelte";

export { ProviderSelectionActions } from "$lib/vault/provider-selection.svelte";

export { ProviderConnectionActions } from "$lib/vault/provider-connection";

export {
  ProviderPersistenceActions,
  ProviderSaveOutcome,
} from "$lib/vault/provider-persistence.svelte";

const log = browserLogRuntime.createLogger("vault-providers");

export interface VaultConnectAssessmentRequest {
  readonly args: NookStorageConnection;
}

type VaultConnectStatusDiscoveryCompletion = {
  readonly operation: Promise<
    Result<VaultAccessStatus, StorageOperationFailure>
  >;
  readonly releaseLateValue: (status: VaultAccessStatus) => void;
};

export interface RemoteVaultAssessmentHandling {
  readonly accessStatus: VaultAccessStatus;
}

export interface ProviderLoadOptions {
  readonly ensureLocalRow: boolean;
}

export interface ProviderLoad {
  readonly options: ProviderLoadOptions;
}

export interface ProviderPersistenceOptions {
  readonly replace: boolean;
  readonly providers: readonly StorageProvider[];
}

export interface ProviderPersistence {
  readonly opts: ProviderPersistenceOptions;
}

export interface ProviderSetup {
  readonly kind: ProviderKind;
}

export interface ProviderRemoval {
  readonly id: string;
}

export enum ProviderPersistenceOutcome {
  Persisted = "persisted",
}

export type PromotedProviderSnapshot = {
  readonly snapshot: AuthProvidersSnapshot;
  readonly localVaultPresent: boolean;
};

/** What removing a row did to this browser's stored folder handles. */
enum FolderHandleRemoval {
  Removed = "removed",
  NotAFolder = "not-a-folder",
}

export enum ProviderRemovalOutcomeKind {
  NotFound = "not-found",
  LocalProviderRetained = "local-provider-retained",
  Removed = "removed",
}

export type ProviderRemovalOutcome =
  | { readonly kind: ProviderRemovalOutcomeKind.NotFound }
  | {
      readonly kind: ProviderRemovalOutcomeKind.LocalProviderRetained;
      readonly provider: StorageProvider;
    }
  | {
      readonly kind: ProviderRemovalOutcomeKind.Removed;
      readonly providers: readonly StorageProvider[];
    };

export class VaultProviderActions {
  constructor(private readonly state: ProviderActionsContext) {}

  /** Where the vault connects from: this browser's vault, the signed-in
   * session's first sync row, or the draft, which fails closed with its gap. */
  wasmStorageArgs(): Result<NookStorageConnection, StorageOperationFailure> {
    const state = this.state;
    const syncProvider = new ProviderSelectionActions(state).syncProviders()[0];
    if (state.localVaultPresent) {
      return storageOk(local_vault_storage_args());
    }
    if (state.isAuthenticated && syncProvider) {
      return storageOk(
        authenticated_vault_storage_args($state.snapshot(syncProvider)),
      );
    }
    return this.draftStorageArgs();
  }

  /** The draft's own connection, or the gap that keeps it from connecting. */
  draftStorageArgs(): Result<NookStorageConnection, StorageOperationFailure> {
    const connection = draft_storage_args(this.state.providerDraft);
    switch (connection.state) {
      case "ready":
        return storageOk(connection.connection);
      case "incomplete":
        return storageErr(new ProviderDraftIncompleteFailure(connection.gap));
    }
  }

  /** Rust decides whether a join connects through the join provider. */
  connectStorageArgs(): Result<NookStorageConnection, StorageOperationFailure> {
    const state = this.state;
    const sourceRequest: Parameters<
      typeof state.clientPolicy.join_connect_source
    >[0] = {
      authentication: this.authentication(),
      joinState: state.joinEnrollmentPrompt,
      syncProviders: $state.snapshot(
        new ProviderSelectionActions(state).syncProviders(),
      ),
    };
    const source = state.clientPolicy.join_connect_source(sourceRequest);
    switch (source.kind) {
      case "joinProvider":
        return storageOk(source.connection);
      case "draft":
        return this.wasmStorageArgs();
    }
  }

  private authentication(): VaultAuthenticationState {
    switch (this.state.isAuthenticated) {
      case true:
        return "authenticated";
      case false:
        return "unauthenticated";
    }
  }

  stagedRemoteStorageArgs(): StagedRemoteStorage {
    const staged = staged_storage_args(this.state.providerDraft);
    try {
      switch (staged.state) {
        case NookStagedStorageArgsState.Ready:
          return {
            kind: StagedRemoteStorageKind.Available,
            args: staged.args,
          };
        case NookStagedStorageArgsState.Incomplete:
          return { kind: StagedRemoteStorageKind.Unavailable };
      }
    } finally {
      staged.free();
    }
  }

  stagedProviderLabel(): string {
    return provider_draft_label(this.state.providerDraft);
  }

  credentialReadiness(): ProviderCredentialReadiness {
    return provider_draft_credential_readiness(this.state.providerDraft);
  }

  /** Feeds the sync decision's boolean parameter; other callers switch on
   * the readiness itself. */
  hasRemoteProviderCredentials(): boolean {
    switch (this.credentialReadiness().state) {
      case "ready":
        return true;
      case "required":
        return false;
    }
  }

  async assessVaultConnectStatus({
    args,
  }: VaultConnectAssessmentRequest): Promise<
    Result<VaultAccessStatus, StorageOperationFailure>
  > {
    const state = this.state;
    return state.enqueueStorage(async () => {
      const admitted = state.admitManager();
      if (admitted.isErr()) return storageErr(admitted.error);
      const operation: Promise<
        Result<VaultAccessStatus, StorageOperationFailure>
      > = (async () => {
        try {
          return storageOk(await admitted.value.assess_vault_connect(args));
        } catch (nativeFailure) {
          const failure = new NativeVaultStorageFailure(nativeFailure);
          const failureRequest: Parameters<
            typeof ProviderFailureLogContext.from
          >[0] = {
            provider_type: args.mode,
            failure_kind: failure.kind,
            cause: failure.cause,
          };
          const failureContext = ProviderFailureLogContext.from(failureRequest);
          const warningContext: Parameters<typeof log.warnWithContext>[0] = {
            message: "provider vault assessment failed",
            serializedContext: failureContext.serialize(),
          };
          log.warnWithContext(warningContext);
          return storageErr(failure);
        }
      })();
      const deadline: ConstructorParameters<typeof VaultDiscoveryTimeout>[0] = {
        timeoutMs: 30_000,
      };
      const timeout = new VaultDiscoveryTimeout(deadline);
      const timeoutRequest: VaultConnectStatusDiscoveryCompletion = {
        operation,
        releaseLateValue: () => {},
      };
      return timeout.waitFor<VaultAccessStatus, StorageOperationFailure>(
        timeoutRequest,
      );
    });
  }

  async handleRemoteVaultAssessStatus({
    accessStatus,
  }: RemoteVaultAssessmentHandling): Promise<boolean> {
    const state = this.state;
    const decision = state.clientPolicy.remote_vault_assess_decision(
      accessStatus,
      state.loginRequiresExistingVault,
      state.loginSetup.kind === LoginSetupKind.Active,
    );
    switch (decision) {
      case RemoteVaultAssessDecision.PromptRecoveryFromCache: {
        state.remoteVaultRecoveryState =
          RemoteVaultRecoveryState.PromptWithCache;
        const passwordRefresh1 = await state.refreshPasswordEntriesList();
        if (passwordRefresh1.isErr()) {
          state.errorMsg = state.t(passwordRefresh1.error.translationKey);
          return true;
        }
        return true;
      }
      case RemoteVaultAssessDecision.RejectMissingExistingVault:
        state.remoteVaultRecoveryState = RemoteVaultRecoveryState.None;
        state.errorMsg = state.t(I18N_KEYS.AuthStorageExistingVaultNotFound);
        return true;
      case RemoteVaultAssessDecision.PromptMissingRemote:
        state.remoteVaultRecoveryState =
          RemoteVaultRecoveryState.PromptMissingOnly;
        return true;
      case RemoteVaultAssessDecision.Continue:
        return false;
    }
  }

  private resetICloudSignInState() {
    const state = this.state;
    state.icloudOAuthPreparing = false;
    state.icloudOAuthReady = false;
    state.icloudOAuthBusy = false;
  }

  initializePristineDeviceProviders(): void {
    const state = this.state;
    state.providers = [];
    state.providersLoaded = true;
    log.debug("pristine device providers initialized");
  }

  async loadProviders({ options }: ProviderLoad) {
    const state = this.state;
    const loaded = await state.enqueueStorage(async () => {
      const manager = state.admitManager();
      if (manager.isErr()) return storageErr(manager.error);
      try {
        return storageOk(
          await (options.ensureLocalRow
            ? manager.value.load_auth_providers_with_local_row()
            : manager.value.load_auth_providers_snapshot()),
        );
      } catch (failure) {
        return storageErr(new NativeVaultStorageFailure(failure));
      }
    });
    if (loaded.isErr()) return storageErr(loaded.error);
    const snapshot = loaded.value;
    state.providers = snapshot.providers;
    if (state.selectedLoginVault.kind === LoginVaultSelectionKind.Selected) {
      state.openActiveVault(state.selectedLoginVault.storeId);
    } else if (snapshot.activeVaultStoreId.state === "storeId") {
      state.openActiveVault(snapshot.activeVaultStoreId.value);
    }
    state.providersLoaded = true;
    log.debug("providers loaded");
    const loadedSnapshot: AuthProvidersSnapshot = {
      providers: state.providers,
      activeVaultStoreId: snapshot.activeVaultStoreId,
    };
    return storageOk(loadedSnapshot);
  }

  async promoteSessionVaultToLocalIfNeeded(): Promise<
    Result<PromotedProviderSnapshot, StorageOperationFailure>
  > {
    const state = this.state;
    const ensureLocalAuthProviderSnapshotArgs: Parameters<
      NookVaultManager["ensure_local_auth_provider_snapshot"]
    >[0] = {
      providers: state.providers,
      activeVaultStoreId:
        state.activeVault.kind === ActiveVaultKind.Open
          ? activeVaultScope(state.activeVault.storeId)
          : unselectedVaultScope(),
    };
    const promoted = await state.enqueueStorage(async () => {
      const manager = state.admitManager();
      if (manager.isErr()) return storageErr(manager.error);
      try {
        const snapshot =
          await manager.value.ensure_local_auth_provider_snapshot(
            ensureLocalAuthProviderSnapshotArgs,
          );
        const localVaultPresent = await has_local_vault();
        const promotion: PromotedProviderSnapshot = {
          snapshot,
          localVaultPresent,
        };
        return storageOk(promotion);
      } catch (failure) {
        return storageErr(new NativeVaultStorageFailure(failure));
      }
    });
    if (promoted.isErr()) return storageErr(promoted.error);
    state.providers = promoted.value.snapshot.providers;
    state.localVaultPresent = promoted.value.localVaultPresent;
    if (state.localVaultPresent) {
      state.useThisBrowser();
    }
    return storageOk(promoted.value);
  }

  async persistProviders({ opts }: ProviderPersistence) {
    const state = this.state;
    const request: Parameters<
      NookVaultManager["persist_auth_providers_snapshot"]
    >[0] = {
      snapshot: {
        providers: [...opts.providers],
        activeVaultStoreId:
          state.activeVault.kind === ActiveVaultKind.Open
            ? activeVaultScope(state.activeVault.storeId)
            : unselectedVaultScope(),
      },
      mode:
        !opts.replace && state.localVaultPresent
          ? "preserveUnlistedSyncProviders"
          : "replace",
    };
    const snapshot = await state.enqueueStorage(async () => {
      const admittedManager = state.admitManager();
      if (admittedManager.isErr()) return storageErr(admittedManager.error);
      try {
        return storageOk(
          await admittedManager.value.persist_auth_providers_snapshot(request),
        );
      } catch (nativeFailure) {
        return storageErr(new NativeVaultStorageFailure(nativeFailure));
      }
    });
    if (snapshot.isErr()) return storageErr(snapshot.error);
    state.providers = snapshot.value.providers;
    return storageOk(ProviderPersistenceOutcome.Persisted);
  }

  beginProviderSetup({ kind }: ProviderSetup) {
    const state = this.state;
    if (!state.isAuthenticated) {
      state.resetVaultSessionState();
    }
    state.activateLoginSetup(kind);
    state.stageProviderDraft(begin_provider_draft(kind));
    this.resetSignInStateFor(kind);
    state.clearExistingVaultRecoverySummary();
    state.errorMsg = "";
    state.dismissSuccess();
    log.debug("provider setup started");
  }

  private resetSignInStateFor(kind: ProviderKind): void {
    switch (kind.type) {
      case "oauth-file":
        this.resetSignInStateForPreset(kind.preset);
        return;
      case "local":
      case "local-folder":
      case "github":
      case "s3":
        return;
    }
  }

  private resetSignInStateForPreset(preset: OAuthFilePreset): void {
    switch (preset) {
      case "icloud":
        this.resetICloudSignInState();
        return;
      case "google-drive":
        return;
    }
  }

  beginAddProvider() {
    const state = this.state;
    if (!state.isAuthenticated) {
      state.resetVaultSessionState();
    }
    state.addProviderOpen = true;
    state.clearLoginSetup();
    state.errorMsg = "";
  }

  cancelAddProvider() {
    const state = this.state;
    this.resetICloudSignInState();
    state.addProviderOpen = false;
    state.clearLoginSetup();
    state.clearExistingVaultRecoverySummary();
    state.applyActiveProviderCredentials();
    state.errorMsg = "";
  }

  cancelProviderSetup() {
    const state = this.state;
    this.resetICloudSignInState();
    state.remoteVaultChoices = RemoteVaultChoices.NONE;
    // The add-provider picker stays open when the add path started this
    // setup. Either way the setup's draft and its credentials go, and the
    // projection restores the draft of the provider in use.
    state.useThisBrowser();
    if (
      state.addProviderOpen &&
      state.loginSetup.kind === LoginSetupKind.Active
    ) {
      state.clearLoginSetup();
      state.clearExistingVaultRecoverySummary();
      state.applyActiveProviderCredentials();
      state.errorMsg = "";
      return;
    }
    state.clearLoginSetup();
    state.clearExistingVaultRecoverySummary();
    state.addProviderOpen = false;
    state.applyActiveProviderCredentials();
    state.errorMsg = "";
  }

  async removeProvider({
    id,
  }: ProviderRemoval): Promise<
    Result<ProviderRemovalOutcome, StorageOperationFailure>
  > {
    const state = this.state;
    const target = state.providers.find((p) => p.id === id);
    if (!target) {
      const outcome: ProviderRemovalOutcome = {
        kind: ProviderRemovalOutcomeKind.NotFound,
      };
      return storageOk(outcome);
    }
    if (target.provider.type === "local") {
      const outcome: ProviderRemovalOutcome = {
        kind: ProviderRemovalOutcomeKind.LocalProviderRetained,
        provider: target,
      };
      return storageOk(outcome);
    }

    const persistenceOptions: ProviderPersistenceOptions = {
      replace: true,
      providers: state.providers.filter((provider) => provider.id !== id),
    };
    const persistence = await state.persistProviders(persistenceOptions);
    if (persistence.isErr()) return storageErr(persistence.error);
    if (state.providers.length === 0 && state.isAuthenticated) {
      state.clearUnlockedSession();
    }
    state.applyActiveProviderCredentials();
    const folderRemoval = await this.removeFolderHandle(target.provider);
    if (folderRemoval.isErr()) return storageErr(folderRemoval.error);
    log.info("sync provider removed");
    const tArgs: Parameters<typeof state.t>[0] = {
      key: I18N_KEYS.ToastsRemovedDevice,
      replacements: { label: target.label },
    };
    state.showSuccess(state.t(tArgs));
    const outcome: ProviderRemovalOutcome = {
      kind: ProviderRemovalOutcomeKind.Removed,
      providers: state.providers,
    };
    return storageOk(outcome);
  }

  /** A removed local-folder row takes its stored folder handle with it. */
  private async removeFolderHandle(
    provider: StoredProvider,
  ): Promise<Result<FolderHandleRemoval, StorageOperationFailure>> {
    switch (provider.type) {
      case "local-folder":
        return this.removeStoredFolderHandle(provider.handleId);
      case "local":
      case "github":
      case "oauth-file":
      case "s3":
        return storageOk(FolderHandleRemoval.NotAFolder);
    }
  }

  private async removeStoredFolderHandle(
    handleId: string,
  ): Promise<Result<FolderHandleRemoval, StorageOperationFailure>> {
    try {
      await remove_local_folder_handle(handleId);
      return storageOk(FolderHandleRemoval.Removed);
    } catch (failure) {
      return storageErr(new NativeVaultStorageFailure(failure));
    }
  }
}

export class ActiveProviderCredentialsActions {
  constructor(private readonly state: ActiveProviderCredentialsContext) {}

  /** Rust projects the draft of the provider in use: this browser, the
   * setup's own draft, or the first sync row's. */
  applyActiveProviderCredentials() {
    const state = this.state;
    const projectionArgs: ActiveProviderCredentialsRequest = {
      localVault: state.localVaultPresence,
      loginSetup: this.loginSetup(),
      syncProviders: $state.snapshot(state.syncProviders),
      current: state.providerDraft,
    };
    state.stageProviderDraft(
      active_provider_credentials_projection(projectionArgs),
    );
  }

  private loginSetup(): ActiveProviderLoginSetup {
    const setup = this.state.loginSetup;
    switch (setup.kind) {
      case LoginSetupKind.Active:
        return active_provider_login_setup(setup.providerKind);
      case LoginSetupKind.Inactive:
        return inactive_provider_login_setup();
    }
  }
}
