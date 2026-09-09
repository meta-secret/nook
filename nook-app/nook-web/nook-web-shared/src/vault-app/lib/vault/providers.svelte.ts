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
  missingOAuthAccessToken,
  OAUTH_FILE_PROVIDER_TYPE,
  oauthAccessToken,
  OAuthAccessTokenKind,
  oauthRefreshCredentialNotIssued,
  OAuthFilePresentation,
  OAuthFileNameKind,
  oauthConfigurationNotApplicable,
  personalICloudShareTarget,
  rootGoogleDriveFolder,
  saveAuthProviders,
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
  provider_wasm_args,
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
import {
  VaultDiscoveryTimeout,
  VAULT_ASSESS_TIMEOUT_ERROR_NAME,
} from "$lib/vault/vault-discovery-timeout";
import { ProviderSelectionActions } from "$lib/vault/provider-selection.svelte";

export { ProviderSelectionActions } from "$lib/vault/provider-selection.svelte";

export { ProviderConnectionActions } from "$lib/vault/provider-connection";

export { VAULT_ASSESS_TIMEOUT_ERROR_NAME };

const log = browserLogRuntime.createLogger("vault-providers");

export interface VaultConnectAssessmentRequest {
  readonly args: [string, string, string];
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

  private static takeStorageArgsTuple(
    args: NookStorageConnectArgs,
  ): [string, string, string] {
    try {
      return [args.mode, args.pat, args.repo];
    } finally {
      args.free();
    }
  }

  private stagedProviderType(): StorageProviderType {
    const state = this.state;
    return state.loginSetup.kind === LoginSetupKind.Active
      ? state.loginSetup.providerType
      : state.storageMode;
  }

  wasmStorageArgs(): [string, string, string] {
    const state = this.state;
    const syncProvider = new ProviderSelectionActions(state).syncProviders()[0];
    if (state.localVaultPresent) {
      return VaultProviderActions.takeStorageArgsTuple(
        local_vault_storage_args(),
      );
    }
    if (state.isAuthenticated && syncProvider) {
      return VaultProviderActions.takeStorageArgsTuple(
        authenticated_vault_storage_args($state.snapshot(syncProvider)),
      );
    }
    if (state.storageMode === GITHUB_PROVIDER_TYPE) {
      return VaultProviderActions.takeStorageArgsTuple(
        draft_github_storage_args(state.githubPat, state.githubRepo),
      );
    }
    if (
      state.storageMode === OAUTH_FILE_PROVIDER_TYPE &&
      state.oauthFileDraft.kind === OAuthFileDraftKind.Configured
    ) {
      return VaultProviderActions.takeStorageArgsTuple(
        draft_oauth_storage_args($state.snapshot(state.oauthFileDraft.config)),
      );
    }
    return VaultProviderActions.takeStorageArgsTuple(
      draft_local_storage_args(),
    );
  }

  static providerWasmArgs(provider: StorageProvider): [string, string, string] {
    return VaultProviderActions.takeStorageArgsTuple(
      provider_wasm_args($state.snapshot(provider)),
    );
  }

