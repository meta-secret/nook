import { I18N_KEYS } from "../../../generated/i18n-keys";
/** Provider actions that snapshot reactive Svelte state at WASM boundaries. */
import type {
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
  githubPatValue,
  githubRepositoryValue,
  LOCAL_PROVIDER_TYPE,
  LOCAL_FOLDER_PROVIDER_TYPE,
  localFolderHandle,
  LocalFolderHandleKind,
  localFolderProviderConfiguration,
  LocalFolderProviderConfigurationKind,
  localFolderConfigurationNotApplicable,
  isConfiguredOAuthFile,
  missingOAuthAccessToken,
  OAUTH_FILE_PROVIDER_TYPE,
  oauthAccessToken,
  OAuthAccessTokenKind,
  oauthRefreshCredentialNotIssued,
  oauthFileName,
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
  type OAuthFileName,
  type ProviderSetupRequest,
  type StorageProvider,
  type StorageProviderType,
} from "$lib/auth/providers";
import {
  apply_provider_save_policy,
  authenticated_vault_storage_args,
  draft_github_storage_args,
  draft_local_storage_args,
  draft_oauth_storage_args,
  ensure_local_provider_row,
  existing_provider_save_setup,
  has_github_credentials,
  has_local_vault,
  has_local_folder_credentials,
  has_oauth_credentials,
  new_provider_save_setup,
  NookProviderSaveOutcomeState,
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
  type ProviderSaveRequest,
} from "$app-wasm";
import { createLogger } from "$lib/runtime/log";
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
  startVaultDiscoveryTimeout,
  VAULT_ASSESS_TIMEOUT_ERROR_NAME,
} from "$lib/vault/vault-discovery-timeout";
import { syncProviders } from "$lib/vault/provider-selection.svelte";
export {
  activeProviders,
  chooseLocalFolder,
  localProvider,
  refreshLocalFolderBackupSupport,
  showLoginVaultPicker,
  syncProviders,
} from "$lib/vault/provider-selection.svelte";
export {
  connectAndSyncStagedProvider,
  connectStagedProvider,
  discoverStagedVaultStoreId,
} from "$lib/vault/provider-connection";
enum ProviderSaveStoreIdKind {
  Unavailable = "unavailable",
  Available = "available",
}

type ProviderSaveStoreId =
  | { kind: ProviderSaveStoreIdKind.Unavailable }
  | { kind: ProviderSaveStoreIdKind.Available; storeId: string };

export { VAULT_ASSESS_TIMEOUT_ERROR_NAME };

const log = createLogger("vault-providers");

function takeStorageArgsTuple(
  args: NookStorageConnectArgs,
): [string, string, string] {
  try {
    return [args.mode, args.pat, args.repo];
  } finally {
    args.free();
  }
}

function stagedProviderType(
  state: ProviderActionsContext,
): StorageProviderType {
  return state.loginSetup.kind === LoginSetupKind.Active
    ? state.loginSetup.providerType
    : state.storageMode;
}

export function wasmStorageArgs(
  state: ProviderActionsContext,
): [string, string, string] {
  const syncProvider = syncProviders(state)[0];
  if (state.localVaultPresent) {
    return takeStorageArgsTuple(local_vault_storage_args());
  }
  if (state.isAuthenticated && syncProvider) {
    return takeStorageArgsTuple(
      authenticated_vault_storage_args($state.snapshot(syncProvider)),
    );
  }
  if (state.storageMode === GITHUB_PROVIDER_TYPE) {
    return takeStorageArgsTuple(
      draft_github_storage_args(state.githubPat, state.githubRepo),
    );
  }
  if (
    state.storageMode === OAUTH_FILE_PROVIDER_TYPE &&
    state.oauthFileDraft.kind === OAuthFileDraftKind.Configured
  ) {
    return takeStorageArgsTuple(
      draft_oauth_storage_args($state.snapshot(state.oauthFileDraft.config)),
    );
  }
  return takeStorageArgsTuple(draft_local_storage_args());
}

export function providerWasmArgs(
  provider: StorageProvider,
): [string, string, string] {
  return takeStorageArgsTuple(provider_wasm_args($state.snapshot(provider)));
}

export function connectStorageArgs(
  state: ProviderActionsContext,
): [string, string, string] {
  if (shouldUseJoinProviderForConnect(state)) {
    return providerWasmArgs(syncProviders(state)[0]!);
  }
  return wasmStorageArgs(state);
}

export function shouldUseJoinProviderForConnect(
  state: ProviderActionsContext,
): boolean {
  return state.clientPolicy.should_use_join_provider_for_connect(
    state.isAuthenticated,
    syncProviders(state).length,
    state.joinEnrollmentPrompt,
  );
}

export function stagedRemoteStorageArgs(
  state: ProviderActionsContext,
): StagedRemoteStorage {
  const type = stagedProviderType(state);
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
          args: takeStorageArgsTuple(staged.args),
        }
      : { kind: StagedRemoteStorageKind.Unavailable };
  } finally {
    staged.free();
  }
}

