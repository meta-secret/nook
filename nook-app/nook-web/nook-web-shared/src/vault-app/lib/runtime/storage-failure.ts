import {
  classify_vault_recovery_error,
  provider_failure_cause,
  provider_failure_code,
  VaultRecoveryErrorKind,
} from "$app-wasm";
import { I18N_KEYS } from "../../../generated/i18n-keys";

export enum VaultStorageFailureKind {
  DeletionActive = "deletion-active",
  GenerationChanged = "generation-changed",
  GenerationUnavailable = "generation-unavailable",
  LockUnavailable = "lock-unavailable",
  LockFailed = "lock-failed",
  DeviceAuthorizationRequired = "device-authorization-required",
  LocalFolderUnavailable = "local-folder-unavailable",
  UnlockMetadataUnavailable = "unlock-metadata-unavailable",
  ManagerUnavailable = "manager-unavailable",
  TimedOut = "timed-out",
  OperationFailed = "operation-failed",
  GitHubTokenRejected = "github-token-rejected",
  S3KeyAccessDenied = "s3-key-access-denied",
  S3ConfigurationRequired = "s3-configuration-required",
  VaultSelectionFailed = "vault-selection-failed",
  DuplicateProvider = "duplicate-provider",
  LocalFolderRequired = "local-folder-required",
  LocalFolderUnsupported = "local-folder-unsupported",
  LocalFolderAutomationUnavailable = "local-folder-automation-unavailable",
  PeerTimeout = "peer-timeout",
  PeerFailed = "peer-failed",
  BroadcastFailed = "broadcast-failed",
  BrowserCleanupFailed = "browser-cleanup-failed",
  DatabaseCleanupFailed = "database-cleanup-failed",
  LoggingCleanupFailed = "logging-cleanup-failed",
  ReloadFailed = "reload-failed",
  ExtensionPublicationFailed = "extension-publication-failed",
  ExtensionApprovalContextChanged = "extension-approval-context-changed",
  ExtensionProvidersHandOverFailed = "extension-providers-hand-over-failed",
}

/** Stable codes attached by the native provider adapter across the WASM boundary. */
export enum NativeProviderFailureCode {
  GitHubTokenRejected = "github-token-rejected",
  S3KeyAccessDenied = "s3-key-access-denied",
}

/** What a native failure's stable provider code says. */
export enum NativeProviderFailureKind {
  GitHubTokenRejected = "github-token-rejected",
  S3KeyAccessDenied = "s3-key-access-denied",
  /** No stable code: the failure keeps its generic kind. */
  Unclassified = "unclassified",
}

/** Reads a caught native failure's stable provider code: the code the
 * adapter attached, else the one Rust reads from the message. TypeScript
 * never matches the message text itself. */
export class NativeProviderFailure<NativeCause = Error | string> {
  constructor(private readonly cause: NativeCause) {}

  kind(): NativeProviderFailureKind {
    const cause = this.cause;
    if (cause instanceof Error && "code" in cause) {
      switch (cause.code) {
        case NativeProviderFailureCode.GitHubTokenRejected:
          return NativeProviderFailureKind.GitHubTokenRejected;
        case NativeProviderFailureCode.S3KeyAccessDenied:
          return NativeProviderFailureKind.S3KeyAccessDenied;
      }
    }
    switch (provider_failure_code(this.message())) {
      case "s3-key-access-denied":
        return NativeProviderFailureKind.S3KeyAccessDenied;
      case "unclassified":
        return NativeProviderFailureKind.Unclassified;
    }
  }

  /** The storage failure kind the code names. */
  storageFailureKind(): VaultStorageFailureKind {
    switch (this.kind()) {
      case NativeProviderFailureKind.GitHubTokenRejected:
        return VaultStorageFailureKind.GitHubTokenRejected;
      case NativeProviderFailureKind.S3KeyAccessDenied:
        return VaultStorageFailureKind.S3KeyAccessDenied;
      case NativeProviderFailureKind.Unclassified:
        return VaultStorageFailureKind.OperationFailed;
    }
  }

  private message(): string {
    const cause = this.cause;
    if (cause instanceof Error) return cause.message;
    return String(cause);
  }
}

export type VaultStorageFailureRequest = {
  readonly kind: VaultStorageFailureKind;
  readonly recoveryKind: VaultRecoveryErrorKind;
  /** Rust's loggable category of the native failure, never its message. */
  readonly cause: string;
};

type VaultStorageFailureInput =
  VaultStorageFailureKind | VaultStorageFailureRequest;

/** The cause logged for a failure the app raised itself: its kind says it all. */
const NON_NATIVE_FAILURE_CAUSE = "app";

