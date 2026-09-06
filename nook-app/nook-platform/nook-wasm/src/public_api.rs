use super::{
    NookEnrollmentProvider, NookLocalFolderConfig, NookProviderReplicationCapability,
    NookStorageConnectArgs, NookVaultArchitecture, passkey_browser, wasm_bindgen,
};
use crate::storage::local_folder::LocalFolderHandles;
use crate::storage::session;
use crate::types::{NookManagerStoreScope, NookProviderSyncRevision};
use nook_core::{
    ICloudShareRole, ICloudSharedTarget, PasswordGenerationOptions, ProviderOauthPreset,
    StorageProviderType, TotpAlgorithm, TotpDigits, TotpPeriod, TotpSecret, VaultArchitecture,
};
use wasm_bindgen::JsError;

mod localization;
pub use localization::*;
mod enrollment_entry;
pub use enrollment_entry::*;
mod mnemonic;
pub use mnemonic::*;
mod provider_labels;
pub use provider_labels::*;
mod provider_state;
pub use provider_state::*;
mod provider_operations;
pub use provider_operations::*;
mod provider_import;
pub use provider_import::*;
mod companion_heuristics;
pub use companion_heuristics::*;
mod shared_storage_grant;
pub use shared_storage_grant::*;

#[wasm_bindgen]
#[must_use]
pub fn is_vault_session_locked() -> bool {
    session::is_vault_session_locked()
}

#[wasm_bindgen]
pub fn set_vault_session_locked(locked: bool) {
    session::set_vault_session_locked(locked);
}

#[wasm_bindgen]
#[must_use]
pub fn is_local_folder_backup_supported() -> bool {
    NookLocalFolderConfig::is_supported()
}

#[wasm_bindgen]
pub async fn choose_local_folder_backup_directory()
-> Result<NookLocalFolderConfig, wasm_bindgen::JsError> {
    NookLocalFolderConfig::choose().await.map_err(Into::into)
}

#[wasm_bindgen]
pub async fn remove_local_folder_handle(handle_id: String) -> Result<(), wasm_bindgen::JsError> {
    LocalFolderHandles::current()
        .remove(Some(handle_id))
        .await
        .map_err(Into::into)
}

#[wasm_bindgen]
pub fn generate_id() -> Result<String, wasm_bindgen::JsError> {
    Ok(nook_core::generate_id()?.to_string())
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(
        raw_numeric_public_api,
        reason = "FFI boundary: exchanges `build_passkey_prf_request_options` bytes with JavaScript as a Uint8Array"
    )
)]
pub fn build_passkey_prf_request_options(
    rp_id: &str,
    credential_id: Vec<u8>,
    prf_input: Vec<u8>,
) -> Result<web_sys::CredentialRequestOptions, wasm_bindgen::JsError> {
    passkey_browser::request_options(rp_id, &credential_id, &prf_input)
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(
        raw_numeric_public_api,
        reason = "FFI boundary: exchanges `build_passkey_creation_options` bytes with JavaScript as a Uint8Array"
    )
)]
pub fn build_passkey_creation_options(
    rp_id: &str,
    rp_name: &str,
    passkey_label: &str,
    user_handle: Vec<u8>,
    prf_input: Vec<u8>,
) -> Result<web_sys::CredentialCreationOptions, wasm_bindgen::JsError> {
    passkey_browser::creation_options(rp_id, rp_name, passkey_label, &user_handle, &prf_input)
}

#[wasm_bindgen]
pub fn build_passkey_recovery_request_options(
    rp_id: &str,
) -> Result<web_sys::CredentialRequestOptions, wasm_bindgen::JsError> {
    passkey_browser::recovery_options(rp_id)
}

#[wasm_bindgen]
pub fn generate_secret_id() -> Result<String, wasm_bindgen::JsError> {
    Ok(nook_core::generate_secret_id()?.to_string())
}

