import type { PairedExtensionIdentityDiscovery } from '$lib/extension/connect'
import { ExtensionPairedVaultIdentityStatusMessageStatus } from '$web-shared/extension/paired-vault-identity-status'

export enum LoginVaultExtensionPairingStatusKind {
  NotShown = 'not-shown',
  Checking = 'checking',
  Paired = 'paired',
  NotPaired = 'not-paired',
  Unavailable = 'unavailable',
}

export type LoginVaultExtensionPairingStatusEntry = {
  readonly storeId: string
  readonly kind: LoginVaultExtensionPairingStatusKind
  readonly connectedVaultStoreId: string | undefined
  readonly connectedVaultName: string | undefined
}

export type LoginVaultExtensionPairingStatusLookupRequest = {
  readonly entries: readonly LoginVaultExtensionPairingStatusEntry[]
}

export class LoginVaultExtensionPairingStatusProjection {
  readonly kind: LoginVaultExtensionPairingStatusKind
  readonly connectedVaultStoreId: string | undefined
  readonly connectedVaultName: string | undefined

  constructor(discovery: PairedExtensionIdentityDiscovery) {
    this.connectedVaultStoreId =
      discovery.status === ExtensionPairedVaultIdentityStatusMessageStatus.DifferentVault
        ? discovery.connectedVaultStoreId
        : undefined
    this.connectedVaultName =
      discovery.status === ExtensionPairedVaultIdentityStatusMessageStatus.DifferentVault
        ? discovery.connectedVaultName
        : undefined

    switch (discovery.status) {
      case ExtensionPairedVaultIdentityStatusMessageStatus.Locked:
      case ExtensionPairedVaultIdentityStatusMessageStatus.Unlocked:
        this.kind = LoginVaultExtensionPairingStatusKind.Paired
        break
      case ExtensionPairedVaultIdentityStatusMessageStatus.DifferentVault:
        this.kind = LoginVaultExtensionPairingStatusKind.NotPaired
        break
      case ExtensionPairedVaultIdentityStatusMessageStatus.Unavailable:
        this.kind = LoginVaultExtensionPairingStatusKind.Unavailable
        break
    }
  }
}

export class LoginVaultExtensionPairingStatusLookup {
  private readonly entries: readonly LoginVaultExtensionPairingStatusEntry[]

  constructor(request: LoginVaultExtensionPairingStatusLookupRequest) {
    this.entries = request.entries
  }

  forStore(storeId: string): LoginVaultExtensionPairingStatusKind {
    const entry = this.entryForStore(storeId)
    switch (entry) {
      case undefined:
        return LoginVaultExtensionPairingStatusKind.NotShown
      default:
        return entry.kind
    }
  }

  entryForStore(storeId: string): LoginVaultExtensionPairingStatusEntry | undefined {
    return this.entries.find((candidate) => candidate.storeId === storeId)
  }
}
