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
} from "$lib/auth-providers";
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
} from "$lib/google-oauth";
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
} from "$lib/icloud-oauth";
import {
  BrowserOAuthProvider,
  resolveCurrentOAuthOriginSupport,
} from "$lib/oauth-origin";
import { createLogger } from "$lib/log";
import {
  prepareSharedStorageGrant,
  createSharedStorageTarget,
  providerOauthPresetForConfig,
  resolveSharedStorageGrantTarget,
  sharedStorageGrantAccessToken,
  SharedStorageGrantTargetKind,
  suggestedSharedStorageTarget,
} from "$lib/vault-architecture";
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
  log.info("oauth token freshness check started", {
    preset: oauthFile.preset,
    hasAccessToken:
      oauthAccessToken(oauthFile).kind === OAuthAccessTokenKind.Available,
    expiresAt: oauthFile.expiresAt,
  });
  const providerToRefresh: ReturnType<typeof findDuplicateSyncProvider> =
    state.loginSetup.kind !== LoginSetupKind.Active && !state.addProviderOpen
      ? findDuplicateSyncProvider(state.syncProviders, {
          ...providerPersistenceDefaults(),
          id: "oauth-refresh-target",
          type: OAUTH_FILE_PROVIDER_TYPE,
          label: "",
          oauthFile: configuredOAuthFile(oauthFile),
          createdAt: "",
        })
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
    log.info("oauth token freshness check kept existing token", {
      preset: refreshed.preset,
      expiresAt: refreshed.expiresAt,
    });
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
  log.info("oauth token freshness check refreshed provider", {
    preset: refreshed.preset,
    expiresAt: refreshed.expiresAt,
    ...(providerToRefresh.state === NookDuplicateSyncProviderState.Duplicate
      ? { providerId: providerToRefresh.provider.id }
      : {}),
  });
}

function bindSharedICloudTarget(
  config: OAuthFileConfig,
  storageTargetId: string,
): OAuthFileConfig {
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
    state.errorMsg = state.t("provider_setup.google_oauth_unconfigured");
    return;
  }
  if (!ensureSupportedOAuthOrigin(state, BrowserOAuthProvider.GoogleDrive)) {
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
      ? await requestGoogleDriveSharedAccess({
          prompt: GoogleOAuthPrompt.Consent,
        })
      : await (async () => {
          await initGoogleAuth();
          return requestGoogleAccessToken({
            prompt: GoogleOAuthPrompt.Consent,
          });
        })();
    await applyGoogleOAuthTokens(state, tokens);
  } catch (error) {
    state.errorMsg =
      error instanceof Error ? error.message : "Google sign-in failed.";
  } finally {
    state.googleOAuthBusy = false;
  }
}

export function selectGoogleDriveMode(
  state: VaultState,
  mode: GoogleDriveMode,
): void {
  if (state.oauthFileDraft.kind !== OAuthFileDraftKind.Configured) return;
  const oauthFile = state.oauthFileDraft.config;
  if (oauthFile.preset !== "google-drive") return;
  const current = oauthFile.driveMode;
  if (current === mode) return;
  state.configureOauthFile(setGoogleDriveProviderMode(oauthFile, mode));
  state.sharedGrantInstructions = "";
  state.errorMsg = "";
}

export function selectICloudMode(state: VaultState, mode: ICloudMode): void {
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
    throw new Error(state.t("provider_setup.icloud_shared_sign_in_first"));
  }
  let target;
  try {
    target = await createICloudSharedVault(
      state.githubRepo.trim() || DEFAULT_DRIVE_BACKUP_NAME,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    throw new Error(
      message.startsWith("provider_setup.")
        ? state.t(message)
        : state.t("provider_setup.icloud_shared_create_failed"),
      { cause: error },
    );
  }
  state.configureOauthFile(
    bindSharedICloudTarget(
      state.requireOauthFileConfig(),
      target.storageTargetId,
    ),
  );
  state.sharedGrantInstructions = state.t(
    "provider_setup.icloud_shared_created",
  );
}

export async function useICloudSharedProvider(
  state: VaultState,
  shareReference: string,
): Promise<void> {
  if (
    state.oauthFileDraft.kind !== OAuthFileDraftKind.Configured ||
    oauthAccessToken(state.oauthFileDraft.config).kind ===
      OAuthAccessTokenKind.Missing
  ) {
    throw new Error(state.t("provider_setup.icloud_shared_sign_in_first"));
  }
  let target;
  try {
    target = await acceptICloudSharedVault(shareReference);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    throw new Error(
      message.startsWith("provider_setup.")
        ? state.t(message)
        : state.t("provider_setup.icloud_shared_connect_failed"),
      { cause: error },
    );
  }
  state.configureOauthFile(
    bindSharedICloudTarget(
      state.requireOauthFileConfig(),
      target.storageTargetId,
    ),
  );
  state.sharedGrantInstructions = state.t(
    "provider_setup.icloud_shared_connected",
  );
}

