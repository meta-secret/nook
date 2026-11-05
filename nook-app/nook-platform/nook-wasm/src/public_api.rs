use super::{NookLocalFolderConfig, NookStorageConnection, wasm_bindgen};
use crate::BrowserPasskeyRequestOptions;
use crate::VaultSessionLock;
use crate::storage::local_folder::LocalFolderHandles;
use crate::types::{NookManagerStoreScope, NookProviderSyncRevision};
use crate::{BrowserCredentialCreationOptions, BrowserCredentialRequestOptions};
use crate::{BrowserPasskeyClient, BrowserPasskeyCreationOptions, NookTotpCode};
use crate::{TypedInput, TypedOutput};
use nook_core::CompactToken;
use nook_core::SecretId;
use nook_core::StorageProvider;
use nook_core::{PasswordGenerationOptions, TotpAlgorithm, TotpDigits, TotpPeriod, TotpSecret};
use wasm_bindgen::JsError;

mod localization;
pub use localization::*;
mod enrollment_entry;
pub use enrollment_entry::*;
mod access_check;
pub use access_check::*;
mod provider_identity_choice;
pub use provider_identity_choice::*;
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
mod vault_event_log;
pub use vault_event_log::*;
mod authorized_accounts;
pub use authorized_accounts::*;
mod provider_vault_listing;
pub use provider_vault_listing::*;
mod s3_provider;
pub use s3_provider::*;

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
    Ok(result.encode()?)
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
    let options = options.decode()?;

    Ok::<_, wasm_bindgen::JsError>(PasswordGenerationOptions::generate(options)?)
}

