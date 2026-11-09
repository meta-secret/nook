//! Typed browser and WASM adapter for the Nook Rust core.
//! Browser lifecycle glue stays behind typed exports while domain policy remains in core.

#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_raw_numeric_api_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(raw_numeric_public_api))]
#![allow(
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::uninlined_format_args,
    clippy::must_use_candidate,
    clippy::new_without_default,
    clippy::collapsible_str_replace,
    clippy::assigning_clones,
    clippy::fn_params_excessive_bools,
    clippy::unnecessary_wraps,
    clippy::items_after_statements
)]

use nook_companion_core::ExtensionConnectScope;
use nook_core::{WebsiteHostError, i18n_keys};
mod application;
mod conversion;
mod device_access;
mod error_mapping;
mod extension_consent;
mod identity_record;
mod logger;
mod manager;
mod passkey_browser;
mod passkey_observation;
mod storage;
mod sync_io;
/// Rows and connections the nook-wasm tests share. Every credential here is a
/// test-only placeholder.
#[cfg(test)]
mod test_fixtures {
    #[cfg(feature = "browser-wasm-tests")]
    use nook_core::AuthProvidersSnapshot;

    #[cfg(feature = "browser-wasm-tests")]
    use crate::NookError;
    use nook_core::{
        GithubProvider, ProviderSecretText, ProviderVaultScope, S3Connection, S3ConnectionDraft,
        StorageConnection, StorageProvider, StoredGithubRepository, StoredProvider,
        ValidationError,
    };

    /// The one owner of the fixtures the nook-wasm tests share.
    pub(crate) struct WasmFixture;

    impl WasmFixture {
        /// The secret access key of the S3 test connection.
        pub(crate) const S3_SECRET: &'static str = "TEST-ONLY-device-a-secret-not-real";

        /// A test-only credential text.
        pub(crate) fn secret(text: &str) -> Result<ProviderSecretText, ValidationError> {
            ProviderSecretText::try_from(text.to_owned())
        }

        /// A GitHub connection with a test-only token.
        pub(crate) fn github_connection(
            token: &str,
            repo: &str,
        ) -> Result<StorageConnection, ValidationError> {
            Ok(StorageConnection::Github {
                token: Self::secret(token)?,
                repo: repo.to_owned(),
            })
        }

        /// A never-synced GitHub row with a test-only token.
        pub(crate) fn github_row(
            id: &str,
            token: &str,
            repository: &str,
        ) -> Result<StorageProvider, ValidationError> {
            Ok(StorageProvider::never_synced(
                id.to_owned(),
                ProviderVaultScope::Unscoped,
                "2026-01-01T00:00:00Z".to_owned(),
                StoredProvider::Github(GithubProvider {
                    repository: StoredGithubRepository::Repository(repository.to_owned()),
                    token: Self::secret(token)?,
                }),
            ))
        }

        /// The token of a snapshot whose first row is a GitHub row.
        #[cfg(feature = "browser-wasm-tests")]
        pub(crate) fn first_github_token(
            snapshot: &AuthProvidersSnapshot,
        ) -> Result<&ProviderSecretText, NookError> {
            let [row, ..] = snapshot.providers.as_slice() else {
                return Err(NookError::Database(
                    "the snapshot should hold a row".to_owned(),
                ));
            };
            let StoredProvider::Github(github) = &row.provider else {
                return Err(NookError::Database(
                    "the first row should be a GitHub row".to_owned(),
                ));
            };
            Ok(&github.token)
        }

        /// The S3 setup form the tests fill in for the local development server.
        pub(crate) fn s3_draft() -> S3ConnectionDraft {
            S3ConnectionDraft {
                endpoint: "http://127.0.0.1:8333".to_owned(),
                region: "us-east-1".to_owned(),
                bucket: "nook-dev".to_owned(),
                key_prefix: "e2e".to_owned(),
                access_key_id: "device-a".to_owned(),
                secret_access_key: Self::S3_SECRET.to_owned(),
            }
        }

        /// The validated S3 connection the tests reach the local development
        /// server with.
        pub(crate) fn s3_connection() -> Result<S3Connection, ValidationError> {
            S3Connection::try_from(Self::s3_draft())
        }
    }
}
mod types;

