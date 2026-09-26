import { VaultStorageFailureKind } from "$lib/runtime/storage-failure";

enum ProviderFailureLogHttpStatusKind {
  NotReported = "not-reported",
  Unauthorized = "unauthorized",
}

type ProviderFailureLogContextRequest = {
  readonly provider_type: string;
  readonly failure_kind: VaultStorageFailureKind;
};

type ProviderFailureLogContextRecordBase = {
  readonly provider_type: string;
  readonly failure_kind: VaultStorageFailureKind;
};

type ProviderFailureLogContextRecord =
  | ProviderFailureLogContextRecordBase
  | (ProviderFailureLogContextRecordBase & {
      readonly http_status: 401;
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
    };
    switch (ProviderFailureLogContext.httpStatusKind(request.failure_kind)) {
      case ProviderFailureLogHttpStatusKind.Unauthorized: {
        const record: ProviderFailureLogContextRecord = {
          ...base,
          http_status: 401,
        };
        return new ProviderFailureLogContext(record);
      }
      case ProviderFailureLogHttpStatusKind.NotReported:
        return new ProviderFailureLogContext(base);
    }
  }

  private static httpStatusKind(
    failure_kind: VaultStorageFailureKind,
  ): ProviderFailureLogHttpStatusKind {
    switch (failure_kind === VaultStorageFailureKind.GitHubTokenRejected) {
      case true:
        return ProviderFailureLogHttpStatusKind.Unauthorized;
      case false:
        return ProviderFailureLogHttpStatusKind.NotReported;
    }
  }

  serialize(): string {
    return JSON.stringify(this.record);
  }
}
