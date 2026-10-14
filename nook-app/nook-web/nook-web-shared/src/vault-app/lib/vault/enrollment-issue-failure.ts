import type { Result } from "neverthrow";
import { I18N_KEYS } from "../../../generated/i18n-keys";
import type {
  OAuthFailure,
  SharedStorageGrantFailure,
} from "$lib/auth/oauth-failure";
import type { VaultStorageFailure } from "$lib/runtime/storage-failure";

export enum EnrollmentIssueRejection {
  PassphraseTooShort = "passphrase-too-short",
  ProviderNotMount = "provider-not-mount",
  ProviderRequired = "provider-required",
  LocalProvider = "local-provider",
  LocalFolderProvider = "local-folder-provider",
  SharedIdentityRequired = "shared-identity-required",
  GithubCredentialsRequired = "github-credentials-required",
  ICloudTargetRequired = "icloud-target-required",
  OAuthProviderRequired = "oauth-provider-required",
  SharedTargetUnavailable = "shared-target-unavailable",
}

export class EnrollmentIssueFailure {
  constructor(readonly rejection: EnrollmentIssueRejection) {}
  get translationKey() {
    switch (this.rejection) {
      case EnrollmentIssueRejection.PassphraseTooShort:
        return I18N_KEYS.IdentityControlErrorPassphraseShort;
      case EnrollmentIssueRejection.ProviderNotMount:
        return I18N_KEYS.IdentityControlErrorProviderNotMount;
      case EnrollmentIssueRejection.ProviderRequired:
      case EnrollmentIssueRejection.LocalProvider:
      case EnrollmentIssueRejection.LocalFolderProvider:
        return I18N_KEYS.ErrorsCloudSyncProviderRequired;
      case EnrollmentIssueRejection.SharedIdentityRequired:
        return I18N_KEYS.ErrorsValidationSharedJoinerIdentityRequired;
      case EnrollmentIssueRejection.GithubCredentialsRequired:
        return I18N_KEYS.ErrorsGithubEnrollmentCredentialsRequired;
      case EnrollmentIssueRejection.ICloudTargetRequired:
        return I18N_KEYS.ProviderSetupIcloudSharedTargetRequired;
      case EnrollmentIssueRejection.OAuthProviderRequired:
        return I18N_KEYS.ErrorsSharedProviderOauthRequired;
      case EnrollmentIssueRejection.SharedTargetUnavailable:
        return I18N_KEYS.ProviderSetupGoogleSharedCreateFailed;
    }
  }
}

export type EnrollmentCodeIssueResult = Result<
  string,
  | EnrollmentIssueFailure
  | SharedStorageGrantFailure
  | OAuthFailure
  | VaultStorageFailure
>;
