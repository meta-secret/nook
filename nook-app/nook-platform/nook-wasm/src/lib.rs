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
mod application;
mod conversion;
mod device_access;
mod error_mapping;
mod identity_record;
mod logger;
mod manager;
mod passkey_browser;
mod passkey_observation;
mod storage;
mod sync_io;
mod types;

pub use device_access::*;
pub use identity_record::{
    NookIdentityDirectorySelectionKind, NookIdentityDirectorySnapshot,
    NookIdentityDirectorySnapshotRequest, NookIdentitySnapshot, NookIdentitySnapshotKind,
    NookIdentitySnapshotLoad, load_identity_directory_snapshot, load_identity_snapshot,
    select_identity,
};
pub use logger::{NookLogEntries, log_count, log_dump_page};
pub use manager::{
    NookAdoptedExtensionIdentityHandoff, NookCommittedExtensionIdentityHandoff,
    NookCompanionExtensionEndpoint, NookCompanionPairingApprovalAuthority,
    NookCompanionPairingCandidateFailure, NookCompanionPairingCandidateOutcome,
    NookCompanionPairingCandidateOutcomeState, NookCompanionPairingExtensionEndpoint,
    NookDiscoveredCompanionExtensionEndpoint, NookEventLogRecords, NookEventLogStorageRecord,
    NookExtensionEventLogImportStatus, NookExtensionIdentityHandoffContext,
    NookExternalEventLogRecords, NookPendingCompanionIdentityHandoff,
    NookPendingExtensionIdentityHandoff, NookPreparedCompanionPairingActivation,
    NookPrevalidatedCompanionPairingApproval, NookStoredCompanionPairingActivationCandidate,
    NookVaultManager, NookVaultNameState, admit_companion_handoff_response,
    admit_companion_identity_status,
};
pub use storage::indexed_db::DeviceProtectionDeviceModeState;
pub use storage::local_folder::NookLocalFolderConfig;
pub use types::{
    NookAuthenticationOutcomeObservation, NookAuthenticationOutcomeVerdict,
    NookAuthenticationPageObservation, NookAuthenticationPageObservations,
    NookAuthenticationWorkflowMatch, NookAuthenticationWorkflowMatchState,
    NookAuthenticationWorkflowSnapshot, NookBrowserLocale, NookClientRunMode,
    NookClientRunModeUtil, NookDecryptedEnrollmentPayload, NookDiagnosticEpochState,
    NookEnrollmentIssueInput, NookEnrollmentProvider, NookEventLogSyncIssue, NookGoogleDriveFolder,
    NookImportResult, NookJoinRequest, NookLocalFolderHealth, NookLocalFolderHealthState,
    NookLoginAccount, NookLoginFillCredential, NookManualProviderSync, NookManualProviderSyncState,
    NookOtpauthPreview, NookPasskeyAccount, NookPasskeyAssertion, NookPasskeyRegistration,
    NookPasskeySetup, NookPasskeyUnlockOptions, NookPasswordEntrySummary, NookPendingSyncConflict,
    NookProviderReplicationCapability, NookReplacementCandidate, NookReplacementConflict,
    NookRuntimeConfig, NookSecretFormFields, NookSecretPage, NookSecurityConflict,
    NookSentinelGenesisDelivery, NookSentinelGenesisFinalizeResult,
    NookSentinelGenesisParticipantStatus, NookSentinelGenesisStatus,
    NookSentinelStoredDeliverySummary, NookSentinelUnlockSessionStatus, NookStorageConnectArgs,
    NookSyncConflictReview, NookSyncConflictReviewState, NookTotpCode, NookVaultAccessReport,
    NookVaultArchitecture, NookVaultClientPolicy, NookVaultEpochHistoryDiagnostic,
    NookVaultEventAccessDiagnostic, NookVaultLastSync, NookVaultLastSyncState, NookVaultMember,
    NookVaultSecretAccessDiagnostic, NookVaultSecurityRecommendations, NookVaultSyncResult,
    NookWebsiteLoginSaveDecision, NookWebsiteLoginSavePlan,
};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn extension_vault_access_scope() -> nook_companion_core::ExtensionConnectScope {
    ExtensionConnectScope::VaultAccess
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn extension_password_filling_scope() -> nook_companion_core::ExtensionConnectScope {
    ExtensionConnectScope::PasswordFilling
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn extension_passkey_management_scope() -> nook_companion_core::ExtensionConnectScope {
    ExtensionConnectScope::PasskeyManagement
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn extension_sync_provider_credentials_scope() -> nook_companion_core::ExtensionConnectScope {
    ExtensionConnectScope::SyncProviderCredentials
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn is_extension_connect_scope(value: &str) -> bool {
    ExtensionConnectScope::parse(value).is_ok()
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn companion_pairing_provider_manifest_digest(
    snapshot: nook_core::AuthProvidersSnapshotData,
) -> Result<String, JsError> {
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
    #[error("IndexedDB error: {0}")]
    IndexedDb(String),

    #[error("GitHub error: {0}")]
    GitHub(String),

    #[error("Drive error: {0}")]
    Drive(String),

    #[error("iCloud error: {0}")]
    ICloud(String),

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
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::*;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    fn extension_scopes_and_sentinel_translation_are_typed() {
        assert_eq!(
            extension_vault_access_scope(),
            ExtensionConnectScope::VaultAccess
        );
        assert_eq!(
            extension_password_filling_scope(),
            ExtensionConnectScope::PasswordFilling
        );
        assert_eq!(
            extension_passkey_management_scope(),
            ExtensionConnectScope::PasskeyManagement
        );
        assert_eq!(
            extension_sync_provider_credentials_scope(),
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
        let phase = nook_core::SentinelGenesisPhase::Inactive;
        assert_eq!(
            sentinel_genesis_phase_translation_key(phase),
            phase.translation_key()
        );
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

#[cfg(test)]
pub(crate) use storage::indexed_db::SaveVaultBlobRequest;
#[cfg(test)]
pub(crate) use storage::indexed_db::SaveWrappedDeviceIdentityRequest;
pub(crate) use storage::indexed_db::{
    IdbPutStringRequest, ImportVaultBlobRequest, ReadStringPreferringRequest,
    SaveSecretSearchCatalogBucketsRequest, SetLocalVaultLabelRequest,
};

pub(crate) use storage::indexed_db::{
    IndexedDbFallbackUpdate, IndexedDbMigration, IndexedDbUpdate, StoredStringRecord,
    StringRecordFallback,
};

pub(crate) use conversion::BrowserTimestamp;

pub(crate) use conversion::{
    LoadedVaultUnlockRequest, SyncResultSessionRequest, VaultMemberProjectionRequest,
};

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
pub(crate) use storage::event_db::EventDbRemoveEventFixture;
#[cfg(test)]
pub(crate) use storage::event_db::EventDbSaveEventBytesToStore;
pub(crate) use storage::event_db::{
    EventDbAppendOutboxIndex, EventDbLoadLocalEventStoreFromStore, EventDbQueueOutboxEntry,
    EventDbRemoveOutboxEntry, EventDbSaveEventBytes, EventDbSaveHeads, EventDbSaveKeyEpoch,
};

pub(crate) use storage::identity_record::{
    IdentityDbEnsureLocalIdentityForAppKey, IdentityDbEnsureLocalIdentityInDirectory,
    IdentityDbGenerateVaultDekForIdentity, IdentityDbLocalKeyringEntryForAppIdFromStore,
    IdentityDbMigrateDirectory, IdentityDbMigrateDirectoryInStore, IdentityDbPersistPendingGenesis,
    IdentityDbSaveNewProtectedLocalIdentity, IdentityDbSaveProtectedLocalIdentity,
    IdentityDbSetIdentityMemberSigningPublicKey, IdentityDbValidateVaultIdentityEnrollment,
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
    AuthProviderDatabase, ProviderDbLegacySnapshotBelongsToIdentity,
    ProviderDbReadRawSnapshotFromStore,
};

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

pub(crate) use application::ConfiguredVaultApplication;

pub(crate) use storage::session::VaultSessionLock;

pub(crate) use identity_record::{
    BrowserProviderVaultIdentityObservations,
    BrowserProviderVaultIdentityObservationsFromProjection, BrowserSelectedVaultContextKind,
};

pub(crate) use device_access::{
    BrowserDeviceAccessSnapshotForSessionWithProtected, BrowserDeviceVaultAccessForIdentity,
};

pub(crate) use passkey_browser::PasskeyPrfRequirement;
