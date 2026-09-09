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
  OAuthFilePresentation,
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
  GoogleAccountIdentityKind,
  GoogleDriveOAuthScope,
  GoogleOAuthPrompt,
  type GoogleOAuthTokens,
  googleOAuthSession,
} from "$lib/auth/google/oauth";
import {
  ICLOUD_SIGN_IN_TIMEOUT_MS,
  type ICloudOAuthTokens,
  iCloudOAuthSession,
} from "$lib/auth/icloud/oauth";
import {
  BrowserOAuthProvider,
  OAuthOriginUnsupportedReason,
  resolveCurrentOAuthOriginSupport,
} from "$lib/auth/oauth-origin";
import { browserLogRuntime } from "$lib/runtime/log";
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

const log = browserLogRuntime.createLogger("vault-oauth");

export type ICloudSignInRequest = {
  readonly clickPreparedControl: boolean;
};

interface SharedICloudTargetBinding {
  readonly config: OAuthFileConfig;
  readonly storageTargetId: string;
}

export interface GoogleDriveModeSelection {
  readonly mode: GoogleDriveMode;
}

export interface ICloudModeSelection {
  readonly mode: ICloudMode;
}

export interface ICloudSharedProviderAccess {
  readonly shareReference: string;
}

export interface GoogleSharedFolderCreation {
  readonly collaboratorEmail: string;
}

export interface GoogleSharedFolderAccess {
  readonly folderRef: string;
}

interface ICloudTokenApplication {
  readonly tokens: ICloudOAuthTokens;
}

interface OAuthOriginRequirement {
  readonly provider: BrowserOAuthProvider;
}

interface GoogleTokenApplication {
  readonly tokens: GoogleOAuthTokens;
}

/** Owns browser orchestration for one oauth context. */
export class VaultOAuthActions {
  constructor(private readonly state: VaultState) {}

