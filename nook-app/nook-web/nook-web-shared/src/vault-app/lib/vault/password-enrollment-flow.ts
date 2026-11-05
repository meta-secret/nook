import { NativeVaultStorageFailure } from "$lib/runtime/storage-failure";
import { err as storageErr, ok as storageOk, type Result } from "neverthrow";
import type { NookStorageConnection } from "$app-wasm";
import { I18N_KEYS } from "../../../generated/i18n-keys";
import { VaultState } from "$lib/vault.svelte";
import { OAuthFailure, OAuthFailureKind } from "$lib/auth/oauth-failure";
import {
  findSharedGrantProvider,
  SharedStorageTargetKind,
  type SharedGrantProviderOutcome,
  type SharedStorageTarget,
} from "$lib/vault/password-enrollment";

import {
  JoinEnrollmentState,
  OnboardingType,
  apply_google_drive_sign_in,
  apply_icloud_sign_in,
  bind_icloud_share,
  decrypt_enrollment_payload,
  draft_storage_args,
  github_draft_with_token,
  provider_draft_gap_translation_key,
  provider_draft_kind,
  provider_draft_label,
  provider_row_draft,
  s3_draft_with_key,
  s3_provider_draft,
  verify_joiner_account,
  type NookEnrollmentProvider,
  type ProviderDraft,
} from "$app-wasm";
import type { StorageProvider } from "$lib/auth/providers";
import {
  GoogleAccountIdentities,
  GoogleAccountIdentityKind,
  GoogleOAuthPrompt,
  googleOAuthSession,
} from "$lib/auth/google/oauth";
import { iCloudOAuthSession } from "$lib/auth/icloud/oauth";
import { JoinICloudSignIn } from "$lib/vault/state/ui.svelte";
import { ProviderSetupKinds } from "$lib/vault/provider-setup-kinds";
import {
  DraftICloudSignInKind,
  ProviderDraftReads,
  type OAuthProviderDraft,
} from "$lib/vault/provider-draft-reads";
import {
  InviteKeyKind,
  InviteKeyNeed,
  InviteKeyRequestKind,
  InviteKeyRequests,
  type InviteKeyAsk,
  type InviteKeyEntry,
  type InviteKeyProvider,
} from "$lib/vault/invite-join-keys";
import {
  ProviderPersistenceActions,
  ProviderSaveOutcome,
} from "$lib/vault/provider-persistence.svelte";

enum IdentityInviteJoinOutcome {
  Joined = "joined",
}

/** Why an invite could not reach its provider; the message is already chosen. */
class InviteJoinFailure {
  constructor(readonly translationKey: string) {}
}

type InviteStorageArgs = Result<NookStorageConnection, InviteJoinFailure>;

/** How one provider of a decrypted invite can serve this device. */
enum InviteProviderReadKind {
  /** It carries its key: a complete draft. */
  Ready = "ready",
  /** Its key is this device's to add. */
  AwaitingKey = "awaiting-key",
  /** A shared target this device signs in to. */
  Grant = "grant",
}

type InviteProviderRead =
  | {
      readonly kind: InviteProviderReadKind.Ready;
      readonly draft: ProviderDraft;
    }
  | {
      readonly kind: InviteProviderReadKind.AwaitingKey;
      readonly provider: InviteKeyProvider;
    }
  | {
      readonly kind: InviteProviderReadKind.Grant;
      readonly enrollmentProvider: NookEnrollmentProvider;
    };

type InviteProviderReading = {
  readonly enrollmentProvider: NookEnrollmentProvider;
  readonly index: number;
};

type InviteKeyCompletion = {
  readonly entry: InviteKeyEntry;
  readonly awaiting: readonly InviteKeyProvider[];
};

/** The providers an invite gives this device, sorted by what each needs. */
type InviteProviderPlan = {
  /** Complete drafts: the ones that carry a key, then the keyed ones. */
  readonly complete: readonly ProviderDraft[];
  readonly awaiting: readonly InviteKeyProvider[];
  readonly grants: readonly NookEnrollmentProvider[];
};

