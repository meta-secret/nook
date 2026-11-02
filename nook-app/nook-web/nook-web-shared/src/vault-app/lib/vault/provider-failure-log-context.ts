import type { VaultStorageFailureKind } from "$lib/runtime/storage-failure";

type ProviderFailureLogContextRequest = {
  readonly provider_type: string;
  readonly failure_kind: VaultStorageFailureKind;
  /** Rust's loggable category of the failure, such as `unauthorized` for a
   * token GitHub rejected or `forbidden` for an S3 key without access. */
  readonly cause: string;
};

type ProviderFailureLogContextRecord = ProviderFailureLogContextRequest;

/** Builds the provider failure context serialized into warning logs. */
export class ProviderFailureLogContext {
  private constructor(
    private readonly record: ProviderFailureLogContextRecord,
  ) {}

  static from(
    request: ProviderFailureLogContextRequest,
  ): ProviderFailureLogContext {
    const record: ProviderFailureLogContextRecord = {
      provider_type: request.provider_type,
      failure_kind: request.failure_kind,
      cause: request.cause,
    };
    return new ProviderFailureLogContext(record);
  }

  serialize(): string {
    return JSON.stringify(this.record);
  }
}
