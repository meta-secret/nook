import type { NookVaultManager } from "$app-wasm";
import { NativeVaultStorageFailure } from "$lib/runtime/storage-failure";
import { err as storageErr, ok as storageOk, type Result } from "neverthrow";
import {
  VaultStorageFailure as StorageOperationFailure,
  VaultStorageFailureKind as StorageOperationFailureKind,
} from "$lib/runtime/storage-failure";
import { I18N_KEYS } from "../../../generated/i18n-keys";

/** Provider actions that snapshot reactive Svelte state at WASM boundaries. */
import type {
  ActiveProviderCredentialsContext,
  ProviderActionsContext,
  ProviderSaveContext,
} from "$lib/vault/action-contexts";
import { generate_id, isoTimestamp, type VaultAccessStatus } from "$lib/nook";
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
  isConfiguredOAuthFile,
  isConfiguredLocalFolder,
  missing_oauth_access_token,
  OAUTH_FILE_PROVIDER_TYPE,
  oauth_access_token,
  oauthRefreshCredentialNotIssued,
  OAuthFilePresentation,
  OAuthFileNameKind,
  oauthConfigurationNotApplicable,
  personalICloudShareTarget,
  rootGoogleDriveFolder,
  signedOutOAuthCredential,
  storedOAuthRemoteFileName,
  scopedProviderVault,
  unscopedProviderVault,
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
  apply_provider_save_policy,
  active_provider_login_setup,
  active_provider_credentials_projection_draft,
  active_provider_credentials_projection,
  active_provider_credentials_projection_state,
  authenticated_vault_storage_args,
  draft_github_storage_args,
  draft_local_storage_args,
  draft_oauth_storage_args,
  existing_provider_save_setup,
  has_github_credentials,
  has_local_vault,
  has_local_folder_credentials,
  has_oauth_credentials,
  inactive_provider_login_setup,
  new_provider_save_setup,
  NookProviderSaveOutcomeState,
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
  type ProviderSaveRequest,
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

const log = browserLogRuntime.createLogger("vault-providers");

export interface VaultConnectAssessmentRequest {
  readonly args: NookStorageConnectArgs;
}

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
      return new StorageProviderPresentation(
        $state.snapshot(
          new ProviderSelectionActions(state).syncProviders()[0]!,
        ),
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

  syncOAuthRemoteRefFromManager(): Result<void, StorageOperationFailure> {
    const state = this.state;
    const draft = state.oauthFileDraft;
    if (
      state.storageMode !== OAUTH_FILE_PROVIDER_TYPE ||
      draft.kind !== OAuthFileDraftKind.Configured
    )
      return storageOk();
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
        if (updated.state !== NookOAuthRemoteConfigurationUpdateState.Updated)
          return storageOk();
        config = updated.config;
      } catch (failure) {
        return storageErr(new NativeVaultStorageFailure(failure));
      }
      state.configureOauthFile(config);
      return storageOk();
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
      const operation = (async () => {
        try {
          return storageOk(
            await admitted.value.assess_vault_connect(
              args.mode,
              args.pat,
              args.repo,
            ),
          );
        } catch (nativeFailure) {
          return storageErr(new NativeVaultStorageFailure(nativeFailure));
        }
      })();
      // eslint-disable-next-line nook-typed-api/no-raw-object-arguments, nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
      return new VaultDiscoveryTimeout({ timeoutMs: 30_000 }).waitFor({
        operation,
        releaseLateValue: () => {},
      });
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
    state.providers = snapshot.providers.map((p) =>
      p.label === "GitHub sync" ? { ...p, label: "GitHub" } : p,
    );
    if (state.selectedLoginVault.kind === LoginVaultSelectionKind.Selected) {
      state.openActiveVault(state.selectedLoginVault.storeId);
    } else if (snapshot.activeVaultStoreId.state === "storeId") {
      state.openActiveVault(snapshot.activeVaultStoreId.value);
    }
    state.providersLoaded = true;
    log.debug("providers loaded");
    return storageOk();
  }

  async promoteSessionVaultToLocalIfNeeded(): Promise<
    Result<void, StorageOperationFailure>
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
        // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
        return storageOk({ snapshot, localVaultPresent });
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
    return storageOk();
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
    return storageOk();
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
        driveMode: "private",
        folderId: rootGoogleDriveFolder(),
        iCloudMode: "private",
        iCloudShareTarget: personalICloudShareTarget(),
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
  }: ProviderRemoval): Promise<Result<void, StorageOperationFailure>> {
    const state = this.state;
    const target = state.providers.find((p) => p.id === id);
    if (!target || target.type === "local") return storageOk();

    // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
    const persistence = await state.persistProviders({
      replace: true,
      providers: state.providers.filter((provider) => provider.id !== id),
    });
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
    return storageOk();
  }
}