type InvitePlanRequest = {
  readonly providers: readonly NookEnrollmentProvider[];
  readonly keys: readonly InviteKeyEntry[];
};

type InviteDraftCompletion = Result<ProviderDraft, InviteJoinFailure>;

type OAuthGrantJoin = Omit<SharedGrantJoin, "saved">;
type ICloudJoinBase = Omit<SharedGrantJoin, "enrollmentProvider">;

type SharedGrantJoin = {
  readonly enrollmentProvider: NookEnrollmentProvider;
  readonly grant: OAuthProviderDraft;
  readonly saved: SharedGrantProviderOutcome;
};

export type EnrollmentCodeConnection = {
  readonly code: string;
  readonly password: string;
  /** Keys typed on the join screen for providers whose key this device
   * adds; none before the screen asks. */
  readonly keys: readonly InviteKeyEntry[];
};

export { IdentityEnrollmentIssue } from "$lib/vault/password-enrollment-issue";

/** Owns browser orchestration for one password enrollment flow context. */
export class PasswordEnrollmentActions {
  constructor(private readonly state: VaultState) {}

  clearEnrollmentCode() {
    const state = this.state;
    state.enrollmentCode = "";
  }

  /** How one provider of the invite serves this device. */
  private readInviteProvider({
    enrollmentProvider,
    index,
  }: InviteProviderReading): Result<InviteProviderRead, InviteJoinFailure> {
    if (
      enrollmentProvider.onboardingType === OnboardingType.SharedProviderGrant
    ) {
      const grant: InviteProviderRead = {
        kind: InviteProviderReadKind.Grant,
        enrollmentProvider,
      };
      return storageOk(grant);
    }
    switch (enrollmentProvider.type.type) {
      case "local":
      case "local-folder":
        // A local provider cannot carry an identity to another app.
        return storageErr(
          new InviteJoinFailure(I18N_KEYS.IdentityControlJoinLocalProvider),
        );
      case "github":
      case "s3":
      case "oauth-file":
        break;
    }
    let draft: ProviderDraft;
    try {
      draft = enrollmentProvider.provider_draft();
    } catch (failure) {
      return storageErr(
        new InviteJoinFailure(
          new NativeVaultStorageFailure(failure).translationKey,
        ),
      );
    }
    const connection = draft_storage_args(draft);
    switch (connection.state) {
      case "ready": {
        const ready: InviteProviderRead = {
          kind: InviteProviderReadKind.Ready,
          draft,
        };
        return storageOk(ready);
      }
      case "incomplete":
        break;
    }
    const awaiting = (kind: InviteKeyKind): InviteProviderRead => ({
      kind: InviteProviderReadKind.AwaitingKey,
      provider: { index, kind, label: provider_draft_label(draft), draft },
    });
    switch (connection.gap) {
      case "s3Key":
        return storageOk(awaiting(InviteKeyKind.S3));
      case "githubToken":
        return storageOk(awaiting(InviteKeyKind.Github));
      case "localFolder":
      case "oauthSignIn":
      case "sharedTarget":
      case "s3Connection":
        return storageErr(
          new InviteJoinFailure(
            provider_draft_gap_translation_key(connection.gap),
          ),
        );
    }
  }

  /** Every provider of the invite, read, with the keys typed for it. */
  private inviteProviderPlan({
    providers,
    keys,
  }: InvitePlanRequest): Result<InviteProviderPlan, InviteJoinFailure> {
    const ready: ProviderDraft[] = [];
    const awaiting: InviteKeyProvider[] = [];
    const grants: NookEnrollmentProvider[] = [];
    for (const [index, enrollmentProvider] of providers.entries()) {
      const reading: InviteProviderReading = { enrollmentProvider, index };
      const read = this.readInviteProvider(reading);
      if (read.isErr()) return storageErr(read.error);
      switch (read.value.kind) {
        case InviteProviderReadKind.Ready:
          ready.push(read.value.draft);
          break;
        case InviteProviderReadKind.AwaitingKey:
          awaiting.push(read.value.provider);
          break;
        case InviteProviderReadKind.Grant:
          grants.push(read.value.enrollmentProvider);
          break;
      }
    }
    const keyed: ProviderDraft[] = [];
    for (const entry of keys.filter((typed) =>
      InviteKeyRequests.typed(typed),
    )) {
      const completion: InviteKeyCompletion = { entry, awaiting };
      const completed = this.completeInviteKey(completion);
      if (completed.isErr()) return storageErr(completed.error);
      keyed.push(completed.value);
    }
    const plan: InviteProviderPlan = {
      complete: [...ready, ...keyed],
      awaiting,
      grants,
    };
    return storageOk(plan);
  }

