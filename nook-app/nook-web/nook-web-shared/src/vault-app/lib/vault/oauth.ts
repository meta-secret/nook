import {
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
import type { GoogleDriveProvider } from "$lib/auth/providers";
import {
  apply_google_drive_sign_in,
  apply_icloud_sign_in,
  begin_provider_draft,
  bind_google_drive_folder,
  bind_icloud_share,
  connect_google_drive_vault_folder,
  list_google_drive_vaults,
  nook_provider_root_name,
  put_provider_sign_in,
  type GoogleDriveAccess,
  type ICloudAccess,
  type ICloudSignIn,
  type NookDriveRootOrigin,
  type NookGoogleDriveVaultListing,
  type ProviderDraft,
} from "$app-wasm";
import {
  GoogleAccountIdentities,
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
import { LoginSetupKind } from "$lib/vault/state/provider.svelte";
import { ProviderSetupKinds } from "$lib/vault/provider-setup-kinds";
import { ProviderSelectionActions } from "$lib/vault/provider-selection.svelte";
import {
  DraftDriveSignInKind,
  DraftICloudSignInKind,
  ProviderDraftReads,
  type OAuthProviderDraft,
} from "$lib/vault/provider-draft-reads";

const log = browserLogRuntime.createLogger("vault-oauth");

export type ICloudSignInRequest = {
  readonly clickPreparedControl: boolean;
};

export enum OAuthOperationOutcome {
  ICloudSharedProviderCreated = "iCloudSharedProviderCreated",
  ICloudTokensApplied = "iCloudTokensApplied",
  GoogleTokensApplied = "googleTokensApplied",
  SignInSaved = "signInSaved",
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

interface GoogleVaultFolderConnection {
  readonly name: string;
  readonly origin: NookDriveRootOrigin;
}

/** A Google Drive provider draft. */
type GoogleDriveProviderDraft = Extract<
  OAuthProviderDraft,
  { preset: "google-drive" }
>;

interface DriveAccessRefresh {
  readonly draft: OAuthProviderDraft;
  readonly previous: GoogleDriveAccess;
  readonly fresh: GoogleDriveAccess;
}

interface ICloudAccessRefresh {
  readonly draft: OAuthProviderDraft;
  readonly previous: ICloudSignIn;
  readonly fresh: ICloudAccess;
}

/** A sign-in a freshness check returned, and the draft it replaces. */
interface SignInRefresh {
  readonly draft: OAuthProviderDraft;
  readonly refreshed: Result<ProviderDraft, OAuthFailure>;
}

/** A failed Drive root request: its message and the failure it otherwise is. */
interface DriveRootFailureReport {
  readonly message: string;
  readonly kind: OAuthFailureKind;
}

interface GoogleProviderTokenAdoption {
  /** The saved Google Drive provider the tokens were granted for. */
  readonly drive: GoogleDriveProvider;
  readonly tokens: GoogleOAuthTokens;
}

/** Owns browser orchestration for one oauth context. */
export class VaultOAuthActions {
  constructor(private readonly state: VaultState) {}

  /** A signed-in Drive draft whose token is due is refreshed silently; an
   * iCloud draft without a token asks for one. Outside a setup, the saved
   * rows of the same target take the new sign-in. */
  async ensureOAuthTokensFresh(): Promise<
    Result<
      OAuthTokenFreshnessOutcome | VaultOperationStale,
      OAuthFailure | VaultStorageFailure
    >
  > {
    const draft = this.state.providerDraft;
    switch (draft.type) {
      case "oauth-file":
        return this.refreshOAuthDraft(draft);
      case "local":
      case "local-folder":
      case "github":
      case "s3":
        return ok(OAuthTokenFreshness.NOT_CONFIGURED);
    }
  }

  private async refreshOAuthDraft(
    draft: OAuthProviderDraft,
  ): Promise<
    Result<
      OAuthTokenFreshnessOutcome | VaultOperationStale,
      OAuthFailure | VaultStorageFailure
    >
  > {
    log.info("oauth token freshness check started");
    switch (draft.preset) {
      case "google-drive":
        return this.refreshDriveDraft(draft);
      case "icloud": {
        const access = await iCloudOAuthSession.ensureICloudAccess(
          draft.signIn,
        );
        const refresh: SignInRefresh = {
          draft,
          refreshed: access.map((fresh) => {
            const change: ICloudAccessRefresh = {
              draft,
              previous: draft.signIn,
              fresh,
            };
            return this.iCloudRefresh(change);
          }),
        };
        return this.adoptRefresh(refresh);
      }
    }
  }

  private async refreshDriveDraft(
    draft: GoogleDriveProviderDraft,
  ): Promise<
    Result<
      OAuthTokenFreshnessOutcome | VaultOperationStale,
      OAuthFailure | VaultStorageFailure
    >
  > {
    switch (draft.signIn.state) {
      case "awaitingSignIn":
        return ok(OAuthTokenFreshness.ALREADY_FRESH);
      case "signedIn": {
        const previous = draft.signIn.value;
        const access =
          await googleOAuthSession.ensureFreshDriveAccess(previous);
        const refresh: SignInRefresh = {
          draft,
          refreshed: access.map((fresh) => {
            const change: DriveAccessRefresh = { draft, previous, fresh };
            return this.driveRefresh(change);
          }),
        };
        return this.adoptRefresh(refresh);
      }
    }
  }

  /** The same draft while its access stayed current, else the draft with
   * the refreshed access. */
  private driveRefresh({
    draft,
    previous,
    fresh,
  }: DriveAccessRefresh): ProviderDraft {
    switch (fresh === previous) {
      case true:
        return draft;
      case false: {
        const signIn: Parameters<typeof apply_google_drive_sign_in>[0] = {
          draft,
          access: fresh,
        };
        return apply_google_drive_sign_in(signIn);
      }
    }
  }

  private iCloudRefresh({
    draft,
    previous,
    fresh,
  }: ICloudAccessRefresh): ProviderDraft {
    switch (previous.state) {
      case "signedIn":
        return draft;
      case "awaitingSignIn": {
        const signIn: Parameters<typeof apply_icloud_sign_in>[0] = {
          draft,
          access: fresh,
        };
        return apply_icloud_sign_in(signIn);
      }
    }
  }

  private async adoptRefresh({
    draft,
    refreshed,
  }: SignInRefresh): Promise<
    Result<
      OAuthTokenFreshnessOutcome | VaultOperationStale,
      OAuthFailure | VaultStorageFailure
    >
  > {
    const state = this.state;
    if (state.localDataDeletionStarted)
      return err(
        new VaultStorageFailure(VaultStorageFailureKind.DeletionActive),
      );
    if (state.providerDraft !== draft)
      return ok(
        new VaultOperationStale(VaultOperationStaleKind.ContextReplaced),
      );
    if (refreshed.isErr()) return err(refreshed.error);
    const next = refreshed.value;
    if (next === draft) {
      log.info("oauth token freshness check kept existing token");
      return ok(OAuthTokenFreshness.ALREADY_FRESH);
    }
    if (
      state.loginSetup.kind !== LoginSetupKind.Active &&
      !state.addProviderOpen
    ) {
      const persisted = await this.putSignInOnSavedRows(next);
      if (persisted.isErr()) return err(persisted.error);
    }
    state.stageProviderDraft(next);
    log.info("oauth token freshness check refreshed provider");
    return ok(OAuthTokenFreshness.REFRESHED);
  }

  /** Every saved row of the draft's Drive folder or iCloud share takes the
   * draft's sign-in, and the rows are saved. */
  private async putSignInOnSavedRows(
    draft: ProviderDraft,
  ): Promise<Result<OAuthOperationOutcome, VaultStorageFailure>> {
    const state = this.state;
    const update: Parameters<typeof put_provider_sign_in>[0] = {
      snapshot: new ProviderSelectionActions(state).providerSnapshot(),
      draft,
    };
    const snapshot = put_provider_sign_in(update);
    const persistenceOptions: Parameters<typeof state.persistProviders>[0] = {
      replace: false,
      providers: snapshot.providers,
    };
    const persisted = await state.persistProviders(persistenceOptions);
    return persisted.map(() => OAuthOperationOutcome.SignInSaved);
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
    const draft = state.providerDraft;
    const signIn = ProviderDraftReads.icloudSignIn(draft);
    switch (signIn.kind) {
      case DraftICloudSignInKind.NotICloud:
        return err(new OAuthFailure(OAuthFailureKind.SharedSignInRequired));
      case DraftICloudSignInKind.ICloud:
        switch (signIn.signIn.state) {
          case "awaitingSignIn":
            return err(new OAuthFailure(OAuthFailureKind.SharedSignInRequired));
          case "signedIn":
            return this.createICloudShare(draft);
        }
    }
  }

  private async createICloudShare(
    draft: ProviderDraft,
  ): Promise<Result<OAuthOperationOutcome, OAuthFailure>> {
    const state = this.state;
    // The share is titled like every provider account's Nook root.
    const target = await iCloudOAuthSession.createICloudSharedVault(
      nook_provider_root_name(),
    );
    if (target.isErr()) return err(target.error);
    try {
      const binding: Parameters<typeof bind_icloud_share>[0] = {
        draft,
        shareTarget: target.value.storageTargetId,
      };
      state.stageProviderDraft(bind_icloud_share(binding));
    } catch {
      return err(new OAuthFailure(OAuthFailureKind.InvalidConfiguration));
    }
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
    const draft = state.providerDraft;
    const access = this.driveAccess(draft);
    if (access.isErr()) return err(access.error);
    let folder;
    try {
      folder = await connect_google_drive_vault_folder(
        access.value.authorization.accessToken,
      );
    } catch (failure) {
      const report: DriveRootFailureReport = {
        message: failure instanceof Error ? failure.message : String(failure),
        kind: OAuthFailureKind.GoogleSharedCreation,
      };
      return err(this.driveRootFailure(report));
    }
    try {
      const binding: Parameters<typeof bind_google_drive_folder>[0] = {
        draft,
        folderId: folder.id,
      };
      state.stageProviderDraft(bind_google_drive_folder(binding));
    } catch {
      return err(new OAuthFailure(OAuthFailureKind.GoogleInvalidConfiguration));
    }
    const connection: GoogleVaultFolderConnection = {
      name: folder.name,
      origin: folder.origin,
    };
    return ok(connection);
  }

  /** The signed-in Drive access the draft holds. */
  private driveAccess(
    draft: ProviderDraft,
  ): Result<GoogleDriveAccess, OAuthFailure> {
    const signIn = ProviderDraftReads.driveSignIn(draft);
    switch (signIn.kind) {
      case DraftDriveSignInKind.SignedIn:
        return ok(signIn.access);
      case DraftDriveSignInKind.NotSignedIn:
        return err(
          new OAuthFailure(OAuthFailureKind.GoogleSharedSignInRequired),
        );
    }
  }

  /**
   * What the signed-in account's Nook root already holds, read without
   * creating it: each vault's created and last-activity times, event count,
   * short id, and whether it belongs to this identity. Nothing is decrypted.
   */
  async listGoogleDriveVaults(): Promise<
    Result<NookGoogleDriveVaultListing, OAuthFailure>
  > {
    const access = this.driveAccess(this.state.providerDraft);
    if (access.isErr()) return err(access.error);
    try {
      return ok(
        await list_google_drive_vaults(access.value.authorization.accessToken),
      );
    } catch (failure) {
      const report: DriveRootFailureReport = {
        message: failure instanceof Error ? failure.message : String(failure),
        kind: OAuthFailureKind.GoogleVaultListing,
      };
      return err(this.driveRootFailure(report));
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
    drive,
    tokens,
  }: GoogleProviderTokenAdoption): Promise<
    Result<OAuthOperationOutcome, OAuthFailure | VaultStorageFailure>
  > {
    const state = this.state;
    let granted: ProviderDraft;
    try {
      const accessGrant: Parameters<typeof googleOAuthSession.driveAccess>[0] =
        { tokens, account: drive.account };
      const signIn: Parameters<typeof apply_google_drive_sign_in>[0] = {
        draft: begin_provider_draft(ProviderSetupKinds.GOOGLE_DRIVE),
        access: googleOAuthSession.driveAccess(accessGrant),
      };
      const binding: Parameters<typeof bind_google_drive_folder>[0] = {
        draft: apply_google_drive_sign_in(signIn),
        folderId: drive.folderId,
      };
      granted = bind_google_drive_folder(binding);
    } catch {
      return err(new OAuthFailure(OAuthFailureKind.GoogleInvalidConfiguration));
    }
    const saved = await this.putSignInOnSavedRows(granted);
    if (saved.isErr()) return err(saved.error);
    state.applyActiveProviderCredentials();
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
    let next: ProviderDraft;
    try {
      const signIn: Parameters<typeof apply_icloud_sign_in>[0] = {
        draft: state.providerDraft,
        access: iCloudOAuthSession.iCloudAccess(tokens),
      };
      next = apply_icloud_sign_in(signIn);
    } catch {
      return err(new OAuthFailure(OAuthFailureKind.InvalidConfiguration));
    }
    state.activateLoginSetup(ProviderSetupKinds.ICLOUD);
    state.stageProviderDraft(next);
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
    const accessGrant: Parameters<typeof googleOAuthSession.driveAccess>[0] = {
      tokens,
      account: GoogleAccountIdentities.of(email.value),
    };
    const access = googleOAuthSession.driveAccess(accessGrant);
    let next: ProviderDraft;
    try {
      const signIn: Parameters<typeof apply_google_drive_sign_in>[0] = {
        draft: state.providerDraft,
        access,
      };
      next = apply_google_drive_sign_in(signIn);
    } catch {
      return err(new OAuthFailure(OAuthFailureKind.GoogleInvalidConfiguration));
    }
    state.activateLoginSetup(ProviderSetupKinds.GOOGLE_DRIVE);
    state.stageProviderDraft(next);
    return ok(OAuthOperationOutcome.GoogleTokensApplied);
  }
}

/** The outcomes a freshness check reports. */
class OAuthTokenFreshness {
  static readonly NOT_CONFIGURED: OAuthTokenFreshnessOutcome = {
    kind: OAuthTokenFreshnessKind.NotConfigured,
  };
  static readonly ALREADY_FRESH: OAuthTokenFreshnessOutcome = {
    kind: OAuthTokenFreshnessKind.AlreadyFresh,
  };
  static readonly REFRESHED: OAuthTokenFreshnessOutcome = {
    kind: OAuthTokenFreshnessKind.Refreshed,
  };
}
