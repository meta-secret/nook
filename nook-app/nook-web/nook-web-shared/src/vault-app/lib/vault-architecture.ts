import {
  DeviceMode,
  NookVaultArchitecture,
  OnboardingType,
  ReplicationType,
  VaultType,
  defaultVaultArchitecture,
  firstCompatibleProviderId as wasmFirstCompatibleProviderId,
  providerOauthPresetForConfig,
  providerOauthPresetForProvider,
  providerReplicationCapability,
  providerSupportsReplication,
  prepareSharedStorageGrant,
  providerOnboardingType,
  validateProviderReplication,
  validateVaultArchitecture as wasmValidateVaultArchitecture,
  vaultArchitectureCanCreateSecret as canCreateSecret,
  vaultArchitectureOnboardingType as onboardingType,
} from '$app-wasm'
import type { StorageProvider } from '$lib/auth-providers'

export type {
  NookProviderReplicationCapability as ProviderReplicationCapability,
  SharedStorageGrantOutcome,
  SharedStorageGrantRequest,
  NookVaultArchitecture as VaultArchitecture,
} from '$app-wasm'

export {
  DeviceMode,
  OnboardingType,
  ReplicationType,
  VaultType,
  canCreateSecret,
  defaultVaultArchitecture,
  onboardingType,
  providerOnboardingType,
  providerOauthPresetForConfig,
  providerOauthPresetForProvider,
  providerReplicationCapability,
  providerSupportsReplication,
  prepareSharedStorageGrant,
  validateProviderReplication,
}

export type VaultArchitectureDraft = {
  device_mode: DeviceMode
  vault_type: VaultType
  replication_type: ReplicationType
  sentinel?: {
    threshold: number
    required_participants: number
    ready_participants: number
  }
}

export function validateVaultArchitecture(
  architecture: VaultArchitectureDraft,
): NookVaultArchitecture {
  const candidate =
    architecture.vault_type === VaultType.Sentinel
      ? NookVaultArchitecture.sentinel(
          architecture.device_mode,
          architecture.replication_type,
          architecture.sentinel?.threshold ?? 2,
          architecture.sentinel?.required_participants ?? 3,
          architecture.sentinel?.ready_participants ?? 0,
        )
      : NookVaultArchitecture.simple(
          architecture.device_mode,
          architecture.replication_type,
        )
  try {
    return wasmValidateVaultArchitecture(candidate)
  } finally {
    candidate.free()
  }
}

export enum ProviderCapabilityLabelKey {
  PersonalOnly = 'provider_picker.capability_personal_only',
  PersonalShared = 'provider_picker.capability_personal_shared',
}

/** Presentation label derived from the Rust-owned provider capability. */
export function providerCapabilityLabelKey(
  provider: StorageProvider,
): ProviderCapabilityLabelKey {
  const capability = providerReplicationCapability(provider)
  try {
    return capability.supportsShared
      ? ProviderCapabilityLabelKey.PersonalShared
      : ProviderCapabilityLabelKey.PersonalOnly
  } finally {
    capability.free()
  }
}

/**
 * Keep the user's compatible selection, otherwise choose the first provider
 * accepted by Rust. Incompatible rows remain visible for explanation/removal.
 */
export enum CompatibleProviderSelectionKind {
  Selected = 'selected',
  Unavailable = 'unavailable',
}

export type CompatibleProviderSelection =
  | {
      kind: CompatibleProviderSelectionKind.Selected
      provider: StorageProvider
    }
  | { kind: CompatibleProviderSelectionKind.Unavailable }

export enum CompatibleProviderPreferenceKind {
  Automatic = 'automatic',
  Selected = 'selected',
}

export type CompatibleProviderPreference =
  | { kind: CompatibleProviderPreferenceKind.Automatic }
  | {
      kind: CompatibleProviderPreferenceKind.Selected
      providerId: string
    }

export function firstCompatibleProvider(
  providers: StorageProvider[],
  replicationType: ReplicationType,
  preference: CompatibleProviderPreference,
): CompatibleProviderSelection {
  const selectedId =
    preference.kind === CompatibleProviderPreferenceKind.Selected
      ? wasmFirstCompatibleProviderId(
          { providers },
          replicationType,
          preference.providerId,
        )
      : wasmFirstCompatibleProviderId({ providers }, replicationType)
  const provider = providers.find((candidate) => candidate.id === selectedId)
  return provider
    ? { kind: CompatibleProviderSelectionKind.Selected, provider }
    : { kind: CompatibleProviderSelectionKind.Unavailable }
}
