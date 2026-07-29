export type ExtensionConnectRequestFor<Scope extends string> =
  | (ExtensionIdentityRequestBase<Scope> & { source: "extension-connect" })
  | (ExtensionIdentityRequestBase<Scope> & {
      source: "paired-vault";
      vaultStoreId: string;
    });

type ExtensionIdentityRequestBase<Scope extends string> = {
  deviceId: string;
  devicePublicKey: string;
  deviceSigningPublicKey: string;
  extensionRuntimeId: string;
  deviceLabel: string;
  nonce: string;
  scopes: Scope[];
};

export type PairedExtensionIdentityDiscoveryFor<Request> =
  | {
      status:
        | ExtensionPairedVaultIdentityStatusMessageStatus.Unavailable
        | ExtensionPairedVaultIdentityStatusMessageStatus.Locked;
    }
  | {
      status: ExtensionPairedVaultIdentityStatusMessageStatus.DifferentVault;
      connectedVaultStoreId: string;
      connectedVaultName: string;
    }
  | {
      status: ExtensionPairedVaultIdentityStatusMessageStatus.Unlocked;
      request: Request;
    };
import { ExtensionPairedVaultIdentityStatusMessageStatus } from "./runtime-messages";
