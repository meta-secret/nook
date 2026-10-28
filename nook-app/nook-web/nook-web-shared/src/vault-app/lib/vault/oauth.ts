import {
  isLocalDataInvalidationFailure,
  VaultStorageFailure,
  VaultStorageFailureKind,
} from "$lib/runtime/storage-failure";
import { err, ok, type Result } from "neverthrow";
import { OAuthFailure, OAuthFailureKind } from "$lib/auth/oauth-failure";
import { I18N_KEYS } from "../../../generated/i18n-keys";
import {
  VaultOperationStale,
  VaultOperationStaleKind,
} from "$lib/runtime/vault-operation-stale";
import type { VaultState } from "$lib/vault.svelte";
import {
  OAuthTokenFreshnessKind,
  type OAuthTokenFreshnessOutcome,
} from "$lib/vault/action-contexts";
import {
  bind_google_drive_shared_folder,
  configuredOAuthFile,
  defaultOAuthFileConfig,
  DEFAULT_DRIVE_BACKUP_NAME,
  findDuplicateSyncProvider,
  oauth_access_token,
  OAuthFilePresentation,
  OAuthFileNameKind,
  storedICloudShareTarget,
  storedOAuthAccountEmail,
  storedOAuthRemoteFileName,
  unresolvedOAuthRemoteFileId,
  OAUTH_FILE_PROVIDER_TYPE,
  providerPersistenceDefaults,
  type OAuthFileConfig,
  type StoredOAuthFileConfiguration,
} from "$lib/auth/providers";
import {
  connect_google_drive_vault_folder,
  list_google_drive_vaults,
  nook_provider_root_name,
  reveal_google_drive_names,
  type ProviderNameRevealOutcome,
  type LocalVaultOccupancy,
  type NookGoogleDriveVaultListing,
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

export enum OAuthOperationOutcome {
  ICloudSharedProviderCreated = "iCloudSharedProviderCreated",
  ICloudTokensApplied = "iCloudTokensApplied",
  GoogleTokensApplied = "googleTokensApplied",
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

export enum GoogleVaultFolderOrigin {
  /** Connect & sync created the folder. */
  Created = "created",
  /** The folder already existed; sync keeps the encrypted events in it. */
  Existing = "existing",
}

interface GoogleVaultFolderConnection {
  readonly name: string;
  readonly origin: GoogleVaultFolderOrigin;
}

/** A failed Drive root request: its message and the failure it otherwise is. */
interface DriveRootFailureReport {
  readonly message: string;
  readonly kind: OAuthFailureKind;
}

interface GoogleProviderTokenAdoption {
  /** The saved provider the tokens were granted for. */
  readonly config: OAuthFileConfig;
  readonly tokens: GoogleOAuthTokens;
}

/** Owns browser orchestration for one oauth context. */
export class VaultOAuthActions {
  constructor(private readonly state: VaultState) {}

  async ensureOAuthTokensFresh(): Promise<
    Result<
      OAuthTokenFreshnessOutcome | VaultOperationStale,
      OAuthFailure | VaultStorageFailure
    >
  > {
    const state = this.state;
    if (
      state.storageMode !== "oauth-file" ||
      state.oauthFileDraft.kind !== OAuthFileDraftKind.Configured
    ) {
      const outcome: OAuthTokenFreshnessOutcome = {
        kind: OAuthTokenFreshnessKind.NotConfigured,
      };
      return ok(outcome);
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
    if (
      refresh.isErr() &&
      refresh.error instanceof VaultStorageFailure &&
      isLocalDataInvalidationFailure(refresh.error)
    )
      return err(refresh.error);
    if (state.localDataDeletionStarted)
      return err(
        new VaultStorageFailure(VaultStorageFailureKind.DeletionActive),
      );
    if (
      state.oauthFileDraft.kind !== OAuthFileDraftKind.Configured ||
      state.oauthFileDraft.config !== oauthFile
    )
      return ok(
        new VaultOperationStale(VaultOperationStaleKind.ContextReplaced),
      );
    if (refresh.isErr()) return err(refresh.error);
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
      const outcome: OAuthTokenFreshnessOutcome = {
        kind: OAuthTokenFreshnessKind.AlreadyFresh,
      };
      return ok(outcome);
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
    const outcome: OAuthTokenFreshnessOutcome = {
      kind: OAuthTokenFreshnessKind.Refreshed,
    };
    return ok(outcome);
  }

  private bindSharedICloudTarget({
    config,
    storageTargetId,
  }: SharedICloudTargetBinding): Result<OAuthFileConfig, OAuthFailure> {
    try {
      const boundConfiguration: OAuthFileConfig = {
        ...config,
        iCloudShareTarget: storedICloudShareTarget(storageTargetId),
        fileId: unresolvedOAuthRemoteFileId(),
      };
      return ok(boundConfiguration);
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
    const originRequirement: OAuthOriginRequirement = {
      provider: BrowserOAuthProvider.GoogleDrive,
    };
    if (!this.ensureSupportedOAuthOrigin(originRequirement)) return;
    state.googleOAuthBusy = true;
    state.errorMsg = "";
    try {
      const tokenRequest: Parameters<
        typeof googleOAuthSession.requestGoogleAccessToken
      >[0] = {
        prompt: GoogleOAuthPrompt.Consent,
        // Least privilege: `drive.readonly` is requested only when another
        // account joins or is authorized.
        scope: GoogleDriveOAuthScope.VaultFolder,
        accountHint: "",
        // Earlier `drive.readonly` grants would bring back the warning.
        includeGrantedScopes: false,
      };
      const tokens =
        await googleOAuthSession.requestGoogleAccessToken(tokenRequest);
      if (tokens.isErr()) {
        state.errorMsg = state.t(tokens.error.translationKey);
        return;
      }
      const tokenApplication: GoogleTokenApplication = {
        tokens: tokens.value,
      };
      const applied = await this.applyGoogleOAuthTokens(tokenApplication);
      if (applied.isErr())
        state.errorMsg = state.t(applied.error.translationKey);
    } finally {
      state.googleOAuthBusy = false;
    }
  }

  async createICloudSharedProvider(): Promise<
    Result<OAuthOperationOutcome, OAuthFailure>
  > {
    const state = this.state;
    if (
      state.oauthFileDraft.kind !== OAuthFileDraftKind.Configured ||
      oauth_access_token(state.oauthFileDraft.config).kind === "missing"
    )
      return err(new OAuthFailure(OAuthFailureKind.SharedSignInRequired));
    // The share is titled like every provider account's Nook root.
    const target = await iCloudOAuthSession.createICloudSharedVault(
      nook_provider_root_name(),
    );
    if (target.isErr()) return err(target.error);
    const targetBinding: SharedICloudTargetBinding = {
      config: state.oauthFileDraft.config,
      storageTargetId: target.value.storageTargetId,
    };
    const bound = this.bindSharedICloudTarget(targetBinding);
    if (bound.isErr()) return err(bound.error);
    state.configureOauthFile(bound.value);
    return ok(OAuthOperationOutcome.ICloudSharedProviderCreated);
  }

  /**
   * Bind the draft to the account's one Nook root folder in My Drive: the
   * existing root, or a new one when the account has none. Every identity
   * and vault syncs in its own subfolder of it.
   */
  async connectGoogleVaultFolder(): Promise<
    Result<GoogleVaultFolderConnection, OAuthFailure>
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
    let folder;
    try {
      folder = await connect_google_drive_vault_folder(accessCredential.token);
    } catch (failure) {
      const report: DriveRootFailureReport = {
        message: failure instanceof Error ? failure.message : String(failure),
        kind: OAuthFailureKind.GoogleSharedCreation,
      };
      return err(this.driveRootFailure(report));
    }
    let bound;
    try {
      bound = bind_google_drive_shared_folder(oauthFile, folder.id);
    } catch {
      return err(new OAuthFailure(OAuthFailureKind.GoogleInvalidConfiguration));
    }
    state.configureOauthFile(bound);
    const connection: GoogleVaultFolderConnection = {
      name: folder.name,
      origin: folder.existed
        ? GoogleVaultFolderOrigin.Existing
        : GoogleVaultFolderOrigin.Created,
    };
    return ok(connection);
  }

  /**
   * What the signed-in account's Nook root already holds, read without
   * creating it: each vault's created and last-activity times, event count,
   * short id, and whether it belongs to this identity. Nothing is decrypted.
   */
  async listGoogleDriveVaults(
    localVault: LocalVaultOccupancy,
  ): Promise<Result<NookGoogleDriveVaultListing, OAuthFailure>> {
    const state = this.state;
    if (state.oauthFileDraft.kind !== OAuthFileDraftKind.Configured)
      return err(new OAuthFailure(OAuthFailureKind.GoogleSharedSignInRequired));
    const accessCredential = oauth_access_token(state.oauthFileDraft.config);
    if (accessCredential.kind === "missing")
      return err(new OAuthFailure(OAuthFailureKind.GoogleSharedSignInRequired));
    try {
      return ok(
        await list_google_drive_vaults(accessCredential.token, localVault),
      );
    } catch (failure) {
      const report: DriveRootFailureReport = {
        message: failure instanceof Error ? failure.message : String(failure),
        kind: OAuthFailureKind.GoogleVaultListing,
      };
      return err(this.driveRootFailure(report));
    }
  }

  /**
   * Show the listed vaults' names with one passkey tap. Rust re-derives this
   * device's app key from the passkey and decrypts the names in memory for
   * this page; nothing is stored or imported.
   */
  async revealGoogleDriveNames(): Promise<
    Result<ProviderNameRevealOutcome, OAuthFailure>
  > {
    const state = this.state;
    if (state.oauthFileDraft.kind !== OAuthFileDraftKind.Configured)
      return err(new OAuthFailure(OAuthFailureKind.GoogleSharedSignInRequired));
    const accessCredential = oauth_access_token(state.oauthFileDraft.config);
    if (accessCredential.kind === "missing")
      return err(new OAuthFailure(OAuthFailureKind.GoogleSharedSignInRequired));
    try {
      return ok(
        await reveal_google_drive_names(
          accessCredential.token,
          location.hostname,
        ),
      );
    } catch {
      return err(new OAuthFailure(OAuthFailureKind.GoogleNameReveal));
    }
  }

  /** A duplicated Nook root keeps its own message; anything else is `kind`. */
  private driveRootFailure({
    message,
    kind,
  }: DriveRootFailureReport): OAuthFailure {
    return new OAuthFailure(
      message.includes(
        I18N_KEYS.ErrorsValidationGoogleDriveVaultFolderAmbiguous,
      )
        ? OAuthFailureKind.GoogleVaultFolderAmbiguous
        : kind,
    );
  }

  /**
   * Keep tokens an incremental Drive grant returned on the provider they were
   * granted for, so its sync reads other accounts' events at once.
   */
  async adoptGoogleProviderTokens({
    config,
    tokens,
  }: GoogleProviderTokenAdoption): Promise<
    Result<OAuthOperationOutcome, OAuthFailure | VaultStorageFailure>
  > {
    const state = this.state;
    const update: Parameters<typeof googleOAuthSession.oauthTokensToConfig>[0] =
      { tokens, existing: configuredOAuthFile(config) };
    const converted = googleOAuthSession.oauthTokensToConfig(update);
    if (converted.isErr()) return err(converted.error);
    const refreshed = converted.value;
    const savedProviderLookup: Parameters<typeof findDuplicateSyncProvider>[0] =
      {
        providers: state.syncProviders,
        candidate: {
          ...providerPersistenceDefaults(),
          id: "oauth-grant-target",
          type: OAUTH_FILE_PROVIDER_TYPE,
          label: "",
          oauthFile: configuredOAuthFile(refreshed),
          createdAt: "",
        },
      };
    const saved = findDuplicateSyncProvider(savedProviderLookup);
    if (saved.state === "duplicate") {
      const persistence: Parameters<typeof state.persistProviders>[0] = {
        replace: false,
        providers: state.providers.map((provider) =>
          provider.id === saved.provider.id
            ? { ...provider, oauthFile: configuredOAuthFile(refreshed) }
            : provider,
        ),
      };
      const persisted = await state.persistProviders(persistence);
      if (persisted.isErr()) return err(persisted.error);
    }
    const draft = state.oauthFileDraft;
    if (
      draft.kind === OAuthFileDraftKind.Configured &&
      draft.config.folderId.state === "folderId" &&
      config.folderId.state === "folderId" &&
      draft.config.folderId.value === config.folderId.value
    )
      state.configureOauthFile(refreshed);
    return ok(OAuthOperationOutcome.GoogleTokensApplied);
  }

  async signInWithICloud({
    clickPreparedControl,
  }: ICloudSignInRequest): Promise<void> {
    const state = this.state;
    if (!iCloudOAuthSession.isICloudOAuthConfigured()) {
      state.errorMsg = state.t(I18N_KEYS.ProviderSetupIcloudOauthUnconfigured);
      return;
    }
    const originRequirement: OAuthOriginRequirement = {
      provider: BrowserOAuthProvider.ICloud,
    };
    if (!this.ensureSupportedOAuthOrigin(originRequirement)) return;
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
      const tokenRequest: Parameters<
        typeof iCloudOAuthSession.requestPreparedICloudWebAuthToken
      >[0] = {
        clickSignInControl: clickPreparedControl,
        signInTimeoutMs: ICLOUD_SIGN_IN_TIMEOUT_MS,
      };
      const tokens =
        await iCloudOAuthSession.requestPreparedICloudWebAuthToken(
          tokenRequest,
        );
      if (tokens.isErr()) {
        state.errorMsg = state.t(tokens.error.translationKey);
        return;
      }
      const tokenApplication: ICloudTokenApplication = {
        tokens: tokens.value,
      };
      const applied = await this.applyICloudOAuthTokens(tokenApplication);
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
  }: ICloudTokenApplication): Promise<
    Result<OAuthOperationOutcome, OAuthFailure>
  > {
    const state = this.state;
    const fallbackFileName =
      state.githubRepo.trim() || DEFAULT_DRIVE_BACKUP_NAME;
    let existing: StoredOAuthFileConfiguration;
    try {
      const fallbackRequest: Parameters<typeof defaultOAuthFileConfig>[0] = {
        preset: "icloud",
        fileName: fallbackFileName,
      };
      existing = configuredOAuthFile(
        state.oauthFileDraft.kind === OAuthFileDraftKind.Configured
          ? state.oauthFileDraft.config
          : defaultOAuthFileConfig(fallbackRequest),
      );
    } catch {
      return err(new OAuthFailure(OAuthFailureKind.InvalidConfiguration));
    }
    const conversionRequest: Parameters<
      typeof iCloudOAuthSession.oauthTokensToICloudConfig
    >[0] = {
      tokens,
      existing,
    };
    const converted =
      iCloudOAuthSession.oauthTokensToICloudConfig(conversionRequest);
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
    return ok(OAuthOperationOutcome.ICloudTokensApplied);
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
  }: GoogleTokenApplication): Promise<
    Result<OAuthOperationOutcome, OAuthFailure>
  > {
    const state = this.state;
    const email = await googleOAuthSession.fetchGoogleAccountEmail(
      tokens.accessToken,
    );
    if (email.isErr()) return err(email.error);
    // The event-log backup name keeps its saved value or the default; the
    // Drive folder is always the account's fixed Nook root.
    let existing: StoredOAuthFileConfiguration;
    try {
      const fallbackRequest: Parameters<typeof defaultOAuthFileConfig>[0] = {
        preset: "google-drive",
        fileName: DEFAULT_DRIVE_BACKUP_NAME,
      };
      const previous =
        state.oauthFileDraft.kind === OAuthFileDraftKind.Configured
          ? state.oauthFileDraft.config
          : defaultOAuthFileConfig(fallbackRequest);
      const configuration: Parameters<typeof configuredOAuthFile>[0] = {
        ...previous,
        fileName:
          previous.fileName.state === "fileName"
            ? previous.fileName
            : storedOAuthRemoteFileName(DEFAULT_DRIVE_BACKUP_NAME),
        accountEmail:
          email.value.kind === GoogleAccountIdentityKind.Available
            ? storedOAuthAccountEmail(email.value.label)
            : previous.accountEmail,
      };
      existing = configuredOAuthFile(configuration);
    } catch {
      return err(new OAuthFailure(OAuthFailureKind.GoogleInvalidConfiguration));
    }
    const conversionRequest: Parameters<
      typeof googleOAuthSession.oauthTokensToConfig
    >[0] = {
      tokens,
      existing,
    };
    const converted = googleOAuthSession.oauthTokensToConfig(conversionRequest);
    if (converted.isErr()) return err(converted.error);
    const config = converted.value;
    state.activateLoginSetup("oauth-file");
    if (!state.addProviderOpen) state.storageMode = "oauth-file";
    state.selectOauthSetupPreset("google-drive");
    state.configureOauthFile(config);
    state.githubPat = "";
    return ok(OAuthOperationOutcome.GoogleTokensApplied);
  }
}
