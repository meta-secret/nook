export const EXTENSION_CONNECT_PATH = '/extension-connect'

import type { NookVaultManager } from '$app-wasm'
import type {
  ExtensionConnectRequestFor,
  PairedExtensionIdentityDiscoveryFor,
} from '$web-shared/extension/extension-connect-types'
import { ExtensionPairedVaultIdentityStatusMessageStatus } from '$web-shared/extension/runtime-messages'

export type ExtensionConnectScope =
  | 'vault-access'
  | 'password-filling'
  | 'sync-provider-credentials'

export type ExtensionConnectRequest =
  ExtensionConnectRequestFor<ExtensionConnectScope>
export type PairedExtensionIdentityDiscovery =
  PairedExtensionIdentityDiscoveryFor<ExtensionConnectRequest>

export enum ExtensionConnectRequestStateKind {
  Absent = 'absent',
  Requested = 'requested',
}

export type ExtensionConnectRequestState =
  | { kind: ExtensionConnectRequestStateKind.Absent }
  | {
      kind: ExtensionConnectRequestStateKind.Requested
      request: ExtensionConnectRequest
    }

export enum InstalledExtensionRuntimeKind {
  NotInstalled = 'not-installed',
  Installed = 'installed',
}

export type InstalledExtensionRuntime =
  | { kind: InstalledExtensionRuntimeKind.NotInstalled }
  | {
      kind: InstalledExtensionRuntimeKind.Installed
      extensionRuntimeId: string
    }

export const isExtensionConnectPath: (pathname: string) => boolean = () => false

export const extensionConnectRequestFromLocation: (
  location: Location,
) => ExtensionConnectRequestState = () => ({
  kind: ExtensionConnectRequestStateKind.Absent,
})

export function readInstalledExtensionRuntimeId(): InstalledExtensionRuntime {
  return { kind: InstalledExtensionRuntimeKind.NotInstalled }
}

export async function openInstalledExtension(): Promise<boolean> {
  return false
}

export async function discoverPairedExtensionIdentity(
  _vaultStoreId: string,
): Promise<PairedExtensionIdentityDiscovery> {
  void _vaultStoreId
  return {
    status: ExtensionPairedVaultIdentityStatusMessageStatus.Unavailable,
  }
}

export async function requestPairedExtensionUnlock(
  _vaultStoreId: string,
): Promise<boolean> {
  void _vaultStoreId
  return false
}

export function scopeLabel(): never {
  throw new Error('errors.validation.sentinel_extension_forbidden')
}

export async function adoptExtensionIdentity(
  _manager: NookVaultManager,
  _request: ExtensionConnectRequest,
): Promise<void> {
  void _manager
  void _request
  throw new Error('errors.validation.sentinel_extension_forbidden')
}
