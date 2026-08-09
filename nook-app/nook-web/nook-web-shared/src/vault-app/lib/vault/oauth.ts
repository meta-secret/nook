import { I18N_KEYS } from "../../../generated/i18n-keys";
import type { VaultState } from "$lib/vault.svelte";
import {
  bindGoogleDriveSharedFolder,
  configuredOAuthFile,
  defaultOAuthFileConfig,
  DEFAULT_DRIVE_BACKUP_NAME,
  findDuplicateSyncProvider,
  missingOAuthAccessToken,
  oauthAccessToken,
  OAuthAccessTokenKind,
  oauthFileName,
  OAuthFileNameKind,
  setGoogleDriveProviderMode,
  setICloudProviderMode,
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
  verifySharedGoogleDriveFolder,
} from "$app-wasm";
import {
  ensureValidOAuthFileConfig,
  fetchGoogleAccountEmail,
  GoogleAccountIdentityKind,
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
  ensureValidICloudOAuthFileConfig,
  ICloudAccountNameKind,
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
  prepareSharedStorageGrant,
  createSharedStorageTarget,
  providerOauthPresetForConfig,
  sharedStorageGrantAccessToken,
  suggestedSharedStorageTarget,
} from "$lib/vault/architecture-model";
import {
  LoginSetupKind,
  OAuthFileDraftKind,
  OAuthSetupPresetKind,
} from "$lib/vault/state/provider.svelte";

const log = createLogger("vault-oauth");

export async function ensureOAuthTokensFresh(state: VaultState): Promise<void> {
  if (
    state.storageMode !== "oauth-file" ||
    state.oauthFileDraft.kind !== OAuthFileDraftKind.Configured
  ) {
    return;
  }
  const oauthFile = state.oauthFileDraft.config;
  const infoArgs: Parameters<typeof log.info>[1] = {
    preset: oauthFile.preset,
    hasAccessToken:
      oauthAccessToken(oauthFile).kind === OAuthAccessTokenKind.Available,
    expiresAt: oauthFile.expiresAt,
  };
  log.info("oauth token freshness check started", infoArgs);
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
    const infoArgs2: Parameters<typeof log.info>[1] = {
      preset: refreshed.preset,
      expiresAt: refreshed.expiresAt,
    };
    log.info("oauth token freshness check kept existing token", infoArgs2);
    return;
  }
  state.configureOauthFile(refreshed);
  if (providerToRefresh.state === NookDuplicateSyncProviderState.Duplicate) {
    state.providers = state.providers.map((provider) =>
      provider.id === providerToRefresh.provider.id
        ? { ...provider, oauthFile: configuredOAuthFile(refreshed) }
        : provider,
    );
    await state.persistProviders();
  }
  const infoArgs3: Parameters<typeof log.info>[1] = {
    preset: refreshed.preset,
    expiresAt: refreshed.expiresAt,
    ...(providerToRefresh.state === NookDuplicateSyncProviderState.Duplicate
      ? { providerId: providerToRefresh.provider.id }
      : {}),
  };
  log.info("oauth token freshness check refreshed provider", infoArgs3);
}

function bindSharedICloudTarget({
  config,
  storageTargetId,
}: {
  readonly config: OAuthFileConfig;
  readonly storageTargetId: string;
}): OAuthFileConfig {
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
}: {
  readonly state: VaultState;
  readonly mode: GoogleDriveMode;
}): void {
  if (state.oauthFileDraft.kind !== OAuthFileDraftKind.Configured) return;
  const oauthFile = state.oauthFileDraft.config;
  if (oauthFile.preset !== "google-drive") return;
  const current = oauthFile.driveMode;
  if (current === mode) return;
  state.configureOauthFile(setGoogleDriveProviderMode(oauthFile, mode));
  state.sharedGrantInstructions = "";
  state.errorMsg = "";
}