/// Cryptographically secure password generation — free function so the UI can
/// call it while the vault manager is borrowed by an in-flight `&mut self` op.
#[wasm_bindgen]
#[must_use]
pub fn default_password_generation_options() -> nook_core::PasswordGenerationOptions {
    PasswordGenerationOptions::default()
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
pub fn generate_password(
    options: nook_core::PasswordGenerationOptions,
) -> Result<String, wasm_bindgen::JsError> {
    Ok(nook_core::generate_password(options)?)
}

/// Generate an RFC 6238 TOTP code from a base32 secret via `nook-core`.
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(
        raw_numeric_public_api,
        reason = "FFI boundary: accepts the TOTP Unix timestamp from JavaScript as a bigint"
    )
)]
pub fn generate_totp_code(
    secret: &str,
    unix_seconds: u64,
) -> Result<String, wasm_bindgen::JsError> {
    Ok(authenticator_from_secret(secret)?
        .current_code(unix_seconds.into())
        .map_err(|error| JsError::new(&error.to_string()))?
        .code)
}

/// Verify a TOTP code against a base32 secret with a ±1-step window.
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(
        raw_numeric_public_api,
        reason = "FFI boundary: accepts the TOTP verification Unix timestamp from JavaScript as a bigint"
    )
)]
pub fn verify_totp_code(
    secret: &str,
    code: &str,
    unix_seconds: u64,
) -> Result<bool, wasm_bindgen::JsError> {
    let authenticator = authenticator_from_secret(secret)?;
    let trimmed = code.trim();
    if trimmed.len() < 6 || trimmed.len() > 8 || !trimmed.bytes().all(|b| b.is_ascii_digit()) {
        return Ok(false);
    }
    let period = authenticator.period.duration().as_secs();
    for step_offset in [-1_i64, 0, 1] {
        let Some(shifted) =
            unix_seconds.checked_add_signed(step_offset * i64::try_from(period).unwrap_or(30))
        else {
            continue;
        };
        let candidate = authenticator
            .current_code(shifted.into())
            .map_err(|error| JsError::new(&error.to_string()))?;
        if candidate.code == trimmed {
            return Ok(true);
        }
    }
    Ok(false)
}

fn authenticator_from_secret(
    secret: &str,
) -> Result<nook_core::AuthenticatorSecret, wasm_bindgen::JsError> {
    Ok(nook_core::AuthenticatorSecret {
        issuer: "Nook".to_owned(),
        account: String::new(),
        website_url: String::new(),
        secret: TotpSecret::parse(secret).map_err(|error| JsError::new(&error.to_string()))?,
        algorithm: TotpAlgorithm::Sha1,
        digits: TotpDigits::default(),
        period: TotpPeriod::default(),
        backup_codes: Vec::new(),
    })
}

#[wasm_bindgen]
#[must_use]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(
        raw_numeric_public_api,
        reason = "FFI boundary: projects the `vault_password_min_length` count through a JavaScript Number scalar"
    )
)]
pub fn vault_password_min_length() -> u32 {
    u32::try_from(usize::from(nook_core::vault_password_min_length())).unwrap_or(u32::MAX)
}

#[wasm_bindgen]
#[must_use]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(
        raw_numeric_public_api,
        reason = "FFI boundary: projects the `vault_password_recommended_min_length` count through a JavaScript Number scalar"
    )
)]
pub fn vault_password_recommended_min_length() -> u32 {
    u32::try_from(usize::from(
        nook_core::vault_password_recommended_min_length(),
    ))
    .unwrap_or(u32::MAX)
}

#[wasm_bindgen]
#[must_use]
pub fn is_vault_password_long_enough(password: &str) -> bool {
    nook_core::is_vault_password_long_enough(password)
}

#[wasm_bindgen]
#[must_use]
pub fn is_vault_password_recommended_length(password: &str) -> bool {
    nook_core::is_vault_password_recommended_length(password)
}

#[wasm_bindgen]
#[must_use]
pub fn has_github_credentials(pat: &str) -> bool {
    nook_core::has_provider_credentials(StorageProviderType::Github, Some(pat), None, None)
}

#[wasm_bindgen]
#[must_use]
pub fn has_oauth_credentials(access_token: &str) -> bool {
    nook_core::has_provider_credentials(
        StorageProviderType::OauthFile,
        None,
        Some(access_token),
        None,
    )
}

#[wasm_bindgen]
#[must_use]
pub fn has_local_folder_credentials(handle_id: &str) -> bool {
    nook_core::has_provider_credentials(
        StorageProviderType::LocalFolder,
        None,
        None,
        Some(handle_id),
    )
}

