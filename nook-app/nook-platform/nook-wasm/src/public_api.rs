use super::{NookLocalFolderConfig, NookStorageConnectArgs, wasm_bindgen};
use crate::BrowserPasskeyRequestOptions;
use crate::VaultSessionLock;
use crate::storage::local_folder::LocalFolderHandles;
use crate::types::{NookManagerStoreScope, NookProviderSyncRevision};
use crate::{BrowserCredentialCreationOptions, BrowserCredentialRequestOptions};
use crate::{BrowserPasskeyClient, BrowserPasskeyCreationOptions, NookTotpCode};
use nook_core::CompactToken;
use nook_core::PasswordPolicy;
use nook_core::ProviderCredentialEvidence;
use nook_core::ProviderCredentialReadiness;
use nook_core::SecretId;
use nook_core::StorageProviderData;
use nook_core::{PasswordGenerationOptions, TotpAlgorithm, TotpDigits, TotpPeriod, TotpSecret};
use nook_core::{
    ProviderSaveSetup, StagedGithubConnection, StagedOAuthConnection, StagedRemoteConnection,
};
use nook_core::{
    StoredGithubPat, StoredGithubRepository, StoredLocalFolderHandle, StoredOAuthAccessCredential,
    StoredOAuthFileConfiguration, StoredOAuthRemoteFileName,
};
use tsify::Tsify;
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
mod provider_architecture;
pub use provider_architecture::*;
mod provider_import;
pub use provider_import::*;
mod companion_heuristics;
pub use companion_heuristics::*;
mod shared_storage_grant;
pub use shared_storage_grant::*;

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn is_vault_session_locked() -> bool {
    VaultSessionLock::is_vault_session_locked()
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn set_vault_session_locked(locked: bool) {
    VaultSessionLock::set_vault_session_locked(if locked {
        VaultSessionLock::Locked
    } else {
        VaultSessionLock::Unlocked
    });
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn is_local_folder_backup_supported() -> bool {
    NookLocalFolderConfig::is_supported()
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub async fn choose_local_folder_backup_directory()
-> Result<NookLocalFolderConfig, wasm_bindgen::JsError> {
    NookLocalFolderConfig::choose().await.map_err(Into::into)
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub async fn remove_local_folder_handle(handle_id: String) -> Result<(), wasm_bindgen::JsError> {
    LocalFolderHandles::current()
        .remove(handle_id)
        .await
        .map_err(Into::into)
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn generate_id() -> Result<String, wasm_bindgen::JsError> {
    Ok(CompactToken::generate()?.to_string())
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
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn build_passkey_prf_request_options(
    rp_id: &str,
    credential_id: Vec<u8>,
    prf_input: Vec<u8>,
) -> Result<BrowserCredentialRequestOptions, wasm_bindgen::JsError> {
    BrowserPasskeyClient::request_options(BrowserPasskeyRequestOptions {
        rp_id,
        credential_id: &credential_id,
        prf_input: &prf_input,
    })
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
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn build_passkey_creation_options(
    rp_id: &str,
    rp_name: &str,
    passkey_label: &str,
    user_handle: Vec<u8>,
    prf_input: Vec<u8>,
) -> Result<BrowserCredentialCreationOptions, wasm_bindgen::JsError> {
    BrowserPasskeyClient::creation_options(BrowserPasskeyCreationOptions {
        rp_id,
        rp_name,
        passkey_label,
        user_handle: &user_handle,
        prf_input: &prf_input,
    })
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn build_passkey_recovery_request_options(
    rp_id: &str,
) -> Result<BrowserCredentialRequestOptions, wasm_bindgen::JsError> {
    BrowserPasskeyClient::recovery_options(rp_id)
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn generate_secret_id() -> Result<String, wasm_bindgen::JsError> {
    Ok(SecretId::generate()?.to_string())
}

/// Cryptographically secure password generation — free function so the UI can
/// call it while the vault manager is borrowed by an in-flight `&mut self` op.
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn default_password_generation_options()
-> Result<tsify::Ts<nook_core::PasswordGenerationOptions>, wasm_bindgen::JsError> {
    let result = { PasswordGenerationOptions::default() };
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn generate_password(
    options: &tsify::Ts<nook_core::PasswordGenerationOptions>,
) -> Result<String, wasm_bindgen::JsError> {
    let options = options
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;

    Ok::<_, wasm_bindgen::JsError>(PasswordGenerationOptions::generate(options)?)
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
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn generate_totp_code(
    secret: &str,
    unix_seconds: u64,
) -> Result<String, wasm_bindgen::JsError> {
    Ok(NookTotpCode::authenticator_from_secret(secret)?
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
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn verify_totp_code(
    secret: &str,
    code: &str,
    unix_seconds: u64,
) -> Result<bool, wasm_bindgen::JsError> {
    let authenticator = NookTotpCode::authenticator_from_secret(secret)?;
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

impl NookTotpCode {
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
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn vault_password_min_length() -> u32 {
    u32::try_from(usize::from(PasswordPolicy::min_length())).unwrap_or(u32::MAX)
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
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn vault_password_recommended_min_length() -> u32 {
    u32::try_from(usize::from(
        PasswordPolicy::recommended_min_length(),
    ))
    .unwrap_or(u32::MAX)
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn is_vault_password_long_enough(password: &str) -> bool {
    PasswordPolicy::is_long_enough(password)
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn is_vault_password_recommended_length(password: &str) -> bool {
    PasswordPolicy::is_recommended_length(password)
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn has_github_credentials(pat: &str) -> bool {
    ProviderCredentialEvidence::Github(&StoredGithubPat::Token(pat.to_owned()))
        .readiness()
        == ProviderCredentialReadiness::Ready
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn has_oauth_credentials(access_token: &str) -> bool {
    ProviderCredentialEvidence::OAuth(&StoredOAuthAccessCredential::AccessToken(
        access_token.to_owned(),
    ))
    .readiness()
        == ProviderCredentialReadiness::Ready
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn has_local_folder_credentials(handle_id: &str) -> bool {
    ProviderCredentialEvidence::LocalFolder(&StoredLocalFolderHandle::HandleId(
        handle_id.to_owned(),
    ))
    .readiness()
        == ProviderCredentialReadiness::Ready
}

#[wasm_bindgen]
#[allow(clippy::too_many_arguments, clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn provider_storage_detail(
    provider: &tsify::Ts<nook_core::StorageProviderData>,
    this_device_desc: String,
    no_token_saved: String,
    google_signed_in: String,
    icloud_signed_in: String,
    google_not_signed_in: String,
    icloud_not_signed_in: String,
    local_folder_needs_reconnect: String,
) -> Result<String, wasm_bindgen::JsError> {
    let provider = provider
        .to_rust()
        .map_err(|_| JsError::new("Invalid typed WASM input."))?;

    let labels = nook_core::ProviderStorageDetailLabels {
        this_device_desc,
        no_token_saved,
        google_signed_in,
        icloud_signed_in,
        google_not_signed_in,
        icloud_not_signed_in,
        local_folder_needs_reconnect,
    };
    Ok(provider.storage_detail(&labels))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn localize_provider_label(
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
    labels.localize(label)
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn oauth_remote_storage_ref(
    config: &tsify::Ts<nook_core::OAuthFileConfigData>,
) -> Result<NookOAuthRemoteStorageReference, wasm_bindgen::JsError> {
    let config = config
        .to_rust()
        .map_err(|_| JsError::new("Invalid typed WASM input."))?;
    let result = { NookOAuthRemoteStorageReference::new(config.remote_storage_ref()) };
    Ok(result)
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn update_oauth_remote_ref(
    config: &tsify::Ts<nook_core::OAuthFileConfigData>,

    setup: &tsify::Ts<ProviderSaveSetup>,

    remote_ref: &str,
) -> Result<NookOAuthRemoteConfigurationUpdate, wasm_bindgen::JsError> {
    let config = config
        .to_rust()
        .map_err(|_| JsError::new("Invalid typed WASM input."))?;

    let setup = setup
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let result = {
        NookOAuthRemoteConfigurationUpdate::new(
            config
                .with_provider_save_setup(setup)
                .with_remote_ref(remote_ref),
        )
    };
    Ok(result)
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn staged_github_remote_storage_args(
    github_pat: &str,
    github_repo: &str,
) -> Result<NookStagedStorageArgs, wasm_bindgen::JsError> {
    Ok(NookStagedStorageArgs::new(
        StagedRemoteConnection::Github(StagedGithubConnection {
            credential: &StoredGithubPat::Token((github_pat).to_owned()),
            repository: &StoredGithubRepository::Repository((github_repo).to_owned()),
        })
        .project()?,
    ))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn staged_oauth_remote_storage_args(
    oauth_file: &tsify::Ts<nook_core::OAuthFileConfigData>,

    setup: &tsify::Ts<ProviderSaveSetup>,
) -> Result<NookStagedStorageArgs, wasm_bindgen::JsError> {
    let oauth_file = oauth_file
        .to_rust()
        .map_err(|_| JsError::new("Invalid typed WASM input."))?;

    let setup = setup
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;

    Ok(NookStagedStorageArgs::new(
        StagedRemoteConnection::OAuth(StagedOAuthConnection {
            configuration: &StoredOAuthFileConfiguration::configured(oauth_file.clone()),
            file_name: &StoredOAuthRemoteFileName::Unresolved,
            setup,
        })
        .project()?,
    ))
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn staged_local_remote_storage_args() -> Result<NookStagedStorageArgs, wasm_bindgen::JsError> {
    Ok(NookStagedStorageArgs::new(
        StagedRemoteConnection::Local.project()?,
    ))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn update_provider_sync_metadata(
    snapshot: &tsify::Ts<nook_core::AuthProvidersSnapshotData>,
    provider_id: &str,
    vault_yaml: &str,
    revision: &NookProviderSyncRevision,
    manager_store_scope: &NookManagerStoreScope,
    synced_at: &str,
) -> Result<tsify::Ts<nook_core::AuthProvidersSnapshotData>, wasm_bindgen::JsError> {
    let mut snapshot = snapshot
        .to_rust()
        .map_err(|_| JsError::new("Invalid typed WASM input."))?;

    snapshot.providers = StorageProviderData::update_sync_metadata(
        &snapshot.providers,
        provider_id,
        vault_yaml,
        revision.as_core(),
        manager_store_scope.as_core(),
        synced_at,
    );
    let result = Ok::<_, wasm_bindgen::JsError>(snapshot)?;
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM output could not be encoded."))
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::*;
    use nook_core::AuthProvidersSnapshotData;
    use nook_core::ICloudShareRole;
    use nook_core::ICloudSharedTarget;
    use nook_core::OAuthFileConfigData;
    use nook_core::ProviderOauthPreset;
    use nook_core::SharedGrantProviderOutcome;
    use nook_core::SharedStorageTargetSelection;
    use nook_core::{
        GoogleDriveMode, ICloudMode, OauthFilePreset, ProviderSyncCheckpoint, ProviderVaultScope,
        ReplicationType, StorageProviderData, StorageProviderType, StoredGithubPat,
        StoredGithubRepository, StoredGoogleDriveFolder, StoredICloudShareTarget,
        StoredLocalFolderConfiguration, StoredOAuthAccessCredential, StoredOAuthAccountIdentity,
        StoredOAuthFileConfiguration, StoredOAuthRemoteFileName,
    };
    use serde::{Serialize, de::DeserializeOwned};
    use tsify::{Ts, Tsify};
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    struct ProviderFixture;
    impl ProviderFixture {
        fn wire<T: Tsify + Serialize>(value: &T) -> Result<Ts<T>, JsError> {
            value
                .into_ts()
                .map_err(|_| JsError::new("Provider fixture could not be encoded."))
        }
        fn decode<T: Tsify + DeserializeOwned>(value: Ts<T>) -> Result<T, JsError>
        where
            T::JsType: Clone,
        {
            value
                .to_rust()
                .map_err(|_| JsError::new("Provider output could not be decoded."))
        }
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
                oauth_file: StoredOAuthFileConfiguration::configured(
                    nook_core::OAuthFileConfigData {
                        preset: OauthFilePreset::GoogleDrive,
                        access_token: StoredOAuthAccessCredential::AccessToken(
                            "access-token".into(),
                        ),
                        file_name: StoredOAuthRemoteFileName::FileName("Vault.yaml".into()),
                        folder_id: StoredGoogleDriveFolder::FolderId("target-1".into()),
                        drive_mode: GoogleDriveMode::Shared,
                        ..Default::default()
                    },
                ),
                local_folder: StoredLocalFolderConfiguration::NotApplicable,
                store_id: ProviderVaultScope::Unscoped,
                sync_checkpoint: ProviderSyncCheckpoint::NeverSynced,
                created_at: "2026-01-01T00:00:00Z".into(),
            }
        }

        fn shared_icloud_provider() -> Result<StorageProviderData, JsError> {
            let mut provider = Self::shared_oauth_provider();
            provider.oauth_file =
                StoredOAuthFileConfiguration::configured(nook_core::OAuthFileConfigData {
                    preset: OauthFilePreset::ICloud,
                    access_token: StoredOAuthAccessCredential::AccessToken("access-token".into()),
                    file_name: StoredOAuthRemoteFileName::FileName("Vault.yaml".into()),
                    drive_mode: GoogleDriveMode::Private,
                    folder_id: StoredGoogleDriveFolder::Root,
                    icloud_mode: ICloudMode::Shared,
                    icloud_share_target: StoredICloudShareTarget::SharedTarget(
                        ICloudSharedTarget::new(
                            ICloudShareRole::Owner,
                            "zone",
                            "owner-record",
                            "root-record",
                            "target-2",
                        )?
                        .to_storage_id()?,
                    ),
                    ..Default::default()
                });
            Ok(provider)
        }
    }

    #[wasm_bindgen_test]
    fn public_helpers_project_password_totp_and_provider_credentials() -> Result<(), JsError> {
        VaultSessionLock::set_vault_session_locked(VaultSessionLock::Locked);
        assert!(VaultSessionLock::is_vault_session_locked());
        VaultSessionLock::set_vault_session_locked(VaultSessionLock::Unlocked);
        assert!(!VaultSessionLock::is_vault_session_locked());
        let _ = super::is_local_folder_backup_supported();

        assert!(super::generate_id()?.len() > 10);
        assert!(super::generate_secret_id()?.len() > 10);
        let options = super::default_password_generation_options()?;
        let password = super::generate_password(&options)?;
        assert!(!password.is_empty());
        assert!(super::vault_password_min_length() > 0);
        assert!(
            super::vault_password_recommended_min_length() >= super::vault_password_min_length()
        );
        assert!(!super::is_vault_password_long_enough("no"));
        assert!(!super::is_vault_password_recommended_length("no"));

        let code = super::generate_totp_code("JBSWY3DPEHPK3PXP", 59)?;
        assert_eq!(code.len(), 6);
        assert!(super::verify_totp_code("JBSWY3DPEHPK3PXP", &code, 59)?);
        assert!(!super::verify_totp_code("JBSWY3DPEHPK3PXP", "bad", 59)?);
        assert!(super::generate_totp_code("bad", 59).is_err());

        assert!(super::has_github_credentials("ghp_test"));
        assert!(!super::has_github_credentials(""));
        assert!(super::has_oauth_credentials("access-token"));
        assert!(!super::has_oauth_credentials(""));
        assert!(super::has_local_folder_credentials("handle"));
        assert!(!super::has_local_folder_credentials(""));

        let provider = ProviderFixture::github_provider();
        let detail = super::provider_storage_detail(
            &ProviderFixture::wire(&provider)?,
            "This device".into(),
            "No token".into(),
            "Google signed in".into(),
            "iCloud signed in".into(),
            "Google signed out".into(),
            "iCloud signed out".into(),
            "Reconnect folder".into(),
        )?;
        assert!(detail.contains("work-vault"));
        assert!(detail.contains("ghp_123456"));
        assert_eq!(
            super::localize_provider_label(
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
            ProviderFixture::decode(super::provider_wasm_args(&ProviderFixture::wire(
                &provider
            )?)?)?
            .mode,
            "github"
        );

        let empty = AuthProvidersSnapshotData::default();
        let unscoped = NookManagerStoreScope::unscoped();
        assert!(
            ProviderFixture::decode(super::active_vault_providers(
                &ProviderFixture::wire(&empty)?,
                &unscoped
            )?)?
            .providers
            .is_empty()
        );
        assert!(
            ProviderFixture::decode(super::sync_providers_for_active_vault(
                &ProviderFixture::wire(&empty)?,
                &unscoped
            )?)?
            .providers
            .is_empty()
        );
        assert!(
            super::local_provider_for_active_vault(&ProviderFixture::wire(&empty)?, &unscoped)?
                .provider_id()
                .is_err()
        );
        assert_eq!(
            super::provider_label_by_id(&ProviderFixture::wire(&empty)?, "missing")?,
            "missing"
        );
        assert!(
            ProviderFixture::decode(super::providers_visible_while_device_locked(
                &ProviderFixture::wire(&empty)?
            )?)?
            .providers
            .is_empty()
        );

        let oauth = OAuthFileConfigData::default();
        let remote = super::oauth_remote_storage_ref(&ProviderFixture::wire(&oauth)?)?;
        assert!(remote.value().is_err());
        assert!(
            super::update_oauth_remote_ref(
                &ProviderFixture::wire(&oauth)?,
                &ProviderFixture::wire(&ProviderSaveSetup::Existing)?,
                "file-1"
            )?
            .config()
            .is_ok()
        );
        assert_eq!(
            super::staged_github_remote_storage_args("pat", "owner/repo")?.state(),
            NookStagedStorageArgsState::Ready
        );
        assert_eq!(
            super::staged_local_remote_storage_args()?.state(),
            NookStagedStorageArgsState::Incomplete
        );
        assert_eq!(
            super::staged_oauth_remote_storage_args(
                &ProviderFixture::wire(&oauth)?,
                &ProviderFixture::wire(&ProviderSaveSetup::Existing)?
            )?
            .state(),
            NookStagedStorageArgsState::Incomplete
        );

        let revision = NookProviderSyncRevision::untracked();
        assert!(
            super::update_provider_sync_metadata(
                &ProviderFixture::wire(&AuthProvidersSnapshotData::default())?,
                "provider-1",
                "not yaml",
                &revision,
                &unscoped,
                "2026-01-01T00:00:00Z",
            )
            .is_ok()
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    fn public_provider_and_vault_architecture_helpers_project_success_paths() -> Result<(), JsError>
    {
        let provider = ProviderFixture::github_provider();
        let architecture = super::default_vault_architecture();
        assert!(super::validate_vault_architecture(&architecture).is_ok());
        assert!(super::vault_architecture_onboarding_type(&architecture).is_ok());
        assert!(super::vault_architecture_can_create_secret(&architecture)?);
        assert!(
            super::provider_onboarding_type(&ProviderFixture::wire(&provider)?, &architecture)
                .is_ok()
        );
        assert_eq!(
            ProviderFixture::decode(super::provider_oauth_preset_for_provider(
                &ProviderFixture::wire(&provider)?
            )?)?,
            ProviderOauthPreset::NotApplicable
        );
        assert!(matches!(
            ProviderFixture::decode(super::provider_oauth_preset_for_config(
                &ProviderFixture::wire(&OAuthFileConfigData::default())?
            )?)?,
            ProviderOauthPreset::Preset(_)
        ));
        assert!(super::provider_replication_capability(&ProviderFixture::wire(&provider)?).is_ok());
        assert!(
            super::validate_provider_replication(
                &ProviderFixture::wire(&provider)?,
                ReplicationType::Personal
            )
            .is_ok()
        );
        assert!(super::provider_supports_replication(
            &ProviderFixture::wire(&provider)?,
            ReplicationType::Personal
        )?);

        let snapshot = nook_core::AuthProvidersSnapshotData {
            providers: vec![provider.clone()],
            ..Default::default()
        };
        assert_eq!(
            super::first_compatible_provider_id(
                &ProviderFixture::wire(&snapshot)?,
                ReplicationType::Personal
            )?
            .provider_id()?,
            "provider-1"
        );
        assert_eq!(
            super::first_compatible_provider_id_preferred(
                &ProviderFixture::wire(&snapshot)?,
                ReplicationType::Personal,
                "provider-1"
            )?
            .provider_id()?,
            "provider-1"
        );
        assert!(matches!(
            ProviderFixture::decode(super::select_shared_grant_provider(
                &ProviderFixture::wire(&nook_core::SharedGrantProviderRequest {
                    snapshot,
                    preset: OauthFilePreset::GoogleDrive,
                    target: SharedStorageTargetSelection::Create,
                })?
            )?)?,
            SharedGrantProviderOutcome::AuthorizationRequired
        ));

        let updated_drive = ProviderFixture::decode(super::set_google_drive_provider_mode(
            &ProviderFixture::wire(&OAuthFileConfigData::default())?,
            &ProviderFixture::wire(&GoogleDriveMode::Shared)?,
        )?)?;
        assert_eq!(updated_drive.drive_mode, GoogleDriveMode::Shared);
        let updated_icloud = ProviderFixture::decode(super::set_icloud_provider_mode(
            &ProviderFixture::wire(&OAuthFileConfigData::default())?,
            &ProviderFixture::wire(&ICloudMode::Shared)?,
        )?)?;
        assert_eq!(updated_icloud.icloud_mode, ICloudMode::Shared);

        let target = super::create_icloud_shared_storage_target(
            "owner",
            "zone",
            "owner-record",
            "root-record",
            "short-guid",
        )?;
        assert_eq!(
            ProviderFixture::decode(super::parse_icloud_shared_storage_target(&target)?)?.zone_name,
            "zone"
        );
        assert!(super::create_icloud_shared_storage_target("unknown", "", "", "", "").is_err());
        assert!(
            super::bind_google_drive_shared_folder(
                &ProviderFixture::wire(&OAuthFileConfigData::default())?,
                "folder-1"
            )
            .is_ok()
        );

        let google = ProviderFixture::decode(super::google_oauth_tokens_to_config(
            "access-token",
            "2030-01-01T00:00:00Z",
            &ProviderFixture::wire(&StoredOAuthFileConfiguration::NotApplicable)?,
        )?)?;
        assert!(matches!(
            google.access_token,
            StoredOAuthAccessCredential::AccessToken(_)
        ));
        let icloud = ProviderFixture::decode(super::icloud_oauth_tokens_to_config(
            "access-token",
            &ProviderFixture::wire(&StoredOAuthAccountIdentity::Email(
                "alice@example.test".into(),
            ))?,
            &ProviderFixture::wire(&StoredOAuthFileConfiguration::NotApplicable)?,
        )?)?;
        assert!(matches!(
            icloud.access_token,
            StoredOAuthAccessCredential::AccessToken(_)
        ));

        let github_enrollment = super::enrollment_provider_for_architecture(
            &ProviderFixture::wire(&provider)?,
            &architecture,
        )?;
        assert_eq!(
            github_enrollment.provider_type(),
            StorageProviderType::Github
        );
        assert_eq!(github_enrollment.github_pat()?, "ghp_1234567890ABCDEF");
        assert_eq!(github_enrollment.github_repo()?, "work-vault");
        let shared = super::enrollment_shared_provider_for_architecture(
            &ProviderFixture::wire(&ProviderFixture::shared_oauth_provider())?,
            &architecture,
            "alice@example.test",
            "target-1",
        )?;
        assert!(shared.is_shared_provider_grant());
        let icloud_shared = super::enrollment_icloud_shared_provider_for_architecture(
            &ProviderFixture::wire(&ProviderFixture::shared_icloud_provider()?)?,
            &architecture,
            "target-2",
        )?;
        assert!(icloud_shared.is_shared_provider_grant());
        Ok(())
    }
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn login_unlock_decision(
    access: nook_core::VaultAccessStatus,
    passwords: nook_core::PasswordEntryPresence,
) -> nook_core::LoginUnlockDecision {
    nook_core::LoginUnlockAssessment { access, passwords }.decide()
}

mod passkey_material_admission;
pub use passkey_material_admission::*;
