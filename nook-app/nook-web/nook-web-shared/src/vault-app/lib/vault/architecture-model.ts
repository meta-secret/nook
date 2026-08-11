import { I18N_KEYS } from "../../../generated/i18n-keys";
import {
  DeviceMode,
  NookVaultArchitecture,
  OnboardingType,
  ReplicationType,
  VaultType,
  default_vault_architecture,
  first_compatible_provider_id,
  first_compatible_provider_id_preferred,
  NookProviderSelectionState,
  provider_oauth_preset_for_config,
  provider_oauth_preset_for_provider,
  provider_replication_capability,
  provider_supports_replication,
  prepare_shared_storage_grant,
  provider_onboarding_type,
  validate_provider_replication,
  validate_vault_architecture,
  vault_architecture_can_create_secret,
  vault_architecture_onboarding_type,
  type SharedStorageGrantCredential,
  type SharedStorageTargetHint,
  type SharedStorageTargetSelection,
} from "$app-wasm";
import {
  unselectedVaultScope,
  type StorageProvider,
} from "$lib/auth/providers";

export type {
  NookProviderReplicationCapability as ProviderReplicationCapability,
  SharedStorageGrantOutcome,
  SharedStorageGrantRequest,
  NookVaultArchitecture as VaultArchitecture,
} from "$app-wasm";

export {
  DeviceMode,
  OnboardingType,
  ReplicationType,
  VaultType,
  vault_architecture_can_create_secret,
  default_vault_architecture,
  vault_architecture_onboarding_type,
  provider_onboarding_type,
  provider_oauth_preset_for_config,
  provider_oauth_preset_for_provider,
  provider_replication_capability,
  provider_supports_replication,
  prepare_shared_storage_grant,
  validate_provider_replication,
};

export function suggestedSharedStorageTarget(
  name: string,
): SharedStorageTargetHint {
  return { state: "suggested", hint: name };
}

export function createSharedStorageTarget(): SharedStorageTargetSelection {
  return { state: "create" };
}

export function existingSharedStorageTarget(
  storageTargetId: string,
): SharedStorageTargetSelection {
  return { state: "existing", storageTargetId };
}

export function sharedStorageGrantAccessToken(
  accessToken: string,
): SharedStorageGrantCredential {
  return { state: "accessToken", accessToken };
}

export function unavailableSharedStorageGrantCredential(): SharedStorageGrantCredential {
  return { state: "unavailable" };
}

export type VaultArchitectureDraft = {
  device_mode: DeviceMode;
  vault_type: VaultType;
  replication_type: ReplicationType;
  sentinel?: {
    threshold: number;
    required_participants: number;
    ready_participants: number;
  };
};

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
        );
  try {
    return validate_vault_architecture(candidate);
  } finally {
    candidate.free();
  }
}

export const ProviderCapabilityLabelKey = {
  PersonalOnly: I18N_KEYS.ProviderPickerCapabilityPersonalOnly,
  PersonalShared: I18N_KEYS.ProviderPickerCapabilityPersonalShared,
} as const;

export type ProviderCapabilityLabelKey =
  (typeof ProviderCapabilityLabelKey)[keyof typeof ProviderCapabilityLabelKey];

/** Presentation label derived from the Rust-owned provider capability. */
export function providerCapabilityLabelKey(
  provider: StorageProvider,
): ProviderCapabilityLabelKey {
  const capability = provider_replication_capability(provider);
  try {
    return capability.supportsShared
      ? ProviderCapabilityLabelKey.PersonalShared
      : ProviderCapabilityLabelKey.PersonalOnly;
  } finally {
    capability.free();
  }
}

/**
 * Keep the user's compatible selection, otherwise choose the first provider
 * accepted by Rust. Incompatible rows remain visible for explanation/removal.
 */
export enum CompatibleProviderSelectionKind {
  Selected = "selected",
  Unavailable = "unavailable",
}

export type CompatibleProviderSelection =
  | {
      kind: CompatibleProviderSelectionKind.Selected;
      provider: StorageProvider;
    }
  | { kind: CompatibleProviderSelectionKind.Unavailable };

export enum CompatibleProviderPreferenceKind {
  Automatic = "automatic",
  Selected = "selected",
}

export type CompatibleProviderPreference =
  | { kind: CompatibleProviderPreferenceKind.Automatic }
  | {
      kind: CompatibleProviderPreferenceKind.Selected;
      providerId: string;
    };

export function firstCompatibleProvider({
  providers,
  replicationType,
  preference,
}: {
  readonly providers: StorageProvider[];
  readonly replicationType: ReplicationType;
  readonly preference: CompatibleProviderPreference;
}): CompatibleProviderSelection {
  const snapshot: Parameters<typeof first_compatible_provider_id>[0] = {
    providers,
    activeVaultStoreId: unselectedVaultScope(),
  };
  const selection =
    preference.kind === CompatibleProviderPreferenceKind.Selected
      ? first_compatible_provider_id_preferred(
          snapshot,
          replicationType,
          preference.providerId,
        )
      : first_compatible_provider_id(snapshot, replicationType);
  if (selection.state === NookProviderSelectionState.Selected) {
    const provider = providers.find(
      (candidate) => candidate.id === selection.providerId,
    );
    selection.free();
    return provider
      ? { kind: CompatibleProviderSelectionKind.Selected, provider }
      : { kind: CompatibleProviderSelectionKind.Unavailable };
  }
  selection.free();
  return { kind: CompatibleProviderSelectionKind.Unavailable };
}
