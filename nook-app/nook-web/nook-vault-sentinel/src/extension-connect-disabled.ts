export const EXTENSION_CONNECT_PATH = "/extension-connect";

import type { NookVaultManager } from "$app-wasm";
import type {
  ExtensionConnectRequestFor,
  PairedExtensionIdentityDiscoveryFor,
} from "$web-shared/extension/extension-connect-types";

export type ExtensionConnectScope =
  | "vault-access"
  | "password-filling"
  | "sync-provider-credentials";

export type ExtensionConnectRequest =
  ExtensionConnectRequestFor<ExtensionConnectScope>;
export type PairedExtensionIdentityDiscovery =
  PairedExtensionIdentityDiscoveryFor<ExtensionConnectRequest>;

export const isExtensionConnectPath: (pathname: string) => boolean = () =>
  false;

export const extensionConnectRequestFromLocation: (
  location: Location,
) => undefined = () => undefined;

export function readInstalledExtensionRuntimeId(): undefined {
  return undefined;
}

export async function openInstalledExtension(): Promise<boolean> {
  return false;
}

export async function discoverPairedExtensionIdentity(
  _vaultStoreId: string,
): Promise<PairedExtensionIdentityDiscovery> {
  void _vaultStoreId;
  return { status: "unavailable" };
}

export async function requestPairedExtensionUnlock(
  _vaultStoreId: string,
): Promise<boolean> {
  void _vaultStoreId;
  return false;
}

export function scopeLabel(): never {
  throw new Error("errors.validation.sentinel_extension_forbidden");
}

export async function adoptExtensionIdentity(
  _manager: NookVaultManager,
  _request: ExtensionConnectRequest,
): Promise<void> {
  void _manager;
  void _request;
  throw new Error("errors.validation.sentinel_extension_forbidden");
}
