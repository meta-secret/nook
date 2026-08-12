import { I18N_KEYS } from "../../../generated/i18n-keys";
import type { VaultState } from "$lib/vault.svelte";
import {
  bind_google_drive_shared_folder,
  configuredOAuthFile,
  defaultOAuthFileConfig,
  DEFAULT_DRIVE_BACKUP_NAME,
  findDuplicateSyncProvider,
  missingOAuthAccessToken,
  oauthAccessToken,
  OAuthAccessTokenKind,
  oauthFileName,
  OAuthFileNameKind,
  set_google_drive_provider_mode,
  set_icloud_provider_mode,
  storedICloudShareTarget,
  storedOAuthAccountEmail,
  storedOAuthRemoteFileName,
  unresolvedOAuthRemoteFileId,
  OAUTH_FILE_PROVIDER_TYPE,
  providerPersistenceDefaults,
  type GoogleDriveMode,
  type ICloudMode,
  type OAuthFileConfig,
} from "$lib/auth/providers";
import {
  NookDuplicateSyncProviderState,
  verify_shared_google_drive_folder,
} from "$app-wasm";
import {
  ensureValidOAuthFileConfig,
  fetchGoogleAccountEmail,
  GoogleAccountIdentityKind,
  GoogleDriveOAuthScope,
  initGoogleAuth,
  isGoogleOAuthConfigured,
  GoogleOAuthPrompt,
  oauthTokensToConfig,
  requestGoogleAccessToken,
  requestGoogleDriveSharedAccess,
  type GoogleOAuthTokens,
} from "$lib/auth/google/oauth";
import {
  acceptICloudSharedVault,
  createICloudSharedVault,
  ICLOUD_SIGN_IN_TIMEOUT_MS,
  ensureValidICloudOAuthFileConfig,
  isICloudOAuthConfigured,
  oauthTokensToICloudConfig,
  prepareICloudSignInControl,
  requestPreparedICloudWebAuthToken,
  type ICloudOAuthTokens,
} from "$lib/auth/icloud/oauth";
import {
  BrowserOAuthProvider,
  OAuthOriginUnsupportedReason,
  resolveCurrentOAuthOriginSupport,
} from "$lib/auth/oauth-origin";
import { createLogger } from "$lib/runtime/log";
import {
  prepare_shared_storage_grant,
  createSharedStorageTarget,
  provider_oauth_preset_for_config,
  sharedStorageGrantAccessToken,
  suggestedSharedStorageTarget,
} from "$lib/vault/architecture-model";
import {
  LoginSetupKind,
  OAuthFileDraftKind,
} from "$lib/vault/state/provider.svelte";

const log = createLogger("vault-oauth");

export type ICloudSignInRequest = {
  readonly state: VaultState;
  readonly clickPreparedControl: boolean;
};

interface SharedICloudTargetBinding {
  readonly config: OAuthFileConfig;
  readonly storageTargetId: string;
}

export interface GoogleDriveModeSelection {
  readonly state: VaultState;
  readonly mode: GoogleDriveMode;
}

export interface ICloudModeSelection {
  readonly state: VaultState;
  readonly mode: ICloudMode;
}

export interface ICloudSharedProviderAccess {
  readonly state: VaultState;
  readonly shareReference: string;
}

export interface GoogleSharedFolderCreation {
  readonly state: VaultState;
  readonly collaboratorEmail: string;
}

export interface GoogleSharedFolderAccess {
  readonly state: VaultState;
  readonly folderRef: string;
}

interface ICloudTokenApplication {
  readonly state: VaultState;
  readonly tokens: ICloudOAuthTokens;
}

interface OAuthOriginRequirement {
  readonly state: VaultState;
  readonly provider: BrowserOAuthProvider;
}

interface GoogleTokenApplication {
  readonly state: VaultState;
  readonly tokens: GoogleOAuthTokens;
}

