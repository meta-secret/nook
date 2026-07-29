/** Provider actions that snapshot reactive Svelte state at WASM boundaries. */
import type { ProviderActionsContext } from "$lib/vault/action-contexts";
import { generateId, isoTimestamp, type VaultAccessStatus } from "$lib/nook";
import {
  DEFAULT_DRIVE_BACKUP_NAME,
  DEFAULT_GITHUB_REPO,
  activeVaultScope,
  configuredLocalFolder,
  configuredOAuthFile,
  defaultOAuthFileConfig,
  defaultGithubRepository,
  DuplicateSyncProviderKind,
  findDuplicateSyncProvider,
  GITHUB_PROVIDER_TYPE,
  githubPatValue,
  githubRepositoryValue,
  LOCAL_PROVIDER_TYPE,
  LOCAL_FOLDER_PROVIDER_TYPE,
  localFolderHandle,
  localFolderDirectoryValue,
  LocalFolderHandleKind,
  localFolderProviderConfiguration,
  LocalFolderProviderConfigurationKind,
  localFolderConfigurationNotApplicable,
  missingOAuthAccessToken,
  missingGithubPat,
  OAUTH_FILE_PROVIDER_TYPE,
  oauthAccessToken,
  OAuthAccessTokenKind,
  oauthRefreshCredentialNotIssued,
  oauthFileName,
  OAuthFileNameKind,
  oauthProviderConfiguration,
  OAuthProviderConfigurationKind,
  providerDefaultLabel,
  providerPersistenceDefaults,
  personalICloudShareTarget,
  rootGoogleDriveFolder,
  saveAuthProviders,
  signedOutOAuthCredential,
  storedGithubPat,
  storedGithubRepository,
  storedOAuthCredential,
  storedOAuthRemoteFileName,
  scopedProviderVault,
  unscopedProviderVault,
  unselectedVaultScope,
  unknownOAuthAccountIdentity,
  unknownOAuthTokenExpiry,
  unresolvedOAuthRemoteFileId,
  type AuthProvidersSnapshot,
  type LocalFolderConfig,
  type LocalFolderHandle,
  type OAuthFileConfig,
  type OAuthFileName,
  type OAuthFilePreset,
  type StorageProvider,
  type StorageProviderType,
} from "$lib/auth-providers";
import {
  activeVaultProviders,
  authenticatedVaultStorageArgs,
  chooseLocalFolderBackupDirectory,
  draftGithubStorageArgs,
  draftLocalStorageArgs,
  draftOauthStorageArgs,
  ensureLocalProviderRow as ensureLocalProviderRowWasm,
  hasGithubCredentials,
  hasLocalVault,
  hasLocalFolderCredentials,
  hasOAuthCredentials,
  isLocalFolderBackupSupported,
  isVaultSessionLocked,
  localProviderForActiveVault,
  NookManagerStoreScope,
  NookOAuthRemoteConfigurationUpdateState,
  NookProviderSelectionState,
  NookStagedStorageArgsState,
  providerWasmArgs as providerWasmArgsCore,
  removeLocalFolderHandle,
  RemoteVaultAssessDecision,
  RemoteVaultRecoveryState,
  stagedConfiguredOauthProviderLabel,
  stagedGithubProviderLabel,
  stagedLocalProviderLabel,
  stagedGithubRemoteStorageArgs,
  stagedLocalRemoteStorageArgs,
  stagedOauthRemoteStorageArgs,
  stagedUnconfiguredOauthProviderLabel,
  syncProvidersForActiveVault,
  updateOauthRemoteRef,
  localVaultStorageArgs,
  type NookStorageConnectArgs,
} from "$app-wasm";
import { createLogger } from "$lib/log";
import {
  ActiveVaultKind,
  LocalFolderDraftKind,
  LocalProviderLookupKind,
  LoginVaultSelectionKind,
  LoginSetupKind,
  OAuthFileDraftKind,
  OAuthSetupPresetKind,
  StagedRemoteStorageKind,
  type LocalProviderLookup,
  type StagedRemoteStorage,
} from "$lib/vault/state/provider.svelte";
import {
  startVaultDiscoveryTimeout,
  VAULT_ASSESS_TIMEOUT_ERROR_NAME,
} from "$lib/vault/vault-discovery-timeout";
export {
  connectAndSyncStagedProvider,
  connectStagedProvider,
  discoverStagedVaultStoreId,
} from "$lib/vault/provider-connection";
enum OAuthProviderUpdateKind {
  NotRequired = "not-required",
  Required = "required",
}

