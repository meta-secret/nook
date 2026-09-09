import type { Result } from 'neverthrow'
import { I18N_KEYS } from '../../../generated/i18n-keys'
import type {
  OAuthFailure,
  SharedStorageGrantFailure,
} from '$lib/auth/oauth-failure'
import type { VaultStorageFailure } from '$lib/runtime/storage-failure'

export enum EnrollmentIssueRejection {
  BackupPasswordRequired = 'backup-password-required',
  PasswordEntryMissing = 'password-entry-missing',
  PasswordRejected = 'password-rejected',
  ProviderRequired = 'provider-required',
  LocalProvider = 'local-provider',
  LocalFolderProvider = 'local-folder-provider',
  SharedIdentityRequired = 'shared-identity-required',
  GithubCredentialsRequired = 'github-credentials-required',
  ICloudTargetRequired = 'icloud-target-required',
  OAuthProviderRequired = 'oauth-provider-required',
  SharedTargetUnavailable = 'shared-target-unavailable',
}

export class EnrollmentIssueFailure {
  constructor(readonly rejection: EnrollmentIssueRejection) {}
  get translationKey() {
    switch (this.rejection) {
      case EnrollmentIssueRejection.BackupPasswordRequired:
      case EnrollmentIssueRejection.PasswordEntryMissing:
        return I18N_KEYS.ErrorsVaultPasswordRequired
      case EnrollmentIssueRejection.PasswordRejected:
        return I18N_KEYS.VaultPasswordsFailedIssueError
      case EnrollmentIssueRejection.ProviderRequired:
      case EnrollmentIssueRejection.LocalProvider:
      case EnrollmentIssueRejection.LocalFolderProvider:
        return I18N_KEYS.ErrorsCloudSyncProviderRequired
      case EnrollmentIssueRejection.SharedIdentityRequired:
        return I18N_KEYS.ErrorsValidationSharedJoinerIdentityRequired
      case EnrollmentIssueRejection.GithubCredentialsRequired:
        return I18N_KEYS.ErrorsGithubEnrollmentCredentialsRequired
      case EnrollmentIssueRejection.ICloudTargetRequired:
        return I18N_KEYS.ProviderSetupIcloudSharedTargetRequired
      case EnrollmentIssueRejection.OAuthProviderRequired:
        return I18N_KEYS.ErrorsSharedProviderOauthRequired
      case EnrollmentIssueRejection.SharedTargetUnavailable:
        return I18N_KEYS.ProviderSetupGoogleSharedCreateFailed
    }
  }
}

export type EnrollmentCodeIssueResult = Result<
  string,
  | EnrollmentIssueFailure
  | SharedStorageGrantFailure
  | OAuthFailure
  | VaultStorageFailure
>