  /** The complete draft a key typed on the join screen makes, validated by
   * Rust as the setup forms validate theirs. */
  private completeInviteKey({
    entry,
    awaiting,
  }: InviteKeyCompletion): InviteDraftCompletion {
    const provider = awaiting.find(
      (candidate) => candidate.index === entry.index,
    );
    if (!provider)
      return storageErr(
        new InviteJoinFailure(I18N_KEYS.ErrorsVaultSelectionFailed),
      );
    try {
      switch (entry.kind) {
        case InviteKeyKind.Github:
          return storageOk(
            github_draft_with_token(provider.draft, entry.token),
          );
        case InviteKeyKind.S3: {
          const key: Parameters<typeof s3_draft_with_key>[1] = {
            accessKeyId: entry.accessKeyId,
            secretAccessKey: entry.secretAccessKey,
          };
          const validation = s3_draft_with_key(provider.draft, key);
          switch (validation.state) {
            case "valid":
              return storageOk(s3_provider_draft(validation.configuration));
            case "invalid": {
              const [first] = validation.fields;
              return storageErr(
                new InviteJoinFailure(
                  first
                    ? first.errorKey
                    : I18N_KEYS.ErrorsValidationS3AccessKeyIdRequired,
                ),
              );
            }
          }
        }
      }
    } catch (failure) {
      return storageErr(
        new InviteJoinFailure(
          new NativeVaultStorageFailure(failure).translationKey,
        ),
      );
    }
  }

  /** The connection an invite joins through: a provider it has a key for, or
   * else a shared target the joiner signs in to. */
  private async inviteStorageArgs(
    plan: InviteProviderPlan,
  ): Promise<InviteStorageArgs> {
    const [draft] = plan.complete;
    if (draft) return this.connectPersonalInvite(draft);
    const [grant] = plan.grants;
    if (grant) return this.joinSharedGrant(grant);
    return storageErr(new InviteJoinFailure(I18N_KEYS.JoinKeysRequired));
  }

  /** A provider the invite gives complete: stage it and connect. */
  private connectPersonalInvite(draft: ProviderDraft): InviteStorageArgs {
    const state = this.state;
    state.activateLoginSetup(provider_draft_kind(draft));
    state.stageProviderDraft(draft);
    return this.draftArgs(draft);
  }

  /** Every other provider the invite gave with its key is saved beside the
   * one the join went through. */
  private async saveOtherInviteProviders(
    plan: InviteProviderPlan,
  ): ReturnType<ProviderPersistenceActions["saveInvitedProvider"]> {
    const persistence = new ProviderPersistenceActions(this.state);
    const others = plan.complete.slice(1);
    for (const draft of others) {
      const saved = await persistence.saveInvitedProvider(draft);
      if (saved.isErr()) return saved;
    }
    return storageOk(ProviderSaveOutcome.Saved);
  }

  private draftArgs(draft: ProviderDraft): InviteStorageArgs {
    const connection = draft_storage_args(draft);
    switch (connection.state) {
      case "ready":
        return storageOk(connection.connection);
      case "incomplete":
        return storageErr(
          new InviteJoinFailure(
            provider_draft_gap_translation_key(connection.gap),
          ),
        );
    }
  }

