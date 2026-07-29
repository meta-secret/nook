use super::{
    NookDecryptedEnrollmentPayload, NookEnrollmentIssueInput, NookEnrollmentProvider,
    NookGoogleDriveFolder, NookLocalFolderConfig, NookProviderReplicationCapability,
    NookStorageConnectArgs, NookStringValue, NookStringValueRef, NookVaultArchitecture,
    passkey_browser, storage, wasm_bindgen,
};

mod localization;
pub use localization::*;
mod mnemonic;
pub use mnemonic::*;
mod provider_labels;
pub use provider_labels::*;

#[wasm_bindgen(js_name = isVaultSessionLocked)]
#[must_use]
pub fn is_vault_session_locked() -> bool {
    storage::session::is_vault_session_locked()
}

#[wasm_bindgen(js_name = setVaultSessionLocked)]
pub fn set_vault_session_locked(locked: bool) {
    storage::session::set_vault_session_locked(locked);
}

#[wasm_bindgen(js_name = isLocalFolderBackupSupported)]
#[must_use]
pub fn is_local_folder_backup_supported() -> bool {
    storage::local_folder::is_local_folder_backup_supported()
}

#[wasm_bindgen(js_name = chooseLocalFolderBackupDirectory)]
pub async fn choose_local_folder_backup_directory()
-> Result<NookLocalFolderConfig, wasm_bindgen::JsError> {
    storage::local_folder::choose_local_folder_backup_directory()
        .await
        .map_err(Into::into)
}

#[wasm_bindgen(js_name = removeLocalFolderHandle)]
pub async fn remove_local_folder_handle(
    handle_id: Option<String>,
) -> Result<(), wasm_bindgen::JsError> {
    storage::local_folder::remove_local_folder_handle(handle_id)
        .await
        .map_err(Into::into)
}

#[wasm_bindgen(js_name = generateId)]
pub fn generate_id() -> Result<String, wasm_bindgen::JsError> {
    Ok(nook_core::generate_id()?.to_string())
}

#[wasm_bindgen(js_name = buildPasskeyPrfRequestOptions)]
#[allow(clippy::needless_pass_by_value)]
pub fn build_passkey_prf_request_options(
    rp_id: &str,
    credential_id: Vec<u8>,
    prf_input: Vec<u8>,
) -> Result<web_sys::CredentialRequestOptions, wasm_bindgen::JsError> {
    passkey_browser::request_options(rp_id, &credential_id, &prf_input)
}

#[wasm_bindgen(js_name = buildPasskeyCreationOptions)]
#[allow(clippy::needless_pass_by_value)]
pub fn build_passkey_creation_options(
    rp_id: &str,
    rp_name: &str,
    passkey_label: &str,
    user_handle: Vec<u8>,
    prf_input: Vec<u8>,
) -> Result<web_sys::CredentialCreationOptions, wasm_bindgen::JsError> {
    passkey_browser::creation_options(rp_id, rp_name, passkey_label, &user_handle, &prf_input)
}

#[wasm_bindgen(js_name = buildPasskeyRecoveryRequestOptions)]
pub fn build_passkey_recovery_request_options(
    rp_id: &str,
) -> Result<web_sys::CredentialRequestOptions, wasm_bindgen::JsError> {
    passkey_browser::recovery_options(rp_id)
}

#[wasm_bindgen(js_name = generateSecretId)]
pub fn generate_secret_id() -> Result<String, wasm_bindgen::JsError> {
    Ok(nook_core::generate_secret_id()?.to_string())
}

/// Cryptographically secure password generation — free function so the UI can
/// call it while the vault manager is borrowed by an in-flight `&mut self` op.
#[wasm_bindgen(js_name = generatePassword)]
pub fn generate_password(
    length: u32,
    lowercase: bool,
    uppercase: bool,
    numbers: bool,
    symbols: bool,
) -> Result<String, wasm_bindgen::JsError> {
    Ok(nook_core::generate_password(&nook_core::PasswordOptions {
        length: length as usize,
        lowercase,
        uppercase,
        numbers,
        symbols,
    })?)
}