export class VaultStorageFailure {
  readonly kind: VaultStorageFailureKind;
  readonly recoveryKind: VaultRecoveryErrorKind;
  readonly cause: string;

  constructor(input: VaultStorageFailureInput) {
    if (typeof input === "string") {
      this.kind = input;
      this.recoveryKind = VaultRecoveryErrorKind.Other;
      this.cause = NON_NATIVE_FAILURE_CAUSE;
      return;
    }
    this.kind = input.kind;
    this.recoveryKind = input.recoveryKind;
    this.cause = input.cause;
  }
  get translationKey() {
    switch (this.kind) {
      case VaultStorageFailureKind.DuplicateProvider:
        return I18N_KEYS.AuthStorageDuplicateSyncProvider;
      case VaultStorageFailureKind.LocalFolderUnsupported:
        return I18N_KEYS.ProviderSetupLocalFolderUnsupportedBrowser;
      case VaultStorageFailureKind.LocalFolderAutomationUnavailable:
        return I18N_KEYS.ProviderSetupLocalFolderAutomatedBrowserError;
      case VaultStorageFailureKind.LocalFolderRequired:
        return I18N_KEYS.AuthStorageLocalFolderChooseErr;
      case VaultStorageFailureKind.DeviceAuthorizationRequired:
        return I18N_KEYS.ErrorsDeviceProtectionAuthorizationRequired;
      case VaultStorageFailureKind.LocalFolderUnavailable:
        return I18N_KEYS.ErrorsLocalBackupFolderRequired;
      case VaultStorageFailureKind.UnlockMetadataUnavailable:
        return I18N_KEYS.ErrorsVaultUnlockMetadataUnavailable;
      case VaultStorageFailureKind.ManagerUnavailable:
        return I18N_KEYS.ErrorsEngineUnavailable;
      case VaultStorageFailureKind.GenerationChanged:
      case VaultStorageFailureKind.GenerationUnavailable:
      case VaultStorageFailureKind.DeletionActive:
        return I18N_KEYS.ErrorsValidationLocalDataChangedInAnotherTab;
      case VaultStorageFailureKind.TimedOut:
        return I18N_KEYS.ToastsErrorTimeout;
      case VaultStorageFailureKind.VaultSelectionFailed:
        return I18N_KEYS.ErrorsVaultSelectionFailed;
      case VaultStorageFailureKind.GitHubTokenRejected:
        return I18N_KEYS.AuthStorageGithubTokenRejected;
      case VaultStorageFailureKind.S3KeyAccessDenied:
        return I18N_KEYS.ErrorsS3KeyAccessDenied;
      case VaultStorageFailureKind.S3ConfigurationRequired:
        return I18N_KEYS.ErrorsValidationS3StorageTargetInvalid;
      case VaultStorageFailureKind.ExtensionApprovalContextChanged:
        return I18N_KEYS.ExtensionConsentApprovalFailed;
      case VaultStorageFailureKind.ExtensionProvidersHandOverFailed:
        return I18N_KEYS.ExtensionProvidersHandoverFailed;
      case VaultStorageFailureKind.ExtensionPublicationFailed:
      case VaultStorageFailureKind.OperationFailed:
      case VaultStorageFailureKind.LockUnavailable:
      case VaultStorageFailureKind.LockFailed:
        return I18N_KEYS.AuthStorageSyncFailed;
      case VaultStorageFailureKind.PeerTimeout:
      case VaultStorageFailureKind.PeerFailed:
      case VaultStorageFailureKind.BroadcastFailed:
      case VaultStorageFailureKind.BrowserCleanupFailed:
      case VaultStorageFailureKind.DatabaseCleanupFailed:
      case VaultStorageFailureKind.LoggingCleanupFailed:
      case VaultStorageFailureKind.ReloadFailed:
        return I18N_KEYS.SettingsDeleteLocalError;
    }
  }
}

export function isLocalDataInvalidationFailure(
  failure: VaultStorageFailure,
): boolean {
  return (
    failure.kind === VaultStorageFailureKind.GenerationChanged ||
    failure.kind === VaultStorageFailureKind.GenerationUnavailable ||
    failure.kind === VaultStorageFailureKind.DeletionActive
  );
}

/** Admits a native failure through Rust's compatibility classifier without retaining its message. */
export class NativeVaultStorageFailure<
  NativeCause = Error | string,
> extends VaultStorageFailure {
  constructor(cause: NativeCause) {
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    const request: VaultStorageFailureRequest = {
      kind: new NativeProviderFailure(cause).storageFailureKind(),
      recoveryKind: classify_vault_recovery_error(causeMessage),
      cause: provider_failure_cause(causeMessage),
    };
    super(request);
  }
}
