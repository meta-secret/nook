import { ExtensionPairedVaultIdentityStatusMessageStatus } from './paired-vault-identity-status'
import type { CompanionAdmittedIdentityDiscovery } from './nook-companion-wasm/nook_companion_wasm.js'

export enum ExtensionIdentityRequestSource {
  ExtensionConnect = 'extension-connect',
  PairedVault = 'paired-vault',
}

export type ExtensionConnectRequestFor<Scope extends string> =
  | (ExtensionIdentityRequestBase<Scope> & {
      source: ExtensionIdentityRequestSource.ExtensionConnect
    })
  | (ExtensionIdentityRequestBase<Scope> & {
      source: ExtensionIdentityRequestSource.PairedVault
      vaultStoreId: string
      protocolTransaction: CompanionAdmittedIdentityDiscovery
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
        | typeof ExtensionPairedVaultIdentityStatusMessageStatus.Unavailable
        | typeof ExtensionPairedVaultIdentityStatusMessageStatus.Locked
    }
  | {
      status: typeof ExtensionPairedVaultIdentityStatusMessageStatus.DifferentVault
      connectedVaultStoreId: string
      connectedVaultName: string
    }
  | {
      status: typeof ExtensionPairedVaultIdentityStatusMessageStatus.Unlocked
      request: Request
    }