export async function ensureOAuthTokensFresh(state: VaultState): Promise<void> {
  if (
    state.storageMode !== "oauth-file" ||
    state.oauthFileDraft.kind !== OAuthFileDraftKind.Configured
  ) {
    return;
  }
  const oauthFile = state.oauthFileDraft.config;
  log.info("oauth token freshness check started");
  const providerToRefresh: ReturnType<typeof findDuplicateSyncProvider> =
    state.loginSetup.kind !== LoginSetupKind.Active && !state.addProviderOpen
      ? (() => {
          const findDuplicateSyncProviderArgs: Parameters<
            typeof findDuplicateSyncProvider
          >[0] = {
            providers: state.syncProviders,
            candidate: {
              ...providerPersistenceDefaults(),
              id: "oauth-refresh-target",
              type: OAUTH_FILE_PROVIDER_TYPE,
              label: "",
              oauthFile: configuredOAuthFile(oauthFile),
              createdAt: "",
            },
          };
          return findDuplicateSyncProvider(findDuplicateSyncProviderArgs);
        })()
      : { state: NookDuplicateSyncProviderState.Unique };
  const refreshed =
    oauthFile.preset === "icloud"
      ? await ensureValidICloudOAuthFileConfig(oauthFile)
      : await ensureValidOAuthFileConfig(oauthFile);
  if (
    JSON.stringify(refreshed.accessToken) ===
      JSON.stringify(oauthFile.accessToken) &&
    JSON.stringify(refreshed.expiresAt) === JSON.stringify(oauthFile.expiresAt)
  ) {
    log.info("oauth token freshness check kept existing token");
    return;
  }
  state.configureOauthFile(refreshed);
  if (providerToRefresh.state === NookDuplicateSyncProviderState.Duplicate) {
    state.providers = state.providers.map((provider) =>
      provider.id === providerToRefresh.provider.id
        ? { ...provider, oauthFile: configuredOAuthFile(refreshed) }
        : provider,
    );
    const persistenceOptions: Parameters<typeof state.persistProviders>[0] = {
      replace: false,
    };
    await state.persistProviders(persistenceOptions);
  }
  log.info("oauth token freshness check refreshed provider");
}

function bindSharedICloudTarget({
  config,
  storageTargetId,
}: SharedICloudTargetBinding): OAuthFileConfig {
  const sharedConfig: OAuthFileConfig = {
    ...config,
    iCloudMode: "shared",
    iCloudShareTarget: storedICloudShareTarget(storageTargetId),
    fileId: unresolvedOAuthRemoteFileId(),
  };
  return sharedConfig;
}

export async function signInWithGoogle(state: VaultState): Promise<void> {
  if (!isGoogleOAuthConfigured()) {
    state.errorMsg = state.t(I18N_KEYS.ProviderSetupGoogleOauthUnconfigured);
    return;
  }
  if (
    !(() => {
      const ensureSupportedOAuthOriginArgs: Parameters<
        typeof ensureSupportedOAuthOrigin
      >[0] = { state, provider: BrowserOAuthProvider.GoogleDrive };
      return ensureSupportedOAuthOrigin(ensureSupportedOAuthOriginArgs);
    })()
  ) {
    return;
  }
  state.googleOAuthBusy = true;
  state.errorMsg = "";
  try {
    const shared =
      state.oauthFileDraft.kind === OAuthFileDraftKind.Configured &&
      (state.oauthFileDraft.config.driveMode === "shared" ||
        state.oauthFileDraft.config.folderId.state === "folderId");
    const tokens = shared
      ? await (() => {
          const requestGoogleDriveSharedAccessArgs: Parameters<
            typeof requestGoogleDriveSharedAccess
          >[0] = {
            prompt: GoogleOAuthPrompt.Consent,
          };
          return requestGoogleDriveSharedAccess(
            requestGoogleDriveSharedAccessArgs,
          );
        })()
      : await (async () => {
          await initGoogleAuth();
          const requestGoogleAccessTokenArgs: Parameters<
            typeof requestGoogleAccessToken
          >[0] = {
            prompt: GoogleOAuthPrompt.Consent,
            scope: GoogleDriveOAuthScope.AppData,
          };
          return requestGoogleAccessToken(requestGoogleAccessTokenArgs);
        })();
    const applyGoogleOAuthTokensArgs: Parameters<
      typeof applyGoogleOAuthTokens
    >[0] = { state, tokens };
    await applyGoogleOAuthTokens(applyGoogleOAuthTokensArgs);
  } catch (error) {
    state.errorMsg =
      error instanceof Error ? error.message : "Google sign-in failed.";
  } finally {
    state.googleOAuthBusy = false;
  }
}

