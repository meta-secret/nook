use super::{NookProviderSelection, wasm_bindgen};
use crate::{NookEnrollmentProvider, NookProviderReplicationCapability, NookVaultArchitecture};
use nook_core::{
    GoogleOAuthTokenInput, ICloudOAuthTokenInput, ICloudShareRole, ICloudSharedTarget,
    OAuthFileConfigData, ProviderOauthPreset, VaultArchitecture,
};

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
pub fn bind_google_drive_shared_folder(
    config: nook_core::OAuthFileConfigData,
    folder_ref: &str,
) -> Result<nook_core::OAuthFileConfigData, wasm_bindgen::JsError> {
    Ok(config.bound_google_drive_folder(folder_ref)?)
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
pub fn google_oauth_tokens_to_config(
    access_token: &str,
    expires_at: &str,
    existing: nook_core::StoredOAuthFileConfiguration,
) -> Result<nook_core::OAuthFileConfigData, wasm_bindgen::JsError> {
    Ok(OAuthFileConfigData::from_google_token(
        &GoogleOAuthTokenInput {
            access_token,
            expires_at,
            existing: existing.as_ref(),
        },
    ))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
pub fn icloud_oauth_tokens_to_config(
    access_token: &str,
    account_identity: nook_core::StoredOAuthAccountIdentity,
    existing: nook_core::StoredOAuthFileConfiguration,
) -> Result<nook_core::OAuthFileConfigData, wasm_bindgen::JsError> {
    Ok(OAuthFileConfigData::from_icloud_token(
        &ICloudOAuthTokenInput {
            access_token,
            account_name: account_identity.as_deref(),
            existing: existing.as_ref(),
        },
    ))
}

#[wasm_bindgen]
pub fn create_icloud_shared_storage_target(
    role: &str,
    zone_name: &str,
    owner_record_name: &str,
    root_record_name: &str,
    short_guid: &str,
) -> Result<String, wasm_bindgen::JsError> {
    let role = match role.trim() {
        "owner" => ICloudShareRole::Owner,
        "participant" => ICloudShareRole::Participant,
        other => {
            return Err(wasm_bindgen::JsError::new(&format!(
                "Unknown iCloud share role: {other}"
            )));
        }
    };
    Ok(ICloudSharedTarget::new(
        role,
        zone_name,
        owner_record_name,
        root_record_name,
        short_guid,
    )?
    .to_storage_id()?)
}

#[wasm_bindgen]
pub fn parse_icloud_shared_storage_target(
    storage_target_id: &str,
) -> Result<nook_core::ICloudSharedTarget, wasm_bindgen::JsError> {
    Ok(ICloudSharedTarget::from_storage_id(storage_target_id)?)
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
pub fn set_google_drive_provider_mode(
    config: nook_core::OAuthFileConfigData,
    mode: nook_core::GoogleDriveMode,
) -> Result<nook_core::OAuthFileConfigData, wasm_bindgen::JsError> {
    Ok(config.with_google_drive_mode(mode))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
pub fn set_icloud_provider_mode(
    config: nook_core::OAuthFileConfigData,
    mode: nook_core::ICloudMode,
) -> Result<nook_core::OAuthFileConfigData, wasm_bindgen::JsError> {
    Ok(config.with_icloud_mode(mode))
}

#[wasm_bindgen]
pub fn default_vault_architecture() -> NookVaultArchitecture {
    NookVaultArchitecture::from_core(VaultArchitecture::default())
}

#[wasm_bindgen]
pub fn validate_vault_architecture(
    architecture: &NookVaultArchitecture,
) -> Result<NookVaultArchitecture, wasm_bindgen::JsError> {
    let architecture = architecture.to_core();
    architecture.validate()?;
    Ok(NookVaultArchitecture::from_core(architecture))
}

#[wasm_bindgen]
pub fn vault_architecture_onboarding_type(
    architecture: &NookVaultArchitecture,
) -> Result<nook_core::OnboardingType, wasm_bindgen::JsError> {
    let architecture = architecture.to_core();
    architecture.validate()?;
    Ok(architecture.onboarding_type())
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
pub fn provider_onboarding_type(
    provider: nook_core::StorageProviderData,
    architecture: &NookVaultArchitecture,
) -> Result<nook_core::OnboardingType, wasm_bindgen::JsError> {
    let architecture = architecture.to_core();
    Ok(nook_core::provider_onboarding_type(
        &provider,
        &architecture,
    )?)
}

#[wasm_bindgen]
pub fn vault_architecture_can_create_secret(
    architecture: &NookVaultArchitecture,
) -> Result<bool, wasm_bindgen::JsError> {
    let architecture = architecture.to_core();
    architecture.validate()?;
    Ok(architecture.can_create_secret())
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
pub fn provider_replication_capability(
    provider: nook_core::StorageProviderData,
) -> Result<NookProviderReplicationCapability, wasm_bindgen::JsError> {
    Ok(NookProviderReplicationCapability::from_core(
        nook_core::provider_replication_capability_for_row(&provider)?,
    ))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[must_use]
pub fn provider_oauth_preset_for_provider(
    provider: nook_core::StorageProviderData,
) -> nook_core::ProviderOauthPreset {
    provider
        .oauth_file
        .map_or(ProviderOauthPreset::NotApplicable, |oauth| {
            ProviderOauthPreset::Preset(oauth.preset)
        })
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[must_use]
pub fn provider_oauth_preset_for_config(
    config: nook_core::OAuthFileConfigData,
) -> nook_core::ProviderOauthPreset {
    ProviderOauthPreset::Preset(config.preset)
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
pub fn validate_provider_replication(
    provider: nook_core::StorageProviderData,
    replication_type: nook_core::ReplicationType,
) -> Result<NookProviderReplicationCapability, wasm_bindgen::JsError> {
    Ok(NookProviderReplicationCapability::from_core(
        nook_core::validate_provider_row_replication(&provider, replication_type)?,
    ))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
pub fn provider_supports_replication(
    provider: nook_core::StorageProviderData,
    replication_type: nook_core::ReplicationType,
) -> Result<bool, wasm_bindgen::JsError> {
    Ok(nook_core::provider_supports_replication(
        &provider,
        replication_type,
    ))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
pub fn first_compatible_provider_id(
    snapshot: nook_core::AuthProvidersSnapshotData,
    replication_type: nook_core::ReplicationType,
) -> NookProviderSelection {
    NookProviderSelection(nook_core::first_compatible_provider_id(
        &snapshot.providers,
        replication_type,
        None,
    ))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
pub fn first_compatible_provider_id_preferred(
    snapshot: nook_core::AuthProvidersSnapshotData,
    replication_type: nook_core::ReplicationType,
    preferred_id: &str,
) -> NookProviderSelection {
    NookProviderSelection(nook_core::first_compatible_provider_id(
        &snapshot.providers,
        replication_type,
        Some(preferred_id),
    ))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
pub fn shared_grant_provider_id(
    snapshot: nook_core::AuthProvidersSnapshotData,
    preset: nook_core::OauthFilePreset,
    target: nook_core::SharedStorageTargetSelection,
) -> NookProviderSelection {
    NookProviderSelection(nook_core::shared_grant_provider_id(
        &snapshot.providers,
        preset,
        &target,
    ))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
pub fn enrollment_provider_for_architecture(
    provider: nook_core::StorageProviderData,
    architecture: &NookVaultArchitecture,
) -> Result<NookEnrollmentProvider, wasm_bindgen::JsError> {
    let architecture = architecture.to_core();
    Ok(NookEnrollmentProvider::from_core(
        nook_core::enrollment_provider_for_architecture_with_storage_target(
            &provider,
            &architecture,
            None,
            None,
        )?,
    ))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
pub fn enrollment_shared_provider_for_architecture(
    provider: nook_core::StorageProviderData,
    architecture: &NookVaultArchitecture,
    shared_joiner_identity: &str,
    shared_storage_target_id: &str,
) -> Result<NookEnrollmentProvider, wasm_bindgen::JsError> {
    let architecture = architecture.to_core();
    Ok(NookEnrollmentProvider::from_core(
        nook_core::enrollment_provider_for_architecture_with_storage_target(
            &provider,
            &architecture,
            Some(shared_joiner_identity),
            Some(shared_storage_target_id),
        )?,
    ))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
pub fn enrollment_icloud_shared_provider_for_architecture(
    provider: nook_core::StorageProviderData,
    architecture: &NookVaultArchitecture,
    shared_storage_target_id: &str,
) -> Result<NookEnrollmentProvider, wasm_bindgen::JsError> {
    let architecture = architecture.to_core();
    Ok(NookEnrollmentProvider::from_core(
        nook_core::enrollment_provider_for_architecture_with_storage_target(
            &provider,
            &architecture,
            None,
            Some(shared_storage_target_id),
        )?,
    ))
}
