import {
  defaultVaultArchitecture as wasmDefaultVaultArchitecture,
  prepareSharedStorageGrant as wasmPrepareSharedStorageGrant,
  providerReplicationCapability as wasmProviderReplicationCapability,
  validateProviderReplication as wasmValidateProviderReplication,
  validateVaultArchitecture as wasmValidateVaultArchitecture,
  vaultArchitectureCanCreateSecret as wasmVaultArchitectureCanCreateSecret,
  vaultArchitectureOnboardingType as wasmVaultArchitectureOnboardingType,
} from '$lib/nook-wasm/nook_wasm'
import type { StorageProvider } from '$lib/auth-providers'

export type DeviceMode = 'standard' | 'anti-hacker'
export type VaultType = 'simple' | 'nexus'
export type ReplicationType = 'personal' | 'shared'

export type NexusPolicy = {
  threshold: number
  required_participants: number
  ready_participants: number
}

export type VaultArchitecture = {
  device_mode: DeviceMode
  vault_type: VaultType
  replication_type: ReplicationType
  nexus?: NexusPolicy
}

export type ProviderReplicationCapability = {
  providerType: string
  oauthPreset?: string
  supportsPersonal: boolean
  supportsShared: boolean
  sharedJoinerIdentity?: 'email'
}

export function defaultVaultArchitecture(): VaultArchitecture {
  return wasmDefaultVaultArchitecture() as VaultArchitecture
}

export function validateVaultArchitecture(
  architecture: VaultArchitecture,
): VaultArchitecture {
  return wasmValidateVaultArchitecture(architecture) as VaultArchitecture
}

export function onboardingType(architecture: VaultArchitecture): string {
  return wasmVaultArchitectureOnboardingType(architecture)
}

export function canCreateSecret(architecture: VaultArchitecture): boolean {
  return wasmVaultArchitectureCanCreateSecret(architecture)
}

export function providerReplicationCapability(
  provider: StorageProvider,
): ProviderReplicationCapability {
  return wasmProviderReplicationCapability(
    provider,
  ) as ProviderReplicationCapability
}

export function validateProviderReplication(
  provider: StorageProvider,
  replicationType: ReplicationType,
): ProviderReplicationCapability {
  return wasmValidateProviderReplication(
    provider,
    replicationType,
  ) as ProviderReplicationCapability
}

export type SharedStorageGrantRequest = {
  providerType: string
  oauthPreset?: string
  joinerIdentityKind: 'email'
  joinerIdentity: string
  storageTargetHint?: string
  accessToken?: string
}

export type SharedStorageGrantOutcome =
  | {
      kind: 'granted'
      note: string
      storageTargetId: string
      storageTargetName?: string
    }
  | {
      kind: 'manual-grant-required'
      instructionsKey: string
      joinerIdentity: string
    }
  | { kind: 'unsupported'; reasonKey: string }

export async function prepareSharedStorageGrant(
  request: SharedStorageGrantRequest,
): Promise<SharedStorageGrantOutcome> {
  return (await wasmPrepareSharedStorageGrant(
    request,
  )) as SharedStorageGrantOutcome
}
