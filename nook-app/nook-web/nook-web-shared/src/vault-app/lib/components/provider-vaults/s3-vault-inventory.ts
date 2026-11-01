import { Effect } from "effect";
import {
  list_s3_vaults,
  staged_s3_provider_detail,
  staged_s3_provider_label,
  type ProviderVaultListing,
  type S3Connection,
} from "$app-wasm";
import { configuredS3 } from "$lib/auth/providers";
import { S3ConnectionFailureKind } from "$lib/components/s3-connection-form";
import { browserLogRuntime } from "$lib/runtime/log";
import {
  NativeProviderFailure,
  NativeProviderFailureKind,
  NativeVaultStorageFailure,
} from "$lib/runtime/storage-failure";
import type { VaultState } from "$lib/vault.svelte";
import { ProviderFailureLogContext } from "$lib/vault/provider-failure-log-context";
import { ProviderVaultActions } from "$lib/vault/provider-vaults";
import { I18N_KEYS, type I18nKey } from "../../../../generated/i18n-keys";

/** Why an S3 location could not be listed, as the S3 form's alert says. */
export type S3ListingFailureKind =
  S3ConnectionFailureKind.AccessDenied | S3ConnectionFailureKind.ListFailed;

/** An S3 listing that failed: a refused key, or any other failure. Its
 * message never reaches the page or the logs. */
export class S3ListingFailure<NativeCause = Error | string> {
  readonly kind: S3ListingFailureKind;
  /** The failure as provider logs record it. */
  readonly storage: NativeVaultStorageFailure<NativeCause>;

  constructor(cause: NativeCause) {
    this.storage = new NativeVaultStorageFailure(cause);
    this.kind = S3ListingFailure.kindOf(
      new NativeProviderFailure(cause).kind(),
    );
  }

  get translationKey(): I18nKey {
    switch (this.kind) {
      case S3ConnectionFailureKind.AccessDenied:
        return I18N_KEYS.ErrorsS3KeyAccessDenied;
      case S3ConnectionFailureKind.ListFailed:
        return I18N_KEYS.ProviderSetupS3ListFailed;
    }
  }

  private static kindOf(code: NativeProviderFailureKind): S3ListingFailureKind {
    switch (code) {
      case NativeProviderFailureKind.S3KeyAccessDenied:
        return S3ConnectionFailureKind.AccessDenied;
      case NativeProviderFailureKind.GitHubTokenRejected:
      case NativeProviderFailureKind.Unclassified:
        return S3ConnectionFailureKind.ListFailed;
    }
  }
}

export enum S3VaultInventoryKind {
  Loading = "loading",
  Loaded = "loaded",
  Failed = "failed",
}

/** One read of an S3 location's keyrings. */
export type S3VaultRead =
  | {
      readonly kind: S3VaultInventoryKind.Loaded;
      readonly listing: ProviderVaultListing;
    }
  | {
      readonly kind: S3VaultInventoryKind.Failed;
      readonly failure: S3ListingFailure;
    };

/** What the first-run step knows about the keyrings at an S3 location. */
export type S3VaultInventory =
  { readonly kind: S3VaultInventoryKind.Loading } | S3VaultRead;

type S3ListingAttempt = {
  readonly try: () => Promise<ProviderVaultListing>;
  readonly catch: (
    cause: ConstructorParameters<typeof S3ListingFailure>[0],
  ) => S3ListingFailure;
};

/** Reads the keyrings at an S3 location with this device's key, without
 * saving or connecting it. */
export class S3VaultInventoryReader {
  private static readonly log =
    browserLogRuntime.createLogger("vault-providers");

  constructor(private readonly vault: VaultState) {}

  async read(configuration: S3Connection): Promise<S3VaultRead> {
    const localVault = new ProviderVaultActions(
      this.vault,
    ).localVaultOccupancy();
    const attempt: S3ListingAttempt = {
      try: () => list_s3_vaults(configuration, localVault),
      catch: (cause) => new S3ListingFailure(cause),
    };
    const listed = await Effect.runPromise(
      Effect.result(Effect.tryPromise(attempt)),
    );
    switch (listed._tag) {
      case "Success":
        return { kind: S3VaultInventoryKind.Loaded, listing: listed.success };
      case "Failure":
        S3VaultInventoryReader.report(listed.failure);
        return { kind: S3VaultInventoryKind.Failed, failure: listed.failure };
    }
  }

  private static report(failure: S3ListingFailure): void {
    const request: Parameters<typeof ProviderFailureLogContext.from>[0] = {
      provider_type: "s3",
      failure_kind: failure.storage.kind,
      cause: failure.storage.cause,
    };
    const warning: Parameters<
      typeof S3VaultInventoryReader.log.warnWithContext
    >[0] = {
      message: "S3 vault listing failed",
      serializedContext: ProviderFailureLogContext.from(request).serialize(),
    };
    S3VaultInventoryReader.log.warnWithContext(warning);
  }
}

/** Where a staged S3 connection points, in Rust's words: the label
 * `S3 · bucket[/prefix]` and the detail `host[:port] · accessKeyId`. */
export class S3StagedLocation {
  constructor(private readonly configuration: S3Connection) {}

  get label(): string {
    return staged_s3_provider_label(configuredS3(this.configuration));
  }

  get detail(): string {
    return staged_s3_provider_detail(this.configuration);
  }
}