export function stagedProviderLabel(state: ProviderActionsContext): string {
  const providerType = stagedProviderType(state);
  if (providerType === "github") {
    return staged_github_provider_label(state.githubRepo);
  }
  if (providerType === "oauth-file") {
    if (state.oauthFileDraft.kind === OAuthFileDraftKind.Configured) {
      const oauthFile = state.oauthFileDraft.config;
      const remoteFileName = oauthFileName(oauthFile);
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

export function hasRemoteProviderCredentials(
  state: ProviderActionsContext,
): boolean {
  const oauthCredential =
    state.oauthFileDraft.kind === OAuthFileDraftKind.Configured
      ? oauthAccessToken(state.oauthFileDraft.config)
      : missingOAuthAccessToken();
  const folderHandle: LocalFolderHandle =
    state.localFolderDraft.kind === LocalFolderDraftKind.Configured
      ? localFolderHandle(state.localFolderDraft.config)
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

export function syncOAuthRemoteRefFromManager(
  state: ProviderActionsContext,
): void {
  if (
    state.storageMode !== OAUTH_FILE_PROVIDER_TYPE ||
    !state.hasManager ||
    state.oauthFileDraft.kind !== OAuthFileDraftKind.Configured
  ) {
    return;
  }
  const updated = update_oauth_remote_ref(
    $state.snapshot(state.oauthFileDraft.config),
    state.requireManager().storage_remote_ref ?? "",
  );
  try {
    if (updated.state === NookOAuthRemoteConfigurationUpdateState.Updated) {
      state.configureOauthFile(updated.config);
    }
  } finally {
    updated.free();
  }
}

export async function assessVaultConnectStatus({
  state,
  args,
}: {
  readonly state: ProviderActionsContext;
  readonly args: [string, string, string];
}): Promise<VaultAccessStatus> {
  if (!state.hasManager)
    throw new Error(state.t(I18N_KEYS.ErrorsEngineUnavailable));
  const manager = state.requireManager();
  return (await state.enqueueStorage(async () => {
    const assessPromise = manager.assess_vault_connect(...args);
    const startVaultDiscoveryTimeoutArgs: Parameters<
      typeof startVaultDiscoveryTimeout
    >[0] = {
      message: state.t(I18N_KEYS.ToastsErrorTimeout),
      timeoutMs: 30_000,
    };
    const timeout = startVaultDiscoveryTimeout(startVaultDiscoveryTimeoutArgs);
    try {
      return await Promise.race([assessPromise, timeout.completion]);
    } finally {
      timeout.cancel();
    }
  })) as VaultAccessStatus;
}

export async function handleRemoteVaultAssessStatus({
  state,
  accessStatus,
}: {
  readonly state: ProviderActionsContext;
  readonly accessStatus: VaultAccessStatus;
}): Promise<boolean> {
  const decision = state.clientPolicy.remote_vault_assess_decision(
    accessStatus,
    state.loginRequiresExistingVault,
    state.loginSetup.kind === LoginSetupKind.Active,
  );
  switch (decision) {
    case RemoteVaultAssessDecision.PromptRecoveryFromCache:
      state.remoteVaultRecoveryState = RemoteVaultRecoveryState.PromptWithCache;
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

/** Store id for persisting a sync provider row before or after wasm connect. */
async function vaultStoreIdForProviderSave(
  state: ProviderSaveContext,
): Promise<ProviderSaveStoreId> {
  const fromManager = state.hasManager
    ? (
        await state.enqueueStorage(() => state.requireManager().vaultStoreId)
      ).trim()
    : "";
  if (fromManager) {
    return { kind: ProviderSaveStoreIdKind.Available, storeId: fromManager };
  }
  if (state.activeVault.kind === ActiveVaultKind.Open) {
    return {
      kind: ProviderSaveStoreIdKind.Available,
      storeId: state.activeVault.storeId,
    };
  }
  return state.selectedLoginVault.kind === LoginVaultSelectionKind.Selected
    ? {
        kind: ProviderSaveStoreIdKind.Available,
        storeId: state.selectedLoginVault.storeId,
      }
    : { kind: ProviderSaveStoreIdKind.Unavailable };
}

function resetICloudSignInState(state: ProviderActionsContext) {
  state.icloudOAuthPreparing = false;
  state.icloudOAuthReady = false;
  state.icloudOAuthBusy = false;
}

export async function loadProviders({
  state,
  options,
}: {
  readonly state: ProviderActionsContext;
  readonly options?: { ensureLocalRow?: boolean };
}) {
  const snapshot = await state.enqueueStorage(() =>
    options?.ensureLocalRow
      ? state.requireManager().load_auth_providers_with_local_row()
      : state.requireManager().load_auth_providers_snapshot(),
  );
  state.providers = snapshot.providers.map((p) =>
    p.label === "GitHub sync" ? { ...p, label: "GitHub" } : p,
  );
  if (snapshot.activeVaultStoreId.state === "storeId") {
    state.openActiveVault(snapshot.activeVaultStoreId.value);
  }
  state.providersLoaded = true;
  log.debug("providers loaded");
}

export async function promoteSessionVaultToLocalIfNeeded(
  state: ProviderActionsContext,
): Promise<void> {
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
        const saveAuthProvidersArgs: Parameters<typeof saveAuthProviders>[0] = {
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

export function applyActiveProviderCredentials(state: ProviderActionsContext) {
  if (state.localVaultPresent) {
    state.storageMode = "local";
    state.githubPat = "";
    state.clearOauthFile();
    state.clearLocalFolder();
    return;
  }

  if (state.loginSetup.kind === LoginSetupKind.Active) {
    const setupType = state.loginSetup.providerType;
    state.storageMode = setupType;
    if (setupType !== "github") {
      state.githubPat = "";
    }
    if (setupType !== "oauth-file") {
      state.clearOauthFile();
    }
    if (setupType !== "local-folder") {
      state.clearLocalFolder();
    }
    return;
  }

  const syncProvider = state.syncProviders[0];
  if (!syncProvider) {
    return;
  }

  state.storageMode = syncProvider.type;
  state.githubPat = githubPatValue(syncProvider.githubPat);
  if (syncProvider.type === "oauth-file") {
    const oauthConfiguration = syncProvider.oauthFile;
    if (isConfiguredOAuthFile(oauthConfiguration)) {
      state.configureOauthFile(oauthConfiguration.config);
    } else {
      state.clearOauthFile();
    }
    state.clearLocalFolder();
    const remoteFileName: OAuthFileName = isConfiguredOAuthFile(
      oauthConfiguration,
    )
      ? oauthFileName(oauthConfiguration.config)
      : { kind: OAuthFileNameKind.Unresolved };
    state.githubRepo =
      remoteFileName.kind === OAuthFileNameKind.Resolved
        ? remoteFileName.fileName
        : DEFAULT_DRIVE_BACKUP_NAME;
  } else if (syncProvider.type === "local-folder") {
    const localFolderConfiguration =
      localFolderProviderConfiguration(syncProvider);
    if (
      localFolderConfiguration.kind ===
      LocalFolderProviderConfigurationKind.Configured
    ) {
      state.configureLocalFolder(localFolderConfiguration.config);
    } else {
      state.clearLocalFolder();
    }
    state.githubRepo = DEFAULT_GITHUB_REPO;
    state.clearOauthFile();
  } else {
    state.githubRepo =
      githubRepositoryValue(syncProvider.githubRepo) || DEFAULT_GITHUB_REPO;
    state.clearOauthFile();
    state.clearLocalFolder();
  }
}

export async function persistProviders({
  state,
  opts,
}: {
  readonly state: ProviderActionsContext;
  readonly opts?: { replace?: boolean };
}) {
  if (!opts?.replace && state.localVaultPresent) {
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
      const saveAuthProvidersArgs2: Parameters<typeof saveAuthProviders>[0] = {
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

export function beginProviderSetup({
  state,
  request,
}: {
  readonly state: ProviderActionsContext;
  readonly request: ProviderSetupRequest;
}) {
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
      resetICloudSignInState(state);
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

export function beginAddProvider(state: ProviderActionsContext) {
  if (!state.isAuthenticated) {
    state.resetVaultSessionState();
  }
  state.addProviderOpen = true;
  state.clearLoginSetup();
  state.errorMsg = "";
}

export function cancelAddProvider(state: ProviderActionsContext) {
  resetICloudSignInState(state);
  state.addProviderOpen = false;
  state.clearLoginSetup();
  state.clearExistingVaultRecoverySummary();
  state.applyActiveProviderCredentials();
  state.errorMsg = "";
}

export function cancelProviderSetup(state: ProviderActionsContext) {
  resetICloudSignInState(state);
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

export async function removeProvider({
  state,
  id,
}: {
  readonly state: ProviderActionsContext;
  readonly id: string;
}): Promise<void> {
  const target = state.providers.find((p) => p.id === id);
  if (!target || target.type === "local") return;

  const folderConfiguration = localFolderProviderConfiguration(target);
  if (
    folderConfiguration.kind === LocalFolderProviderConfigurationKind.Configured
  ) {
    const folderHandle = localFolderHandle(folderConfiguration.config);
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

export async function ensureProviderSaved(
  state: ProviderSaveContext,
): Promise<boolean> {
  const vaultStoreId = await vaultStoreIdForProviderSave(state);
  const providerStoreId =
    vaultStoreId.kind === ProviderSaveStoreIdKind.Available
      ? scopedProviderVault(vaultStoreId.storeId)
      : unscopedProviderVault();
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
    if (isConfiguredOAuthFile(outcome.oauth_file)) {
      state.configureOauthFile(outcome.oauth_file.config);
    }

    state.clearLoginSetup();
    state.loginRequiresExistingVault = false;
    state.addProviderOpen = false;
    state.applyActiveProviderCredentials();
    await state.persistProviders();
    log.info("sync provider saved");
    return true;
  } finally {
    outcome.free();
  }
}