pub use device_access::*;
pub use extension_consent::*;
pub use identity_record::{
    NookIdentityDirectorySelectionKind, NookIdentityDirectorySnapshot,
    NookIdentityDirectorySnapshotRequest, NookIdentitySnapshot, NookIdentitySnapshotKind,
    NookIdentitySnapshotLoad, load_identity_directory_snapshot, load_identity_snapshot,
    select_identity,
};
pub use logger::{NookLogEntries, log_count, log_dump_page};
pub use manager::{
    NookCompanionPairingApprovalAuthority, NookCompanionPairingCandidateFailure,
    NookCompanionPairingCandidateOutcome, NookCompanionPairingCandidateOutcomeState,
    NookCompanionPairingExtensionEndpoint, NookEventLogRecords, NookEventLogStorageRecord,
    NookExtensionEventLogImportStatus, NookExternalEventLogRecords,
    NookPreparedCompanionPairingActivation, NookPrevalidatedCompanionPairingApproval,
    NookSentinelStoredDeliveriesRequest, NookStoredCompanionPairingActivationCandidate,
    NookVaultManager, NookVaultNameState,
};
pub use storage::indexed_db::DeviceProtectionDeviceModeState;
pub use storage::local_folder::NookLocalFolderConfig;
pub use types::{
    NookAuthenticationOutcomeObservation, NookAuthenticationOutcomeVerdict,
    NookAuthenticationPageObservation, NookAuthenticationPageObservations,
    NookAuthenticationWorkflowMatch, NookAuthenticationWorkflowMatchState,
    NookAuthenticationWorkflowSnapshot, NookBrowserExtensionInstallation,
    NookBrowserExtensionMembership, NookBrowserLocale, NookClientRunMode, NookClientRunModeUtil,
    NookDecryptedEnrollmentPayload, NookDiagnosticEpochState, NookEnrollmentIssueInput,
    NookEnrollmentProvider, NookGoogleDriveFolder, NookIdentityHealth, NookIdentityHealthStage,
    NookIdentityNextStep, NookIdentityNudge, NookIdentityProtectionStep,
    NookIdentityProtectionTask, NookIdentityProtectionTaskState, NookImportResult, NookJoinRequest,
    NookLoginAccount, NookLoginFillCredential, NookManualProviderSync, NookManualProviderSyncState,
    NookOtpauthPreview, NookPasskeyAccount, NookPasskeyAssertion, NookPasskeyDetails,
    NookPasskeyNameState, NookPasskeyRegistration, NookPasskeySetup, NookPasskeyUnlockOptions,
    NookProviderReplicationCapability, NookReplacementCandidate, NookReplacementConflict,
    NookRuntimeConfig, NookSecretFormFields, NookSecretHistory, NookSecretOriginDeviceState,
    NookSecretPage, NookSecretRevisionState, NookSecurityConflict, NookSentinelGenesisDelivery,
    NookSentinelGenesisFinalizeResult, NookSentinelGenesisParticipantStatus,
    NookSentinelGenesisStatus, NookSentinelStoredDeliverySummary, NookSentinelUnlockSessionStatus,
    NookStorageConnection, NookStoreId, NookStoreIdPresence, NookStoreIdPresenceState,
    NookTotpCode, NookVaultAccessReport, NookVaultArchitecture, NookVaultClientPolicy,
    NookVaultEpochHistoryDiagnostic, NookVaultEventAccessDiagnostic, NookVaultLastSync,
    NookVaultLastSyncState, NookVaultMember, NookVaultSecretAccessDiagnostic, NookVaultSyncResult,
    NookWebsiteLoginSaveDecision, NookWebsiteLoginSavePlan,
};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn extension_vault_access_scope()
-> Result<tsify::Ts<nook_companion_core::ExtensionConnectScope>, wasm_bindgen::JsError> {
    let result = { ExtensionConnectScope::VaultAccess };
    Ok(result.encode()?)
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn extension_password_filling_scope()
-> Result<tsify::Ts<nook_companion_core::ExtensionConnectScope>, wasm_bindgen::JsError> {
    let result = { ExtensionConnectScope::PasswordFilling };
    Ok(result.encode()?)
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn extension_passkey_management_scope()
-> Result<tsify::Ts<nook_companion_core::ExtensionConnectScope>, wasm_bindgen::JsError> {
    let result = { ExtensionConnectScope::PasskeyManagement };
    Ok(result.encode()?)
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn extension_sync_provider_credentials_scope()
-> Result<tsify::Ts<nook_companion_core::ExtensionConnectScope>, wasm_bindgen::JsError> {
    let result = { ExtensionConnectScope::SyncProviderCredentials };
    Ok(result.encode()?)
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn is_extension_connect_scope(value: &str) -> bool {
    ExtensionConnectScope::parse(value).is_ok()
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn companion_pairing_provider_manifest_digest(
    snapshot: &tsify::Ts<nook_core::AuthProvidersSnapshot>,
) -> Result<String, wasm_bindgen::JsError> {
    let snapshot = snapshot.decode()?;

    Ok(snapshot
        .companion_pairing_manifest_digest()
        .map_err(|error| JsError::new(&error.to_string()))?
        .as_str()
        .to_owned())
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn sentinel_genesis_phase_translation_key(phase: nook_core::SentinelGenesisPhase) -> String {
    phase.translation_key().to_owned()
}

#[derive(thiserror::Error, Debug)]
pub enum NookError {
    #[error("Invalid requesting login origin: {0}")]
    LoginFillOrigin(#[from] WebsiteHostError),
    #[error(transparent)]
    AuthenticatorIssuerHosts(#[from] nook_core::AuthenticatorIssuerHostsError),
    #[error(transparent)]
    AuthenticatorEnrollment(#[from] nook_core::AuthenticatorEnrollmentError),

    #[error("App protection is unavailable")]
    AppProtectionUnavailable,
    #[error("App protection belongs to another app")]
    AppProtectionBindingMismatch,
    #[error("Passkey metadata no longer matches protected app")]
    PasskeyMetadataGuardRejected,

    #[error("IndexedDB error: {0}")]
    IndexedDb(String),

    #[error("GitHub error: {0}")]
    GitHub(String),

    /// Its message is its translation key, which the web classifies through
    /// `provider_failure_code` like every other refusal.
    #[error("{}", i18n_keys::AUTH_STORAGE_GITHUB_TOKEN_REJECTED)]
    GitHubTokenRejected,

    /// A vault's folder on a provider holds another vault's events, so
    /// sync stops there. Its message is its translation key, classified like
    /// every other refusal.
    #[error("{}", i18n_keys::AUTH_STORAGE_VAULT_FOLDER_HOLDS_ANOTHER_VAULT)]
    VaultFolderHoldsAnotherVault,

    #[error("Drive error: {0}")]
    Drive(String),

    #[error("iCloud error: {0}")]
    ICloud(String),

    /// An S3 answer, as its typed failure: a refused key, or a category and
    /// status without the request or the body.
    #[error(transparent)]
    S3Request(#[from] nook_core::S3RequestFailure),

    #[error(transparent)]
    S3Signing(#[from] nook_core::S3SigningError),

    #[error("Decryption failed: {0}")]
    Decryption(String),

    #[error("Encryption failed: {0}")]
    Encryption(String),

    #[error("Database error: {0}")]
    Database(String),

    #[error("Channel error: {0}")]
    Channel(String),

    #[error("Network request failed: {0}")]
    Network(#[from] reqwest::Error),

    #[error("Serialization error: {0}")]
    Serialization(String),

    #[error(transparent)]
    TypedBoundary(#[from] TypedBoundaryError),

    /// A log level string that names none of the five levels.
    #[error("Unknown log level.")]
    UnknownLogLevel,
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::*;
    #[cfg(all(test, target_arch = "wasm32"))]
    #[cfg(all(test, target_arch = "wasm32"))]
    use nook_core::SentinelGenesisPhase;
    #[cfg(all(test, target_arch = "wasm32"))]
    #[cfg(all(test, target_arch = "wasm32"))]
    use nook_core::StoreId;
    use wasm_bindgen::JsError;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    fn typed_vault_identity_exports_are_available_at_the_crate_boundary() -> Result<(), JsError> {
        let store_id = NookStoreId::from(StoreId::before_genesis_placeholder());
        assert_eq!(store_id.value(), "store_abcdefghijk");
        assert_eq!(
            NookStoreIdPresence::from_raw("")
                .map_err(|error| JsError::new(&error.to_string()))?
                .state(),
            NookStoreIdPresenceState::Absent,
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    fn extension_scopes_and_sentinel_translation_are_typed() -> Result<(), JsError> {
        assert_eq!(
            extension_vault_access_scope()?.to_rust()?,
            ExtensionConnectScope::VaultAccess
        );
        assert_eq!(
            extension_password_filling_scope()?.to_rust()?,
            ExtensionConnectScope::PasswordFilling
        );
        assert_eq!(
            extension_passkey_management_scope()?.to_rust()?,
            ExtensionConnectScope::PasskeyManagement
        );
        assert_eq!(
            extension_sync_provider_credentials_scope()?.to_rust()?,
            ExtensionConnectScope::SyncProviderCredentials
        );
        for value in [
            "vault-access",
            "password-filling",
            "passkey-management",
            "sync-provider-credentials",
        ] {
            assert!(is_extension_connect_scope(value));
        }
        assert!(!is_extension_connect_scope("unknown"));
        let phase = SentinelGenesisPhase::Inactive;
        assert_eq!(
            sentinel_genesis_phase_translation_key(phase),
            phase.translation_key()
        );
        Ok(())
    }
}

mod public_api;
mod secret_api;
mod vault_api;
mod vault_api_local;

pub use public_api::*;
pub use secret_api::*;
pub use vault_api::*;
pub use vault_api_local::*;

pub(crate) use storage::NookDatabase;

pub(crate) use storage::indexed_db::{SecretSearchBucketKeyRequest, VaultSnapshotLookup};

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
pub(crate) use storage::indexed_db::SaveVaultBlobRequest;
#[cfg(test)]
pub(crate) use storage::indexed_db::SaveWrappedDeviceIdentityRequest;
pub(crate) use storage::indexed_db::{
    IdbPutStringRequest, ImportVaultBlobRequest, SaveSecretSearchCatalogBucketsRequest,
    SetLocalVaultLabelRequest,
};

pub(crate) use storage::indexed_db::{IndexedDbUpdate, StoredStringRecord};

pub(crate) use conversion::BrowserTimestamp;
pub use types::TypedBoundaryError;
pub(crate) use types::{TypedInput, TypedOutput};

pub(crate) use conversion::{
    LoadedVaultUnlockRequest, SyncResultSessionRequest, VaultMemberProjectionRequest,
};

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
pub(crate) use storage::event_db::EventDbRemoveEventFixture;
pub(crate) use storage::event_db::{
    EventDbAppendOutboxIndex, EventDbQueueOutboxEntry, EventDbRemoveOutboxEntry,
    EventDbSaveEventBytes, EventDbSaveHeads, EventDbSaveKeyEpoch,
};

#[cfg(test)]
pub(crate) use storage::identity_record::IdentityDbSaveNewProtectedLocalIdentity;
pub(crate) use storage::identity_record::{
    IdentityDbEnsureLocalIdentityForAppKey, IdentityDbEnsureLocalIdentityInDirectory,
    IdentityDbGenerateVaultDekForIdentity, IdentityDbLocalKeyringEntryForAppIdFromStore,
    IdentityDbSaveProtectedLocalIdentity, IdentityDbSetIdentityMemberSigningPublicKey,
    IdentityDbWriteIdentityDirectory,
};

pub(crate) use storage::identity_record::{
    KeyringDbKeyringDeleteKey, KeyringDbKeyringReadString, KeyringDbLoadKeyringForStore,
    KeyringDbValidateKeyringDirectoryBinding, KeyringDbWriteKeyring,
};

pub(crate) use storage::indexed_db::{
    SentinelDbLoadSentinelGenesisShareDelivery, SentinelDbSaveSentinelGenesisShareDelivery,
};

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
pub(crate) use storage::auth_providers::ProviderDbWriteSnapshotAt;
pub(crate) use storage::auth_providers::{
    AuthProviderDatabase, ProviderDbReadRawSnapshotFromStore,
};

pub use passkey_browser::{BrowserCredentialCreationOptions, BrowserCredentialRequestOptions};
pub(crate) use passkey_browser::{
    BrowserPasskeyClient, BrowserPasskeyCreationOptions, BrowserPasskeyGetOptionalArray,
    BrowserPasskeyGetOptionalObject, BrowserPasskeyGetRequiredObject,
    BrowserPasskeyPasskeyLabelWithDeviceId, BrowserPasskeyPrfOutput, BrowserPasskeyRequestOptions,
    BrowserPasskeySignalCurrentUserDetails,
};

pub(crate) use passkey_observation::BrowserPasskeyObservation;

pub(crate) use storage::github::{
    GitHubStorageClient, GitHubStorageClientFetchGithubVault,
    GitHubStorageClientWriteGithubTextFile,
};

pub(crate) use storage::drive::DriveStorageClient;

pub(crate) use storage::drive_shared::DriveStorageClientShareFolderWithEmail;

pub(crate) use storage::extension_state::{
    ExtensionPairingDatabase, ExtensionPairingReconciliation,
};

pub(crate) use logger::LoggerState;

pub use application::ConfiguredVaultApplication;

pub(crate) use storage::session::VaultSessionLock;

pub(crate) use identity_record::BrowserSelectedVaultContextKind;

pub(crate) use device_access::{
    BrowserDeviceAccessSnapshotForSessionWithProtected, BrowserDeviceVaultAccessForIdentity,
};

pub(crate) use passkey_browser::PasskeyPrfRequirement;