export function selectICloudMode({
  state,
  mode,
}: {
  readonly state: VaultState;
  readonly mode: ICloudMode;
}): void {
  if (state.oauthFileDraft.kind !== OAuthFileDraftKind.Configured) return;
  const oauthFile = state.oauthFileDraft.config;
  if (oauthFile.preset !== "icloud") return;
  const current = oauthFile.iCloudMode;
  if (current === mode) return;
  state.configureOauthFile(setICloudProviderMode(oauthFile, mode));
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
}: {
  readonly state: VaultState;
  readonly shareReference: string;
}): Promise<void> {
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
}: {
  readonly state: VaultState;
  readonly collaboratorEmail: string;
}): Promise<string> {
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
    typeof prepareSharedStorageGrant
  >[0] = {
    providerType: OAUTH_FILE_PROVIDER_TYPE,
    oauthPreset: providerOauthPresetForConfig(oauthFile),
    joinerIdentityKind: "email",
    joinerIdentity: collaboratorEmail,
    storageTargetHint: suggestedSharedStorageTarget(folderName),
    storageTarget: createSharedStorageTarget(),
    credential: sharedStorageGrantAccessToken(accessCredential.token),
  };
  const grant = await prepareSharedStorageGrant(prepareSharedStorageGrantArgs);
  if (grant.kind === "unsupported") {
    throw new Error(state.t(grant.reasonKey));
  }
  const target = grant.target;
  if (target.state === "unavailable") {
    throw new Error(state.t(I18N_KEYS.ProviderSetupGoogleSharedCreateFailed));
  }
  state.configureOauthFile(
    bindGoogleDriveSharedFolder(
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
}: {
  readonly state: VaultState;
  readonly folderRef: string;
}): Promise<string> {
  const accessCredential =
    state.oauthFileDraft.kind === OAuthFileDraftKind.Configured
      ? oauthAccessToken(state.oauthFileDraft.config)
      : missingOAuthAccessToken();
  if (accessCredential.kind === OAuthAccessTokenKind.Missing) {
    throw new Error(state.t(I18N_KEYS.ProviderSetupGoogleSharedSignInFirst));
  }
  let folder;
  try {
    folder = await verifySharedGoogleDriveFolder(
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
    bindGoogleDriveSharedFolder(state.requireOauthFileConfig(), folder.id),
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
  options,
}: {
  readonly state: VaultState;
  readonly options: { clickPreparedControl?: boolean };
}): Promise<void> {
  const infoArgs4: Parameters<typeof log.info>[1] = {
    configured: isICloudOAuthConfigured(),
    ready: state.icloudOAuthReady,
    preparing: state.icloudOAuthPreparing,
    busy: state.icloudOAuthBusy,
    clickPreparedControl: options.clickPreparedControl === true,
  };
  log.info("iCloud sign-in requested", infoArgs4);
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
      const warnArgs: Parameters<typeof log.warn>[1] = {
        wasReady,
        ready: state.icloudOAuthReady,
        preparing: state.icloudOAuthPreparing,
      };
      log.warn(
        "iCloud sign-in blocked: control not ready after prepare",
        warnArgs,
      );
      throw new Error(I18N_KEYS.ProviderSetupIcloudSignInLoading);
    }
    if (!wasReady) {
      log.info("iCloud sign-in control became ready; waiting for second click");
      throw new Error(I18N_KEYS.ProviderSetupIcloudSignInReady);
    }
    const requestPreparedICloudWebAuthTokenArgs: Parameters<
      typeof requestPreparedICloudWebAuthToken
    >[0] = {
      clickSignInControl: options.clickPreparedControl,
    };
    const tokenRequest = requestPreparedICloudWebAuthToken(
      requestPreparedICloudWebAuthTokenArgs,
    );
    const tokens = await tokenRequest;
    const infoArgs5: Parameters<typeof log.info>[1] = {
      hasAccessToken: Boolean(tokens.accessToken.trim()),
      tokenLength: tokens.accessToken.length,
      hasAccountName:
        tokens.accountName.kind === ICloudAccountNameKind.Available,
    };
    log.info("iCloud sign-in returned token", infoArgs5);
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
    const warnArgs2: Parameters<typeof log.warn>[1] = { error: state.errorMsg };
    log.warn("iCloud sign-in failed", warnArgs2);
  } finally {
    state.icloudOAuthBusy = false;
    const infoArgs6: Parameters<typeof log.info>[1] = {
      ready: state.icloudOAuthReady,
      preparing: state.icloudOAuthPreparing,
      busy: state.icloudOAuthBusy,
      hasOauthFile: state.oauthFileDraft.kind === OAuthFileDraftKind.Configured,
      oauthPreset:
        state.oauthFileDraft.kind === OAuthFileDraftKind.Configured
          ? state.oauthFileDraft.config.preset
          : "",
      storageMode: state.storageMode,
    };
    log.info("iCloud sign-in finished", infoArgs6);
  }
}

