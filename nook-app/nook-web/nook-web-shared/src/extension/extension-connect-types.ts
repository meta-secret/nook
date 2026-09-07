import { ExtensionPairedVaultIdentityStatusMessageStatus } from './paired-vault-identity-status'
import type {
  CompanionIdentityDiscoveryObservation,
  CompanionIdentityStatus,
} from './nook-companion-wasm/nook_companion_wasm.js'

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
      protocolDiscovery: CompanionIdentityDiscoveryObservation
      protocolStatus: CompanionIdentityStatus
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
