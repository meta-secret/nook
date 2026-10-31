import type { NookVaultManager } from "$app-wasm";
import { NativeVaultStorageFailure } from "$lib/runtime/storage-failure";
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
  DEFAULT_DRIVE_BACKUP_NAME,
  DEFAULT_GITHUB_REPO,
  activeVaultScope,
  configuredLocalFolder,
  configuredOAuthFile,
  GITHUB_PROVIDER_TYPE,
  LOCAL_PROVIDER_TYPE,
  LOCAL_FOLDER_PROVIDER_TYPE,
  LocalFolderPresentation,
  LocalFolderHandleKind,
  StorageProviderPresentation,
  LocalFolderProviderConfigurationKind,
  localFolderConfigurationNotApplicable,
  decodeStoredOAuthFileConfiguration,
  StoredOAuthFileConfigurationDecodeKind,
  decodeStoredLocalFolderConfiguration,
  StoredLocalFolderConfigurationDecodeKind,
  missing_oauth_access_token,
  OAUTH_FILE_PROVIDER_TYPE,
  oauth_access_token,
  oauthRefreshCredentialNotIssued,
  OAuthFilePresentation,
  OAuthFileNameKind,
  oauthConfigurationNotApplicable,
  unboundICloudShareTarget,
  rootGoogleDriveFolder,
  signedOutOAuthCredential,
  storedOAuthRemoteFileName,
  unselectedVaultScope,
  unknownOAuthAccountIdentity,
  unknownOAuthTokenExpiry,
  unresolvedOAuthRemoteFileId,
  type LocalFolderHandle,
  type ProviderSetupRequest,
  type StorageProvider,
  type StorageProviderType,
} from "$lib/auth/providers";
import {
  active_provider_login_setup,
  active_provider_credentials_projection_draft,
  active_provider_credentials_projection,
  active_provider_credentials_projection_state,
  authenticated_vault_storage_args,
  draft_github_storage_args,
  draft_local_storage_args,
  draft_oauth_storage_args,
  has_github_credentials,
  has_local_vault,
  has_local_folder_credentials,
  has_oauth_credentials,
  inactive_provider_login_setup,
  NookActiveProviderCredentialsProjectionState,
  NookOAuthRemoteConfigurationUpdateState,
  NookStagedStorageArgsState,
  remove_local_folder_handle,
  RemoteVaultAssessDecision,
  RemoteVaultRecoveryState,
  staged_configured_oauth_provider_label,
  staged_github_provider_label,
  staged_local_provider_label,
  staged_github_remote_storage_args,
  staged_local_remote_storage_args,
  staged_oauth_remote_storage_args,
  staged_unconfigured_oauth_provider_label,
  update_oauth_remote_ref,
  local_vault_storage_args,
  type NookStorageConnectArgs,
  type ActiveProviderCredentialsRequest,
  type AuthProvidersSnapshot,
} from "$app-wasm";
import { browserLogRuntime } from "$lib/runtime/log";
import {
  ActiveVaultKind,
  LocalFolderDraftKind,
  LoginVaultSelectionKind,
  LoginSetupKind,
  OAuthFileDraftKind,
  OAuthSetupPresetKind,
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
  readonly args: NookStorageConnectArgs;
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
  readonly providers?: StorageProvider[];
}

export interface ProviderPersistence {
  readonly opts: ProviderPersistenceOptions;
}

export interface ProviderSetup {
  readonly request: ProviderSetupRequest;
}

export interface ProviderRemoval {
  readonly id: string;
}

export enum ProviderPersistenceOutcome {
  Persisted = "persisted",
}

export enum OAuthRemoteReferenceSyncKind {
  NotApplicable = "not-applicable",
  Unchanged = "unchanged",
  Updated = "updated",
}

export type OAuthRemoteReferenceSyncOutcome =
  | { readonly kind: OAuthRemoteReferenceSyncKind.NotApplicable }
  | { readonly kind: OAuthRemoteReferenceSyncKind.Unchanged }
  | { readonly kind: OAuthRemoteReferenceSyncKind.Updated };