type OAuthProviderUpdate =
  | { kind: OAuthProviderUpdateKind.NotRequired }
  | { kind: OAuthProviderUpdateKind.Required; providerId: string };

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

function providerSnapshot(state: ProviderActionsContext) {
  return $state.snapshot({
    providers: state.providers,
    activeVaultStoreId:
      state.activeVault.kind === ActiveVaultKind.Open
        ? activeVaultScope(state.activeVault.storeId)
        : unselectedVaultScope(),
  });
}

export function wasmStorageArgs(
  state: ProviderActionsContext,
): [string, string, string] {
  const syncProvider = syncProviders(state)[0];
  if (state.localVaultPresent) {
    return takeStorageArgsTuple(localVaultStorageArgs());
  }
  if (state.isAuthenticated && syncProvider) {
    return takeStorageArgsTuple(
      authenticatedVaultStorageArgs($state.snapshot(syncProvider)),
    );
  }
  if (state.storageMode === GITHUB_PROVIDER_TYPE) {
    return takeStorageArgsTuple(
      draftGithubStorageArgs(state.githubPat, state.githubRepo),
    );
  }
  if (
    state.storageMode === OAUTH_FILE_PROVIDER_TYPE &&
    state.oauthFileDraft.kind === OAuthFileDraftKind.Configured
  ) {
    return takeStorageArgsTuple(
      draftOauthStorageArgs($state.snapshot(state.oauthFileDraft.config)),
    );
  }
  return takeStorageArgsTuple(draftLocalStorageArgs());
}