/// Display-only strength estimate shown beside a revealed password or key.
#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn password_strength_level(password: &str) -> nook_core::PasswordStrengthLevel {
    nook_core::PasswordStrengthLevel::estimate(password)
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
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn provider_storage_detail(
    provider: &tsify::Ts<nook_core::StorageProvider>,
    this_device_desc: String,
    google_signed_in: String,
    icloud_signed_in: String,
    local_folder_needs_reconnect: String,
) -> Result<String, wasm_bindgen::JsError> {
    let provider = provider.decode()?;

    let labels = nook_core::ProviderStorageDetailLabels {
        this_device_desc,
        google_signed_in,
        icloud_signed_in,
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
pub fn update_provider_sync_metadata(
    snapshot: &tsify::Ts<nook_core::AuthProvidersSnapshot>,
    provider_id: &str,
    vault_yaml: &str,
    revision: &NookProviderSyncRevision,
    manager_store_scope: &NookManagerStoreScope,
    synced_at: &str,
) -> Result<tsify::Ts<nook_core::AuthProvidersSnapshot>, wasm_bindgen::JsError> {
    let mut snapshot = snapshot.decode()?;

    snapshot.providers = StorageProvider::update_sync_metadata(
        &snapshot.providers,
        provider_id,
        vault_yaml,
        revision.as_core(),
        manager_store_scope.as_core(),
        synced_at,
    );
    let result = Ok::<_, wasm_bindgen::JsError>(snapshot)?;
    Ok(result.encode()?)
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::*;
    use nook_core::{
        AuthProvidersSnapshot, GithubProvider, GoogleDriveAccess, GoogleDriveAuthorization,
        GoogleDriveFolderBinding, GoogleDriveFolderId, GoogleDriveProvider,
        GoogleDriveSignInRequest, ICloudProvider, ICloudShareRole, ICloudShareTargetId,
        ICloudSharedTarget, IsoTimestamp, OAuthAccountIdentity, OAuthFilePreset, OAuthFileProvider,
        ProviderDraft, ProviderKind, ProviderSecretText, ProviderVaultScope, ReplicationSupport,
        ReplicationType, SharedGrantProviderOutcome, SharedStorageTargetSelection,
        StorageConnection, StoredGithubRepository, StoredProvider,
    };
    use serde::{Serialize, de::DeserializeOwned};
    use serde_wasm_bindgen::Serializer;
    use tsify::{Ts, Tsify};
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    fn malformed_typed_inputs_are_rejected() -> Result<(), JsError> {
        assert!(
            super::generate_password(&Ts::new_unchecked(
                Option::<bool>::None.serialize(&Serializer::json_compatible())?
            ))
            .is_err()
        );
        assert!(
            super::provider_storage_detail(
                &Ts::new_unchecked(serde_wasm_bindgen::to_value(&true)?),
                "Device".to_owned(),
                "Google".to_owned(),
                "iCloud".to_owned(),
                "Reconnect".to_owned(),
            )
            .is_err()
        );
        assert!(
            super::draft_storage_args(&Ts::new_unchecked(serde_wasm_bindgen::to_value(&true)?))
                .is_err()
        );
        Ok(())
    }

    struct ProviderFixture;
    impl ProviderFixture {
        fn wire<T: Tsify + Serialize>(value: &T) -> Result<Ts<T>, JsError> {
            Ok(value.encode()?)
        }
        fn decode<T: Tsify + DeserializeOwned>(value: Ts<T>) -> Result<T, JsError>
        where
            T::JsType: Clone,
        {
            Ok(value.decode()?)
        }
        fn row(id: &str, provider: StoredProvider) -> StorageProvider {
            StorageProvider::never_synced(
                id.to_owned(),
                ProviderVaultScope::Unscoped,
                "2026-01-01T00:00:00Z".to_owned(),
                provider,
            )
        }
        fn github_provider() -> Result<StorageProvider, JsError> {
            Ok(Self::row(
                "provider-1",
                StoredProvider::Github(GithubProvider {
                    repository: StoredGithubRepository::Repository("work-vault".to_owned()),
                    token: ProviderSecretText::try_from("ghp_1234567890ABCDEF".to_owned())?,
                }),
            ))
        }
        fn authorization() -> Result<GoogleDriveAuthorization, JsError> {
            Ok(GoogleDriveAuthorization {
                access_token: ProviderSecretText::try_from("access-token".to_owned())?,
                expires_at: IsoTimestamp::parse("2030-01-01T00:00:00Z")?,
            })
        }
        fn shared_oauth_provider() -> Result<StorageProvider, JsError> {
            Ok(Self::row(
                "oauth-provider",
                StoredProvider::OauthFile(OAuthFileProvider::GoogleDrive(GoogleDriveProvider {
                    authorization: Self::authorization()?,
                    account: OAuthAccountIdentity::Unknown,
                    folder_id: GoogleDriveFolderId::parse("target-1")?,
                })),
            ))
        }
        fn shared_icloud_provider() -> Result<StorageProvider, JsError> {
            let share = ICloudSharedTarget::new(
                ICloudShareRole::Owner,
                "zone",
                "owner-record",
                "root-record",
                "target-2",
            )?
            .to_storage_id()?;
            Ok(Self::row(
                "icloud-provider",
                StoredProvider::OauthFile(OAuthFileProvider::ICloud(ICloudProvider {
                    web_auth_token: ProviderSecretText::try_from("access-token".to_owned())?,
                    account: OAuthAccountIdentity::Unknown,
                    share_target: ICloudShareTargetId::try_from(share)?,
                })),
            ))
        }
    }

    #[wasm_bindgen_test]
    fn public_helpers_project_password_totp_and_provider_rows() -> Result<(), JsError> {
        VaultSessionLock::set_vault_session_locked(VaultSessionLock::Locked);
        assert!(VaultSessionLock::is_vault_session_locked());
        VaultSessionLock::set_vault_session_locked(VaultSessionLock::Unlocked);
        assert!(!VaultSessionLock::is_vault_session_locked());
        assert!(super::generate_id()?.len() > 10);
        assert!(super::generate_secret_id()?.len() > 10);
        let options = super::default_password_generation_options()?;
        assert!(!super::generate_password(&options)?.is_empty());
        let code = super::generate_totp_code("JBSWY3DPEHPK3PXP", 59)?;
        assert_eq!(code.len(), 6);
        assert!(super::verify_totp_code("JBSWY3DPEHPK3PXP", &code, 59)?);

        let provider = ProviderFixture::github_provider()?;
        let detail = super::provider_storage_detail(
            &ProviderFixture::wire(&provider)?,
            "This device".into(),
            "Google signed in".into(),
            "iCloud signed in".into(),
            "Reconnect folder".into(),
        )?;
        assert!(detail.contains("work-vault"));
        assert!(detail.contains("ghp_123456"));
        let StorageConnection::Github { token, repo } = ProviderFixture::decode(
            super::provider_wasm_args(&ProviderFixture::wire(&provider)?)?,
        )?
        else {
            return Err(JsError::new("a GitHub row connects to GitHub"));
        };
        assert_eq!(token.expose(), "ghp_1234567890ABCDEF");
        assert_eq!(repo, "work-vault");

        let empty = AuthProvidersSnapshot::default();
        let unscoped = NookManagerStoreScope::unscoped();
        assert!(
            ProviderFixture::decode(super::active_vault_providers(
                &ProviderFixture::wire(&empty)?,
                &unscoped
            )?)?
            .providers
            .is_empty()
        );
        assert_eq!(
            super::provider_label_by_id(&ProviderFixture::wire(&empty)?, "missing")?,
            "missing"
        );
        let revision = NookProviderSyncRevision::untracked();
        assert!(
            super::update_provider_sync_metadata(
                &ProviderFixture::wire(&empty)?,
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
        let provider = ProviderFixture::github_provider()?;
        let architecture = super::default_vault_architecture();
        assert!(super::validate_vault_architecture(&architecture).is_ok());
        assert!(super::vault_architecture_can_create_secret(&architecture)?);
        assert!(
            super::provider_onboarding_type(&ProviderFixture::wire(&provider)?, &architecture)
                .is_ok()
        );
        assert!(super::provider_replication_capability(&ProviderFixture::wire(&provider)?).is_ok());
        assert_eq!(
            super::provider_supports_replication(
                &ProviderFixture::wire(&provider)?,
                ReplicationType::Shared
            )?,
            ReplicationSupport::Unsupported
        );
        assert!(
            super::provider_kind_replication_capability(&ProviderFixture::wire(
                &ProviderKind::OauthFile(OAuthFilePreset::ICloud)
            )?)?
            .supports(ReplicationType::Shared)
                == ReplicationSupport::Supported
        );
        let snapshot = AuthProvidersSnapshot {
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
        assert!(matches!(
            ProviderFixture::decode(super::select_shared_grant_provider(
                &ProviderFixture::wire(&nook_core::SharedGrantProviderRequest {
                    snapshot,
                    preset: OAuthFilePreset::GoogleDrive,
                    target: SharedStorageTargetSelection::Create,
                })?
            )?)?,
            SharedGrantProviderOutcome::AuthorizationRequired
        ));

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
        let signed_in = ProviderFixture::decode(super::apply_google_drive_sign_in(
            &ProviderFixture::wire(&GoogleDriveSignInRequest {
                draft: ProviderDraft::begin(ProviderKind::Github),
                access: GoogleDriveAccess {
                    authorization: ProviderFixture::authorization()?,
                    account: OAuthAccountIdentity::Unknown,
                },
            })?,
        )?)?;
        let bound = ProviderFixture::decode(super::bind_google_drive_folder(
            &ProviderFixture::wire(&GoogleDriveFolderBinding {
                draft: signed_in,
                folder_id: GoogleDriveFolderId::parse("folder-1")?,
            })?,
        )?)?;
        assert!(bound.complete().is_ok());
        assert!(
            super::bind_google_drive_folder(&ProviderFixture::wire(&GoogleDriveFolderBinding {
                draft: ProviderDraft::begin(ProviderKind::S3),
                folder_id: GoogleDriveFolderId::parse("folder-1")?,
            })?)
            .is_err()
        );

        let github_enrollment = super::enrollment_provider_for_architecture(
            &ProviderFixture::wire(&provider)?,
            &architecture,
            &ProviderFixture::wire(&nook_core::EnrollmentCredentialChoice::Inviter)?,
        )?;
        assert_eq!(
            github_enrollment.provider_type()?.to_rust()?,
            ProviderKind::Github
        );
        assert_eq!(github_enrollment.github_pat()?, "ghp_1234567890ABCDEF");
        let shared = super::enrollment_shared_provider_for_architecture(
            &ProviderFixture::wire(&ProviderFixture::shared_oauth_provider()?)?,
            &architecture,
            "alice@example.test",
        )?;
        assert!(shared.is_shared_provider_grant());
        assert_eq!(shared.shared_storage_target_id()?, "target-1");
        let icloud_shared = super::enrollment_shared_provider_for_architecture(
            &ProviderFixture::wire(&ProviderFixture::shared_icloud_provider()?)?,
            &architecture,
            "bob@example.test",
        )?;
        assert_eq!(icloud_shared.shared_joiner_identity()?, "bob@example.test");
        Ok(())
    }
}

mod passkey_material_admission;
pub use passkey_material_admission::*;