  async ensureOAuthTokensFresh(): Promise<void> {
    const state = this.state;
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
        ? await iCloudOAuthSession.ensureValidICloudOAuthFileConfig(oauthFile)
        : await googleOAuthSession.ensureValidOAuthFileConfig(oauthFile);
    if (
      refreshed.accessToken.state === oauthFile.accessToken.state &&
      (refreshed.accessToken.state === "signedOut" ||
        (oauthFile.accessToken.state === "accessToken" &&
          refreshed.accessToken.value === oauthFile.accessToken.value)) &&
      refreshed.expiresAt.state === oauthFile.expiresAt.state &&
      (refreshed.expiresAt.state === "unknown" ||
        (oauthFile.expiresAt.state === "expiresAt" &&
          refreshed.expiresAt.value === oauthFile.expiresAt.value))
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

  private static bindSharedICloudTarget({
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

  async signInWithGoogle(): Promise<void> {
    const state = this.state;
    if (!googleOAuthSession.isGoogleOAuthConfigured()) {
      state.errorMsg = state.t(I18N_KEYS.ProviderSetupGoogleOauthUnconfigured);
      return;
    }
    if (
      !(() => {
        const ensureSupportedOAuthOriginArgs: Parameters<
          VaultOAuthActions["ensureSupportedOAuthOrigin"]
        >[0] = { provider: BrowserOAuthProvider.GoogleDrive };
        return this.ensureSupportedOAuthOrigin(ensureSupportedOAuthOriginArgs);
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
              typeof googleOAuthSession.requestGoogleDriveSharedAccess
            >[0] = {
              prompt: GoogleOAuthPrompt.Consent,
            };
            return googleOAuthSession.requestGoogleDriveSharedAccess(
              requestGoogleDriveSharedAccessArgs,
            );
          })()
        : await (async () => {
            await googleOAuthSession.initGoogleAuth();
            const requestGoogleAccessTokenArgs: Parameters<
              typeof googleOAuthSession.requestGoogleAccessToken
            >[0] = {
              prompt: GoogleOAuthPrompt.Consent,
              scope: GoogleDriveOAuthScope.AppData,
            };
            return googleOAuthSession.requestGoogleAccessToken(
              requestGoogleAccessTokenArgs,
            );
          })();
      const applyGoogleOAuthTokensArgs: Parameters<
        VaultOAuthActions["applyGoogleOAuthTokens"]
      >[0] = { tokens };
      await this.applyGoogleOAuthTokens(applyGoogleOAuthTokensArgs);
    } catch (error) {
      state.errorMsg =
        error instanceof Error ? error.message : "Google sign-in failed.";
    } finally {
      state.googleOAuthBusy = false;
    }
  }

  selectGoogleDriveMode({ mode }: GoogleDriveModeSelection): void {
    const state = this.state;
    if (state.oauthFileDraft.kind !== OAuthFileDraftKind.Configured) return;
    const oauthFile = state.oauthFileDraft.config;
    if (oauthFile.preset !== "google-drive") return;
    const current = oauthFile.driveMode;
    if (current === mode) return;
    state.configureOauthFile(set_google_drive_provider_mode(oauthFile, mode));
    state.sharedGrantInstructions = "";
    state.errorMsg = "";
  }

  selectICloudMode({ mode }: ICloudModeSelection): void {
    const state = this.state;
    if (state.oauthFileDraft.kind !== OAuthFileDraftKind.Configured) return;
    const oauthFile = state.oauthFileDraft.config;
    if (oauthFile.preset !== "icloud") return;
    const current = oauthFile.iCloudMode;
    if (current === mode) return;
    state.configureOauthFile(set_icloud_provider_mode(oauthFile, mode));
    state.sharedGrantInstructions = "";
    state.errorMsg = "";
  }

  async createICloudSharedProvider(): Promise<void> {
    const state = this.state;
    if (
      state.oauthFileDraft.kind !== OAuthFileDraftKind.Configured ||
      oauthAccessToken(state.oauthFileDraft.config).kind ===
        OAuthAccessTokenKind.Missing
    ) {
      throw new Error(state.t(I18N_KEYS.ProviderSetupIcloudSharedSignInFirst));
    }
    let target;
    try {
      target = await iCloudOAuthSession.createICloudSharedVault(
        state.githubRepo.trim() || DEFAULT_DRIVE_BACKUP_NAME,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const ErrorArgs: ConstructorParameters<typeof Error>[1] = {
        cause: error,
      };
      throw new Error(
        message.startsWith("provider_setup.")
          ? state.t(message)
          : state.t(I18N_KEYS.ProviderSetupIcloudSharedCreateFailed),
        ErrorArgs,
      );
    }
    const bindSharedICloudTargetArgs: Parameters<
      typeof VaultOAuthActions.bindSharedICloudTarget
    >[0] = {
      config: state.requireOauthFileConfig(),
      storageTargetId: target.storageTargetId,
    };
    state.configureOauthFile(
      VaultOAuthActions.bindSharedICloudTarget(bindSharedICloudTargetArgs),
    );
    state.sharedGrantInstructions = state.t(
      I18N_KEYS.ProviderSetupIcloudSharedCreated,
    );
  }

  async useICloudSharedProvider({
    shareReference,
  }: ICloudSharedProviderAccess): Promise<void> {
    const state = this.state;
    if (
      state.oauthFileDraft.kind !== OAuthFileDraftKind.Configured ||
      oauthAccessToken(state.oauthFileDraft.config).kind ===
        OAuthAccessTokenKind.Missing
    ) {
      throw new Error(state.t(I18N_KEYS.ProviderSetupIcloudSharedSignInFirst));
    }
    let target;
    try {
      target = await iCloudOAuthSession.acceptICloudSharedVault(shareReference);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const ErrorArgs2: ConstructorParameters<typeof Error>[1] = {
        cause: error,
      };
      throw new Error(
        message.startsWith("provider_setup.")
          ? state.t(message)
          : state.t(I18N_KEYS.ProviderSetupIcloudSharedConnectFailed),
        ErrorArgs2,
      );
    }
    const bindSharedICloudTargetArgs2: Parameters<
      typeof VaultOAuthActions.bindSharedICloudTarget
    >[0] = {
      config: state.requireOauthFileConfig(),
      storageTargetId: target.storageTargetId,
    };
    state.configureOauthFile(
      VaultOAuthActions.bindSharedICloudTarget(bindSharedICloudTargetArgs2),
    );
    state.sharedGrantInstructions = state.t(
      I18N_KEYS.ProviderSetupIcloudSharedConnected,
    );
  }

  async createGoogleSharedFolder({
    collaboratorEmail,
  }: GoogleSharedFolderCreation): Promise<string> {
    const state = this.state;
    if (state.oauthFileDraft.kind !== OAuthFileDraftKind.Configured) {
      throw new Error(state.t(I18N_KEYS.ProviderSetupGoogleSharedSignInFirst));
    }
    const oauthFile = state.oauthFileDraft.config;
    const accessCredential = oauthAccessToken(oauthFile);
    if (accessCredential.kind === OAuthAccessTokenKind.Missing) {
      throw new Error(state.t(I18N_KEYS.ProviderSetupGoogleSharedSignInFirst));
    }
    const remoteFileName = new OAuthFilePresentation(oauthFile).oauthFileName();
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

  async useGoogleSharedFolder({
    folderRef,
  }: GoogleSharedFolderAccess): Promise<string> {
    const state = this.state;
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
      bind_google_drive_shared_folder(
        state.requireOauthFileConfig(),
        folder.id,
      ),
    );
    const tArgs3: Parameters<typeof state.t>[0] = {
      key: I18N_KEYS.ProviderSetupGoogleSharedFolderConnected,
      replacements: { folder: folder.name },
    };
    state.sharedGrantInstructions = state.t(tArgs3);
    return folder.name;
  }

  async signInWithICloud({
    clickPreparedControl,
  }: ICloudSignInRequest): Promise<void> {
    const state = this.state;
    log.info("iCloud sign-in requested");
    if (!iCloudOAuthSession.isICloudOAuthConfigured()) {
      state.errorMsg = state.t(I18N_KEYS.ProviderSetupIcloudOauthUnconfigured);
      log.warn("iCloud sign-in blocked: not configured");
      return;
    }
    if (
      !(() => {
        const ensureSupportedOAuthOriginArgs2: Parameters<
          VaultOAuthActions["ensureSupportedOAuthOrigin"]
        >[0] = { provider: BrowserOAuthProvider.ICloud };
        return this.ensureSupportedOAuthOrigin(ensureSupportedOAuthOriginArgs2);
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
        await this.prepareICloudSignIn();
      }
      if (!state.icloudOAuthReady) {
        log.warn("iCloud sign-in blocked: control not ready after prepare ");
        throw new Error(I18N_KEYS.ProviderSetupIcloudSignInLoading);
      }
      if (!wasReady) {
        log.info(
          "iCloud sign-in control became ready; waiting for second click",
        );
        throw new Error(I18N_KEYS.ProviderSetupIcloudSignInReady);
      }
      const requestPreparedICloudWebAuthTokenArgs: Parameters<
        typeof iCloudOAuthSession.requestPreparedICloudWebAuthToken
      >[0] = {
        clickSignInControl: clickPreparedControl,
        signInTimeoutMs: ICLOUD_SIGN_IN_TIMEOUT_MS,
      };
      const tokenRequest = iCloudOAuthSession.requestPreparedICloudWebAuthToken(
        requestPreparedICloudWebAuthTokenArgs,
      );
      const tokens = await tokenRequest;
      log.info("iCloud sign-in returned token");
      const applyICloudOAuthTokensArgs: Parameters<
        VaultOAuthActions["applyICloudOAuthTokens"]
      >[0] = { tokens };
      await this.applyICloudOAuthTokens(applyICloudOAuthTokensArgs);
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

  async prepareICloudSignIn(): Promise<void> {
    const state = this.state;
    log.info("iCloud sign-in prepare requested");
    if (
      state.icloudOAuthReady ||
      state.icloudOAuthPreparing ||
      !iCloudOAuthSession.isICloudOAuthConfigured()
    ) {
      log.info("iCloud sign-in prepare skipped");
      return;
    }
    const support = resolveCurrentOAuthOriginSupport(
      BrowserOAuthProvider.ICloud,
    );
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
      await iCloudOAuthSession.prepareICloudSignInControl();
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

  private async applyICloudOAuthTokens({
    tokens,
  }: ICloudTokenApplication): Promise<void> {
    const state = this.state;
    state.activateLoginSetup("oauth-file");
    if (!state.addProviderOpen) {
      state.storageMode = "oauth-file";
    }
    state.selectOauthSetupPreset("icloud");
    const previousOauthFile = state.oauthFileDraft;
    const fallbackFileName =
      state.githubRepo.trim() || DEFAULT_DRIVE_BACKUP_NAME;
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
      typeof iCloudOAuthSession.oauthTokensToICloudConfig
    >[0] = { tokens, existing: existingConfiguration };
    state.configureOauthFile(
      iCloudOAuthSession.oauthTokensToICloudConfig(
        oauthTokensToICloudConfigArgs,
      ),
    );
    const oauthFile = state.requireOauthFileConfig();
    state.githubPat = "";
    const resolvedFileName = new OAuthFilePresentation(
      oauthFile,
    ).oauthFileName();
    state.githubRepo =
      resolvedFileName.kind === OAuthFileNameKind.Resolved
        ? resolvedFileName.fileName
        : DEFAULT_DRIVE_BACKUP_NAME;
    log.info("iCloud oauth tokens applied to vault state");
  }

  private ensureSupportedOAuthOrigin({
    provider,
  }: OAuthOriginRequirement): boolean {
    const state = this.state;
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

  private async applyGoogleOAuthTokens({
    tokens,
  }: GoogleTokenApplication): Promise<void> {
    const state = this.state;
    const email = await googleOAuthSession.fetchGoogleAccountEmail(
      tokens.accessToken,
    );
    const sharedFolderName = state.githubRepo.trim();
    state.activateLoginSetup("oauth-file");
    if (!state.addProviderOpen) {
      state.storageMode = "oauth-file";
    }
    state.selectOauthSetupPreset("google-drive");
    const previousOauthFile = state.oauthFileDraft;
    const fallbackFileName =
      state.githubRepo.trim() || DEFAULT_DRIVE_BACKUP_NAME;
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
    const oauthTokensToConfigArgs: Parameters<
      typeof googleOAuthSession.oauthTokensToConfig
    >[0] = {
      tokens,
      existing: configuredOAuthFile(existingConfig),
    };
    state.configureOauthFile(
      googleOAuthSession.oauthTokensToConfig(oauthTokensToConfigArgs),
    );
    const oauthFile = state.requireOauthFileConfig();
    state.githubPat = "";
    const sharedGoogleDrive =
      oauthFile.driveMode === "shared" ||
      oauthFile.folderId.state === "folderId";
    const resolvedFileName = new OAuthFilePresentation(
      oauthFile,
    ).oauthFileName();
    state.githubRepo = sharedGoogleDrive
      ? sharedFolderName || DEFAULT_DRIVE_BACKUP_NAME
      : resolvedFileName.kind === OAuthFileNameKind.Resolved
        ? resolvedFileName.fileName
        : DEFAULT_DRIVE_BACKUP_NAME;
  }
}