  connectStorageArgs(): [string, string, string] {
    const state = this.state;
    if (this.shouldUseJoinProviderForConnect()) {
      return VaultProviderActions.providerWasmArgs(
        new ProviderSelectionActions(state).syncProviders()[0]!,
      );
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
            args: VaultProviderActions.takeStorageArgsTuple(staged.args),
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
        ? oauthAccessToken(state.oauthFileDraft.config)
        : missingOAuthAccessToken();
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
      oauthCredential.kind === OAuthAccessTokenKind.Available
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

  syncOAuthRemoteRefFromManager(): void {
    const state = this.state;
    if (
      state.storageMode !== OAUTH_FILE_PROVIDER_TYPE ||
      !state.hasManager ||
      state.oauthFileDraft.kind !== OAuthFileDraftKind.Configured
    ) {
      return;
    }
    const updated = update_oauth_remote_ref(
      $state.snapshot(state.oauthFileDraft.config),
      ((v) => (v ? v : ""))(state.requireManager().storage_remote_ref),
    );
    try {
      if (updated.state === NookOAuthRemoteConfigurationUpdateState.Updated) {
        state.configureOauthFile(updated.config);
      }
    } finally {
      updated.free();
    }
  }

  async assessVaultConnectStatus({
    args,
  }: VaultConnectAssessmentRequest): Promise<VaultAccessStatus> {
    const state = this.state;
    if (!state.hasManager)
      throw new Error(state.t(I18N_KEYS.ErrorsEngineUnavailable));
    const manager = state.requireManager();
    return (await state.enqueueStorage(async () => {
      const assessPromise = manager.assess_vault_connect(...args);
      const startVaultDiscoveryTimeoutArgs: ConstructorParameters<
        typeof VaultDiscoveryTimeout
      >[0] = {
        message: state.t(I18N_KEYS.ToastsErrorTimeout),
        timeoutMs: 30_000,
      };
      const timeout = new VaultDiscoveryTimeout(startVaultDiscoveryTimeoutArgs);
      try {
        return await Promise.race([assessPromise, timeout.completion]);
      } finally {
        timeout.cancel();
      }
    })) as VaultAccessStatus;
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
      case RemoteVaultAssessDecision.PromptRecoveryFromCache:
        state.remoteVaultRecoveryState =
          RemoteVaultRecoveryState.PromptWithCache;
        await state.refreshPasswordEntriesList();
        return true;
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

  async loadProviders({ options }: ProviderLoad) {
    const state = this.state;
    const snapshot = await state.enqueueStorage(() =>
      options.ensureLocalRow
        ? state.requireManager().load_auth_providers_with_local_row()
        : state.requireManager().load_auth_providers_snapshot(),
    );
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
  }

  async promoteSessionVaultToLocalIfNeeded(): Promise<void> {
    const state = this.state;
    const ensureLocalAuthProviderSnapshotArgs: Parameters<
      ReturnType<
        typeof state.requireManager
      >["ensure_local_auth_provider_snapshot"]
    >[0] = {
      providers: state.providers,
      activeVaultStoreId:
        state.activeVault.kind === ActiveVaultKind.Open
          ? activeVaultScope(state.activeVault.storeId)
          : unselectedVaultScope(),
    };
    const snapshot = await state
      .requireManager()
      .ensure_local_auth_provider_snapshot(ensureLocalAuthProviderSnapshotArgs);
    if (snapshot.providers.length !== state.providers.length) {
      state.providers = snapshot.providers;
      await state.enqueueStorage(() =>
        (() => {
          const saveAuthProvidersArgs: Parameters<typeof saveAuthProviders>[0] =
            {
              manager: state.requireManager(),
              snapshot,
            };
          return saveAuthProviders(saveAuthProvidersArgs);
        })(),
      );
    }
    state.localVaultPresent = await has_local_vault();
    if (state.localVaultPresent) {
      state.storageMode = LOCAL_PROVIDER_TYPE;
      state.githubPat = "";
      state.clearOauthFile();
      state.clearLocalFolder();
    }
  }

  async persistProviders({ opts }: ProviderPersistence) {
    const state = this.state;
    if (!opts.replace && state.localVaultPresent) {
      const snapshot = await state.enqueueStorage(() =>
        state.requireManager().load_auth_providers_snapshot(),
      );
      const memoryIds = state.providers.map((p) => p.id);
      const extraSync = snapshot.providers.filter(
        (p) => p.type !== "local" && !memoryIds.includes(p.id),
      );
      if (extraSync.length > 0) {
        state.providers = [...state.providers, ...extraSync];
      }
    }
    await state.enqueueStorage(() =>
      (() => {
        const saveAuthProvidersArgs2: Parameters<typeof saveAuthProviders>[0] =
          {
            manager: state.requireManager(),
            snapshot: {
              providers: state.providers,
              activeVaultStoreId: state.hasActiveVaultStore
                ? activeVaultScope(state.requireActiveVaultStoreId())
                : unselectedVaultScope(),
            },
          };
        return saveAuthProviders(saveAuthProvidersArgs2);
      })(),
    );
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

  async removeProvider({ id }: ProviderRemoval): Promise<void> {
    const state = this.state;
    const target = state.providers.find((p) => p.id === id);
    if (!target || target.type === "local") return;

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
        await remove_local_folder_handle(folderHandle.handleId);
      }
    }
    state.providers = state.providers.filter((p) => p.id !== id);

    if (state.providers.length === 0 && state.isAuthenticated) {
      state.clearUnlockedSession();
    }

    state.applyActiveProviderCredentials();
    const persistProvidersArgs: Parameters<typeof state.persistProviders>[0] = {
      replace: true,
    };
    await state.persistProviders(persistProvidersArgs);
    log.info("sync provider removed");
    const tArgs: Parameters<typeof state.t>[0] = {
      key: I18N_KEYS.ToastsRemovedDevice,
      replacements: { label: target.label },
    };
    state.showSuccess(state.t(tArgs));
  }
}

export class ProviderPersistenceActions {
  constructor(private readonly state: ProviderSaveContext) {}

  private async providerStoreIdForSave(): Promise<
    | ReturnType<typeof scopedProviderVault>
    | ReturnType<typeof unscopedProviderVault>
  > {
    const state = this.state;
    const fromManager = state.hasManager
      ? (
          await state.enqueueStorage(() => state.requireManager().vaultStoreId)
        ).trim()
      : "";
    if (fromManager) {
      return scopedProviderVault(fromManager);
    }
    if (state.activeVault.kind === ActiveVaultKind.Open) {
      return scopedProviderVault(state.activeVault.storeId);
    }
    return state.selectedLoginVault.kind === LoginVaultSelectionKind.Selected
      ? scopedProviderVault(state.selectedLoginVault.storeId)
      : unscopedProviderVault();
  }

  async ensureProviderSaved(): Promise<boolean> {
    const state = this.state;
    const providerStoreId = await this.providerStoreIdForSave();
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
        activeVaultStoreId: state.hasActiveVaultStore
          ? activeVaultScope(state.requireActiveVaultStoreId())
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
        state.errorMsg = state.t(I18N_KEYS.AuthStorageDuplicateSyncProvider);
        return false;
      }
      if (outcome.state === NookProviderSaveOutcomeState.LocalFolderRequired) {
        state.errorMsg = state.t(I18N_KEYS.AuthStorageLocalFolderChooseErr);
        return false;
      }
      state.providers = outcome.snapshot.providers;
      if (isConfiguredOAuthFile(outcome.oauthFile)) {
        state.configureOauthFile(outcome.oauthFile.config);
      }

      state.clearLoginSetup();
      state.loginRequiresExistingVault = false;
      state.addProviderOpen = false;
      state.applyActiveProviderCredentials();
      const persistenceOptions: Parameters<typeof state.persistProviders>[0] = {
        replace: false,
      };
      await state.persistProviders(persistenceOptions);
      log.info("sync provider saved");
      return true;
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