  /** A shared grant names a target the joiner reaches with its own sign-in,
   * or through a saved row of that target. */
  private async joinSharedGrant(
    enrollmentProvider: NookEnrollmentProvider,
  ): Promise<InviteStorageArgs> {
    let grant: ProviderDraft;
    try {
      grant = enrollmentProvider.provider_draft();
    } catch (failure) {
      return storageErr(
        new InviteJoinFailure(
          new NativeVaultStorageFailure(failure).translationKey,
        ),
      );
    }
    switch (grant.type) {
      case "oauth-file": {
        const join: OAuthGrantJoin = { enrollmentProvider, grant };
        return this.joinOAuthGrant(join);
      }
      case "local":
      case "local-folder":
      case "github":
      case "s3":
        return storageErr(
          new InviteJoinFailure(I18N_KEYS.ErrorsVaultSelectionFailed),
        );
    }
  }

  private async joinOAuthGrant({
    enrollmentProvider,
    grant,
  }: OAuthGrantJoin): Promise<InviteStorageArgs> {
    const state = this.state;
    const providerLoadOptions: Parameters<typeof state.loadProviders>[0] = {
      ensureLocalRow: false,
    };
    const loaded = await state.loadProviders(providerLoadOptions);
    if (loaded.isErr())
      return storageErr(new InviteJoinFailure(loaded.error.translationKey));
    const target: SharedStorageTarget = {
      kind: SharedStorageTargetKind.Bound,
      storageTargetId: enrollmentProvider.sharedStorageTargetId,
    };
    const findSharedGrantProviderArgs: Parameters<
      typeof findSharedGrantProvider
    >[0] = {
      providers: state.providers,
      preset: grant.preset,
      target,
    };
    const join: SharedGrantJoin = {
      enrollmentProvider,
      grant,
      saved: findSharedGrantProvider(findSharedGrantProviderArgs),
    };
    switch (grant.preset) {
      case "google-drive":
        return this.joinDriveGrant(join);
      case "icloud":
        return this.joinICloudGrant(join);
    }
  }

  private async joinDriveGrant(
    join: SharedGrantJoin,
  ): Promise<InviteStorageArgs> {
    const saved = join.saved;
    switch (saved.kind) {
      case "existing":
        return storageOk(this.useSavedGrantRow(saved.provider));
      case "authorizationRequired":
        return this.signInToDriveGrant(join);
    }
  }

  /** A saved row of the target serves the join, with no setup. */
  private useSavedGrantRow(row: StorageProvider): NookStorageConnection {
    const state = this.state;
    state.stageProviderDraft(provider_row_draft(row));
    state.clearLoginSetup();
    return state.providerWasmArgs(row);
  }

  private async signInToDriveGrant({
    enrollmentProvider,
    grant,
  }: SharedGrantJoin): Promise<InviteStorageArgs> {
    const state = this.state;
    if (!googleOAuthSession.isGoogleOAuthConfigured())
      return storageErr(
        new InviteJoinFailure(I18N_KEYS.ProviderSetupGoogleOauthUnconfigured),
      );
    // Google preselects the authorized account the link names; the
    // folder's Drive permissions decide whether it can read the vault.
    const invitedAccount = enrollmentProvider.sharedJoinerIdentity;
    const requestGoogleDriveSharedAccessArgs: Parameters<
      typeof googleOAuthSession.requestGoogleDriveSharedAccess
    >[0] = {
      prompt: GoogleOAuthPrompt.Consent,
      accountHint: invitedAccount,
    };
    const tokens = await googleOAuthSession.requestGoogleDriveSharedAccess(
      requestGoogleDriveSharedAccessArgs,
    );
    if (tokens.isErr())
      return storageErr(new InviteJoinFailure(tokens.error.translationKey));
    const signedIn = await googleOAuthSession.fetchGoogleAccountEmail(
      tokens.value.accessToken,
    );
    if (signedIn.isErr())
      return storageErr(new InviteJoinFailure(signedIn.error.translationKey));
    const signedInAccount =
      signedIn.value.kind === GoogleAccountIdentityKind.Available
        ? signedIn.value.label
        : "";
    try {
      verify_joiner_account(invitedAccount, signedInAccount);
    } catch {
      return storageErr(
        new InviteJoinFailure(I18N_KEYS.ErrorsValidationJoinerAccountMismatch),
      );
    }
    let draft: ProviderDraft;
    try {
      const accessGrant: Parameters<typeof googleOAuthSession.driveAccess>[0] =
        {
          tokens: tokens.value,
          account: GoogleAccountIdentities.of(signedIn.value),
        };
      const signInRequest: Parameters<typeof apply_google_drive_sign_in>[0] = {
        draft: grant,
        access: googleOAuthSession.driveAccess(accessGrant),
      };
      draft = apply_google_drive_sign_in(signInRequest);
    } catch {
      return storageErr(
        new InviteJoinFailure(
          new OAuthFailure(OAuthFailureKind.GoogleInvalidConfiguration)
            .translationKey,
        ),
      );
    }
    state.activateLoginSetup(ProviderSetupKinds.GOOGLE_DRIVE);
    state.stageProviderDraft(draft);
    return this.draftArgs(draft);
  }