/// Generate an RFC 6238 TOTP code from a base32 secret via `nook-core`.
#[wasm_bindgen(js_name = generateTotpCode)]
pub fn generate_totp_code(
    secret: &str,
    unix_seconds: u64,
) -> Result<String, wasm_bindgen::JsError> {
    Ok(authenticator_from_secret(secret)?
        .current_code(unix_seconds)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))?
        .code)
}

/// Verify a TOTP code against a base32 secret with a ±1-step window.
#[wasm_bindgen(js_name = verifyTotpCode)]
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
    let period = authenticator.period.get();
    for step_offset in [-1_i64, 0, 1] {
        let Some(shifted) =
            unix_seconds.checked_add_signed(step_offset * i64::try_from(period).unwrap_or(30))
        else {
            continue;
        };
        let candidate = authenticator
            .current_code(shifted)
            .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))?;
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
        secret: nook_core::TotpSecret::parse(secret)
            .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))?,
        algorithm: nook_core::TotpAlgorithm::Sha1,
        digits: nook_core::TotpDigits::default(),
        period: nook_core::TotpPeriod::default(),
        backup_codes: Vec::new(),
    })
}

#[wasm_bindgen(js_name = vaultPasswordMinLength)]
#[must_use]
pub fn vault_password_min_length() -> u32 {
    u32::try_from(nook_core::vault_password_min_length()).unwrap_or(u32::MAX)
}

#[wasm_bindgen(js_name = vaultPasswordRecommendedMinLength)]
#[must_use]
pub fn vault_password_recommended_min_length() -> u32 {
    u32::try_from(nook_core::vault_password_recommended_min_length()).unwrap_or(u32::MAX)
}

#[wasm_bindgen(js_name = isVaultPasswordLongEnough)]
#[must_use]
pub fn is_vault_password_long_enough(password: &str) -> bool {
    nook_core::is_vault_password_long_enough(password)
}

#[wasm_bindgen(js_name = isVaultPasswordRecommendedLength)]
#[must_use]
pub fn is_vault_password_recommended_length(password: &str) -> bool {
    nook_core::is_vault_password_recommended_length(password)
}

#[wasm_bindgen(js_name = hasRemoteCredentials)]
#[allow(clippy::needless_pass_by_value)]
pub fn has_remote_credentials(
    provider_type: nook_core::StorageProviderType,
    github_pat: Option<String>,
    oauth_access_token: Option<String>,
    local_folder_handle_id: Option<String>,
) -> Result<bool, wasm_bindgen::JsError> {
    Ok(nook_core::has_provider_credentials(
        provider_type,
        github_pat.as_deref(),
        oauth_access_token.as_deref(),
        local_folder_handle_id.as_deref(),
    ))
}

#[wasm_bindgen(js_name = providerStorageDetail)]
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

#[wasm_bindgen(js_name = localizeProviderLabel)]
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

#[wasm_bindgen(js_name = providerWasmArgs)]
#[allow(clippy::needless_pass_by_value)]
pub fn provider_wasm_args(
    provider: nook_core::StorageProviderData,
) -> Result<NookStorageConnectArgs, wasm_bindgen::JsError> {
    Ok(nook_core::storage_args_for_provider(&provider)?.into())
}

#[wasm_bindgen(js_name = activeVaultProviders)]
#[allow(clippy::needless_pass_by_value)]
pub fn active_vault_providers(
    mut snapshot: nook_core::AuthProvidersSnapshotData,
    active_store_id: Option<String>,
) -> Result<nook_core::AuthProvidersSnapshotData, wasm_bindgen::JsError> {
    snapshot.providers =
        nook_core::active_vault_providers(&snapshot.providers, active_store_id.as_deref());
    Ok(snapshot)
}