export function providerWasmArgs(
  provider: StorageProvider,
): [string, string, string] {
  return takeStorageArgsTuple(providerWasmArgsCore($state.snapshot(provider)));
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
  return state.clientPolicy.shouldUseJoinProviderForConnect(
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
      ? stagedGithubRemoteStorageArgs(state.githubPat, state.githubRepo)
      : type === OAUTH_FILE_PROVIDER_TYPE &&
          state.oauthFileDraft.kind === OAuthFileDraftKind.Configured
        ? stagedOauthRemoteStorageArgs(
            $state.snapshot(state.oauthFileDraft.config),
          )
        : stagedLocalRemoteStorageArgs();
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
    return stagedGithubProviderLabel(state.githubRepo);
  }
  if (providerType === "oauth-file") {
    if (state.oauthFileDraft.kind === OAuthFileDraftKind.Configured) {
      const oauthFile = state.oauthFileDraft.config;
      const remoteFileName = oauthFileName(oauthFile);
      return stagedConfiguredOauthProviderLabel(
        remoteFileName.kind === OAuthFileNameKind.Resolved
          ? remoteFileName.fileName
          : DEFAULT_DRIVE_BACKUP_NAME,
        oauthFile.preset,
      );
    }
    return state.oauthSetupSelection.kind === OAuthSetupPresetKind.Selected
      ? stagedConfiguredOauthProviderLabel("", state.oauthSetupSelection.preset)
      : stagedUnconfiguredOauthProviderLabel();
  }
  return stagedLocalProviderLabel(providerType);
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
    return hasGithubCredentials(state.githubPat);
  }
  if (
    state.storageMode === OAUTH_FILE_PROVIDER_TYPE &&
    oauthCredential.kind === OAuthAccessTokenKind.Available
  ) {
    return hasOAuthCredentials(oauthCredential.token);
  }
  if (
    state.storageMode === LOCAL_FOLDER_PROVIDER_TYPE &&
    folderHandle.kind === LocalFolderHandleKind.Selected
  ) {
    return hasLocalFolderCredentials(folderHandle.handleId);
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
  const updated = updateOauthRemoteRef(
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

export async function chooseLocalFolder(
  state: ProviderActionsContext,
): Promise<void> {
  refreshLocalFolderBackupSupport(state);
  if (!state.localFolderBackupSupported) {
    throw new Error(state.t("provider_setup.local_folder_unsupported_browser"));
  }
  const folder = await chooseLocalFolderBackupDirectory();
  state.configureLocalFolder(folder);
}

export function refreshLocalFolderBackupSupport(
  state: ProviderActionsContext,
): void {
  state.localFolderBackupSupported =
    "window" in globalThis && isLocalFolderBackupSupported();
}

export function localProvider(
  state: ProviderActionsContext,
): LocalProviderLookup {
  const scope = state.hasActiveVaultStore
    ? NookManagerStoreScope.scoped(state.requireActiveVaultStoreId())
    : NookManagerStoreScope.unscoped();
  const selection = localProviderForActiveVault(providerSnapshot(state), scope);
  scope.free();
  if (selection.state === NookProviderSelectionState.Selected) {
    const provider = state.providers.find(
      (candidate) => candidate.id === selection.providerId,
    );
    selection.free();
    return provider
      ? { kind: LocalProviderLookupKind.Found, provider }
      : { kind: LocalProviderLookupKind.Missing };
  }
  selection.free();
  return { kind: LocalProviderLookupKind.Missing };
}

export function activeProviders(
  state: ProviderActionsContext,
): StorageProvider[] {
  const scope = state.hasActiveVaultStore
    ? NookManagerStoreScope.scoped(state.requireActiveVaultStoreId())
    : NookManagerStoreScope.unscoped();
  const providers = activeVaultProviders(
    providerSnapshot(state),
    scope,
  ).providers;
  scope.free();
  return providers;
}

export function syncProviders(
  state: ProviderActionsContext,
): StorageProvider[] {
  const scope = state.hasActiveVaultStore
    ? NookManagerStoreScope.scoped(state.requireActiveVaultStoreId())
    : NookManagerStoreScope.unscoped();
  const providers = syncProvidersForActiveVault(
    providerSnapshot(state),
    scope,
  ).providers;
  scope.free();
  return providers;
}

export function showLoginVaultPicker(state: ProviderActionsContext): boolean {
  return state.clientPolicy.shouldShowLoginVaultPicker(
    state.isAuthenticated,
    state.localVaults.length,
    state.hasSelectedLoginVaultStore,
    state.loginSetup.kind === LoginSetupKind.Active,
    state.addProviderOpen,
    isVaultSessionLocked(),
  );
}

export async function assessVaultConnectStatus(
  state: ProviderActionsContext,
  args: [string, string, string],
): Promise<VaultAccessStatus> {
  if (!state.hasManager) throw new Error(state.t("errors.engine_unavailable"));
  const manager = state.requireManager();
  return (await state.enqueueStorage(async () => {
    const assessPromise = manager.assess_vault_connect(...args);
    const timeout = startVaultDiscoveryTimeout(
      "Connection timed out. Check your PAT, network, and try again.",
      30_000,
    );
    try {
      return await Promise.race([assessPromise, timeout.completion]);
    } finally {
      timeout.cancel();
    }
  })) as VaultAccessStatus;
}

export async function handleRemoteVaultAssessStatus(
  state: ProviderActionsContext,
  accessStatus: VaultAccessStatus,
): Promise<boolean> {
  const decision = state.clientPolicy.remoteVaultAssessDecision(
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
      state.errorMsg = state.t("auth_storage.existing_vault_not_found");
      return true;
    case RemoteVaultAssessDecision.PromptMissingRemote:
      state.remoteVaultRecoveryState =
        RemoteVaultRecoveryState.PromptMissingOnly;
      return true;
    default:
      return false;
  }
}

/** Store id for persisting a sync provider row before or after wasm connect. */
async function vaultStoreIdForProviderSave(
  state: ProviderActionsContext,
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

export async function loadProviders(
  state: ProviderActionsContext,
  options?: { ensureLocalRow?: boolean },
) {
  const snapshot = await state.enqueueStorage(() =>
    options?.ensureLocalRow
      ? state.requireManager().loadAuthProvidersWithLocalRow()
      : state.requireManager().loadAuthProviders(),
  );
  state.providers = snapshot.providers.map((p) =>
    p.label === "GitHub sync" ? { ...p, label: "GitHub" } : p,
  );
  if (snapshot.activeVaultStoreId.state === "storeId") {
    state.openActiveVault(snapshot.activeVaultStoreId.value);
  }
  state.providersLoaded = true;
  log.debug("providers loaded", {
    count: state.providers.length,
    localVaultPresent: state.localVaultPresent,
  });
}

export async function promoteSessionVaultToLocalIfNeeded(
  state: ProviderActionsContext,
): Promise<void> {
  const snapshot = await state
    .requireManager()
    .ensureLocalAuthProviderSnapshot({
      providers: state.providers,
      activeVaultStoreId:
        state.activeVault.kind === ActiveVaultKind.Open
          ? activeVaultScope(state.activeVault.storeId)
          : unselectedVaultScope(),
    });
  if (snapshot.providers.length !== state.providers.length) {
    state.providers = snapshot.providers;
    await state.enqueueStorage(() =>
      saveAuthProviders(state.requireManager(), snapshot),
    );
  }
  state.localVaultPresent = await hasLocalVault();
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
    const oauthConfiguration = oauthProviderConfiguration(syncProvider);
    if (oauthConfiguration.kind === OAuthProviderConfigurationKind.Configured) {
      state.configureOauthFile(oauthConfiguration.config);
    } else {
      state.clearOauthFile();
    }
    state.clearLocalFolder();
    const remoteFileName: OAuthFileName =
      oauthConfiguration.kind === OAuthProviderConfigurationKind.Configured
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

export async function persistProviders(
  state: ProviderActionsContext,
  opts?: { replace?: boolean },
) {
  if (!opts?.replace && state.localVaultPresent) {
    const snapshot = await state.enqueueStorage(() =>
      state.requireManager().loadAuthProviders(),
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
    saveAuthProviders(state.requireManager(), {
      providers: state.providers,
      activeVaultStoreId: state.hasActiveVaultStore
        ? activeVaultScope(state.requireActiveVaultStoreId())
        : unselectedVaultScope(),
    }),
  );
}

export function beginProviderSetup(
  state: ProviderActionsContext,
  type: StorageProviderType,
  oauthPreset?: OAuthFilePreset,
) {
  if (!state.isAuthenticated) {
    state.resetVaultSessionState();
  }
  state.activateLoginSetup(type);
  state.storageMode = type;
  state.githubPat = "";
  state.githubRepo =
    type === "oauth-file" ? DEFAULT_DRIVE_BACKUP_NAME : DEFAULT_GITHUB_REPO;
  if (type === "oauth-file") {
    const preset = oauthPreset ?? "google-drive";
    if (preset === "icloud") {
      resetICloudSignInState(state);
    }
    state.selectOauthSetupPreset(preset);
    state.configureOauthFile({
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
    });
  } else {
    state.clearOauthSetupPreset();
    state.clearOauthFile();
  }
  state.clearLocalFolder();
  state.clearExistingVaultRecoverySummary();
  state.errorMsg = "";
  state.dismissSuccess();
  log.debug("provider setup started", { type, oauthPreset });
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

export async function removeProvider(
  state: ProviderActionsContext,
  id: string,
): Promise<void> {
  const target = state.providers.find((p) => p.id === id);
  if (!target || target.type === "local") return;

  const folderConfiguration = localFolderProviderConfiguration(target);
  if (
    folderConfiguration.kind === LocalFolderProviderConfigurationKind.Configured
  ) {
    const folderHandle = localFolderHandle(folderConfiguration.config);
    if (folderHandle.kind === LocalFolderHandleKind.Selected) {
      await removeLocalFolderHandle(folderHandle.handleId);
    }
  }
  state.providers = state.providers.filter((p) => p.id !== id);

  if (state.providers.length === 0 && state.isAuthenticated) {
    state.clearUnlockedSession();
  }

  state.applyActiveProviderCredentials();
  await state.persistProviders({ replace: true });

  log.info("sync provider removed", { id, label: target.label });
  state.showSuccess(state.t("toasts.removed_device", { label: target.label }));
}

export async function ensureProviderSaved(
  state: ProviderActionsContext,
): Promise<boolean> {
  const pat = state.githubPat.trim();
  const repo = state.githubRepo.trim() || DEFAULT_GITHUB_REPO;
  const oauthFileDraft = state.oauthFileDraft;
  const sharedGoogleDrive =
    oauthFileDraft.kind === OAuthFileDraftKind.Configured &&
    oauthFileDraft.config.preset === "google-drive" &&
    (oauthFileDraft.config.driveMode === "shared" ||
      oauthFileDraft.config.folderId.state === "folderId");
  const configuredRemoteFileName =
    oauthFileDraft.kind === OAuthFileDraftKind.Configured
      ? oauthFileName(oauthFileDraft.config)
      : { kind: OAuthFileNameKind.Unresolved };
  const driveFile = sharedGoogleDrive
    ? configuredRemoteFileName.kind === OAuthFileNameKind.Resolved
      ? configuredRemoteFileName.fileName
      : DEFAULT_DRIVE_BACKUP_NAME
    : state.githubRepo.trim() || DEFAULT_DRIVE_BACKUP_NAME;
  const type = stagedProviderType(state);
  const isNewSetup = state.loginSetup.kind === LoginSetupKind.Active;
  let oauthProviderToUpdate: OAuthProviderUpdate = {
    kind: OAuthProviderUpdateKind.NotRequired,
  };
  const vaultStoreId = await vaultStoreIdForProviderSave(state);
  const providerStoreId =
    vaultStoreId.kind === ProviderSaveStoreIdKind.Available
      ? scopedProviderVault(vaultStoreId.storeId)
      : unscopedProviderVault();
  const oauthPreset =
    oauthFileDraft.kind === OAuthFileDraftKind.Configured
      ? oauthFileDraft.config.preset
      : state.oauthSetupSelection.kind === OAuthSetupPresetKind.Selected
        ? state.oauthSetupSelection.preset
        : "google-drive";

  const isExplicitAdd =
    state.addProviderOpen ||
    (state.isAuthenticated && state.loginSetup.kind === LoginSetupKind.Active);

  if (isNewSetup && type !== "local") {
    let provider: StorageProvider;
    if (type === "github") {
      provider = {
        ...providerPersistenceDefaults(),
        id: generateId(),
        type,
        label: providerDefaultLabel(type, {
          detail: repo,
          oauthPreset,
        }),
        githubPat: storedGithubPat(pat),
        githubRepo: storedGithubRepository(repo),
        storeId: providerStoreId,
        createdAt: isoTimestamp(),
      };
    } else if (type === "oauth-file") {
      const oauthFile: OAuthFileConfig =
        oauthFileDraft.kind === OAuthFileDraftKind.Configured
          ? {
              ...oauthFileDraft.config,
              preset: oauthPreset,
              fileName: storedOAuthRemoteFileName(driveFile),
            }
          : defaultOAuthFileConfig(oauthPreset, driveFile);
      provider = {
        ...providerPersistenceDefaults(),
        id: generateId(),
        type,
        label: providerDefaultLabel(type, {
          detail: driveFile,
          oauthPreset,
        }),
        oauthFile: configuredOAuthFile(oauthFile),
        storeId: providerStoreId,
        createdAt: isoTimestamp(),
      };
    } else {
      if (state.localFolderDraft.kind !== LocalFolderDraftKind.Configured) {
        state.errorMsg = state.t("auth_storage.local_folder_choose_err");
        return false;
      }
      const localFolder: LocalFolderConfig = state.localFolderDraft.config;
      provider = {
        ...providerPersistenceDefaults(),
        id: generateId(),
        type,
        label: providerDefaultLabel(type, {
          detail: localFolderDirectoryValue(localFolder.directoryName),
          oauthPreset,
        }),
        localFolder: configuredLocalFolder(localFolder),
        storeId: providerStoreId,
        createdAt: isoTimestamp(),
      };
    }
    const duplicateProvider = findDuplicateSyncProvider(
      state.activeVaultProviders,
      provider,
    );
    if (duplicateProvider.kind === DuplicateSyncProviderKind.Duplicate) {
      if (isExplicitAdd) {
        state.errorMsg = state.t("auth_storage.duplicate_sync_provider");
        return false;
      }
    } else {
      state.providers = [...state.providers, provider];
      if (provider.type === "oauth-file") {
        oauthProviderToUpdate = {
          kind: OAuthProviderUpdateKind.Required,
          providerId: provider.id,
        };
      }
    }
  } else if (
    isNewSetup &&
    type === "local" &&
    state.localProvider.kind === LocalProviderLookupKind.Missing
  ) {
    const provider: StorageProvider = {
      ...providerPersistenceDefaults(),
      id: generateId(),
      type: "local",
      label: providerDefaultLabel("local"),
      storeId: providerStoreId,
      createdAt: isoTimestamp(),
    };
    state.providers = [...state.providers, provider];
  } else if (state.localProvider.kind === LocalProviderLookupKind.Found) {
    const localProviderId = state.localProvider.provider.id;
    state.providers = state.providers.map((provider) =>
      provider.id === localProviderId
        ? {
            ...provider,
            storeId: providerStoreId,
          }
        : provider,
    );
  } else {
    const snapshot = ensureLocalProviderRowWasm(
      {
        providers: state.providers,
        activeVaultStoreId: activeVaultScope(state.requireActiveVaultStoreId()),
      } as AuthProvidersSnapshot,
      state.requireActiveVaultStoreId(),
    );
    state.providers = snapshot.providers;
  }

  if (
    state.storageMode === "oauth-file" &&
    state.oauthFileDraft.kind === OAuthFileDraftKind.Configured &&
    state.oauthFileDraft.config.fileId.state === "fileId"
  ) {
    const activeOauthFile = state.oauthFileDraft.config;
    const activePreset = activeOauthFile.preset;
    if (oauthProviderToUpdate.kind === OAuthProviderUpdateKind.NotRequired) {
      const duplicate = findDuplicateSyncProvider(state.syncProviders, {
        ...providerPersistenceDefaults(),
        id: "oauth-provider-update-target",
        type: "oauth-file",
        label: "",
        oauthFile: configuredOAuthFile(activeOauthFile),
        createdAt: "",
      });
      if (duplicate.kind === DuplicateSyncProviderKind.Duplicate) {
        oauthProviderToUpdate = {
          kind: OAuthProviderUpdateKind.Required,
          providerId: duplicate.provider.id,
        };
      }
    }
    if (oauthProviderToUpdate.kind === OAuthProviderUpdateKind.Required) {
      const oauthProviderToUpdateId = oauthProviderToUpdate.providerId;
      state.providers = state.providers.map((provider) => {
        const providerOAuthConfiguration = oauthProviderConfiguration(provider);
        if (
          provider.type !== "oauth-file" ||
          providerOAuthConfiguration.kind !==
            OAuthProviderConfigurationKind.Configured ||
          provider.id !== oauthProviderToUpdateId
        ) {
          return provider;
        }
        const providerOauthFile = providerOAuthConfiguration.config;
        const activeAccessToken = oauthAccessToken(activeOauthFile);
        const providerFileName = oauthFileName(providerOauthFile);
        const activeFileName = oauthFileName(activeOauthFile);
        const merged: OAuthFileConfig = {
          preset: activePreset,
          accessToken:
            activeAccessToken.kind === OAuthAccessTokenKind.Available
              ? activeOauthFile.accessToken
              : providerOauthFile.accessToken,
          refreshToken: providerOauthFile.refreshToken,
          expiresAt:
            providerOauthFile.expiresAt.state === "expiresAt"
              ? providerOauthFile.expiresAt
              : activeOauthFile.expiresAt,
          fileId: activeOauthFile.fileId,
          folderId:
            activeOauthFile.folderId.state === "folderId"
              ? activeOauthFile.folderId
              : providerOauthFile.folderId,
          driveMode: activeOauthFile.driveMode,
          iCloudMode: activeOauthFile.iCloudMode,
          iCloudShareTarget:
            activeOauthFile.iCloudShareTarget.state === "sharedTarget"
              ? activeOauthFile.iCloudShareTarget
              : providerOauthFile.iCloudShareTarget,
          fileName:
            providerFileName.kind === OAuthFileNameKind.Resolved
              ? providerOauthFile.fileName
              : activeFileName.kind === OAuthFileNameKind.Resolved
                ? activeOauthFile.fileName
                : storedOAuthRemoteFileName(driveFile),
          accountEmail:
            providerOauthFile.accountEmail.state === "email"
              ? providerOauthFile.accountEmail
              : activeOauthFile.accountEmail,
        };
        return { ...provider, oauthFile: configuredOAuthFile(merged) };
      });
      const updatedProvider = state.providers.find(
        (provider) => provider.id === oauthProviderToUpdateId,
      );
      const updatedConfiguration = updatedProvider
        ? oauthProviderConfiguration(updatedProvider)
        : { kind: OAuthProviderConfigurationKind.Missing };
      state.configureOauthFile(
        updatedConfiguration.kind === OAuthProviderConfigurationKind.Configured
          ? updatedConfiguration.config
          : activeOauthFile,
      );
    }
  }

  state.clearLoginSetup();
  state.loginRequiresExistingVault = false;
  state.addProviderOpen = false;
  state.applyActiveProviderCredentials();
  await state.persistProviders();
  log.info("sync provider saved", { type, explicitAdd: isExplicitAdd });
  return true;
}
