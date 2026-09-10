import { I18N_KEYS } from "../../../generated/i18n-keys";

type UnsupportedSharedStorageGrant = {
  readonly reasonKey: string;
};

export enum OAuthFailureKind {
  GoogleConfiguration = "google-configuration",
  GoogleScript = "google-script",
  GoogleRequest = "google-request",
  GoogleResponse = "google-response",
  RequestInProgress = "request-in-progress",
  CloudKitScript = "cloudkit-script",
  CloudKitUnavailable = "cloudkit-unavailable",
  CloudKitAuthentication = "cloudkit-authentication",
  ControlUnavailable = "control-unavailable",
  TokenUnavailable = "token-unavailable",
  TimedOut = "timed-out",
  Cancelled = "cancelled",
  PopupBlocked = "popup-blocked",
  CleanupFailed = "cleanup-failed",
  BrowserStorage = "browser-storage",
  InvalidChallenge = "invalid-challenge",
  InvalidConfiguration = "invalid-configuration",
  AccountLookup = "account-lookup",
  GoogleSharedSignInRequired = "google-shared-sign-in-required",
  GoogleSharedCreation = "google-shared-creation",
  GoogleSharedConnection = "google-shared-connection",
  GoogleSharedNotFolder = "google-shared-not-folder",
  GoogleSharedNotWritable = "google-shared-not-writable",
  SharedLinkRequired = "shared-link-required",
  SharedLocationMissing = "shared-location-missing",
  SharedSignInRequired = "shared-sign-in-required",
  SharedCreation = "shared-creation",
  SharedIdentifierMissing = "shared-identifier-missing",
  SharedConnection = "shared-connection",
  ProviderPersistence = "provider-persistence",
}

/** Concrete operation failure; foreign exception objects remain at their host boundary. */
export class OAuthFailure {
  constructor(readonly kind: OAuthFailureKind) {}
  get translationKey() {
    // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check -- The default branch intentionally groups equivalent failures.
    switch (this.kind) {
      case OAuthFailureKind.GoogleConfiguration:
        return I18N_KEYS.ProviderSetupGoogleOauthUnconfigured;
      case OAuthFailureKind.GoogleScript:
      case OAuthFailureKind.GoogleRequest:
      case OAuthFailureKind.GoogleResponse:
      case OAuthFailureKind.RequestInProgress:
        return I18N_KEYS.ErrorsGoogleSignInRequired;
      case OAuthFailureKind.GoogleSharedSignInRequired:
        return I18N_KEYS.ProviderSetupGoogleSharedSignInFirst;
      case OAuthFailureKind.GoogleSharedCreation:
        return I18N_KEYS.ProviderSetupGoogleSharedCreateFailed;
      case OAuthFailureKind.GoogleSharedConnection:
        return I18N_KEYS.ProviderSetupGoogleSharedConnectFailed;
      case OAuthFailureKind.GoogleSharedNotFolder:
        return I18N_KEYS.ProviderSetupGoogleSharedNotFolder;
      case OAuthFailureKind.GoogleSharedNotWritable:
        return I18N_KEYS.ProviderSetupGoogleSharedNotWritable;
      case OAuthFailureKind.SharedLinkRequired:
        return I18N_KEYS.ProviderSetupIcloudSharedLinkRequired;
      case OAuthFailureKind.SharedLocationMissing:
        return I18N_KEYS.ProviderSetupIcloudSharedLocationMissing;
      case OAuthFailureKind.SharedSignInRequired:
        return I18N_KEYS.ProviderSetupIcloudSharedSignInFirst;
      case OAuthFailureKind.SharedCreation:
        return I18N_KEYS.ProviderSetupIcloudSharedCreateFailed;
      case OAuthFailureKind.SharedIdentifierMissing:
        return I18N_KEYS.ProviderSetupIcloudSharedIdentifierMissing;
      case OAuthFailureKind.SharedConnection:
        return I18N_KEYS.ProviderSetupIcloudSharedConnectFailed;
      default:
        return I18N_KEYS.ProviderSetupIcloudSignInFailed;
    }
  }
}

/** Preserves the Rust-owned rejection projection without converting it to an exception. */
export class SharedStorageGrantFailure {
  constructor(private readonly rejection: UnsupportedSharedStorageGrant) {}
  get translationKey() {
    return this.rejection.reasonKey;
  }
}
