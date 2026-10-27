import { err, ok, type Result } from "neverthrow";
import { I18N_KEYS, type I18nKey } from "../../../generated/i18n-keys";
import {
  add_google_drive_authorized_account,
  authorized_invite_account,
  icloud_authorized_accounts,
  list_google_drive_authorized_accounts,
  parse_icloud_shared_storage_target,
  remove_google_drive_authorized_account,
  type AuthorizedAccountList,
  type ICloudSharedTarget,
} from "$app-wasm";
import { oauth_access_token, type OAuthFileConfig } from "$lib/auth/providers";
import {
  GoogleOAuthPrompt,
  googleOAuthSession,
  type GoogleOAuthTokens,
} from "$lib/auth/google/oauth";
import {
  iCloudOAuthSession,
  type ICloudShareManagementRequest,
} from "$lib/auth/icloud/oauth";

export enum AuthorizedAccountsFailureKind {
  SignInRequired = "sign-in-required",
  TargetRequired = "target-required",
  Load = "load",
  Add = "add",
  Remove = "remove",
  ReadAccess = "read-access",
  Manage = "manage",
  Rejected = "rejected",
}

/** Rust account rules that reach the UI as their own translated message. */
const ACCOUNT_RULE_KEYS: readonly I18nKey[] = [
  I18N_KEYS.ErrorsValidationAuthorizedAccountExists,
  I18N_KEYS.ErrorsValidationAuthorizedAccountMissing,
  I18N_KEYS.ErrorsValidationAuthorizedAccountOwner,
  I18N_KEYS.ErrorsValidationAuthorizedAccountReadOnly,
  I18N_KEYS.ErrorsValidationSharedJoinerIdentityInvalid,
  I18N_KEYS.ErrorsValidationSharedJoinerIdentityRequired,
];

export class AuthorizedAccountsFailure {
  constructor(readonly kind: AuthorizedAccountsFailureKind) {}

  get translationKey(): I18nKey {
    switch (this.kind) {
      case AuthorizedAccountsFailureKind.SignInRequired:
        return I18N_KEYS.AuthorizedAccountsSignInRequired;
      case AuthorizedAccountsFailureKind.TargetRequired:
        return I18N_KEYS.AuthorizedAccountsTargetRequired;
      case AuthorizedAccountsFailureKind.Load:
        return I18N_KEYS.AuthorizedAccountsLoadFailed;
      case AuthorizedAccountsFailureKind.Add:
        return I18N_KEYS.AuthorizedAccountsAddFailed;
      case AuthorizedAccountsFailureKind.Remove:
        return I18N_KEYS.AuthorizedAccountsRemoveFailed;
      case AuthorizedAccountsFailureKind.ReadAccess:
        return I18N_KEYS.AuthorizedAccountsDriveReadAccessRequired;
      case AuthorizedAccountsFailureKind.Manage:
        return I18N_KEYS.AuthorizedAccountsManageFailed;
      case AuthorizedAccountsFailureKind.Rejected:
        return I18N_KEYS.AuthorizedAccountsLoadFailed;
    }
  }
}

/** A Rust account rule rejected the change; its own message explains why. */
class AuthorizedAccountRuleFailure extends AuthorizedAccountsFailure {
  constructor(private readonly ruleKey: I18nKey) {
    super(AuthorizedAccountsFailureKind.Rejected);
  }

  override get translationKey(): I18nKey {
    return this.ruleKey;
  }
}

/** Maps a native WASM failure of one operation to its UI failure. */
class AccountFailureMapping {
  constructor(private readonly kind: AuthorizedAccountsFailureKind) {}

  /** A Rust account-rule rejection keeps its message; anything else is `kind`. */
  from<NativeCause = Error | string>(
    failure: NativeCause,
  ): AuthorizedAccountsFailure {
    const message =
      failure instanceof Error ? failure.message : String(failure);
    const ruleKey = ACCOUNT_RULE_KEYS.find((key) => message.includes(key));
    return ruleKey
      ? new AuthorizedAccountRuleFailure(ruleKey)
      : new AuthorizedAccountsFailure(this.kind);
  }
}

