//! Typed browser and WASM adapter for the Nook Rust core.
//! Browser lifecycle glue stays behind typed exports while domain policy remains in core.

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

#[doc(hidden)]
pub use wasm_bindgen_futures as __wasm_bindgen_futures;

pub use device_access::*;
pub use identity_record::{
    NookIdentityDirectorySelectionKind, NookIdentityDirectorySnapshot, NookIdentitySnapshot,
    NookIdentitySnapshotKind, NookIdentitySnapshotLoad, load_identity_directory_snapshot,
    load_identity_snapshot, select_identity,
};
pub use logger::NookLogEntries;
pub use manager::{
    NookEventLogRecords, NookEventLogStorageRecord, NookExtensionEventLogImportStatus,
    NookExtensionIdentityHandoffContext, NookExternalEventLogRecords, NookVaultManager,
    NookVaultNameState,
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
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
#[must_use]
pub fn extension_vault_access_scope() -> nook_companion_core::ExtensionConnectScope {
    nook_companion_core::ExtensionConnectScope::VaultAccess
}

#[wasm_bindgen]
#[must_use]
pub fn extension_password_filling_scope() -> nook_companion_core::ExtensionConnectScope {
    nook_companion_core::ExtensionConnectScope::PasswordFilling
}

#[wasm_bindgen]
#[must_use]
pub fn extension_passkey_management_scope() -> nook_companion_core::ExtensionConnectScope {
    nook_companion_core::ExtensionConnectScope::PasskeyManagement
}

#[wasm_bindgen]
#[must_use]
pub fn extension_sync_provider_credentials_scope() -> nook_companion_core::ExtensionConnectScope {
    nook_companion_core::ExtensionConnectScope::SyncProviderCredentials
}

#[wasm_bindgen]
#[must_use]
pub fn is_extension_connect_scope(value: &str) -> bool {
    nook_companion_core::ExtensionConnectScope::parse(value).is_some()
}

#[wasm_bindgen]
#[must_use]
pub fn sentinel_genesis_phase_translation_key(phase: nook_core::SentinelGenesisPhase) -> String {
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

mod public_api;
mod secret_api;
mod vault_api;

pub use public_api::*;
pub use secret_api::*;
pub use vault_api::*;
