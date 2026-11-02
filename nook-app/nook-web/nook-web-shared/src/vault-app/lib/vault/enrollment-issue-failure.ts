import type { Result } from "neverthrow";
import { I18N_KEYS } from "../../../generated/i18n-keys";
import type { OAuthFailure } from "$lib/auth/oauth-failure";
import type { VaultStorageFailure } from "$lib/runtime/storage-failure";

export enum EnrollmentIssueRejection {
  PassphraseTooShort = "passphrase-too-short",
  ProviderNotMount = "provider-not-mount",
  ProviderRequired = "provider-required",
  LocalProvider = "local-provider",
  LocalFolderProvider = "local-folder-provider",
  SharedIdentityRequired = "shared-identity-required",
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
    }
  }
}

export type EnrollmentCodeIssueResult = Result<
  string,
  EnrollmentIssueFailure | OAuthFailure | VaultStorageFailure
>;