#[wasm_bindgen(js_name = syncProvidersForActiveVault)]
#[allow(clippy::needless_pass_by_value)]
pub fn sync_providers_for_active_vault(
    mut snapshot: nook_core::AuthProvidersSnapshotData,
    active_store_id: Option<String>,
) -> Result<nook_core::AuthProvidersSnapshotData, wasm_bindgen::JsError> {
    snapshot.providers = nook_core::sync_providers_for_active_vault(
        &snapshot.providers,
        active_store_id.as_deref(),
    )?;
    Ok(snapshot)
}

#[wasm_bindgen(js_name = localProviderIdForActiveVault)]
#[allow(clippy::needless_pass_by_value)]
pub fn local_provider_id_for_active_vault(
    snapshot: nook_core::AuthProvidersSnapshotData,
    active_store_id: Option<String>,
) -> Result<Option<String>, wasm_bindgen::JsError> {
    Ok(
        nook_core::local_provider_for_active_vault(
            &snapshot.providers,
            active_store_id.as_deref(),
        )?
        .map(|provider| provider.id),
    )
}

#[wasm_bindgen(js_name = providerLabelById)]
#[allow(clippy::needless_pass_by_value)]
pub fn provider_label_by_id(
    snapshot: nook_core::AuthProvidersSnapshotData,
    provider_id: &str,
) -> Result<String, wasm_bindgen::JsError> {
    Ok(nook_core::provider_label_by_id(
        &snapshot.providers,
        provider_id,
    ))
}

#[wasm_bindgen(js_name = providersVisibleWhileDeviceLocked)]
#[allow(clippy::needless_pass_by_value)]
pub fn providers_visible_while_device_locked(
    mut snapshot: nook_core::AuthProvidersSnapshotData,
) -> nook_core::AuthProvidersSnapshotData {
    snapshot.providers = nook_core::providers_visible_while_device_locked(&snapshot.providers);
    snapshot
}

#[wasm_bindgen(js_name = oauthRemoteStorageRef)]
#[allow(clippy::needless_pass_by_value)]
pub fn oauth_remote_storage_ref(config: nook_core::OAuthFileConfigData) -> Option<String> {
    nook_core::oauth_remote_storage_ref(&config)
}

#[wasm_bindgen(js_name = updateOauthRemoteRef)]
#[allow(clippy::needless_pass_by_value)]
pub fn update_oauth_remote_ref(
    config: nook_core::OAuthFileConfigData,
    remote_ref: &str,
) -> Option<nook_core::OAuthFileConfigData> {
    nook_core::update_oauth_remote_ref(&config, remote_ref)
}

#[wasm_bindgen(js_name = stagedRemoteStorageArgs)]
#[allow(clippy::needless_pass_by_value)]
pub fn staged_remote_storage_args(
    provider_type: nook_core::StorageProviderType,
    github_pat: Option<String>,
    github_repo: Option<String>,
    oauth_file: Option<nook_core::OAuthFileConfigData>,
) -> Result<Option<NookStorageConnectArgs>, wasm_bindgen::JsError> {
    Ok(nook_core::staged_remote_storage_args(
        provider_type,
        github_pat.as_deref(),
        github_repo.as_deref(),
        oauth_file.as_ref(),
    )?
    .map(Into::into))
}

#[wasm_bindgen(js_name = updateProviderSyncMetadata)]
#[allow(clippy::needless_pass_by_value)]
pub fn update_provider_sync_metadata(
    mut snapshot: nook_core::AuthProvidersSnapshotData,
    provider_id: &str,
    vault_yaml: &str,
    revision: NookStringValue,
    manager_store_id: NookStringValue,
    synced_at: &str,
) -> Result<nook_core::AuthProvidersSnapshotData, wasm_bindgen::JsError> {
    snapshot.providers = nook_core::update_provider_sync_metadata(
        &snapshot.providers,
        provider_id,
        vault_yaml,
        match revision.as_ref() {
            NookStringValueRef::Value(value) => nook_core::ProviderSyncRevisionRef::Revision(value),
            NookStringValueRef::Unavailable => nook_core::ProviderSyncRevisionRef::Unreported,
        },
        match manager_store_id.as_ref() {
            NookStringValueRef::Value(value) => nook_core::ManagerStoreScopeRef::Store(value),
            NookStringValueRef::Unavailable => nook_core::ManagerStoreScopeRef::Unscoped,
        },
        synced_at,
    );
    Ok(snapshot)
}

