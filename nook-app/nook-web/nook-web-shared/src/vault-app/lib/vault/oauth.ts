import {
  VaultStorageFailure,
  VaultStorageFailureKind,
} from "$lib/runtime/storage-failure";
import { err, ok, type Result } from "neverthrow";
import {
  OAuthFailure,
  OAuthFailureKind,
  SharedStorageGrantFailure,
} from "$lib/auth/oauth-failure";
import { I18N_KEYS } from "../../../generated/i18n-keys";
import type { VaultState } from "$lib/vault.svelte";
import {
  bind_google_drive_shared_folder,
  configuredOAuthFile,
  defaultOAuthFileConfig,
  DEFAULT_DRIVE_BACKUP_NAME,
  findDuplicateSyncProvider,
  oauth_access_token,
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
  type StoredOAuthFileConfiguration,
} from "$lib/auth/providers";
import { verify_shared_google_drive_folder } from "$app-wasm";
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

  async ensureOAuthTokensFresh(): Promise<
    Result<void, OAuthFailure | VaultStorageFailure>
  > {
    const state = this.state;
    if (
      state.storageMode !== "oauth-file" ||
      state.oauthFileDraft.kind !== OAuthFileDraftKind.Configured
    ) {
      return ok();
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
        : { state: "unique" };
    const refresh =
      oauthFile.preset === "icloud"
        ? await iCloudOAuthSession.ensureValidICloudOAuthFileConfig(oauthFile)
        : await googleOAuthSession.ensureValidOAuthFileConfig(oauthFile);
    if (refresh.isErr()) return err(refresh.error);
    if (
      state.localDataDeletionStarted ||
      state.oauthFileDraft.kind !== OAuthFileDraftKind.Configured ||
      state.oauthFileDraft.config !== oauthFile
    )
      return err(
        new VaultStorageFailure(VaultStorageFailureKind.GenerationChanged),
      );
    const refreshed = refresh.value;
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
      return ok();
    }
    if (providerToRefresh.state === "duplicate") {
      const providers = state.providers.map((provider) =>
        provider.id === providerToRefresh.provider.id
          ? { ...provider, oauthFile: configuredOAuthFile(refreshed) }
          : provider,
      );
      const persistenceOptions: Parameters<typeof state.persistProviders>[0] = {
        replace: false,
        providers,
      };
      const persisted = await state.persistProviders(persistenceOptions);
      if (persisted.isErr()) return err(persisted.error);
    }
    state.configureOauthFile(refreshed);
    log.info("oauth token freshness check refreshed provider");
    return ok();
  }

  private bindSharedICloudTarget({
    config,
    storageTargetId,
  }: SharedICloudTargetBinding): Result<OAuthFileConfig, OAuthFailure> {
    try {
      // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
      return ok({
        ...config,
        iCloudMode: "shared",
        iCloudShareTarget: storedICloudShareTarget(storageTargetId),
        fileId: unresolvedOAuthRemoteFileId(),
      });
    } catch {
      return err(new OAuthFailure(OAuthFailureKind.InvalidConfiguration));
    }
  }

  async signInWithGoogle(): Promise<void> {
    const state = this.state;
    if (!googleOAuthSession.isGoogleOAuthConfigured()) {
      state.errorMsg = state.t(I18N_KEYS.ProviderSetupGoogleOauthUnconfigured);
      return;
    }
    if (
      // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
      !this.ensureSupportedOAuthOrigin({
        provider: BrowserOAuthProvider.GoogleDrive,
      })
    )
      return;
    state.googleOAuthBusy = true;
    state.errorMsg = "";
    try {
      const shared =
        state.oauthFileDraft.kind === OAuthFileDraftKind.Configured &&
        (state.oauthFileDraft.config.driveMode === "shared" ||
          state.oauthFileDraft.config.folderId.state === "folderId");
      // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
      const tokens = await googleOAuthSession.requestGoogleAccessToken({
        prompt: GoogleOAuthPrompt.Consent,
        scope: shared
          ? GoogleDriveOAuthScope.Shared
          : GoogleDriveOAuthScope.AppData,
      });
      if (tokens.isErr()) {
        state.errorMsg = state.t(tokens.error.translationKey);
        return;
      }
      // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
      const applied = await this.applyGoogleOAuthTokens({
        tokens: tokens.value,
      });
      if (applied.isErr())
        state.errorMsg = state.t(applied.error.translationKey);
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

  async createICloudSharedProvider(): Promise<Result<void, OAuthFailure>> {
    const state = this.state;
    if (
      state.oauthFileDraft.kind !== OAuthFileDraftKind.Configured ||
      oauth_access_token(state.oauthFileDraft.config).kind === "missing"
    )
      return err(new OAuthFailure(OAuthFailureKind.SharedSignInRequired));
    const target = await iCloudOAuthSession.createICloudSharedVault(
      state.githubRepo.trim() || DEFAULT_DRIVE_BACKUP_NAME,
    );
    if (target.isErr()) return err(target.error);
    // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
    const bound = this.bindSharedICloudTarget({
      config: state.oauthFileDraft.config,
      storageTargetId: target.value.storageTargetId,
    });
    if (bound.isErr()) return err(bound.error);
    state.configureOauthFile(bound.value);
    state.sharedGrantInstructions = state.t(
      I18N_KEYS.ProviderSetupIcloudSharedCreated,
    );
    return ok();
  }

  async useICloudSharedProvider({
    shareReference,
  }: ICloudSharedProviderAccess): Promise<Result<void, OAuthFailure>> {
    const state = this.state;
    if (
      state.oauthFileDraft.kind !== OAuthFileDraftKind.Configured ||
      oauth_access_token(state.oauthFileDraft.config).kind === "missing"
    )
      return err(new OAuthFailure(OAuthFailureKind.SharedSignInRequired));
    const target =
      await iCloudOAuthSession.acceptICloudSharedVault(shareReference);
    if (target.isErr()) return err(target.error);
    // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
    const bound = this.bindSharedICloudTarget({
      config: state.oauthFileDraft.config,
      storageTargetId: target.value.storageTargetId,
    });
    if (bound.isErr()) return err(bound.error);
    state.configureOauthFile(bound.value);
    state.sharedGrantInstructions = state.t(
      I18N_KEYS.ProviderSetupIcloudSharedConnected,
    );
    return ok();
  }

  async createGoogleSharedFolder({
    collaboratorEmail,
  }: GoogleSharedFolderCreation): Promise<
    Result<string, OAuthFailure | SharedStorageGrantFailure>
  > {
    const state = this.state;
    if (state.oauthFileDraft.kind !== OAuthFileDraftKind.Configured) {
      return err(new OAuthFailure(OAuthFailureKind.GoogleSharedSignInRequired));
    }
    const oauthFile = state.oauthFileDraft.config;
    const accessCredential = oauth_access_token(oauthFile);
    if (accessCredential.kind === "missing") {
      return err(new OAuthFailure(OAuthFailureKind.GoogleSharedSignInRequired));
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
    let grant;
    try {
      grant = await prepare_shared_storage_grant(prepareSharedStorageGrantArgs);
    } catch {
      return err(new OAuthFailure(OAuthFailureKind.GoogleSharedCreation));
    }
    if (grant.kind === "unsupported") {
      return err(new SharedStorageGrantFailure(grant));
    }
    const target = grant.target;
    if (target.state === "unavailable") {
      return err(new OAuthFailure(OAuthFailureKind.GoogleSharedCreation));
    }
    let bound;
    try {
      bound = bind_google_drive_shared_folder(
        oauthFile,
        target.storageTargetId,
      );
    } catch {
      return err(new OAuthFailure(OAuthFailureKind.InvalidConfiguration));
    }
    state.configureOauthFile(bound);
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
    return ok(target.state === "named" ? target.storageTargetName : folderName);
  }

  async useGoogleSharedFolder({
    folderRef,
  }: GoogleSharedFolderAccess): Promise<Result<string, OAuthFailure>> {
    const state = this.state;
    if (state.oauthFileDraft.kind !== OAuthFileDraftKind.Configured) {
      return err(new OAuthFailure(OAuthFailureKind.GoogleSharedSignInRequired));
    }
    const config = state.oauthFileDraft.config;
    const accessCredential = oauth_access_token(config);
    if (accessCredential.kind === "missing") {
      return err(new OAuthFailure(OAuthFailureKind.GoogleSharedSignInRequired));
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
        return err(new OAuthFailure(OAuthFailureKind.GoogleSharedNotFolder));
      }
      if (message.includes(I18N_KEYS.ProviderSetupGoogleSharedNotWritable)) {
        return err(new OAuthFailure(OAuthFailureKind.GoogleSharedNotWritable));
      }
      return err(new OAuthFailure(OAuthFailureKind.GoogleSharedConnection));
    }
    let bound;
    try {
      bound = bind_google_drive_shared_folder(config, folder.id);
    } catch {
      return err(new OAuthFailure(OAuthFailureKind.InvalidConfiguration));
    }
    state.configureOauthFile(bound);
    const tArgs3: Parameters<typeof state.t>[0] = {
      key: I18N_KEYS.ProviderSetupGoogleSharedFolderConnected,
      replacements: { folder: folder.name },
    };
    state.sharedGrantInstructions = state.t(tArgs3);
    return ok(folder.name);
  }

  async signInWithICloud({
    clickPreparedControl,
  }: ICloudSignInRequest): Promise<void> {
    const state = this.state;
    if (!iCloudOAuthSession.isICloudOAuthConfigured()) {
      state.errorMsg = state.t(I18N_KEYS.ProviderSetupIcloudOauthUnconfigured);
      return;
    }
    if (
      // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
      !this.ensureSupportedOAuthOrigin({
        provider: BrowserOAuthProvider.ICloud,
      })
    )
      return;
    state.icloudOAuthBusy = true;
    state.errorMsg = "";
    try {
      const wasReady = state.icloudOAuthReady;
      if (!wasReady) await this.prepareICloudSignIn();
      if (!state.icloudOAuthReady) {
        state.errorMsg = state.t(I18N_KEYS.ProviderSetupIcloudSignInLoading);
        return;
      }
      if (!wasReady) {
        state.errorMsg = state.t(I18N_KEYS.ProviderSetupIcloudSignInReady);
        return;
      }
      const tokens = await iCloudOAuthSession.requestPreparedICloudWebAuthToken(
        // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
        {
          clickSignInControl: clickPreparedControl,
          signInTimeoutMs: ICLOUD_SIGN_IN_TIMEOUT_MS,
        },
      );
      if (tokens.isErr()) {
        state.errorMsg = state.t(tokens.error.translationKey);
        return;
      }
      // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
      const applied = await this.applyICloudOAuthTokens({
        tokens: tokens.value,
      });
      if (applied.isErr())
        state.errorMsg = state.t(applied.error.translationKey);
    } finally {
      state.icloudOAuthBusy = false;
    }
  }

  async prepareICloudSignIn(): Promise<void> {
    const state = this.state;
    if (
      state.icloudOAuthReady ||
      state.icloudOAuthPreparing ||
      !iCloudOAuthSession.isICloudOAuthConfigured()
    )
      return;
    if (
      !resolveCurrentOAuthOriginSupport(BrowserOAuthProvider.ICloud).supported
    )
      return;
    state.icloudOAuthPreparing = true;
    try {
      const prepared = await iCloudOAuthSession.prepareICloudSignInControl();
      state.icloudOAuthReady = prepared.isOk();
      if (prepared.isErr())
        state.errorMsg = state.t(prepared.error.translationKey);
    } finally {
      state.icloudOAuthPreparing = false;
    }
  }

  private async applyICloudOAuthTokens({
    tokens,
  }: ICloudTokenApplication): Promise<Result<void, OAuthFailure>> {
    const state = this.state;
    const fallbackFileName =
      state.githubRepo.trim() || DEFAULT_DRIVE_BACKUP_NAME;
    let existing: StoredOAuthFileConfiguration;
    try {
      existing = configuredOAuthFile(
        state.oauthFileDraft.kind === OAuthFileDraftKind.Configured
          ? state.oauthFileDraft.config
          : // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
            defaultOAuthFileConfig({
              preset: "icloud",
              fileName: fallbackFileName,
            }),
      );
    } catch {
      return err(new OAuthFailure(OAuthFailureKind.InvalidConfiguration));
    }
    // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
    const converted = iCloudOAuthSession.oauthTokensToICloudConfig({
      tokens,
      existing,
    });
    if (converted.isErr()) return err(converted.error);
    state.activateLoginSetup("oauth-file");
    if (!state.addProviderOpen) state.storageMode = "oauth-file";
    state.selectOauthSetupPreset("icloud");
    state.configureOauthFile(converted.value);
    state.githubPat = "";
    const name = new OAuthFilePresentation(converted.value).oauthFileName();
    state.githubRepo =
      name.kind === OAuthFileNameKind.Resolved
        ? name.fileName
        : DEFAULT_DRIVE_BACKUP_NAME;
    return ok();
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
  }: GoogleTokenApplication): Promise<Result<void, OAuthFailure>> {
    const state = this.state;
    const email = await googleOAuthSession.fetchGoogleAccountEmail(
      tokens.accessToken,
    );
    if (email.isErr()) return err(email.error);
    const sharedFolderName = state.githubRepo.trim();
    const fallbackFileName = sharedFolderName || DEFAULT_DRIVE_BACKUP_NAME;
    let existing: StoredOAuthFileConfiguration;
    try {
      const previous =
        state.oauthFileDraft.kind === OAuthFileDraftKind.Configured
          ? state.oauthFileDraft.config
          : // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
            defaultOAuthFileConfig({
              preset: "google-drive",
              fileName: fallbackFileName,
            });
      // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
      existing = configuredOAuthFile({
        ...previous,
        fileName:
          previous.fileName.state === "fileName"
            ? previous.fileName
            : storedOAuthRemoteFileName(fallbackFileName),
        accountEmail:
          email.value.kind === GoogleAccountIdentityKind.Available
            ? storedOAuthAccountEmail(email.value.label)
            : previous.accountEmail,
      });
    } catch {
      return err(new OAuthFailure(OAuthFailureKind.InvalidConfiguration));
    }
    // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
    const converted = googleOAuthSession.oauthTokensToConfig({
      tokens,
      existing,
    });
    if (converted.isErr()) return err(converted.error);
    const config = converted.value;
    state.activateLoginSetup("oauth-file");
    if (!state.addProviderOpen) state.storageMode = "oauth-file";
    state.selectOauthSetupPreset("google-drive");
    state.configureOauthFile(config);
    state.githubPat = "";
    const name = new OAuthFilePresentation(config).oauthFileName();
    state.githubRepo =
      config.driveMode === "shared" || config.folderId.state === "folderId"
        ? sharedFolderName || DEFAULT_DRIVE_BACKUP_NAME
        : name.kind === OAuthFileNameKind.Resolved
          ? name.fileName
          : DEFAULT_DRIVE_BACKUP_NAME;
    return ok();
  }
}