export function selectGoogleDriveMode({
  state,
  mode,
}: GoogleDriveModeSelection): void {
  if (state.oauthFileDraft.kind !== OAuthFileDraftKind.Configured) return;
  const oauthFile = state.oauthFileDraft.config;
  if (oauthFile.preset !== "google-drive") return;
  const current = oauthFile.driveMode;
  if (current === mode) return;
  state.configureOauthFile(set_google_drive_provider_mode(oauthFile, mode));
  state.sharedGrantInstructions = "";
  state.errorMsg = "";
}

export function selectICloudMode({ state, mode }: ICloudModeSelection): void {
  if (state.oauthFileDraft.kind !== OAuthFileDraftKind.Configured) return;
  const oauthFile = state.oauthFileDraft.config;
  if (oauthFile.preset !== "icloud") return;
  const current = oauthFile.iCloudMode;
  if (current === mode) return;
  state.configureOauthFile(set_icloud_provider_mode(oauthFile, mode));
  state.sharedGrantInstructions = "";
  state.errorMsg = "";
}

export async function createICloudSharedProvider(
  state: VaultState,
): Promise<void> {
  if (
    state.oauthFileDraft.kind !== OAuthFileDraftKind.Configured ||
    oauthAccessToken(state.oauthFileDraft.config).kind ===
      OAuthAccessTokenKind.Missing
  ) {
    throw new Error(state.t(I18N_KEYS.ProviderSetupIcloudSharedSignInFirst));
  }
  let target;
  try {
    target = await createICloudSharedVault(
      state.githubRepo.trim() || DEFAULT_DRIVE_BACKUP_NAME,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const ErrorArgs: ConstructorParameters<typeof Error>[1] = { cause: error };
    throw new Error(
      message.startsWith("provider_setup.")
        ? state.t(message)
        : state.t(I18N_KEYS.ProviderSetupIcloudSharedCreateFailed),
      ErrorArgs,
    );
  }
  const bindSharedICloudTargetArgs: Parameters<
    typeof bindSharedICloudTarget
  >[0] = {
    config: state.requireOauthFileConfig(),
    storageTargetId: target.storageTargetId,
  };
  state.configureOauthFile(bindSharedICloudTarget(bindSharedICloudTargetArgs));
  state.sharedGrantInstructions = state.t(
    I18N_KEYS.ProviderSetupIcloudSharedCreated,
  );
}

export async function useICloudSharedProvider({
  state,
  shareReference,
}: ICloudSharedProviderAccess): Promise<void> {
  if (
    state.oauthFileDraft.kind !== OAuthFileDraftKind.Configured ||
    oauthAccessToken(state.oauthFileDraft.config).kind ===
      OAuthAccessTokenKind.Missing
  ) {
    throw new Error(state.t(I18N_KEYS.ProviderSetupIcloudSharedSignInFirst));
  }
  let target;
  try {
    target = await acceptICloudSharedVault(shareReference);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const ErrorArgs2: ConstructorParameters<typeof Error>[1] = { cause: error };
    throw new Error(
      message.startsWith("provider_setup.")
        ? state.t(message)
        : state.t(I18N_KEYS.ProviderSetupIcloudSharedConnectFailed),
      ErrorArgs2,
    );
  }
  const bindSharedICloudTargetArgs2: Parameters<
    typeof bindSharedICloudTarget
  >[0] = {
    config: state.requireOauthFileConfig(),
    storageTargetId: target.storageTargetId,
  };
  state.configureOauthFile(bindSharedICloudTarget(bindSharedICloudTargetArgs2));
  state.sharedGrantInstructions = state.t(
    I18N_KEYS.ProviderSetupIcloudSharedConnected,
  );
}

export async function createGoogleSharedFolder({
  state,
  collaboratorEmail,
}: GoogleSharedFolderCreation): Promise<string> {
  if (state.oauthFileDraft.kind !== OAuthFileDraftKind.Configured) {
    throw new Error(state.t(I18N_KEYS.ProviderSetupGoogleSharedSignInFirst));
  }
  const oauthFile = state.oauthFileDraft.config;
  const accessCredential = oauthAccessToken(oauthFile);
  if (accessCredential.kind === OAuthAccessTokenKind.Missing) {
    throw new Error(state.t(I18N_KEYS.ProviderSetupGoogleSharedSignInFirst));
  }
  const remoteFileName = oauthFileName(oauthFile);
  const folderName = state.githubRepo.trim()
    ? state.githubRepo.trim()
    : remoteFileName.kind === OAuthFileNameKind.Resolved
      ? remoteFileName.fileName
      : DEFAULT_DRIVE_BACKUP_NAME;
  const prepareSharedStorageGrantArgs: Parameters<
    typeof prepare_shared_storage_grant
  >[0] = {
    providerType: OAUTH_FILE_PROVIDER_TYPE,
    oauthPreset: provider_oauth_preset_for_config(oauthFile),
    joinerIdentityKind: "email",
    joinerIdentity: collaboratorEmail,
    storageTargetHint: suggestedSharedStorageTarget(folderName),
    storageTarget: createSharedStorageTarget(),
    credential: sharedStorageGrantAccessToken(accessCredential.token),
  };
  const grant = await prepare_shared_storage_grant(
    prepareSharedStorageGrantArgs,
  );
  if (grant.kind === "unsupported") {
    throw new Error(state.t(grant.reasonKey));
  }
  const target = grant.target;
  if (target.state === "unavailable") {
    throw new Error(state.t(I18N_KEYS.ProviderSetupGoogleSharedCreateFailed));
  }
  state.configureOauthFile(
    bind_google_drive_shared_folder(
      state.requireOauthFileConfig(),
      target.storageTargetId,
    ),
  );
  state.sharedGrantInstructions =
    grant.kind === "granted"
      ? (() => {
          const tArgs2: Parameters<typeof state.t>[0] = {
            key: I18N_KEYS.ProviderSetupGoogleSharedFolderCreated,
            replacements: {
              email: collaboratorEmail.trim(),
              folder:
                target.state === "named"
                  ? target.storageTargetName
                  : target.storageTargetId,
            },
          };
          return state.t(tArgs2);
        })()
      : (() => {
          const tArgs: Parameters<typeof state.t>[0] = {
            key: grant.instructionsKey,
            replacements: {
              email: grant.joinerIdentity,
              folder:
                target.state === "named"
                  ? target.storageTargetName
                  : target.storageTargetId,
            },
          };
          return state.t(tArgs);
        })();
  return target.state === "named" ? target.storageTargetName : folderName;
}

export async function useGoogleSharedFolder({
  state,
  folderRef,
}: GoogleSharedFolderAccess): Promise<string> {
  const accessCredential =
    state.oauthFileDraft.kind === OAuthFileDraftKind.Configured
      ? oauthAccessToken(state.oauthFileDraft.config)
      : missingOAuthAccessToken();
  if (accessCredential.kind === OAuthAccessTokenKind.Missing) {
    throw new Error(state.t(I18N_KEYS.ProviderSetupGoogleSharedSignInFirst));
  }
  let folder;
  try {
    folder = await verify_shared_google_drive_folder(
      accessCredential.token,
      folderRef,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes(I18N_KEYS.ProviderSetupGoogleSharedNotFolder)) {
      const ErrorArgs3: ConstructorParameters<typeof Error>[1] = {
        cause: error,
      };
      throw new Error(
        state.t(I18N_KEYS.ProviderSetupGoogleSharedNotFolder),
        ErrorArgs3,
      );
    }
    if (message.includes(I18N_KEYS.ProviderSetupGoogleSharedNotWritable)) {
      const ErrorArgs4: ConstructorParameters<typeof Error>[1] = {
        cause: error,
      };
      throw new Error(
        state.t(I18N_KEYS.ProviderSetupGoogleSharedNotWritable),
        ErrorArgs4,
      );
    }
    throw error;
  }
  state.configureOauthFile(
    bind_google_drive_shared_folder(state.requireOauthFileConfig(), folder.id),
  );
  const tArgs3: Parameters<typeof state.t>[0] = {
    key: I18N_KEYS.ProviderSetupGoogleSharedFolderConnected,
    replacements: { folder: folder.name },
  };
  state.sharedGrantInstructions = state.t(tArgs3);
  return folder.name;
}

export async function signInWithICloud({
  state,
  clickPreparedControl,
}: ICloudSignInRequest): Promise<void> {
  log.info("iCloud sign-in requested");
  if (!isICloudOAuthConfigured()) {
    state.errorMsg = state.t(I18N_KEYS.ProviderSetupIcloudOauthUnconfigured);
    log.warn("iCloud sign-in blocked: not configured");
    return;
  }
  if (
    !(() => {
      const ensureSupportedOAuthOriginArgs2: Parameters<
        typeof ensureSupportedOAuthOrigin
      >[0] = { state, provider: BrowserOAuthProvider.ICloud };
      return ensureSupportedOAuthOrigin(ensureSupportedOAuthOriginArgs2);
    })()
  ) {
    return;
  }
  state.icloudOAuthBusy = true;
  state.errorMsg = "";
  try {
    const wasReady = state.icloudOAuthReady;
    if (!wasReady) {
      log.info("iCloud sign-in preparing control before token request");
      await prepareICloudSignIn(state);
    }
    if (!state.icloudOAuthReady) {
      log.warn("iCloud sign-in blocked: control not ready after prepare ");
      throw new Error(I18N_KEYS.ProviderSetupIcloudSignInLoading);
    }
    if (!wasReady) {
      log.info("iCloud sign-in control became ready; waiting for second click");
      throw new Error(I18N_KEYS.ProviderSetupIcloudSignInReady);
    }
    const requestPreparedICloudWebAuthTokenArgs: Parameters<
      typeof requestPreparedICloudWebAuthToken
    >[0] = {
      clickSignInControl: clickPreparedControl,
      signInTimeoutMs: ICLOUD_SIGN_IN_TIMEOUT_MS,
    };
    const tokenRequest = requestPreparedICloudWebAuthToken(
      requestPreparedICloudWebAuthTokenArgs,
    );
    const tokens = await tokenRequest;
    log.info("iCloud sign-in returned token");
    const applyICloudOAuthTokensArgs: Parameters<
      typeof applyICloudOAuthTokens
    >[0] = { state, tokens };
    await applyICloudOAuthTokens(applyICloudOAuthTokensArgs);
  } catch (error) {
    state.errorMsg = state.t(
      error instanceof Error &&
        error.message.startsWith("provider_setup.icloud_")
        ? error.message
        : I18N_KEYS.ProviderSetupIcloudSignInFailed,
    );
    log.warn("iCloud sign-in failed");
  } finally {
    state.icloudOAuthBusy = false;
    log.info("iCloud sign-in finished");
  }
}

export async function prepareICloudSignIn(state: VaultState): Promise<void> {
  log.info("iCloud sign-in prepare requested");
  if (
    state.icloudOAuthReady ||
    state.icloudOAuthPreparing ||
    !isICloudOAuthConfigured()
  ) {
    log.info("iCloud sign-in prepare skipped");
    return;
  }
  const support = resolveCurrentOAuthOriginSupport(BrowserOAuthProvider.ICloud);
  if (!support.supported) {
    log.warn(
      "iCloud sign-in prepare blocked by origin" +
        " " +
        JSON.stringify(support),
    );
    return;
  }
  state.icloudOAuthPreparing = true;
  try {
    await prepareICloudSignInControl();
    state.icloudOAuthReady = true;
    log.info("iCloud sign-in prepare completed");
  } catch (error) {
    state.icloudOAuthReady = false;
    state.errorMsg = state.t(
      error instanceof Error &&
        error.message.startsWith("provider_setup.icloud_")
        ? error.message
        : I18N_KEYS.ProviderSetupIcloudSignInFailed,
    );
    log.warn("iCloud sign-in prepare failed");
  } finally {
    state.icloudOAuthPreparing = false;
  }
}

async function applyICloudOAuthTokens({
  state,
  tokens,
}: ICloudTokenApplication): Promise<void> {
  state.activateLoginSetup("oauth-file");
  if (!state.addProviderOpen) {
    state.storageMode = "oauth-file";
  }
  state.selectOauthSetupPreset("icloud");
  const previousOauthFile = state.oauthFileDraft;
  const fallbackFileName = state.githubRepo.trim() || DEFAULT_DRIVE_BACKUP_NAME;
  const existingConfiguration =
    previousOauthFile.kind === OAuthFileDraftKind.Configured
      ? configuredOAuthFile(previousOauthFile.config)
      : configuredOAuthFile(
          (() => {
            const defaultOAuthFileConfigArgs: Parameters<
              typeof defaultOAuthFileConfig
            >[0] = { preset: "icloud", fileName: fallbackFileName };
            return defaultOAuthFileConfig(defaultOAuthFileConfigArgs);
          })(),
        );
  const oauthTokensToICloudConfigArgs: Parameters<
    typeof oauthTokensToICloudConfig
  >[0] = { tokens, existing: existingConfiguration };
  state.configureOauthFile(
    oauthTokensToICloudConfig(oauthTokensToICloudConfigArgs),
  );
  const oauthFile = state.requireOauthFileConfig();
  state.githubPat = "";
  const resolvedFileName = oauthFileName(oauthFile);
  state.githubRepo =
    resolvedFileName.kind === OAuthFileNameKind.Resolved
      ? resolvedFileName.fileName
      : DEFAULT_DRIVE_BACKUP_NAME;
  log.info("iCloud oauth tokens applied to vault state");
}

function ensureSupportedOAuthOrigin({
  state,
  provider,
}: OAuthOriginRequirement): boolean {
  const support = resolveCurrentOAuthOriginSupport(provider);
  if (support.supported) {
    log.info("oauth origin supported");
    return true;
  }
  log.warn("oauth origin unsupported");
  const tArgs4: Parameters<typeof state.t>[0] = {
    key:
      support.reason === OAuthOriginUnsupportedReason.CloudflarePrPreview
        ? I18N_KEYS.ProviderSetupOauthPreviewOriginUnsupported
        : I18N_KEYS.ProviderSetupOauthOriginUnsupported,
    replacements: { origin: support.origin },
  };
  state.errorMsg = state.t(tArgs4);
  return false;
}

async function applyGoogleOAuthTokens({
  state,
  tokens,
}: GoogleTokenApplication): Promise<void> {
  const email = await fetchGoogleAccountEmail(tokens.accessToken);
  const sharedFolderName = state.githubRepo.trim();
  state.activateLoginSetup("oauth-file");
  if (!state.addProviderOpen) {
    state.storageMode = "oauth-file";
  }
  state.selectOauthSetupPreset("google-drive");
  const previousOauthFile = state.oauthFileDraft;
  const fallbackFileName = state.githubRepo.trim() || DEFAULT_DRIVE_BACKUP_NAME;
  const previousConfig =
    previousOauthFile.kind === OAuthFileDraftKind.Configured
      ? previousOauthFile.config
      : (() => {
          const defaultOAuthFileConfigArgs2: Parameters<
            typeof defaultOAuthFileConfig
          >[0] = { preset: "google-drive", fileName: fallbackFileName };
          return defaultOAuthFileConfig(defaultOAuthFileConfigArgs2);
        })();
  const existingConfig: OAuthFileConfig = {
    ...previousConfig,
    fileName:
      previousConfig.fileName.state === "fileName"
        ? previousConfig.fileName
        : storedOAuthRemoteFileName(fallbackFileName),
    accountEmail:
      email.kind === GoogleAccountIdentityKind.Available
        ? storedOAuthAccountEmail(email.label)
        : previousConfig.accountEmail,
  };
  const oauthTokensToConfigArgs: Parameters<typeof oauthTokensToConfig>[0] = {
    tokens,
    existing: configuredOAuthFile(existingConfig),
  };
  state.configureOauthFile(oauthTokensToConfig(oauthTokensToConfigArgs));
  const oauthFile = state.requireOauthFileConfig();
  state.githubPat = "";
  const sharedGoogleDrive =
    oauthFile.driveMode === "shared" || oauthFile.folderId.state === "folderId";
  const resolvedFileName = oauthFileName(oauthFile);
  state.githubRepo = sharedGoogleDrive
    ? sharedFolderName || DEFAULT_DRIVE_BACKUP_NAME
    : resolvedFileName.kind === OAuthFileNameKind.Resolved
      ? resolvedFileName.fileName
      : DEFAULT_DRIVE_BACKUP_NAME;
}