#[wasm_bindgen(js_name = setGoogleDriveProviderMode)]
#[allow(clippy::needless_pass_by_value)]
pub fn set_google_drive_provider_mode(
    config: nook_core::OAuthFileConfigData,
    mode: nook_core::GoogleDriveMode,
) -> Result<nook_core::OAuthFileConfigData, wasm_bindgen::JsError> {
    Ok(nook_core::set_google_drive_provider_mode(&config, mode))
}

#[wasm_bindgen(js_name = setICloudProviderMode)]
#[allow(clippy::needless_pass_by_value)]
pub fn set_icloud_provider_mode(
    config: nook_core::OAuthFileConfigData,
    mode: nook_core::ICloudMode,
) -> Result<nook_core::OAuthFileConfigData, wasm_bindgen::JsError> {
    Ok(nook_core::set_icloud_provider_mode(&config, mode))
}

#[wasm_bindgen(js_name = createICloudSharedStorageTarget)]
pub fn create_icloud_shared_storage_target(
    role: &str,
    zone_name: &str,
    owner_record_name: &str,
    root_record_name: &str,
    short_guid: &str,
) -> Result<String, wasm_bindgen::JsError> {
    let role = match role.trim() {
        "owner" => nook_core::ICloudShareRole::Owner,
        "participant" => nook_core::ICloudShareRole::Participant,
        other => {
            return Err(wasm_bindgen::JsError::new(&format!(
                "Unknown iCloud share role: {other}"
            )));
        }
    };
    Ok(nook_core::ICloudSharedTarget::new(
        role,
        zone_name,
        owner_record_name,
        root_record_name,
        short_guid,
    )?
    .to_storage_id()?)
}

#[wasm_bindgen(js_name = parseICloudSharedStorageTarget)]
pub fn parse_icloud_shared_storage_target(
    storage_target_id: &str,
) -> Result<nook_core::ICloudSharedTarget, wasm_bindgen::JsError> {
    Ok(nook_core::ICloudSharedTarget::from_storage_id(
        storage_target_id,
    )?)
}

#[wasm_bindgen(js_name = bindGoogleDriveSharedFolder)]
#[allow(clippy::needless_pass_by_value)]
pub fn bind_google_drive_shared_folder(
    config: nook_core::OAuthFileConfigData,
    folder_ref: &str,
) -> Result<nook_core::OAuthFileConfigData, wasm_bindgen::JsError> {
    Ok(nook_core::bind_google_drive_shared_folder(
        &config, folder_ref,
    )?)
}

#[wasm_bindgen(js_name = googleOAuthTokensToConfig)]
#[allow(clippy::needless_pass_by_value)]
pub fn google_oauth_tokens_to_config(
    access_token: &str,
    expires_at: &str,
    existing: Option<nook_core::OAuthFileConfigData>,
) -> Result<nook_core::OAuthFileConfigData, wasm_bindgen::JsError> {
    Ok(nook_core::google_oauth_tokens_to_config(
        access_token,
        expires_at,
        existing.as_ref(),
    ))
}

#[wasm_bindgen(js_name = iCloudOAuthTokensToConfig)]
#[allow(clippy::needless_pass_by_value)]
pub fn icloud_oauth_tokens_to_config(
    access_token: &str,
    account_name: Option<String>,
    existing: Option<nook_core::OAuthFileConfigData>,
) -> Result<nook_core::OAuthFileConfigData, wasm_bindgen::JsError> {
    Ok(nook_core::icloud_oauth_tokens_to_config(
        access_token,
        account_name.as_deref(),
        existing.as_ref(),
    ))
}

#[wasm_bindgen(js_name = defaultVaultArchitecture)]
pub fn default_vault_architecture() -> NookVaultArchitecture {
    NookVaultArchitecture::from_core(nook_core::VaultArchitecture::default())
}