export async function prepareICloudSignIn(state: VaultState): Promise<void> {
  const infoArgs7: Parameters<typeof log.info>[1] = {
    ready: state.icloudOAuthReady,
    preparing: state.icloudOAuthPreparing,
    configured: isICloudOAuthConfigured(),
  };
  log.info("iCloud sign-in prepare requested", infoArgs7);
  if (
    state.icloudOAuthReady ||
    state.icloudOAuthPreparing ||
    !isICloudOAuthConfigured()
  ) {
    const infoArgs8: Parameters<typeof log.info>[1] = {
      ready: state.icloudOAuthReady,
      preparing: state.icloudOAuthPreparing,
      configured: isICloudOAuthConfigured(),
    };
    log.info("iCloud sign-in prepare skipped", infoArgs8);
    return;
  }
  const support = resolveCurrentOAuthOriginSupport(BrowserOAuthProvider.ICloud);
  if (!support.supported) {
    log.warn("iCloud sign-in prepare blocked by origin", support);
    return;
  }
  state.icloudOAuthPreparing = true;
  try {
    await prepareICloudSignInControl();
    state.icloudOAuthReady = true;
    const infoArgs9: Parameters<typeof log.info>[1] = {
      ready: state.icloudOAuthReady,
      origin: support.origin,
    };
    log.info("iCloud sign-in prepare completed", infoArgs9);
  } catch (error) {
    state.icloudOAuthReady = false;
    state.errorMsg = state.t(
      error instanceof Error &&
        error.message.startsWith("provider_setup.icloud_")
        ? error.message
        : I18N_KEYS.ProviderSetupIcloudSignInFailed,
    );
    const warnArgs3: Parameters<typeof log.warn>[1] = { error: state.errorMsg };
    log.warn("iCloud sign-in prepare failed", warnArgs3);
  } finally {
    state.icloudOAuthPreparing = false;
  }
}

async function applyICloudOAuthTokens({
  state,
  tokens,
}: {
  readonly state: VaultState;
  readonly tokens: ICloudOAuthTokens;
}): Promise<void> {
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
  const accessCredential = oauthAccessToken(oauthFile);
  const infoArgs10: Parameters<typeof log.info>[1] = {
    storageMode: state.storageMode,
    oauthSetupPreset:
      state.oauthSetupSelection.kind === OAuthSetupPresetKind.Selected
        ? state.oauthSetupSelection.preset
        : "",
    hasOauthFile: true,
    fileName: oauthFile.fileName,
    hasAccessToken: accessCredential.kind === OAuthAccessTokenKind.Available,
    tokenLength:
      accessCredential.kind === OAuthAccessTokenKind.Available
        ? accessCredential.token.length
        : 0,
  };
  log.info("iCloud oauth tokens applied to vault state", infoArgs10);
}

function ensureSupportedOAuthOrigin({
  state,
  provider,
}: {
  readonly state: VaultState;
  readonly provider: BrowserOAuthProvider;
}): boolean {
  const support = resolveCurrentOAuthOriginSupport(provider);
  if (support.supported) {
    const infoArgs11: Parameters<typeof log.info>[1] = {
      provider,
      origin: support.origin,
    };
    log.info("oauth origin supported", infoArgs11);
    return true;
  }
  const warnArgs4: Parameters<typeof log.warn>[1] = {
    provider,
    origin: support.origin,
    reason: support.reason,
  };
  log.warn("oauth origin unsupported", warnArgs4);
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
}: {
  readonly state: VaultState;
  readonly tokens: GoogleOAuthTokens;
}): Promise<void> {
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
