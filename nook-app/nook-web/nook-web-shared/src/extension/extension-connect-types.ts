import { ExtensionConnectScope } from './extension-connect-scope'
import { ExtensionPairedVaultIdentityStatusMessageStatus } from './runtime-messages'

export enum ExtensionIdentityRequestSource {
  ExtensionConnect = 'extension-connect',
  PairedVault = 'paired-vault',
}

export { ExtensionConnectScope }

export type ExtensionConnectRequestFor<Scope extends string> =
  | (ExtensionIdentityRequestBase<Scope> & {
      source: ExtensionIdentityRequestSource.ExtensionConnect
    })
  | (ExtensionIdentityRequestBase<Scope> & {
      source: ExtensionIdentityRequestSource.PairedVault
      vaultStoreId: string
    })

type ExtensionIdentityRequestBase<Scope extends string> = {
  deviceId: string
  devicePublicKey: string
  deviceSigningPublicKey: string
  extensionRuntimeId: string
  deviceLabel: string
  nonce: string
  scopes: Scope[]
}

export type PairedExtensionIdentityDiscoveryFor<Request> =
  | {
      status:
        | ExtensionPairedVaultIdentityStatusMessageStatus.Unavailable
        | ExtensionPairedVaultIdentityStatusMessageStatus.Locked
    }
  | {
      status: ExtensionPairedVaultIdentityStatusMessageStatus.DifferentVault
      connectedVaultStoreId: string
      connectedVaultName: string
    }
  | {
      status: ExtensionPairedVaultIdentityStatusMessageStatus.Unlocked
      request: Request
    }