#[wasm_bindgen(js_name = validateVaultArchitecture)]
pub fn validate_vault_architecture(
    architecture: &NookVaultArchitecture,
) -> Result<NookVaultArchitecture, wasm_bindgen::JsError> {
    let architecture = architecture.to_core();
    architecture.validate()?;
    Ok(NookVaultArchitecture::from_core(architecture))
}

#[wasm_bindgen(js_name = vaultArchitectureOnboardingType)]
pub fn vault_architecture_onboarding_type(
    architecture: &NookVaultArchitecture,
) -> Result<nook_core::OnboardingType, wasm_bindgen::JsError> {
    let architecture = architecture.to_core();
    architecture.validate()?;
    Ok(architecture.onboarding_type())
}

#[wasm_bindgen(js_name = providerOnboardingType)]
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

#[wasm_bindgen(js_name = vaultArchitectureCanCreateSecret)]
pub fn vault_architecture_can_create_secret(
    architecture: &NookVaultArchitecture,
) -> Result<bool, wasm_bindgen::JsError> {
    let architecture = architecture.to_core();
    architecture.validate()?;
    Ok(architecture.can_create_secret())
}

#[wasm_bindgen(js_name = providerReplicationCapability)]
#[allow(clippy::needless_pass_by_value)]
pub fn provider_replication_capability(
    provider: nook_core::StorageProviderData,
) -> Result<NookProviderReplicationCapability, wasm_bindgen::JsError> {
    Ok(NookProviderReplicationCapability::from_core(
        nook_core::provider_replication_capability_for_row(&provider)?,
    ))
}

#[wasm_bindgen(js_name = providerOauthPresetForProvider)]
#[allow(clippy::needless_pass_by_value)]
#[must_use]
pub fn provider_oauth_preset_for_provider(
    provider: nook_core::StorageProviderData,
) -> nook_core::ProviderOauthPreset {
    provider
        .oauth_file
        .map_or(nook_core::ProviderOauthPreset::NotApplicable, |oauth| {
            nook_core::ProviderOauthPreset::Preset(oauth.preset)
        })
}

#[wasm_bindgen(js_name = providerOauthPresetForConfig)]
#[allow(clippy::needless_pass_by_value)]
#[must_use]
pub fn provider_oauth_preset_for_config(
    config: nook_core::OAuthFileConfigData,
) -> nook_core::ProviderOauthPreset {
    nook_core::ProviderOauthPreset::Preset(config.preset)
}

#[wasm_bindgen(js_name = validateProviderReplication)]
#[allow(clippy::needless_pass_by_value)]
pub fn validate_provider_replication(
    provider: nook_core::StorageProviderData,
    replication_type: nook_core::ReplicationType,
) -> Result<NookProviderReplicationCapability, wasm_bindgen::JsError> {
    Ok(NookProviderReplicationCapability::from_core(
        nook_core::validate_provider_row_replication(&provider, replication_type)?,
    ))
}

#[wasm_bindgen(js_name = providerSupportsReplication)]
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

#[wasm_bindgen(js_name = firstCompatibleProviderId)]
#[allow(clippy::needless_pass_by_value)]
pub fn first_compatible_provider_id(
    snapshot: nook_core::AuthProvidersSnapshotData,
    replication_type: nook_core::ReplicationType,
    preferred_id: Option<String>,
) -> Result<Option<String>, wasm_bindgen::JsError> {
    Ok(nook_core::first_compatible_provider_id(
        &snapshot.providers,
        replication_type,
        preferred_id.as_deref(),
    ))
}