export type PromotedProviderSnapshot = {
  readonly snapshot: AuthProvidersSnapshot;
  readonly localVaultPresent: boolean;
};

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

  private stagedProviderType(): StorageProviderType {
    const state = this.state;
    return state.loginSetup.kind === LoginSetupKind.Active
      ? state.loginSetup.providerType
      : state.storageMode;
  }

  wasmStorageArgs(): NookStorageConnectArgs {
    const state = this.state;
    const syncProvider = new ProviderSelectionActions(state).syncProviders()[0];
    if (state.localVaultPresent) {
      return local_vault_storage_args();
    }
    if (state.isAuthenticated && syncProvider) {
      return authenticated_vault_storage_args($state.snapshot(syncProvider));
    }
    if (state.storageMode === GITHUB_PROVIDER_TYPE) {
      return draft_github_storage_args(state.githubPat, state.githubRepo);
    }
    if (
      state.storageMode === OAUTH_FILE_PROVIDER_TYPE &&
      state.oauthFileDraft.kind === OAuthFileDraftKind.Configured
    ) {
      return draft_oauth_storage_args(
        $state.snapshot(state.oauthFileDraft.config),
      );
    }
    return draft_local_storage_args();
  }

  connectStorageArgs(): NookStorageConnectArgs {
    const state = this.state;
    if (this.shouldUseJoinProviderForConnect()) {
      const [syncProvider] = new ProviderSelectionActions(
        state,
      ).syncProviders();
      if (!syncProvider) return this.wasmStorageArgs();
      return new StorageProviderPresentation(
        $state.snapshot(syncProvider),
      ).storageArgs();
    }
    return this.wasmStorageArgs();
  }

  shouldUseJoinProviderForConnect(): boolean {
    const state = this.state;
    return state.clientPolicy.should_use_join_provider_for_connect(
      state.isAuthenticated,
      new ProviderSelectionActions(state).syncProviders().length,
      state.joinEnrollmentPrompt,
    );
  }

  stagedRemoteStorageArgs(): StagedRemoteStorage {
    const state = this.state;
    const type = this.stagedProviderType();
    const staged =
      type === GITHUB_PROVIDER_TYPE
        ? staged_github_remote_storage_args(state.githubPat, state.githubRepo)
        : type === OAUTH_FILE_PROVIDER_TYPE &&
            state.oauthFileDraft.kind === OAuthFileDraftKind.Configured
          ? staged_oauth_remote_storage_args(
              $state.snapshot(state.oauthFileDraft.config),
            )
          : staged_local_remote_storage_args();
    try {
      return staged.state === NookStagedStorageArgsState.Ready
        ? {
            kind: StagedRemoteStorageKind.Available,
            args: staged.args,
          }
        : { kind: StagedRemoteStorageKind.Unavailable };
    } finally {
      staged.free();
    }
  }

  stagedProviderLabel(): string {
    const state = this.state;
    const providerType = this.stagedProviderType();
    if (providerType === "github") {
      return staged_github_provider_label(state.githubRepo);
    }
    if (providerType === "oauth-file") {
      if (state.oauthFileDraft.kind === OAuthFileDraftKind.Configured) {
        const oauthFile = state.oauthFileDraft.config;
        const remoteFileName = new OAuthFilePresentation(
          oauthFile,
        ).oauthFileName();
        return staged_configured_oauth_provider_label(
          remoteFileName.kind === OAuthFileNameKind.Resolved
            ? remoteFileName.fileName
            : DEFAULT_DRIVE_BACKUP_NAME,
          oauthFile.preset,
        );
      }
      return state.oauthSetupSelection.kind === OAuthSetupPresetKind.Selected
        ? staged_configured_oauth_provider_label(
            "",
            state.oauthSetupSelection.preset,
          )
        : staged_unconfigured_oauth_provider_label();
    }
    return staged_local_provider_label(providerType);
  }

  hasRemoteProviderCredentials(): boolean {
    const state = this.state;
    const oauthCredential =
      state.oauthFileDraft.kind === OAuthFileDraftKind.Configured
        ? oauth_access_token(state.oauthFileDraft.config)
        : missing_oauth_access_token();
    const folderHandle: LocalFolderHandle =
      state.localFolderDraft.kind === LocalFolderDraftKind.Configured
        ? new LocalFolderPresentation(
            state.localFolderDraft.config,
          ).localFolderHandle()
        : { kind: LocalFolderHandleKind.Unselected };
    if (state.storageMode === GITHUB_PROVIDER_TYPE) {
      return has_github_credentials(state.githubPat);
    }
    if (
      state.storageMode === OAUTH_FILE_PROVIDER_TYPE &&
      oauthCredential.kind === "available"
    ) {
      return has_oauth_credentials(oauthCredential.token);
    }
    if (
      state.storageMode === LOCAL_FOLDER_PROVIDER_TYPE &&
      folderHandle.kind === LocalFolderHandleKind.Selected
    ) {
      return has_local_folder_credentials(folderHandle.handleId);
    }
    return state.storageMode === LOCAL_PROVIDER_TYPE;
  }

  syncOAuthRemoteRefFromManager(): Result<
    OAuthRemoteReferenceSyncOutcome,
    StorageOperationFailure
  > {
    const state = this.state;
    const draft = state.oauthFileDraft;
    if (
      state.storageMode !== OAUTH_FILE_PROVIDER_TYPE ||
      draft.kind !== OAuthFileDraftKind.Configured
    ) {
      const outcome: OAuthRemoteReferenceSyncOutcome = {
        kind: OAuthRemoteReferenceSyncKind.NotApplicable,
      };
      return storageOk(outcome);
    }
    const manager = state.admitManager();
    if (manager.isErr()) return storageErr(manager.error);
    let updated: ReturnType<typeof update_oauth_remote_ref>;
    try {
      updated = update_oauth_remote_ref(
        $state.snapshot(draft.config),
        manager.value.storage_remote_ref,
      );
    } catch (failure) {
      return storageErr(new NativeVaultStorageFailure(failure));
    }
    try {
      let config: typeof draft.config;
      try {
        if (updated.state !== NookOAuthRemoteConfigurationUpdateState.Updated) {
          const outcome: OAuthRemoteReferenceSyncOutcome = {
            kind: OAuthRemoteReferenceSyncKind.Unchanged,
          };
          return storageOk(outcome);
        }
        config = updated.config;
      } catch (failure) {
        return storageErr(new NativeVaultStorageFailure(failure));
      }
      state.configureOauthFile(config);
      const outcome: OAuthRemoteReferenceSyncOutcome = {
        kind: OAuthRemoteReferenceSyncKind.Updated,
      };
      return storageOk(outcome);
    } finally {
      updated.free();
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
          return storageOk(
            await admitted.value.assess_vault_connect(
              args.mode,
              args.pat,
              args.repo,
            ),
          );
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
      state.storageMode = LOCAL_PROVIDER_TYPE;
      state.githubPat = "";
      state.clearOauthFile();
      state.clearLocalFolder();
    }
    return storageOk(promoted.value);
  }

  async persistProviders({ opts }: ProviderPersistence) {
    const state = this.state;
    const request: Parameters<
      NookVaultManager["persist_auth_providers_snapshot"]
    >[0] = {
      snapshot: {
        providers: opts.providers ? opts.providers : state.providers,
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

  beginProviderSetup({ request }: ProviderSetup) {
    const state = this.state;
    const { type } = request;
    if (!state.isAuthenticated) {
      state.resetVaultSessionState();
    }
    state.activateLoginSetup(type);
    state.storageMode = type;
    state.githubPat = "";
    state.githubRepo =
      type === "oauth-file" ? DEFAULT_DRIVE_BACKUP_NAME : DEFAULT_GITHUB_REPO;
    if (type === "oauth-file") {
      const preset = request.oauthPreset;
      if (preset === "icloud") {
        this.resetICloudSignInState();
      }
      state.selectOauthSetupPreset(preset);
      const configureOauthFileArgs: Parameters<
        typeof state.configureOauthFile
      >[0] = {
        preset,
        accessToken: signedOutOAuthCredential(),
        refreshToken: oauthRefreshCredentialNotIssued(),
        expiresAt: unknownOAuthTokenExpiry(),
        fileId: unresolvedOAuthRemoteFileId(),
        fileName: storedOAuthRemoteFileName(DEFAULT_DRIVE_BACKUP_NAME),
        accountEmail: unknownOAuthAccountIdentity(),
        folderId: rootGoogleDriveFolder(),
        iCloudShareTarget: unboundICloudShareTarget(),
      };
      state.configureOauthFile(configureOauthFileArgs);
    } else {
      state.clearOauthSetupPreset();
      state.clearOauthFile();
    }
    state.clearLocalFolder();
    state.clearExistingVaultRecoverySummary();
    state.errorMsg = "";
    state.dismissSuccess();
    log.debug("provider setup started");
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
    state.remoteVaultChoices = [];
    if (
      state.addProviderOpen &&
      state.loginSetup.kind === LoginSetupKind.Active
    ) {
      const setupType = state.loginSetup.providerType;
      state.clearLoginSetup();
      state.githubPat = "";
      state.githubRepo =
        setupType === "oauth-file"
          ? DEFAULT_DRIVE_BACKUP_NAME
          : DEFAULT_GITHUB_REPO;
      state.clearLocalFolder();
      state.clearExistingVaultRecoverySummary();
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
    if (target.type === "local") {
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
    const folderConfiguration = new StorageProviderPresentation(
      target,
    ).localFolderProviderConfiguration();
    if (
      folderConfiguration.kind ===
      LocalFolderProviderConfigurationKind.Configured
    ) {
      const folderHandle = new LocalFolderPresentation(
        folderConfiguration.config,
      ).localFolderHandle();
      if (folderHandle.kind === LocalFolderHandleKind.Selected) {
        try {
          await remove_local_folder_handle(folderHandle.handleId);
        } catch (failure) {
          return storageErr(new NativeVaultStorageFailure(failure));
        }
      }
    }
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
}

export class ActiveProviderCredentialsActions {
  constructor(private readonly state: ActiveProviderCredentialsContext) {}

  applyActiveProviderCredentials() {
    const state = this.state;
    const currentOauthFile =
      state.oauthFileDraft.kind === OAuthFileDraftKind.Configured
        ? configuredOAuthFile($state.snapshot(state.oauthFileDraft.config))
        : oauthConfigurationNotApplicable();
    const currentLocalFolder =
      state.localFolderDraft.kind === LocalFolderDraftKind.Configured
        ? configuredLocalFolder($state.snapshot(state.localFolderDraft.config))
        : localFolderConfigurationNotApplicable();
    const loginSetup =
      state.loginSetup.kind === LoginSetupKind.Active
        ? active_provider_login_setup(state.loginSetup.providerType)
        : inactive_provider_login_setup();
    const projectionArgs: ActiveProviderCredentialsRequest = {
      localVaultPresent: state.localVaultPresent,
      loginSetup,
      syncProviders: $state.snapshot(state.syncProviders),
      currentStorageMode: state.storageMode,
      currentGithubPat: state.githubPat,
      currentGithubRepo: state.githubRepo,
      currentOauthFile,
      currentLocalFolder,
    };
    const projection = active_provider_credentials_projection(projectionArgs);
    if (
      active_provider_credentials_projection_state(projection) ===
      NookActiveProviderCredentialsProjectionState.Unchanged
    ) {
      return;
    }
    const draft = active_provider_credentials_projection_draft(projection);
    state.storageMode = draft.storageMode;
    state.githubPat = draft.githubPat;
    state.githubRepo = draft.githubRepo;
    const oauthFileConfiguration = decodeStoredOAuthFileConfiguration(
      draft.oauthFile,
    );
    if (
      oauthFileConfiguration.kind ===
      StoredOAuthFileConfigurationDecodeKind.Configured
    ) {
      state.configureOauthFile(oauthFileConfiguration.config);
    } else {
      state.clearOauthFile();
    }
    const localFolderConfiguration = decodeStoredLocalFolderConfiguration(
      draft.localFolder,
    );
    if (
      localFolderConfiguration.kind ===
      StoredLocalFolderConfigurationDecodeKind.Configured
    ) {
      state.configureLocalFolder(localFolderConfiguration.config);
    } else {
      state.clearLocalFolder();
    }
  }
}
