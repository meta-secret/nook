import type { ProviderKind } from "$app-wasm";

/** The provider kinds a setup starts from, as values of Rust's `ProviderKind`. */
export class ProviderSetupKinds {
  static readonly THIS_BROWSER: ProviderKind = { type: "local" };
  static readonly LOCAL_FOLDER: ProviderKind = { type: "local-folder" };
  static readonly GITHUB: ProviderKind = { type: "github" };
  static readonly GOOGLE_DRIVE: ProviderKind = {
    type: "oauth-file",
    preset: "google-drive",
  };
  static readonly ICLOUD: ProviderKind = {
    type: "oauth-file",
    preset: "icloud",
  };
  static readonly S3: ProviderKind = { type: "s3" };
}