#[wasm_bindgen(js_name = enrollmentProviderForArchitecture)]
#[allow(clippy::needless_pass_by_value)]
pub fn enrollment_provider_for_architecture(
    provider: nook_core::StorageProviderData,
    architecture: &NookVaultArchitecture,
    shared_joiner_identity: &NookStringValue,
    shared_storage_target_id: &NookStringValue,
) -> Result<NookEnrollmentProvider, wasm_bindgen::JsError> {
    let architecture = architecture.to_core();
    let shared_joiner_identity = match shared_joiner_identity.as_ref() {
        NookStringValueRef::Unavailable => None,
        NookStringValueRef::Value(identity) => Some(identity),
    };
    let shared_storage_target_id = match shared_storage_target_id.as_ref() {
        NookStringValueRef::Unavailable => None,
        NookStringValueRef::Value(target_id) => Some(target_id),
    };
    Ok(NookEnrollmentProvider::from_core(
        nook_core::enrollment_provider_for_architecture_with_storage_target(
            &provider,
            &architecture,
            shared_joiner_identity,
            shared_storage_target_id,
        )?,
    ))
}

async fn grant_existing_drive_folder(
    access_token: &str,
    folder_id: String,
    instructions_key: String,
    joiner_identity: String,
    storage_target_name: Option<String>,
) -> nook_core::SharedStorageGrantOutcome {
    match storage::drive_shared::share_folder_with_email(access_token, &folder_id, &joiner_identity)
        .await
    {
        Ok(()) => nook_core::SharedStorageGrantOutcome::Granted {
            note: "architecture_modes.shared_grant_success".to_owned(),
            storage_target_id: folder_id,
            storage_target_name,
        },
        Err(error) => {
            tracing::warn!(
                scope = "shared-storage-grant",
                stage = "share-existing-folder",
                error = %error,
                "automatic shared storage grant failed; manual grant required"
            );
            nook_core::SharedStorageGrantOutcome::ManualGrantRequired {
                instructions_key,
                joiner_identity,
                storage_target_id: Some(folder_id),
                storage_target_name,
            }
        }
    }
}

async fn create_and_grant_drive_folder(
    access_token: &str,
    folder_name: &str,
    instructions_key: String,
    joiner_identity: String,
) -> nook_core::SharedStorageGrantOutcome {
    let Ok((folder_id, created_name)) =
        storage::drive_shared::create_shared_vault_folder(access_token, folder_name)
            .await
            .inspect_err(|error| {
                tracing::warn!(
                    scope = "shared-storage-grant",
                    stage = "create-folder",
                    error = %error,
                    "automatic shared storage grant failed; manual grant required"
                );
            })
    else {
        return nook_core::SharedStorageGrantOutcome::ManualGrantRequired {
            instructions_key,
            joiner_identity,
            storage_target_id: None,
            storage_target_name: None,
        };
    };
    match storage::drive_shared::share_folder_with_email(access_token, &folder_id, &joiner_identity)
        .await
    {
        Ok(()) => nook_core::SharedStorageGrantOutcome::Granted {
            note: "architecture_modes.shared_grant_success".to_owned(),
            storage_target_id: folder_id,
            storage_target_name: Some(created_name),
        },
        Err(error) => {
            tracing::warn!(
                scope = "shared-storage-grant",
                stage = "share-folder",
                error = %error,
                "automatic shared storage grant failed; manual grant required"
            );
            nook_core::SharedStorageGrantOutcome::ManualGrantRequired {
                instructions_key,
                joiner_identity,
                storage_target_id: Some(folder_id),
                storage_target_name: Some(created_name),
            }
        }
    }
}

/// Validate a shared-grant request, then (for Google Drive) grant the persisted
/// folder or create one when no target exists. Falls back to
/// `ManualGrantRequired` when the Drive API fails or no owner token is supplied.
pub(crate) fn is_google_drive_shared_grant_request(
    provider_type: &str,
    oauth_preset: nook_core::ProviderOauthPreset,
) -> bool {
    provider_type.trim() == "oauth-file"
        && oauth_preset
            == nook_core::ProviderOauthPreset::Preset(nook_core::OauthFilePreset::GoogleDrive)
}

