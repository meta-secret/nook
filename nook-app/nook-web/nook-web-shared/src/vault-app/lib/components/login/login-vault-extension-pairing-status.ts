import type { PairedExtensionIdentityDiscovery } from '$lib/extension/connect'
import { ExtensionPairedVaultIdentityStatusMessageStatus } from '$web-shared/extension/paired-vault-identity-status'
import { LoginVaultEntryKind, type LoginVaultEntry } from './login-unlock-state'

export enum LoginVaultExtensionPairingStatusKind {
  NotShown = 'not-shown',
  Checking = 'checking',
  Paired = 'paired',
  NotPaired = 'not-paired',
  Unavailable = 'unavailable',
}

export type LoginVaultConnectedExtensionIdentity = {
  readonly storeId: string
  readonly name: string
}

export type LoginVaultExtensionResolvedPairingStatus =
  | { readonly kind: LoginVaultExtensionPairingStatusKind.Paired }
  | {
      readonly kind: LoginVaultExtensionPairingStatusKind.NotPaired
      readonly connectedVault: LoginVaultConnectedExtensionIdentity
    }
  | { readonly kind: LoginVaultExtensionPairingStatusKind.Unavailable }

export type LoginVaultExtensionPairingStatus =
  | { readonly kind: LoginVaultExtensionPairingStatusKind.NotShown }
  | { readonly kind: LoginVaultExtensionPairingStatusKind.Checking }
  | LoginVaultExtensionResolvedPairingStatus

export type LoginVaultNotPairedExtensionPairingStatus = Extract<
  LoginVaultExtensionPairingStatus,
  { readonly kind: LoginVaultExtensionPairingStatusKind.NotPaired }
>

export type LoginVaultExtensionPairingStatusEntry = {
  readonly storeId: string
} & (
  | { readonly kind: LoginVaultExtensionPairingStatusKind.Checking }
  | LoginVaultExtensionResolvedPairingStatus
)

export type LoginVaultExtensionPairingStatusLookupRequest = {
  readonly entries: readonly LoginVaultExtensionPairingStatusEntry[]
}

export class LoginVaultExtensionPairingStatusProjection {
  readonly status: LoginVaultExtensionResolvedPairingStatus

  constructor(discovery: PairedExtensionIdentityDiscovery) {
    switch (discovery.status) {
      case ExtensionPairedVaultIdentityStatusMessageStatus.Locked:
      case ExtensionPairedVaultIdentityStatusMessageStatus.Unlocked:
        this.status = { kind: LoginVaultExtensionPairingStatusKind.Paired }
        break
      case ExtensionPairedVaultIdentityStatusMessageStatus.DifferentVault:
        this.status = {
          kind: LoginVaultExtensionPairingStatusKind.NotPaired,
          connectedVault: {
            storeId: discovery.connectedVaultStoreId,
            name: discovery.connectedVaultName,
          },
        }
        break
      case ExtensionPairedVaultIdentityStatusMessageStatus.Unavailable:
        this.status = { kind: LoginVaultExtensionPairingStatusKind.Unavailable }
        break
    }
  }
}

export class LoginVaultExtensionPairingStatusLookup {
  private readonly entries: readonly LoginVaultExtensionPairingStatusEntry[]

  constructor(request: LoginVaultExtensionPairingStatusLookupRequest) {
    this.entries = request.entries
  }

  statusForStore(storeId: string): LoginVaultExtensionPairingStatus {
    const entry = this.entries.find(
      (candidate) => candidate.storeId === storeId,
    )
    if (!entry) return { kind: LoginVaultExtensionPairingStatusKind.NotShown }

    switch (entry.kind) {
      case LoginVaultExtensionPairingStatusKind.NotPaired:
        return { kind: entry.kind, connectedVault: entry.connectedVault }
      default:
        return { kind: entry.kind }
    }
  }
}

export function statusForLoginVault(
  activeLoginVault: LoginVaultEntry,
  entries: readonly LoginVaultExtensionPairingStatusEntry[],
): LoginVaultExtensionPairingStatus {
  if (activeLoginVault.kind !== LoginVaultEntryKind.Available) {
    return { kind: LoginVaultExtensionPairingStatusKind.NotShown }
  }
  return new LoginVaultExtensionPairingStatusLookup({ entries }).statusForStore(
    activeLoginVault.entry.storeId,
  )
}
