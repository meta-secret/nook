import type {
  OAuthFilePreset,
  StorageProviderType,
} from "../nook-wasm/nook_wasm";

export const LOCAL_PROVIDER_TYPE = "local" satisfies StorageProviderType;
export const LOCAL_FOLDER_PROVIDER_TYPE =
  "local-folder" satisfies StorageProviderType;
export const GITHUB_PROVIDER_TYPE = "github" satisfies StorageProviderType;
export const OAUTH_FILE_PROVIDER_TYPE =
  "oauth-file" satisfies StorageProviderType;
export const GOOGLE_DRIVE_OAUTH_FILE_PRESET =
  "google-drive" satisfies OAuthFilePreset;
export const ICLOUD_OAUTH_FILE_PRESET = "icloud" satisfies OAuthFilePreset;
