import type { ExtensionConnectFollow } from "./extension-connect-progress";

export type ExtensionConnectRequestFor<Scope extends string> = {
  /** Whether a side panel follows this connect page. */
  follow: ExtensionConnectFollow;
  deviceId: string;
  devicePublicKey: string;
  deviceSigningPublicKey: string;
  extensionRuntimeId: string;
  deviceLabel: string;
  scopes: Scope[];
};
