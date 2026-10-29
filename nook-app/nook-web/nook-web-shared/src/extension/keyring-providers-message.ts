import type { NookKeyringProviderShares } from "../vault-app/lib/nook-wasm/nook_wasm.js";

export enum ExtensionKeyringProvidersMessageType {
  NookExtensionKeyringProviders = "nook:extension-keyring-providers",
}

/** The keyring's remote providers the web app hands the extension after they
 * change: one copy per other app of the keyring, each sealed in Rust to that
 * app's key. The extension's Rust admission decodes the payload. */
export type ExtensionKeyringProvidersMessage = {
  readonly type: ExtensionKeyringProvidersMessageType.NookExtensionKeyringProviders;
  readonly payload: NookKeyringProviderShares;
};