  /** iCloud joins through a saved row's sign-in or a new one, then accepts
   * the share the invite names. */
  private async joinICloudGrant({
    enrollmentProvider,
    grant,
    saved,
  }: SharedGrantJoin): Promise<InviteStorageArgs> {
    const state = this.state;
    const baseRequest: ICloudJoinBase = { grant, saved };
    const base = this.iCloudJoinBase(baseRequest);
    const signIn = ProviderDraftReads.icloudSignIn(base);
    switch (signIn.kind) {
      case DraftICloudSignInKind.NotICloud:
        return storageErr(
          new InviteJoinFailure(I18N_KEYS.ErrorsVaultSelectionFailed),
        );
      case DraftICloudSignInKind.ICloud:
        break;
    }
    const access = await iCloudOAuthSession.ensureICloudAccess(signIn.signIn);
    if (access.isErr()) {
      // The join screen shows the iCloud sign-in only now.
      state.joinICloudSignIn = JoinICloudSignIn.Needed;
      return storageErr(new InviteJoinFailure(access.error.translationKey));
    }
    state.joinICloudSignIn = JoinICloudSignIn.NotNeeded;
    const accepted = await iCloudOAuthSession.acceptICloudSharedVault(
      enrollmentProvider.sharedStorageTargetId,
    );
    if (accepted.isErr())
      return storageErr(new InviteJoinFailure(accepted.error.translationKey));
    let draft: ProviderDraft;
    try {
      const signInRequest: Parameters<typeof apply_icloud_sign_in>[0] = {
        draft: base,
        access: access.value,
      };
      const binding: Parameters<typeof bind_icloud_share>[0] = {
        draft: apply_icloud_sign_in(signInRequest),
        shareTarget: accepted.value.storageTargetId,
      };
      draft = bind_icloud_share(binding);
    } catch {
      return storageErr(
        new InviteJoinFailure(
          new OAuthFailure(OAuthFailureKind.InvalidConfiguration)
            .translationKey,
        ),
      );
    }
    state.stageProviderDraft(draft);
    this.settleICloudSetup(saved);
    return this.draftArgs(draft);
  }

  private iCloudJoinBase({ grant, saved }: ICloudJoinBase): ProviderDraft {
    switch (saved.kind) {
      case "existing":
        return provider_row_draft(saved.provider);
      case "authorizationRequired":
        return grant;
    }
  }

  /** A saved row needs no setup; a new iCloud provider is saved by one. */
  private settleICloudSetup(saved: SharedGrantProviderOutcome): void {
    const state = this.state;
    switch (saved.kind) {
      case "existing":
        state.clearLoginSetup();
        return;
      case "authorizationRequired":
        state.activateLoginSetup(ProviderSetupKinds.ICLOUD);
        return;
    }
  }

