import type { StartSentinelGenesisArgs } from "$app-wasm";
import type {
  LocalFolderConfig,
  OAuthFileConfig,
  StorageProviderType,
} from "$lib/auth-providers";
import type { ExtensionConnectRequest } from "$lib/extension-connect";
import type { ExtensionSetupState } from "$lib/extension-install";
import type { LegalPageId } from "$lib/legal-content";

export enum ColorMode {
  Light = "light",
  Dark = "dark",
}

export function systemColorMode(): ColorMode {
  return "window" in globalThis &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
    ? ColorMode.Dark
    : ColorMode.Light;
}

export function manualColorMode(
  current: ColorMode,
  storageKey: string,
): ColorMode {
  const selected =
    current === ColorMode.Dark ? ColorMode.Light : ColorMode.Dark;
  localStorage.setItem(storageKey, selected);
  return selected;
}

export enum LegalRouteKind {
  Application = "application",
  Legal = "legal",
}

export type LegalRoute =
  | { kind: LegalRouteKind.Application }
  | { kind: LegalRouteKind.Legal; page: LegalPageId };

export function legalRoute(page: LegalPageId | void): LegalRoute {
  return page
    ? { kind: LegalRouteKind.Legal, page }
    : { kind: LegalRouteKind.Application };
}

export enum ExtensionConnectIntentKind {
  Absent = "absent",
  Requested = "requested",
}

export type ExtensionConnectIntent =
  | { kind: ExtensionConnectIntentKind.Absent }
  | {
      kind: ExtensionConnectIntentKind.Requested;
      request: ExtensionConnectRequest;
    };

export function extensionConnectIntent(
  request: ExtensionConnectRequest | void,
): ExtensionConnectIntent {
  return request
    ? { kind: ExtensionConnectIntentKind.Requested, request }
    : { kind: ExtensionConnectIntentKind.Absent };
}

export enum ExtensionSetupOfferKind {
  Hidden = "hidden",
  Visible = "visible",
}

export type ExtensionSetupOffer =
  | { kind: ExtensionSetupOfferKind.Hidden }
  | { kind: ExtensionSetupOfferKind.Visible; setup: ExtensionSetupState };

export enum PendingVaultCreationKind {
  Simple = "simple",
  Sentinel = "sentinel",
  SentinelParticipantKey = "sentinel-participant-key",
  SentinelParticipantResponse = "sentinel-participant-response",
  SentinelOnboarding = "sentinel-onboarding",
}

export type PendingVaultCreation =
  | { kind: PendingVaultCreationKind.Simple; label: string }
  | { kind: PendingVaultCreationKind.Sentinel; args: StartSentinelGenesisArgs }
  | { kind: PendingVaultCreationKind.SentinelParticipantKey }
  | {
      kind: PendingVaultCreationKind.SentinelParticipantResponse;
      requestPayload: string;
    }
  | { kind: PendingVaultCreationKind.SentinelOnboarding; packageJson: string };

export enum VaultCreationQueueKind {
  Idle = "idle",
  WaitingForDevice = "waiting-for-device",
}

export type VaultCreationQueue =
  | { kind: VaultCreationQueueKind.Idle }
  | {
      kind: VaultCreationQueueKind.WaitingForDevice;
      request: PendingVaultCreation;
    };

export type PendingExistingVaultImport = {
  storeId: string;
  previousActiveStoreId: string | void;
  setupType: StorageProviderType;
  githubPat: string;
  githubRepo: string;
  oauthFile: OAuthFileConfig | void;
  localFolder: LocalFolderConfig | void;
};

export enum ExistingVaultImportQueueKind {
  Idle = "idle",
  WaitingForDevice = "waiting-for-device",
}

export type ExistingVaultImportQueue =
  | { kind: ExistingVaultImportQueueKind.Idle }
  | {
      kind: ExistingVaultImportQueueKind.WaitingForDevice;
      request: PendingExistingVaultImport;
    };

export type PendingEnrollmentSubmit = { code: string; password: string };

export enum EnrollmentSubmitQueueKind {
  Idle = "idle",
  WaitingForDevice = "waiting-for-device",
}

export type EnrollmentSubmitQueue =
  | { kind: EnrollmentSubmitQueueKind.Idle }
  | {
      kind: EnrollmentSubmitQueueKind.WaitingForDevice;
      request: PendingEnrollmentSubmit;
    };