#[wasm_bindgen(js_name = prepareSharedStorageGrant)]
pub async fn prepare_shared_storage_grant(
    request: nook_core::SharedStorageGrantRequest,
) -> Result<nook_core::SharedStorageGrantOutcome, wasm_bindgen::JsError> {
    let validated = nook_core::prepare_shared_storage_grant(&request)?;
    let outcome = match validated {
        nook_core::SharedStorageGrantOutcome::ManualGrantRequired {
            instructions_key,
            joiner_identity,
            storage_target_id,
            storage_target_name,
        } => {
            let token = request
                .access_token
                .as_deref()
                .map(str::trim)
                .filter(|token| !token.is_empty());
            let is_gdrive =
                is_google_drive_shared_grant_request(&request.provider_type, request.oauth_preset);
            match (token, is_gdrive) {
                (Some(access_token), true) => {
                    if let Some(folder_id) = storage_target_id
                        .as_deref()
                        .map(str::trim)
                        .filter(|target| !target.is_empty())
                    {
                        grant_existing_drive_folder(
                            access_token,
                            folder_id.to_owned(),
                            instructions_key,
                            joiner_identity,
                            storage_target_name,
                        )
                        .await
                    } else {
                        let folder_name = request
                            .storage_target_hint
                            .as_deref()
                            .map(str::trim)
                            .filter(|name| !name.is_empty())
                            .unwrap_or("Nook shared vault");
                        create_and_grant_drive_folder(
                            access_token,
                            folder_name,
                            instructions_key,
                            joiner_identity,
                        )
                        .await
                    }
                }
                _ => nook_core::SharedStorageGrantOutcome::ManualGrantRequired {
                    instructions_key,
                    joiner_identity,
                    storage_target_id,
                    storage_target_name,
                },
            }
        }
        other => other,
    };
    Ok(outcome)
}

/// Resolve a shared Drive folder id/URL and verify write access for the current
/// account before persisting the provider row.
#[wasm_bindgen(js_name = verifySharedGoogleDriveFolder)]
pub async fn verify_shared_google_drive_folder(
    access_token: &str,
    folder_ref: &str,
) -> Result<NookGoogleDriveFolder, wasm_bindgen::JsError> {
    let (id, name) =
        storage::drive_shared::verify_shared_vault_folder(access_token, folder_ref).await?;
    Ok(NookGoogleDriveFolder::new(id, name))
}

#[wasm_bindgen(js_name = wasmStorageArgs)]
#[allow(clippy::too_many_arguments, clippy::needless_pass_by_value)]
pub fn wasm_storage_args(
    local_vault_present: bool,
    is_authenticated: bool,
    sync_provider: Option<nook_core::StorageProviderData>,
    provider_type: nook_core::StorageProviderType,
    github_pat: Option<String>,
    github_repo: Option<String>,
    oauth_preset: Option<nook_core::OauthFilePreset>,
    oauth_access_token: Option<String>,
    oauth_file_id: Option<String>,
    oauth_file_name: Option<String>,
) -> Result<NookStorageConnectArgs, wasm_bindgen::JsError> {
    Ok(nook_core::vault_storage_args(
        local_vault_present,
        is_authenticated,
        sync_provider.as_ref(),
        provider_type,
        github_pat.as_deref(),
        github_repo.as_deref(),
        oauth_preset,
        oauth_access_token.as_deref(),
        oauth_file_id.as_deref(),
        oauth_file_name.as_deref(),
    )?
    .into())
}

/// Masked GitHub PAT hint for provider lists. `None` means no token is saved;
/// the JS layer supplies the localized "no token" copy. `Some` is a truncated
/// hint that never contains the full secret.
#[wasm_bindgen(js_name = maskGithubPatHint)]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
pub fn mask_github_pat_hint(pat: Option<String>) -> Option<String> {
    match nook_core::mask_github_pat(pat.as_deref().unwrap_or_default()) {
        nook_core::GithubPatMask::NoToken => None,
        nook_core::GithubPatMask::Hint(hint) => Some(hint),
    }
}

#[wasm_bindgen(js_name = encryptEnrollmentPayload)]
pub fn encrypt_enrollment_payload(
    input: &NookEnrollmentIssueInput,
    password: &str,
    entry_label: Option<String>,
) -> Result<String, wasm_bindgen::JsError> {
    Ok(nook_core::encrypt_enrollment_payload(
        &input.to_core()?,
        password,
        entry_label.unwrap_or_default().as_str(),
    )?)
}

