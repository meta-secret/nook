import type { OAuthFileProvider, StorageProvider } from "$lib/auth/providers";

export enum SharedProviderAccountsKind {
  /** A Drive folder or iCloud share whose authorized accounts are listed. */
  Listed = "listed",
  /** A provider without a shared target. */
  None = "none",
}

export type SharedProviderAccounts =
  | {
      readonly kind: SharedProviderAccountsKind.Listed;
      readonly payload: OAuthFileProvider;
    }
  | { readonly kind: SharedProviderAccountsKind.None };

/** Which saved rows have accounts to manage: every Google Drive and iCloud
 * row carries its shared target. */
export class SharedProviderAccountsOf {
  /** The shared target an accounts list reads, as its reload key. */
  static targetKey(payload: OAuthFileProvider): string {
    switch (payload.preset) {
      case "google-drive":
        return payload.folderId;
      case "icloud":
        return payload.shareTarget;
    }
  }

  static row(provider: StorageProvider): SharedProviderAccounts {
    const stored = provider.provider;
    switch (stored.type) {
      case "oauth-file":
        return { kind: SharedProviderAccountsKind.Listed, payload: stored };
      case "local":
      case "local-folder":
      case "github":
      case "s3":
        return { kind: SharedProviderAccountsKind.None };
    }
  }
}
