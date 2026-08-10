//! Portable auth-companion heuristics and vault host/OAuth origin policy.
//!
//! Kept free of vault crypto and sync so a tiny companion WASM package can link
//! this crate without the full `nook-core` graph.

#![allow(
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::uninlined_format_args
)]

mod authentication_workflow;
mod authentication_workflow_response;
mod authenticator_backup_attach_response;
mod authenticator_options_response;
mod authenticator_preview_response;
mod backup_code_candidates;
mod extension_pairing_state;
mod extension_persistence;
mod extension_session_protocol;
mod oauth_origin_policy;
mod outcome_evidence;
mod page_field_classification;
mod vault_host_policy;
mod website_login_options_response;
mod website_passkey_proposal;

pub use authentication_workflow::{
    AuthenticationPageObservation, AuthenticationPageObservations, AuthenticationWorkflowAction,
    AuthenticationWorkflowKind, AuthenticationWorkflowMatch, AuthenticationWorkflowNotDetected,
    AuthenticationWorkflowSnapshot, AuthenticationWorkflowStage, classify_authentication_workflow,
    classify_authentication_workflow_candidates,
};
pub use authentication_workflow_response::{
    AuthenticationWorkflowSnapshotResponse, AuthenticationWorkflowSnapshotResponseDecodeError,
    AuthenticationWorkflowSnapshotResponseKind, AuthenticationWorkflowSnapshotResponseWire,
    decode_authentication_workflow_snapshot_response,
};
pub use authenticator_backup_attach_response::{
    AuthenticatorBackupAttachResponse, AuthenticatorBackupAttachResponseDecodeError,
    AuthenticatorBackupAttachResponseKind, AuthenticatorBackupAttachResponseWire,
    decode_authenticator_backup_attach_response,
};
pub use authenticator_options_response::{
    AuthenticatorOptionsResponse, AuthenticatorOptionsResponseDecodeError,
    AuthenticatorOptionsResponseKind, AuthenticatorOptionsResponseWire, WebsiteAuthenticatorOption,
    decode_authenticator_options_response,
};
pub use authenticator_preview_response::{
    AuthenticatorEnrollmentPreview, AuthenticatorPreviewResponse,
    AuthenticatorPreviewResponseDecodeError, AuthenticatorPreviewResponseKind,
    AuthenticatorPreviewResponseWire, decode_authenticator_preview_response,
};
pub use backup_code_candidates::{extract_backup_code_candidates, page_has_backup_code_hint};
pub use extension_pairing_state::{
    CreateExtensionPairingStateInput, EXTENSION_GRANT_KEY_PREFIX, EXTENSION_SETUP_KEY,
    ExtensionConnectScope, ExtensionPairingEntry, ExtensionPairingGrantApproval,
    ExtensionPairingGrantRemovalInput, ExtensionPairingRecord, ExtensionPairingState,
    ExtensionPairingStateError, ExtensionPairingVaultType, ExtensionReadySetup,
    ExtensionReadySetupStatus, ExtensionSetupAfterRemoval, ImportedExtensionEventLog,
    RefreshExtensionPairingGrantInput, SelectedExtensionPairingGrant, StoredExtensionPairingGrant,
    create_pairing_state, grant_storage_key, is_ready_pairing_setup_json,
    is_stored_pairing_grant_json, migrate_legacy_pairing_state_json, refresh_pairing_grant,
};
pub use extension_persistence::{
    ExtensionPersistenceArea, ExtensionPersistenceDatabaseState, ExtensionPersistenceObservation,
    ExtensionPersistenceStoreState, classify_extension_database_names,
    classify_extension_store_names, matching_extension_store_names,
};
pub use extension_session_protocol::{
    ExtensionSessionRequestValidation, ExtensionSessionRequestWire, LoginPickerOpenResponse,
    LoginPickerOpenResponseDecodeError, LoginPickerOpenResponseWire,
    decode_login_picker_open_response, validate_extension_session_request_json,
};
pub use oauth_origin_policy::{
    BrowserOAuthProvider, OAuthOriginSupport, OAuthOriginUnsupportedReason,
    is_cloudflare_pr_preview_host, resolve_oauth_origin_support,
};
pub use outcome_evidence::{
    AuthenticationOutcomeClassification, AuthenticationOutcomeDecision,
    AuthenticationOutcomeObservation, AuthenticationOutcomeVerdict,
    DEFAULT_OUTCOME_EVIDENCE_TIMEOUT_MS, classify_authentication_outcome,
};
pub use page_field_classification::{
    LoginContextObservation, PageInputFieldObservation, PageInputType, expand_identity_text,
    has_login_context, looks_like_email_verification_body, looks_like_manual_checkpoint_label,
    looks_like_one_time_code_field, looks_like_passkey_control_label, looks_like_username_field,
};
pub use vault_host_policy::{
    DEFAULT_SIMPLE_VAULT_URL, VaultHostPolicyError, belongs_to_sentinel_vault,
    belongs_to_simple_vault, is_nook_vault_app_url, is_sentinel_vault_hostname,
    is_simple_vault_hostname, matching_sentinel_vault_base_url,
    nook_vault_app_exclude_match_patterns, normalize_simple_vault_base_url,
    sentinel_vault_match_patterns, simple_vault_match_pattern, simple_vault_url,
};
pub use website_login_options_response::{
    WebsiteLoginAccountOption, WebsiteLoginOptions, WebsiteLoginOptionsDecodeError,
    WebsiteLoginOptionsWireValue, decode_website_login_options, decode_website_login_options_json,
};
pub use website_passkey_proposal::{WebsitePasskeyProposal, propose_website_passkey};
