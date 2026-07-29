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

export enum PairedExtensionIdentityDiscoveryForStatus {
  Unavailable = "unavailable",
  Locked = "locked",
  DifferentVault = "different-vault",
  Unlocked = "unlocked",
}

export type PairedExtensionIdentityDiscoveryFor<Request> =
  | {
      status:
        | PairedExtensionIdentityDiscoveryForStatus.Unavailable
        | PairedExtensionIdentityDiscoveryForStatus.Locked;
    }
  | {
      status: PairedExtensionIdentityDiscoveryForStatus.DifferentVault;
      connectedVaultStoreId: string;
      connectedVaultName: string;
    }
  | {
      status: PairedExtensionIdentityDiscoveryForStatus.Unlocked;
      request: Request;
    };