export enum AuthorizedAccountsSource {
  GoogleDrive = "google-drive",
  ICloud = "icloud",
}

type GoogleDriveAccess = {
  readonly source: AuthorizedAccountsSource.GoogleDrive;
  readonly accessToken: string;
  readonly folderId: string;
  /** The signed-in owner account Google preselects for a new grant. */
  readonly accountHint: string;
};

type ICloudAccess = {
  readonly source: AuthorizedAccountsSource.ICloud;
  readonly target: ICloudSharedTarget;
};

/** Where one provider's access list lives, resolved from its saved row. */
export type AuthorizedAccountsAccess = GoogleDriveAccess | ICloudAccess;

type AccountChange = {
  readonly access: AuthorizedAccountsAccess;
  readonly email: string;
};

/** An account authorized on the Drive folder with the grant that allowed it. */
type AuthorizedAccountAddition = {
  readonly accounts: AuthorizedAccountList;
  /** The access to keep using; its token also covers `drive.readonly`. */
  readonly access: AuthorizedAccountsAccess;
  /** The incremental grant, for the saved provider to keep. */
  readonly tokens: GoogleOAuthTokens;
};

type InviteAccountChoice = {
  readonly accounts: AuthorizedAccountList;
  readonly email: string;
};

/** Reads and changes the accounts authorized on a shared provider target. */
class AuthorizedAccountsClient {
  /** Resolve a provider's shared target with a fresh credential. */
  async access(
    config: OAuthFileConfig,
  ): Promise<Result<AuthorizedAccountsAccess, AuthorizedAccountsFailure>> {
    if (config.preset === "icloud") {
      if (config.iCloudShareTarget.state !== "sharedTarget")
        return err(
          new AuthorizedAccountsFailure(
            AuthorizedAccountsFailureKind.TargetRequired,
          ),
        );
      let target: ICloudSharedTarget;
      try {
        target = parse_icloud_shared_storage_target(
          config.iCloudShareTarget.value,
        );
      } catch {
        return err(
          new AuthorizedAccountsFailure(
            AuthorizedAccountsFailureKind.TargetRequired,
          ),
        );
      }
      const access: ICloudAccess = {
        source: AuthorizedAccountsSource.ICloud,
        target,
      };
      return ok(access);
    }
    if (config.folderId.state !== "folderId")
      return err(
        new AuthorizedAccountsFailure(
          AuthorizedAccountsFailureKind.TargetRequired,
        ),
      );
    const refreshed =
      await googleOAuthSession.ensureValidOAuthFileConfig(config);
    if (refreshed.isErr())
      return err(
        new AuthorizedAccountsFailure(
          AuthorizedAccountsFailureKind.SignInRequired,
        ),
      );
    const credential = oauth_access_token(refreshed.value);
    if (credential.kind === "missing")
      return err(
        new AuthorizedAccountsFailure(
          AuthorizedAccountsFailureKind.SignInRequired,
        ),
      );
    const access: GoogleDriveAccess = {
      source: AuthorizedAccountsSource.GoogleDrive,
      accessToken: credential.token,
      folderId: config.folderId.value,
      accountHint:
        refreshed.value.accountEmail.state === "email"
          ? refreshed.value.accountEmail.value
          : "",
    };
    return ok(access);
  }

  async list(
    access: AuthorizedAccountsAccess,
  ): Promise<Result<AuthorizedAccountList, AuthorizedAccountsFailure>> {
    if (access.source === AuthorizedAccountsSource.ICloud) {
      const share = await iCloudOAuthSession.fetchShareParticipants(
        access.target,
      );
      if (share.isErr())
        return err(
          new AuthorizedAccountsFailure(AuthorizedAccountsFailureKind.Load),
        );
      try {
        return ok(icloud_authorized_accounts(share.value));
      } catch (failure) {
        return err(
          new AccountFailureMapping(AuthorizedAccountsFailureKind.Load).from(
            failure,
          ),
        );
      }
    }
    try {
      return ok(
        await list_google_drive_authorized_accounts(
          access.accessToken,
          access.folderId,
        ),
      );
    } catch (failure) {
      return err(
        new AccountFailureMapping(AuthorizedAccountsFailureKind.Load).from(
          failure,
        ),
      );
    }
  }

