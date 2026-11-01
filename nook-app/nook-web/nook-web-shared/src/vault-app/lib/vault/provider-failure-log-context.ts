import { VaultStorageFailureKind } from "$lib/runtime/storage-failure";

enum ProviderFailureLogHttpStatusKind {
  NotReported = "not-reported",
  Unauthorized = "unauthorized",
  Forbidden = "forbidden",
}

type ProviderFailureLogContextRequest = {
  readonly provider_type: string;
  readonly failure_kind: VaultStorageFailureKind;
  readonly cause: string;
};

type ProviderFailureLogContextRecordBase = {
  readonly provider_type: string;
  readonly failure_kind: VaultStorageFailureKind;
  readonly cause: string;
};

type ProviderFailureLogContextRecord =
  | ProviderFailureLogContextRecordBase
  | (ProviderFailureLogContextRecordBase & {
      readonly http_status: 401;
    })
  | (ProviderFailureLogContextRecordBase & {
      readonly http_status: 403;
    });

/** Builds the provider failure context serialized into warning logs. */
export class ProviderFailureLogContext {
  private constructor(
    private readonly record: ProviderFailureLogContextRecord,
  ) {}

  static from(
    request: ProviderFailureLogContextRequest,
  ): ProviderFailureLogContext {
    const base: ProviderFailureLogContextRecordBase = {
      provider_type: request.provider_type,
      failure_kind: request.failure_kind,
      cause: request.cause,
    };
    switch (ProviderFailureLogContext.httpStatusKind(request.failure_kind)) {
      case ProviderFailureLogHttpStatusKind.Unauthorized: {
        const record: ProviderFailureLogContextRecord = {
          ...base,
          http_status: 401,
        };
        return new ProviderFailureLogContext(record);
      }
      case ProviderFailureLogHttpStatusKind.Forbidden: {
        const record: ProviderFailureLogContextRecord = {
          ...base,
          http_status: 403,
        };
        return new ProviderFailureLogContext(record);
      }
      case ProviderFailureLogHttpStatusKind.NotReported:
        return new ProviderFailureLogContext(base);
    }
  }

  /** The HTTP status a typed provider code stands for; the message names
   * none Rust can read. */
  private static httpStatusKind(
    failure_kind: VaultStorageFailureKind,
  ): ProviderFailureLogHttpStatusKind {
    switch (failure_kind) {
      case VaultStorageFailureKind.GitHubTokenRejected:
        return ProviderFailureLogHttpStatusKind.Unauthorized;
      case VaultStorageFailureKind.S3KeyAccessDenied:
        return ProviderFailureLogHttpStatusKind.Forbidden;
      case VaultStorageFailureKind.DeletionActive:
      case VaultStorageFailureKind.GenerationChanged:
      case VaultStorageFailureKind.GenerationUnavailable:
      case VaultStorageFailureKind.LockUnavailable:
      case VaultStorageFailureKind.LockFailed:
      case VaultStorageFailureKind.DeviceAuthorizationRequired:
      case VaultStorageFailureKind.LocalFolderUnavailable:
      case VaultStorageFailureKind.UnlockMetadataUnavailable:
      case VaultStorageFailureKind.ManagerUnavailable:
      case VaultStorageFailureKind.TimedOut:
      case VaultStorageFailureKind.OperationFailed:
      case VaultStorageFailureKind.S3ConfigurationRequired:
      case VaultStorageFailureKind.VaultSelectionFailed:
      case VaultStorageFailureKind.DuplicateProvider:
      case VaultStorageFailureKind.LocalFolderRequired:
      case VaultStorageFailureKind.LocalFolderUnsupported:
      case VaultStorageFailureKind.LocalFolderAutomationUnavailable:
      case VaultStorageFailureKind.PeerTimeout:
      case VaultStorageFailureKind.PeerFailed:
      case VaultStorageFailureKind.BroadcastFailed:
      case VaultStorageFailureKind.BrowserCleanupFailed:
      case VaultStorageFailureKind.DatabaseCleanupFailed:
      case VaultStorageFailureKind.LoggingCleanupFailed:
      case VaultStorageFailureKind.ReloadFailed:
      case VaultStorageFailureKind.ExtensionPublicationFailed:
      case VaultStorageFailureKind.ExtensionApprovalContextChanged:
      case VaultStorageFailureKind.ExtensionProvidersHandOverFailed:
        return ProviderFailureLogHttpStatusKind.NotReported;
    }
  }

  serialize(): string {
    return JSON.stringify(this.record);
  }
}
