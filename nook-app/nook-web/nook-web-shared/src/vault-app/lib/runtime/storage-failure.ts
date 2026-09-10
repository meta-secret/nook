import {
  classify_vault_recovery_error,
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
  ManagerUnavailable = "manager-unavailable",
  TimedOut = "timed-out",
  OperationFailed = "operation-failed",
  VaultSelectionFailed = "vault-selection-failed",
  IdentityHandoffRejected = "identity-handoff-rejected",
  IdentityHandoffUnavailable = "identity-handoff-unavailable",
  IdentityHandoffConsumed = "identity-handoff-consumed",
  IdentityHandoffCleanupFailed = "identity-handoff-cleanup-failed",
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
}

export class VaultStorageFailure {
  // eslint-disable-next-line max-params -- Existing integration signature is preserved for this lint-only fix.
  constructor(
    readonly kind: VaultStorageFailureKind,
    readonly recoveryKind = VaultRecoveryErrorKind.Other,
  ) {}
  get translationKey() {
    switch (this.kind) {
      case VaultStorageFailureKind.IdentityHandoffRejected:
      case VaultStorageFailureKind.IdentityHandoffUnavailable:
      case VaultStorageFailureKind.IdentityHandoffConsumed:
      case VaultStorageFailureKind.IdentityHandoffCleanupFailed:
        return I18N_KEYS.ExtensionConnectIdentityHandoffFailed;
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

/** Admits a native failure through Rust's compatibility classifier without retaining its message. */
export class NativeVaultStorageFailure extends VaultStorageFailure {
  // eslint-disable-next-line @typescript-eslint/no-restricted-types -- Foreign host data is narrowed at this boundary.
  constructor(cause: unknown) {
    super(
      VaultStorageFailureKind.OperationFailed,
      classify_vault_recovery_error(
        cause instanceof Error ? cause.message : String(cause),
      ),
    );
  }
}