export async function createGoogleSharedFolder(
  state: VaultState,
  collaboratorEmail: string,
): Promise<string> {
  if (state.oauthFileDraft.kind !== OAuthFileDraftKind.Configured) {
    throw new Error(state.t("provider_setup.google_shared_sign_in_first"));
  }
  const oauthFile = state.oauthFileDraft.config;
  const accessCredential = oauthAccessToken(oauthFile);
  if (accessCredential.kind === OAuthAccessTokenKind.Missing) {
    throw new Error(state.t("provider_setup.google_shared_sign_in_first"));
  }
  const remoteFileName = oauthFileName(oauthFile);
  const folderName = state.githubRepo.trim()
    ? state.githubRepo.trim()
    : remoteFileName.kind === OAuthFileNameKind.Resolved
      ? remoteFileName.fileName
      : DEFAULT_DRIVE_BACKUP_NAME;
  const grant = await prepareSharedStorageGrant({
    providerType: OAUTH_FILE_PROVIDER_TYPE,
    oauthPreset: providerOauthPresetForConfig(oauthFile),
    joinerIdentityKind: "email",
    joinerIdentity: collaboratorEmail,
    storageTargetHint: suggestedSharedStorageTarget(folderName),
    storageTarget: createSharedStorageTarget(),
    credential: sharedStorageGrantAccessToken(accessCredential.token),
  });
  if (grant.kind === "unsupported") {
    throw new Error(state.t(grant.reasonKey));
  }
  const target = resolveSharedStorageGrantTarget(grant.target);
  if (target.kind === SharedStorageGrantTargetKind.Unavailable) {
    throw new Error(state.t("provider_setup.google_shared_create_failed"));
  }
  state.configureOauthFile(
    bindGoogleDriveSharedFolder(
      state.requireOauthFileConfig(),
      target.storageTargetId,
    ),
  );
  state.sharedGrantInstructions =
    grant.kind === "granted"
      ? state.t("provider_setup.google_shared_folder_created", {
          email: collaboratorEmail.trim(),
          folder:
            target.kind === SharedStorageGrantTargetKind.Named
              ? target.storageTargetName
              : target.storageTargetId,
        })
      : state.t(grant.instructionsKey, {
          email: grant.joinerIdentity,
          folder:
            target.kind === SharedStorageGrantTargetKind.Named
              ? target.storageTargetName
              : target.storageTargetId,
        });
  return target.kind === SharedStorageGrantTargetKind.Named
    ? target.storageTargetName
    : folderName;
}

export async function useGoogleSharedFolder(
  state: VaultState,
  folderRef: string,
): Promise<string> {
  const accessCredential =
    state.oauthFileDraft.kind === OAuthFileDraftKind.Configured
      ? oauthAccessToken(state.oauthFileDraft.config)
      : missingOAuthAccessToken();
  if (accessCredential.kind === OAuthAccessTokenKind.Missing) {
    throw new Error(state.t("provider_setup.google_shared_sign_in_first"));
  }
  let folder;
  try {
    folder = await verifySharedGoogleDriveFolder(
      accessCredential.token,
      folderRef,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("provider_setup.google_shared_not_folder")) {
      throw new Error(state.t("provider_setup.google_shared_not_folder"), {
        cause: error,
      });
    }
    if (message.includes("provider_setup.google_shared_not_writable")) {
      throw new Error(state.t("provider_setup.google_shared_not_writable"), {
        cause: error,
      });
    }
    throw error;
  }
  state.configureOauthFile(
    bindGoogleDriveSharedFolder(state.requireOauthFileConfig(), folder.id),
  );
  state.sharedGrantInstructions = state.t(
    "provider_setup.google_shared_folder_connected",
    { folder: folder.name },
  );
  return folder.name;
}