#[wasm_bindgen]
#[allow(clippy::too_many_arguments, clippy::needless_pass_by_value)]
pub fn provider_storage_detail(
    provider: nook_core::StorageProviderData,
    this_device_desc: String,
    no_token_saved: String,
    google_signed_in: String,
    icloud_signed_in: String,
    google_not_signed_in: String,
    icloud_not_signed_in: String,
    local_folder_needs_reconnect: String,
) -> Result<String, wasm_bindgen::JsError> {
    let labels = nook_core::ProviderStorageDetailLabels {
        this_device_desc,
        no_token_saved,
        google_signed_in,
        icloud_signed_in,
        google_not_signed_in,
        icloud_not_signed_in,
        local_folder_needs_reconnect,
    };
    Ok(nook_core::provider_storage_detail(&provider, &labels)?)
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
pub fn localize_provider_label(
    label: &str,
    this_device: String,
    github: String,
    local_folder: String,
    google_drive: String,
    icloud: String,
) -> String {
    let labels = nook_core::ProviderLabelLabels {
        this_device,
        github,
        local_folder,
        google_drive,
        icloud,
    };
    nook_core::localize_provider_label(label, &labels)
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
pub fn oauth_remote_storage_ref(
    config: nook_core::OAuthFileConfigData,
) -> NookOAuthRemoteStorageReference {
    NookOAuthRemoteStorageReference::new(nook_core::oauth_remote_storage_ref(&config))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
pub fn update_oauth_remote_ref(
    config: nook_core::OAuthFileConfigData,
    remote_ref: &str,
) -> NookOAuthRemoteConfigurationUpdate {
    NookOAuthRemoteConfigurationUpdate::new(nook_core::update_oauth_remote_ref(&config, remote_ref))
}

#[wasm_bindgen]
pub fn staged_github_remote_storage_args(
    github_pat: &str,
    github_repo: &str,
) -> Result<NookStagedStorageArgs, wasm_bindgen::JsError> {
    Ok(NookStagedStorageArgs::new(
        nook_core::staged_remote_storage_args(
            StorageProviderType::Github,
            Some(github_pat),
            Some(github_repo),
            None,
        )?,
    ))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
pub fn staged_oauth_remote_storage_args(
    oauth_file: nook_core::OAuthFileConfigData,
) -> Result<NookStagedStorageArgs, wasm_bindgen::JsError> {
    Ok(NookStagedStorageArgs::new(
        nook_core::staged_remote_storage_args(
            StorageProviderType::OauthFile,
            None,
            None,
            Some(&oauth_file),
        )?,
    ))
}

#[wasm_bindgen]
pub fn staged_local_remote_storage_args() -> Result<NookStagedStorageArgs, wasm_bindgen::JsError> {
    Ok(NookStagedStorageArgs::new(
        nook_core::staged_remote_storage_args(StorageProviderType::Local, None, None, None)?,
    ))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
pub fn update_provider_sync_metadata(
    mut snapshot: nook_core::AuthProvidersSnapshotData,
    provider_id: &str,
    vault_yaml: &str,
    revision: &NookProviderSyncRevision,
    manager_store_scope: &NookManagerStoreScope,
    synced_at: &str,
) -> Result<nook_core::AuthProvidersSnapshotData, wasm_bindgen::JsError> {
    snapshot.providers = nook_core::update_provider_sync_metadata(
        &snapshot.providers,
        provider_id,
        vault_yaml,
        revision.as_core(),
        manager_store_scope.as_core(),
        synced_at,
    );
    Ok(snapshot)
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
pub fn set_google_drive_provider_mode(
    config: nook_core::OAuthFileConfigData,
    mode: nook_core::GoogleDriveMode,
) -> Result<nook_core::OAuthFileConfigData, wasm_bindgen::JsError> {
    Ok(nook_core::set_google_drive_provider_mode(&config, mode))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
pub fn set_icloud_provider_mode(
    config: nook_core::OAuthFileConfigData,
    mode: nook_core::ICloudMode,
) -> Result<nook_core::OAuthFileConfigData, wasm_bindgen::JsError> {
    Ok(nook_core::set_icloud_provider_mode(&config, mode))
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
            return Err(JsError::new(&format!("Unknown iCloud share role: {other}")));
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
pub fn bind_google_drive_shared_folder(
    config: nook_core::OAuthFileConfigData,
    folder_ref: &str,
) -> Result<nook_core::OAuthFileConfigData, wasm_bindgen::JsError> {
    Ok(nook_core::bind_google_drive_shared_folder(
        &config, folder_ref,
    )?)
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
pub fn google_oauth_tokens_to_config(
    access_token: &str,
    expires_at: &str,
    existing: nook_core::StoredOAuthFileConfiguration,
) -> Result<nook_core::OAuthFileConfigData, wasm_bindgen::JsError> {
    Ok(nook_core::google_oauth_tokens_to_config(
        access_token,
        expires_at,
        existing.as_ref(),
    ))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
pub fn icloud_oauth_tokens_to_config(
    access_token: &str,
    account_identity: nook_core::StoredOAuthAccountIdentity,
    existing: nook_core::StoredOAuthFileConfiguration,
) -> Result<nook_core::OAuthFileConfigData, wasm_bindgen::JsError> {
    Ok(nook_core::icloud_oauth_tokens_to_config(
        access_token,
        account_identity.as_deref(),
        existing.as_ref(),
    ))
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

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::*;
    use nook_core::{
        GoogleDriveMode, ICloudMode, OauthFilePreset, ProviderSyncCheckpoint, ProviderVaultScope,
        ReplicationType, StorageProviderData, StorageProviderType, StoredGithubPat,
        StoredGithubRepository, StoredGoogleDriveFolder, StoredICloudShareTarget,
        StoredOAuthAccessCredential, StoredOAuthAccountIdentity, StoredOAuthFileConfiguration,
        StoredOAuthRemoteFileName,
    };
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    fn github_provider() -> StorageProviderData {
        StorageProviderData::github(
            "provider-1",
            "GitHub",
            "ghp_1234567890ABCDEF",
            "work-vault",
            "2026-01-01T00:00:00Z",
        )
    }

    fn shared_oauth_provider() -> StorageProviderData {
        StorageProviderData {
            id: "oauth-provider".into(),
            provider_type: StorageProviderType::OauthFile,
            label: "Google Drive".into(),
            github_pat: StoredGithubPat::Missing,
            github_repo: StoredGithubRepository::DefaultRepository,
            oauth_file: StoredOAuthFileConfiguration::Configured(nook_core::OAuthFileConfigData {
                preset: OauthFilePreset::GoogleDrive,
                access_token: StoredOAuthAccessCredential::AccessToken("access-token".into()),
                file_name: StoredOAuthRemoteFileName::FileName("Vault.yaml".into()),
                folder_id: StoredGoogleDriveFolder::FolderId("target-1".into()),
                drive_mode: GoogleDriveMode::Shared,
                ..Default::default()
            }),
            local_folder: nook_core::StoredLocalFolderConfiguration::NotApplicable,
            store_id: ProviderVaultScope::Unscoped,
            sync_checkpoint: ProviderSyncCheckpoint::NeverSynced,
            created_at: "2026-01-01T00:00:00Z".into(),
        }
    }

    fn shared_icloud_provider() -> StorageProviderData {
        let mut provider = shared_oauth_provider();
        provider.oauth_file =
            StoredOAuthFileConfiguration::Configured(nook_core::OAuthFileConfigData {
                preset: OauthFilePreset::ICloud,
                access_token: StoredOAuthAccessCredential::AccessToken("access-token".into()),
                file_name: StoredOAuthRemoteFileName::FileName("Vault.yaml".into()),
                drive_mode: GoogleDriveMode::Private,
                folder_id: StoredGoogleDriveFolder::Root,
                icloud_mode: ICloudMode::Shared,
                icloud_share_target: StoredICloudShareTarget::SharedTarget(
                    nook_core::ICloudSharedTarget::new(
                        nook_core::ICloudShareRole::Owner,
                        "zone",
                        "owner-record",
                        "root-record",
                        "target-2",
                    )
                    .unwrap()
                    .to_storage_id()
                    .unwrap(),
                ),
                ..Default::default()
            });
        provider
    }

    #[wasm_bindgen_test]
    fn public_helpers_project_password_totp_and_provider_credentials() {
        set_vault_session_locked(true);
        assert!(is_vault_session_locked());
        set_vault_session_locked(false);
        assert!(!is_vault_session_locked());
        let _ = is_local_folder_backup_supported();

        assert!(generate_id().unwrap().len() > 10);
        assert!(generate_secret_id().unwrap().len() > 10);
        let options = default_password_generation_options();
        let password = generate_password(options).unwrap();
        assert!(!password.is_empty());
        assert!(vault_password_min_length() > 0);
        assert!(vault_password_recommended_min_length() >= vault_password_min_length());
        assert!(!is_vault_password_long_enough("no"));
        assert!(!is_vault_password_recommended_length("no"));

        let code = generate_totp_code("JBSWY3DPEHPK3PXP", 59).unwrap();
        assert_eq!(code.len(), 6);
        assert!(verify_totp_code("JBSWY3DPEHPK3PXP", &code, 59).unwrap());
        assert!(!verify_totp_code("JBSWY3DPEHPK3PXP", "bad", 59).unwrap());
        assert!(generate_totp_code("bad", 59).is_err());

        assert!(has_github_credentials("ghp_test"));
        assert!(!has_github_credentials(""));
        assert!(has_oauth_credentials("access-token"));
        assert!(!has_oauth_credentials(""));
        assert!(has_local_folder_credentials("handle"));
        assert!(!has_local_folder_credentials(""));

        let provider = github_provider();
        let detail = provider_storage_detail(
            provider.clone(),
            "This device".into(),
            "No token".into(),
            "Google signed in".into(),
            "iCloud signed in".into(),
            "Google signed out".into(),
            "iCloud signed out".into(),
            "Reconnect folder".into(),
        )
        .unwrap();
        assert!(detail.contains("work-vault"));
        assert!(detail.contains("ghp_123456"));
        assert_eq!(
            localize_provider_label(
                "GitHub",
                "This device".into(),
                "GitHub".into(),
                "Local".into(),
                "Drive".into(),
                "iCloud".into(),
            ),
            "GitHub"
        );
        assert_eq!(
            provider_wasm_args(provider.clone()).unwrap().mode(),
            "github"
        );

        let empty = nook_core::AuthProvidersSnapshotData::default();
        let unscoped = NookManagerStoreScope::unscoped();
        assert!(
            active_vault_providers(empty.clone(), &unscoped)
                .unwrap()
                .providers
                .is_empty()
        );
        assert!(
            sync_providers_for_active_vault(empty.clone(), &unscoped)
                .unwrap()
                .providers
                .is_empty()
        );
        assert!(
            local_provider_for_active_vault(empty.clone(), &unscoped)
                .unwrap()
                .provider_id()
                .is_err()
        );
        assert_eq!(provider_label_by_id(empty.clone(), "missing").unwrap(), "");
        assert!(
            providers_visible_while_device_locked(empty)
                .providers
                .is_empty()
        );

        let oauth = nook_core::OAuthFileConfigData::default();
        let remote = oauth_remote_storage_ref(oauth.clone());
        assert!(remote.value().is_err());
        assert!(
            update_oauth_remote_ref(oauth.clone(), "file-1")
                .config()
                .is_ok()
        );
        assert_eq!(
            staged_github_remote_storage_args("pat", "owner/repo")
                .unwrap()
                .state(),
            NookStagedStorageArgsState::Ready
        );
        assert_eq!(
            staged_local_remote_storage_args().unwrap().state(),
            NookStagedStorageArgsState::Ready
        );
        assert!(staged_oauth_remote_storage_args(oauth.clone()).is_err());

        let revision = NookProviderSyncRevision::untracked();
        assert!(
            update_provider_sync_metadata(
                nook_core::AuthProvidersSnapshotData::default(),
                "provider-1",
                "not yaml",
                &revision,
                &unscoped,
                "2026-01-01T00:00:00Z",
            )
            .is_ok()
        );
    }

    #[wasm_bindgen_test]
    fn public_provider_and_vault_architecture_helpers_project_success_paths() {
        let provider = github_provider();
        let architecture = default_vault_architecture();
        assert!(validate_vault_architecture(&architecture).is_ok());
        assert!(vault_architecture_onboarding_type(&architecture).is_ok());
        assert!(vault_architecture_can_create_secret(&architecture).unwrap());
        assert!(provider_onboarding_type(provider.clone(), &architecture).is_ok());
        assert_eq!(
            provider_oauth_preset_for_provider(provider.clone()),
            nook_core::ProviderOauthPreset::NotApplicable
        );
        assert!(matches!(
            provider_oauth_preset_for_config(nook_core::OAuthFileConfigData::default()),
            nook_core::ProviderOauthPreset::Preset(_)
        ));
        assert!(provider_replication_capability(provider.clone()).is_ok());
        assert!(validate_provider_replication(provider.clone(), ReplicationType::Personal).is_ok());
        assert!(
            provider_supports_replication(provider.clone(), ReplicationType::Personal).unwrap()
        );

        let snapshot = nook_core::AuthProvidersSnapshotData {
            providers: vec![provider.clone()],
            ..Default::default()
        };
        assert_eq!(
            first_compatible_provider_id(snapshot.clone(), ReplicationType::Personal)
                .provider_id()
                .unwrap(),
            "provider-1"
        );
        assert_eq!(
            first_compatible_provider_id_preferred(
                snapshot.clone(),
                ReplicationType::Personal,
                "provider-1"
            )
            .provider_id()
            .unwrap(),
            "provider-1"
        );
        assert!(
            shared_grant_provider_id(
                snapshot,
                OauthFilePreset::GoogleDrive,
                nook_core::SharedStorageTargetSelection::Create,
            )
            .provider_id()
            .is_err()
        );

        let updated_drive = set_google_drive_provider_mode(
            nook_core::OAuthFileConfigData::default(),
            GoogleDriveMode::Shared,
        )
        .unwrap();
        assert_eq!(updated_drive.drive_mode, GoogleDriveMode::Shared);
        let updated_icloud = set_icloud_provider_mode(
            nook_core::OAuthFileConfigData::default(),
            ICloudMode::Shared,
        )
        .unwrap();
        assert_eq!(updated_icloud.icloud_mode, ICloudMode::Shared);

        let target = create_icloud_shared_storage_target(
            "owner",
            "zone",
            "owner-record",
            "root-record",
            "short-guid",
        )
        .unwrap();
        assert_eq!(
            parse_icloud_shared_storage_target(&target)
                .unwrap()
                .zone_name,
            "zone"
        );
        assert!(create_icloud_shared_storage_target("unknown", "", "", "", "").is_err());
        assert!(
            bind_google_drive_shared_folder(nook_core::OAuthFileConfigData::default(), "folder-1")
                .is_ok()
        );

        let google = google_oauth_tokens_to_config(
            "access-token",
            "2030-01-01T00:00:00Z",
            StoredOAuthFileConfiguration::NotApplicable,
        )
        .unwrap();
        assert!(google.access_token.as_deref().is_some());
        let icloud = icloud_oauth_tokens_to_config(
            "access-token",
            StoredOAuthAccountIdentity::Email("alice@example.test".into()),
            StoredOAuthFileConfiguration::NotApplicable,
        )
        .unwrap();
        assert!(icloud.access_token.as_deref().is_some());

        let github_enrollment =
            enrollment_provider_for_architecture(provider.clone(), &architecture).unwrap();
        assert_eq!(
            github_enrollment.provider_type(),
            StorageProviderType::Github
        );
        assert_eq!(
            github_enrollment.github_pat().unwrap(),
            "ghp_1234567890ABCDEF"
        );
        assert_eq!(github_enrollment.github_repo().unwrap(), "work-vault");
        let shared = enrollment_shared_provider_for_architecture(
            shared_oauth_provider(),
            &architecture,
            "alice@example.test",
            "target-1",
        )
        .unwrap();
        assert!(shared.is_shared_provider_grant());
        let icloud_shared = enrollment_icloud_shared_provider_for_architecture(
            shared_icloud_provider(),
            &architecture,
            "target-2",
        )
        .unwrap();
        assert!(icloud_shared.is_shared_provider_grant());
    }
}