#[wasm_bindgen(js_name = decryptEnrollmentPayload)]
pub fn decrypt_enrollment_payload(
    code: &str,
    password: &str,
) -> Result<NookDecryptedEnrollmentPayload, wasm_bindgen::JsError> {
    let code = nook_core::normalize_enrollment_code(code);
    Ok(NookDecryptedEnrollmentPayload::from_core(
        nook_core::decrypt_enrollment_payload(&code, password)?,
    ))
}

#[wasm_bindgen(js_name = buildEnrollmentLink)]
#[must_use]
pub fn build_enrollment_link(code: &str, base_url: &str) -> String {
    nook_core::build_enrollment_link(code, base_url)
}

#[wasm_bindgen(js_name = buildSentinelGenesisRequestLink)]
pub fn build_sentinel_genesis_request_link(
    request_json: &str,
    base_url: &str,
) -> Result<String, wasm_bindgen::JsError> {
    Ok(nook_core::build_sentinel_genesis_request_link(
        request_json,
        base_url,
    )?)
}

#[wasm_bindgen(js_name = normalizeSentinelGenesisRequest)]
pub fn normalize_sentinel_genesis_request(input: &str) -> Result<String, wasm_bindgen::JsError> {
    Ok(nook_core::normalize_sentinel_genesis_request(input)?)
}

#[wasm_bindgen(js_name = buildSentinelGenesisParticipantResponseLink)]
pub fn build_sentinel_genesis_participant_response_link(
    response_json: &str,
    base_url: &str,
) -> Result<String, wasm_bindgen::JsError> {
    Ok(nook_core::build_sentinel_genesis_participant_response_link(
        response_json,
        base_url,
    )?)
}

#[wasm_bindgen(js_name = normalizeSentinelGenesisParticipantPayload)]
pub fn normalize_sentinel_genesis_participant_payload(
    input: &str,
) -> Result<String, wasm_bindgen::JsError> {
    Ok(nook_core::normalize_sentinel_genesis_participant_payload(
        input,
    )?)
}

#[wasm_bindgen(js_name = sentinelGenesisParticipantFingerprint)]
pub fn sentinel_genesis_participant_fingerprint(
    input: &str,
) -> Result<String, wasm_bindgen::JsError> {
    Ok(nook_core::sentinel_genesis_participant_fingerprint(input)?)
}

#[wasm_bindgen(js_name = normalizeEnrollmentCode)]
#[must_use]
pub fn normalize_enrollment_code(code: &str) -> String {
    nook_core::normalize_enrollment_code(code)
}

#[wasm_bindgen(js_name = peekEnrollmentEntryId)]
#[must_use]
pub fn peek_enrollment_entry_id(code: &str) -> NookStringValue {
    let code = nook_core::normalize_enrollment_code(code);
    match nook_core::peek_enrollment_entry_id(&code) {
        Ok(value) => NookStringValue::from_value(value),
        Err(_) => NookStringValue::unavailable(),
    }
}

#[wasm_bindgen(js_name = peekEnrollmentEntryLabel)]
#[must_use]
pub fn peek_enrollment_entry_label(code: &str) -> NookStringValue {
    let code = nook_core::normalize_enrollment_code(code);
    match nook_core::peek_enrollment_entry_label(&code) {
        Ok(nook_core::EnrollmentEntryLabel::Labeled(label)) => NookStringValue::from_value(label),
        Ok(nook_core::EnrollmentEntryLabel::Unlabeled) | Err(_) => NookStringValue::unavailable(),
    }
}

#[wasm_bindgen(js_name = peekEnrollmentIssuedAt)]
#[must_use]
pub fn peek_enrollment_issued_at(code: &str) -> NookStringValue {
    let code = nook_core::normalize_enrollment_code(code);
    match nook_core::peek_enrollment_issued_at(&code) {
        Ok(value) => NookStringValue::from_value(value),
        Err(_) => NookStringValue::unavailable(),
    }
}