export async function signInWithICloud(
  state: VaultState,
  options: { clickPreparedControl?: boolean } = {},
): Promise<void> {
  log.info("iCloud sign-in requested", {
    configured: isICloudOAuthConfigured(),
    ready: state.icloudOAuthReady,
    preparing: state.icloudOAuthPreparing,
    busy: state.icloudOAuthBusy,
    clickPreparedControl: options.clickPreparedControl === true,
  });
  if (!isICloudOAuthConfigured()) {
    state.errorMsg = state.t("provider_setup.icloud_oauth_unconfigured");
    log.warn("iCloud sign-in blocked: not configured");
    return;
  }
  if (!ensureSupportedOAuthOrigin(state, BrowserOAuthProvider.ICloud)) {
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
      log.warn("iCloud sign-in blocked: control not ready after prepare", {
        wasReady,
        ready: state.icloudOAuthReady,
        preparing: state.icloudOAuthPreparing,
      });
      throw new Error("provider_setup.icloud_sign_in_loading");
    }
    if (!wasReady) {
      log.info("iCloud sign-in control became ready; waiting for second click");
      throw new Error("provider_setup.icloud_sign_in_ready");
    }
    const tokenRequest = requestPreparedICloudWebAuthToken({
      clickSignInControl: options.clickPreparedControl,
    });
    const tokens = await tokenRequest;
    log.info("iCloud sign-in returned token", {
      hasAccessToken: Boolean(tokens.accessToken.trim()),
      tokenLength: tokens.accessToken.length,
      hasAccountName:
        tokens.accountName.kind === ICloudAccountNameKind.Available,
    });
    await applyICloudOAuthTokens(state, tokens);
  } catch (error) {
    state.errorMsg = state.t(
      error instanceof Error &&
        error.message.startsWith("provider_setup.icloud_")
        ? error.message
        : "provider_setup.icloud_sign_in_failed",
    );
    log.warn("iCloud sign-in failed", { error: state.errorMsg });
  } finally {
    state.icloudOAuthBusy = false;
    log.info("iCloud sign-in finished", {
      ready: state.icloudOAuthReady,
      preparing: state.icloudOAuthPreparing,
      busy: state.icloudOAuthBusy,
      hasOauthFile: state.oauthFileDraft.kind === OAuthFileDraftKind.Configured,
      oauthPreset:
        state.oauthFileDraft.kind === OAuthFileDraftKind.Configured
          ? state.oauthFileDraft.config.preset
          : "",
      storageMode: state.storageMode,
    });
  }
}

export async function prepareICloudSignIn(state: VaultState): Promise<void> {
  log.info("iCloud sign-in prepare requested", {
    ready: state.icloudOAuthReady,
    preparing: state.icloudOAuthPreparing,
    configured: isICloudOAuthConfigured(),
  });
  if (
    state.icloudOAuthReady ||
    state.icloudOAuthPreparing ||
    !isICloudOAuthConfigured()
  ) {
    log.info("iCloud sign-in prepare skipped", {
      ready: state.icloudOAuthReady,
      preparing: state.icloudOAuthPreparing,
      configured: isICloudOAuthConfigured(),
    });
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
    log.info("iCloud sign-in prepare completed", {
      ready: state.icloudOAuthReady,
      origin: support.origin,
    });
  } catch (error) {
    state.icloudOAuthReady = false;
    state.errorMsg = state.t(
      error instanceof Error &&
        error.message.startsWith("provider_setup.icloud_")
        ? error.message
        : "provider_setup.icloud_sign_in_failed",
    );
    log.warn("iCloud sign-in prepare failed", { error: state.errorMsg });
  } finally {
    state.icloudOAuthPreparing = false;
  }
}

async function applyICloudOAuthTokens(
  state: VaultState,
  tokens: ICloudOAuthTokens,
): Promise<void> {
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
      : configuredOAuthFile(defaultOAuthFileConfig("icloud", fallbackFileName));
  state.configureOauthFile(
    oauthTokensToICloudConfig(tokens, existingConfiguration),
  );
  const oauthFile = state.requireOauthFileConfig();
  state.githubPat = "";
  const resolvedFileName = oauthFileName(oauthFile);
  state.githubRepo =
    resolvedFileName.kind === OAuthFileNameKind.Resolved
      ? resolvedFileName.fileName
      : DEFAULT_DRIVE_BACKUP_NAME;
  const accessCredential = oauthAccessToken(oauthFile);
  log.info("iCloud oauth tokens applied to vault state", {
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
  });
}

function ensureSupportedOAuthOrigin(
  state: VaultState,
  provider: BrowserOAuthProvider,
): boolean {
  const support = resolveCurrentOAuthOriginSupport(provider);
  if (support.supported) {
    log.info("oauth origin supported", {
      provider,
      origin: support.origin,
    });
    return true;
  }
  log.warn("oauth origin unsupported", {
    provider,
    origin: support.origin,
    reason: support.reason,
  });
  state.errorMsg = state.t(
    support.reason === "cloudflare-pr-preview"
      ? "provider_setup.oauth_preview_origin_unsupported"
      : "provider_setup.oauth_origin_unsupported",
    { origin: support.origin },
  );
  return false;
}

async function applyGoogleOAuthTokens(
  state: VaultState,
  tokens: GoogleOAuthTokens,
): Promise<void> {
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
      : defaultOAuthFileConfig("google-drive", fallbackFileName);
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
  state.configureOauthFile(
    oauthTokensToConfig(tokens, configuredOAuthFile(existingConfig)),
  );
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
