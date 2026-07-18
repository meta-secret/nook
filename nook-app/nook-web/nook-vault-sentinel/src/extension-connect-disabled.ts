export const EXTENSION_CONNECT_PATH = "/extension-connect";

import type { NookVaultManager } from "$app-wasm";

export type ExtensionConnectScope =
  | "vault-access"
  | "password-filling"
  | "sync-provider-credentials";

type ExtensionIdentityRequestBase = {
  deviceId: string;
  devicePublicKey: string;
  deviceSigningPublicKey: string;
  extensionRuntimeId: string;
  deviceLabel: string;
  nonce: string;
  scopes: ExtensionConnectScope[];
};

export type ExtensionConnectRequest =
  | (ExtensionIdentityRequestBase & {
      source: "extension-connect";
    })
  | (ExtensionIdentityRequestBase & {
      source: "paired-vault";
      vaultStoreId: string;
    });

export type PairedExtensionIdentityDiscovery =
  | { status: "unavailable" | "locked" }
  | { status: "unlocked"; request: ExtensionConnectRequest };

export const isExtensionConnectPath: (pathname: string) => boolean = () =>
  false;

export const extensionConnectRequestFromLocation: (
  location: Location,
) => undefined = () => undefined;

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
