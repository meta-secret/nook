import type { S3Connection } from "$app-wasm";
import type { StorageProvider } from "$lib/auth/providers";

export enum S3ProviderKeysKind {
  /** An S3 row: its keys are listed and managed. */
  Listed = "listed",
  /** Any other provider has no access keys. */
  None = "none",
}

export type S3ProviderKeys =
  | {
      readonly kind: S3ProviderKeysKind.Listed;
      readonly connection: S3Connection;
    }
  | { readonly kind: S3ProviderKeysKind.None };

/** Which saved rows have S3 keys to manage. */
export class S3ProviderKeysOf {
  static row(provider: StorageProvider): S3ProviderKeys {
    const stored = provider.provider;
    switch (stored.type) {
      case "s3":
        return { kind: S3ProviderKeysKind.Listed, connection: stored };
      case "local":
      case "local-folder":
      case "github":
      case "oauth-file":
        return { kind: S3ProviderKeysKind.None };
    }
  }
}