export class ProviderPersistenceActions {
  constructor(private readonly state: ProviderSaveContext) {}

  private async providerStoreIdForSave(): Promise<
    Result<
      | ReturnType<typeof scopedProviderVault>
      | ReturnType<typeof unscopedProviderVault>,
      StorageOperationFailure
    >
  > {
    const state = this.state;
    if (!state.hasManager)
      return storageOk(
        state.selectedLoginVault.kind === LoginVaultSelectionKind.Selected
          ? scopedProviderVault(state.selectedLoginVault.storeId)
          : unscopedProviderVault(),
      );
    const storeId = await state.enqueueStorage(async () => {
      const manager = state.admitManager();
      if (manager.isErr()) return storageErr(manager.error);
      try {
        return storageOk(manager.value.vaultStoreId.trim());
      } catch (failure) {
        return storageErr(new NativeVaultStorageFailure(failure));
      }
    });
    if (storeId.isErr()) return storageErr(storeId.error);
    if (storeId.value) return storageOk(scopedProviderVault(storeId.value));
    return storageOk(
      state.selectedLoginVault.kind === LoginVaultSelectionKind.Selected
        ? scopedProviderVault(state.selectedLoginVault.storeId)
        : unscopedProviderVault(),
    );
  }

  async ensureProviderSaved(): Promise<Result<void, StorageOperationFailure>> {
    const state = this.state;
    const scope = await this.providerStoreIdForSave();
    if (scope.isErr()) return storageErr(scope.error);
    const providerStoreId = scope.value;
    const oauthFile =
      state.oauthFileDraft.kind === OAuthFileDraftKind.Configured
        ? configuredOAuthFile($state.snapshot(state.oauthFileDraft.config))
        : oauthConfigurationNotApplicable();
    const localFolder =
      state.localFolderDraft.kind === LocalFolderDraftKind.Configured
        ? configuredLocalFolder($state.snapshot(state.localFolderDraft.config))
        : localFolderConfigurationNotApplicable();
    const oauthPreset =
      state.oauthFileDraft.kind === OAuthFileDraftKind.Configured
        ? state.oauthFileDraft.config.preset
        : state.oauthSetupSelection.kind === OAuthSetupPresetKind.Selected
          ? state.oauthSetupSelection.preset
          : "google-drive";
    const setup =
      state.loginSetup.kind === LoginSetupKind.Active
        ? new_provider_save_setup(state.loginSetup.providerType)
        : existing_provider_save_setup();
    const request: ProviderSaveRequest = {
      snapshot: {
        providers: $state.snapshot(state.providers),
        activeVaultStoreId:
          state.activeVault.kind === ActiveVaultKind.Open
            ? activeVaultScope(state.activeVault.storeId)
            : unselectedVaultScope(),
      },
      providerStoreId,
      storageMode: state.storageMode,
      setup,
      explicitAdd:
        state.addProviderOpen ||
        (state.isAuthenticated &&
          state.loginSetup.kind === LoginSetupKind.Active),
      githubPat: state.githubPat,
      githubRepo: state.githubRepo,
      oauthFile,
      oauthPreset,
      localFolder,
      newProviderId: generate_id(),
      createdAt: isoTimestamp(),
    };
    const outcome = apply_provider_save_policy(request);
    try {
      if (outcome.state === NookProviderSaveOutcomeState.Duplicate) {
        return storageErr(
          new StorageOperationFailure(
            StorageOperationFailureKind.DuplicateProvider,
          ),
        );
      }
      if (outcome.state === NookProviderSaveOutcomeState.LocalFolderRequired) {
        return storageErr(
          new StorageOperationFailure(
            StorageOperationFailureKind.LocalFolderRequired,
          ),
        );
      }
      // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
      const persistence = await state.persistProviders({
        replace: false,
        providers: outcome.snapshot.providers,
      });
      if (persistence.isErr()) {
        return storageErr(persistence.error);
      }
      if (isConfiguredOAuthFile(outcome.oauthFile)) {
        state.configureOauthFile(outcome.oauthFile.config);
      }
      state.clearLoginSetup();
      state.loginRequiresExistingVault = false;
      state.addProviderOpen = false;
      state.applyActiveProviderCredentials();
      log.info("sync provider saved");
      return storageOk();
    } finally {
      outcome.free();
    }
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
    if (isConfiguredOAuthFile(draft.oauthFile)) {
      state.configureOauthFile(draft.oauthFile.config);
    } else {
      state.clearOauthFile();
    }
    if (isConfiguredLocalFolder(draft.localFolder)) {
      state.configureLocalFolder(draft.localFolder.config);
    } else {
      state.clearLocalFolder();
    }
  }
}