  async connectWithEnrollmentCode({
    code,
    password,
    keys,
  }: EnrollmentCodeConnection): Promise<void> {
    const state = this.state;
    if (!state.hasManager) {
      state.errorMsg = state.t(I18N_KEYS.ErrorsEngineUnavailable);
      return;
    }
    state.errorMsg = "";
    state.dismissSuccess();
    state.isVerifying = true;
    state.isInviteBusy = true;
    try {
      let payload: ReturnType<typeof decrypt_enrollment_payload>;
      try {
        payload = decrypt_enrollment_payload(code, password);
      } catch (failure) {
        state.errorMsg = state.t(
          new NativeVaultStorageFailure(failure).translationKey,
        );
        return;
      }
      try {
        const enrollmentProviders = payload.providers;
        try {
          const entryId = payload.entryId.trim();
          const unlockPassword = password.trim();
          if (!entryId) {
            state.errorMsg = state.t(I18N_KEYS.ErrorsVaultSelectionFailed);
            return;
          }
          if (!unlockPassword) {
            state.errorMsg = state.t(I18N_KEYS.ErrorsInvitePassphraseRequired);
            return;
          }

          const planRequest: InvitePlanRequest = {
            providers: enrollmentProviders,
            keys,
          };
          const planned = this.inviteProviderPlan(planRequest);
          if (planned.isErr()) {
            state.errorMsg = state.t(planned.error.translationKey);
            return;
          }
          const plan = planned.value;
          // A provider whose key this device adds asks for it first, with
          // its location shown, in one form per provider.
          const keyAsk: InviteKeyAsk = {
            request: state.inviteKeyRequest,
            code,
          };
          if (plan.awaiting.length > 0 && !InviteKeyRequests.asked(keyAsk)) {
            state.inviteKeyRequest = {
              kind: InviteKeyRequestKind.Asked,
              code,
              need:
                plan.complete.length + plan.grants.length > 0
                  ? InviteKeyNeed.Optional
                  : InviteKeyNeed.AtLeastOne,
              providers: plan.awaiting,
            };
            return;
          }
          const storageArgs = await this.inviteStorageArgs(plan);
          if (storageArgs.isErr()) {
            state.errorMsg = state.t(storageArgs.error.translationKey);
            return;
          }
          const enrollmentStorageArgs = storageArgs.value;

          const identityInitialization = await state.initDeviceIdentity();
          if (identityInitialization.isErr()) {
            state.errorMsg = state.t(
              identityInitialization.error.translationKey,
            );
            return;
          }

          const identityId = payload.identityId;
          const identityLabel = payload.identityLabel;
          const joined = await state.enqueueStorage(async () => {
            const admittedManager = state.admitManager();
            if (admittedManager.isErr())
              return storageErr(admittedManager.error);
            try {
              await admittedManager.value.bind_local_identity_to_invitation(
                identityId,
                identityLabel,
              );
              await admittedManager.value.join_identity_with_invite(
                code,
                password,
                enrollmentStorageArgs,
              );
              return storageOk(IdentityInviteJoinOutcome.Joined);
            } catch (nativeFailure) {
              return storageErr(new NativeVaultStorageFailure(nativeFailure));
            }
          });
          if (joined.isErr()) {
            state.errorMsg = state.t(joined.error.translationKey);
            return;
          }
          // The mount the join went through becomes this app's identity mount.
          const savedProvider = await state.ensureProviderSaved();
          if (savedProvider.isErr()) {
            state.errorMsg = state.t(savedProvider.error.translationKey);
            return;
          }
          const savedOthers = await this.saveOtherInviteProviders(plan);
          if (savedOthers.isErr()) {
            state.errorMsg = state.t(savedOthers.error.translationKey);
            return;
          }
          state.inviteKeyRequest = InviteKeyRequests.NONE;
          state.joinEnrollmentPrompt = JoinEnrollmentState.None;
          state.loginEnrollmentCode = "";
          state.prefillEnrollmentCode = "";
          state.enrollmentFromUrlPending = false;
          const followed =
            await state.identityControl.followInviteJoin(identityLabel);
          if (followed.isErr()) {
            state.errorMsg = state.t(followed.error.translationKey);
          }
        } finally {
          for (const enrollmentProvider of enrollmentProviders)
            enrollmentProvider.free();
        }
      } finally {
        payload.free();
      }
    } finally {
      state.isInviteBusy = false;
      state.isVerifying = false;
    }
  }
}
