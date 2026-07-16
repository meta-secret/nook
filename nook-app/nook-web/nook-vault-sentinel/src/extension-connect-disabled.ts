export const EXTENSION_CONNECT_PATH = "/extension-connect";

import type { NookVaultManager } from "$app-wasm";

export type ExtensionConnectScope =
  | "vault-access"
  | "password-filling"
  | "sync-provider-credentials";

export type ExtensionConnectRequest = {
  deviceId: string;
  devicePublicKey: string;
  deviceSigningPublicKey: string;
  extensionRuntimeId: string;
  deviceLabel: string;
  nonce: string;
  scopes: ExtensionConnectScope[];
};

export const isExtensionConnectPath: (pathname: string) => boolean = () =>
  false;

export const extensionConnectRequestFromLocation: (
  location: Location,
) => undefined = () => undefined;

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
