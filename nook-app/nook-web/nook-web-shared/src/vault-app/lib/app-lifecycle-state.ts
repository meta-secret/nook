import type { StartSentinelGenesisArgs } from "$app-wasm";
import type {
  LocalFolderConfig,
  OAuthFileConfig,
  StorageProviderType,
} from "$lib/auth-providers";
import type { ExtensionConnectRequest } from "$lib/extension-connect";
import type { ExtensionSetupState } from "$lib/extension-install";
import type { LegalPageId } from "$lib/legal-content";

export type ColorMode = "light" | "dark";

export function systemColorMode(): ColorMode {
  return typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export type LegalRoute =
  | { kind: "application" }
  | { kind: "legal"; page: LegalPageId };

export function legalRoute(page: LegalPageId | void): LegalRoute {
  return typeof page === "undefined"
    ? { kind: "application" }
    : { kind: "legal", page };
}

export type ExtensionConnectIntent =
  | { kind: "absent" }
  | { kind: "requested"; request: ExtensionConnectRequest };

export function extensionConnectIntent(
  request: ExtensionConnectRequest | void,
): ExtensionConnectIntent {
  return typeof request === "undefined"
    ? { kind: "absent" }
    : { kind: "requested", request };
}

export type ExtensionSetupOffer =
  | { kind: "hidden" }
  | { kind: "visible"; setup: ExtensionSetupState };

export type PendingVaultCreation =
  | { kind: "simple"; label: string }
  | { kind: "sentinel"; args: StartSentinelGenesisArgs }
  | { kind: "sentinel-participant-key" }
  | { kind: "sentinel-participant-response"; requestPayload: string }
  | { kind: "sentinel-onboarding"; packageJson: string };

export type VaultCreationQueue =
  | { kind: "idle" }
  | { kind: "waiting-for-device"; request: PendingVaultCreation };

export type PendingExistingVaultImport = {
  storeId: string;
  previousActiveStoreId: string | void;
  setupType: StorageProviderType;
  githubPat: string;
  githubRepo: string;
  oauthFile: OAuthFileConfig | void;
  localFolder: LocalFolderConfig | void;
};

export type ExistingVaultImportQueue =
  | { kind: "idle" }
  | { kind: "waiting-for-device"; request: PendingExistingVaultImport };

export type PendingEnrollmentSubmit = { code: string; password: string };

export type EnrollmentSubmitQueue =
  | { kind: "idle" }
  | { kind: "waiting-for-device"; request: PendingEnrollmentSubmit };
