import {
  classify_vault_recovery_error,
  provider_draft_gap_translation_key,
  provider_failure_cause,
  provider_failure_code,
  provider_failure_translation_key,
  VaultRecoveryErrorKind,
  type ProviderDraftGap,
  type ProviderFailureCode,
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
  /** The provider draft lacks what it needs to connect; Rust names the gap. */
  ProviderDraftIncomplete = "provider-draft-incomplete",
  VaultSelectionFailed = "vault-selection-failed",
  DuplicateProvider = "duplicate-provider",
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

/** A failure the app raises itself: its kind picks its message. */
export type AppStorageFailureKind = Exclude<
  VaultStorageFailureKind,
  VaultStorageFailureKind.ProviderDraftIncomplete
>;

export type VaultStorageFailureRequest = {
  readonly kind: VaultStorageFailureKind;
  readonly recoveryKind: VaultRecoveryErrorKind;
  /** Rust's loggable category of the native failure, never its message. */
  readonly cause: string;
  /** The message key Rust chose for this failure. */
  readonly translationKey: string;
};

type VaultStorageFailureInput =
  AppStorageFailureKind | VaultStorageFailureRequest;

/** The cause logged for a failure the app raised itself: its kind says it all. */
const NON_NATIVE_FAILURE_CAUSE = "app";

export class VaultStorageFailure {
  readonly kind: VaultStorageFailureKind;
  readonly recoveryKind: VaultRecoveryErrorKind;
  readonly cause: string;
  readonly translationKey: string;

  constructor(input: VaultStorageFailureInput) {
    if (typeof input === "string") {
      this.kind = input;
      this.recoveryKind = VaultRecoveryErrorKind.Other;
      this.cause = NON_NATIVE_FAILURE_CAUSE;
      this.translationKey = VaultStorageFailure.appFailureKey(input);
      return;
    }
    this.kind = input.kind;
    this.recoveryKind = input.recoveryKind;
    this.cause = input.cause;
    this.translationKey = input.translationKey;
  }

  private static appFailureKey(kind: AppStorageFailureKind): string {
    switch (kind) {
      case VaultStorageFailureKind.DuplicateProvider:
        return I18N_KEYS.AuthStorageDuplicateSyncProvider;
      case VaultStorageFailureKind.LocalFolderUnsupported:
        return I18N_KEYS.ProviderSetupLocalFolderUnsupportedBrowser;
      case VaultStorageFailureKind.LocalFolderAutomationUnavailable:
        return I18N_KEYS.ProviderSetupLocalFolderAutomatedBrowserError;
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

/** Admits a native failure through Rust's classifiers without retaining its
 * message: Rust reads the stable provider code and picks the message key. */
export class NativeVaultStorageFailure<
  NativeCause = Error | string,
> extends VaultStorageFailure {
  readonly code: ProviderFailureCode;

  constructor(cause: NativeCause) {
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    const keyRequest: Parameters<typeof provider_failure_translation_key>[0] = {
      message: causeMessage,
      operationFailedKey: I18N_KEYS.AuthStorageSyncFailed,
    };
    const request: VaultStorageFailureRequest = {
      kind: VaultStorageFailureKind.OperationFailed,
      recoveryKind: classify_vault_recovery_error(causeMessage),
      cause: provider_failure_cause(causeMessage),
      translationKey: provider_failure_translation_key(keyRequest),
    };
    super(request);
    this.code = provider_failure_code(causeMessage);
  }
}

/** A provider draft that cannot connect yet, with Rust's message for its gap. */
export class ProviderDraftIncompleteFailure extends VaultStorageFailure {
  constructor(readonly gap: ProviderDraftGap) {
    const request: VaultStorageFailureRequest = {
      kind: VaultStorageFailureKind.ProviderDraftIncomplete,
      recoveryKind: VaultRecoveryErrorKind.Other,
      cause: NON_NATIVE_FAILURE_CAUSE,
      translationKey: provider_draft_gap_translation_key(gap),
    };
    super(request);
  }
}