  /**
   * Share the Drive vault folder with one more account. That account's
   * events are files this one did not create, so Google is first asked, from
   * the user's click, to add `drive.readonly` to this account's grant.
   */
  async add({
    access,
    email,
  }: AccountChange): Promise<
    Result<AuthorizedAccountAddition, AuthorizedAccountsFailure>
  > {
    if (access.source !== AuthorizedAccountsSource.GoogleDrive)
      return err(
        new AuthorizedAccountsFailure(AuthorizedAccountsFailureKind.Add),
      );
    const grantRequest: Parameters<
      typeof googleOAuthSession.requestGoogleDriveSharedAccess
    >[0] = {
      prompt: GoogleOAuthPrompt.Default,
      accountHint: access.accountHint,
    };
    const granted =
      await googleOAuthSession.requestGoogleDriveSharedAccess(grantRequest);
    if (granted.isErr())
      return err(
        new AuthorizedAccountsFailure(AuthorizedAccountsFailureKind.ReadAccess),
      );
    const sharedAccess: GoogleDriveAccess = {
      ...access,
      accessToken: granted.value.accessToken,
    };
    try {
      const addition: AuthorizedAccountAddition = {
        accounts: await add_google_drive_authorized_account(
          sharedAccess.accessToken,
          sharedAccess.folderId,
          email,
        ),
        access: sharedAccess,
        tokens: granted.value,
      };
      return ok(addition);
    } catch (failure) {
      return err(
        new AccountFailureMapping(AuthorizedAccountsFailureKind.Add).from(
          failure,
        ),
      );
    }
  }

  /** Revoke one account's access to the Drive vault folder. */
  async remove({
    access,
    email,
  }: AccountChange): Promise<
    Result<AuthorizedAccountList, AuthorizedAccountsFailure>
  > {
    if (access.source !== AuthorizedAccountsSource.GoogleDrive)
      return err(
        new AuthorizedAccountsFailure(AuthorizedAccountsFailureKind.Remove),
      );
    try {
      return ok(
        await remove_google_drive_authorized_account(
          access.accessToken,
          access.folderId,
          email,
        ),
      );
    } catch (failure) {
      return err(
        new AccountFailureMapping(AuthorizedAccountsFailureKind.Remove).from(
          failure,
        ),
      );
    }
  }

  /** Open Apple's sharing sheet, then read the updated participants. */
  async manageICloud({
    target,
    title,
  }: ICloudShareManagementRequest): Promise<
    Result<AuthorizedAccountList, AuthorizedAccountsFailure>
  > {
    const request: ICloudShareManagementRequest = { target, title };
    const managed = await iCloudOAuthSession.manageICloudShare(request);
    if (managed.isErr())
      return err(
        new AuthorizedAccountsFailure(AuthorizedAccountsFailureKind.Manage),
      );
    const access: ICloudAccess = {
      source: AuthorizedAccountsSource.ICloud,
      target,
    };
    return this.list(access);
  }

  /** The account a device invite names, checked by Rust against the list. */
  inviteAccount({
    accounts,
    email,
  }: InviteAccountChoice): Result<string, AuthorizedAccountsFailure> {
    try {
      return ok(authorized_invite_account(accounts, email));
    } catch (failure) {
      return err(
        new AccountFailureMapping(AuthorizedAccountsFailureKind.Rejected).from(
          failure,
        ),
      );
    }
  }
}

export const authorizedAccountsClient = new AuthorizedAccountsClient();
