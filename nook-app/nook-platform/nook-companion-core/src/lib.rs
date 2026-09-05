//! Portable auth-companion heuristics and vault host/OAuth origin policy.
//!
//! Kept free of vault crypto and sync so a tiny companion WASM package can link
//! this crate without the full `nook-core` graph.

#![allow(
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::uninlined_format_args
)]

mod account_picker_authorization;
mod authentication_outcome_response;
mod authentication_workflow;
mod authentication_workflow_response;
mod authenticator_backup_attach_response;
mod authenticator_code_response;
mod authenticator_enrollment_response;
mod authenticator_options_response;
mod authenticator_picker_open_response;
mod authenticator_preview_response;
mod backup_code_candidates;
pub mod credential_fill;
mod domain_numbers;
mod extension_pairing_state;
mod extension_persistence;
mod extension_session_protocol;
mod extension_session_status_response;
mod extension_vault_event;
mod generated_password_response;
mod oauth_origin_policy;
mod outcome_evidence;
mod page_field_classification;
mod vault_host_policy;
mod website_login_options_response;
mod website_login_save_offer_response;
mod website_passkey_account_list;
mod website_passkey_proposal;

pub use account_picker_authorization::{
    AccountPickerAuthorizationLifecycle, AccountPickerAuthorizationTransition, CleanupEvidence,
    CleanupTransitionError, CleanupTransitionOutcome,
};
pub use authentication_outcome_response::{
    AuthenticationOutcomeResponse, AuthenticationOutcomeResponseDecodeError,
    AuthenticationOutcomeResponseKind, AuthenticationOutcomeResponseWire,
    decode_authentication_outcome_response,
};
pub use authentication_workflow::{
    AuthenticationAdvanceControlEvidence, AuthenticationApprovalRequirement,
    AuthenticationAuthenticatorObservationFacts, AuthenticationAuthenticatorSetupObservation,
    AuthenticationBackupCodesObservation, AuthenticationCeremonyContextObservation,
    AuthenticationCeremonyObservationFacts, AuthenticationCredentialSubmissionFacts,
    AuthenticationCredentialSubmissionObservation, AuthenticationDetailedAdvanceControlObservation,
    AuthenticationDetailedPasskeyControlCandidateObservation,
    AuthenticationDetailedPasskeyControlObservation, AuthenticationEnrollmentEvidence,
    AuthenticationFieldObservationFacts, AuthenticationFormObservationPriority,
    AuthenticationManualCheckpoint, AuthenticationObservationBindingError,
    AuthenticationObservationBindingToken, AuthenticationOneTimeCodeProgressionEvidence,
    AuthenticationPageObservation, AuthenticationPageObservationFacts,
    AuthenticationPageObservationFactsBatch, AuthenticationPageObservations,
    AuthenticationPasskeyAccountAvailability, AuthenticationPasskeyControlObservation,
    AuthenticationPasskeyEvidence, AuthenticationPilotPresentationCapability,
    AuthenticationSavedLoginCapability, AuthenticationWorkflowAction, AuthenticationWorkflowKind,
    AuthenticationWorkflowMatch, AuthenticationWorkflowSnapshot,
    AuthenticationWorkflowSnapshotError, AuthenticationWorkflowStage,
    MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT, MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS,
    authentication_enrollment_workflow_match, authentication_form_observation_priority,
    authentication_page_observation_facts_match_binding,
    authentication_page_observation_facts_priority, authentication_page_observations_are_valid,
    authentication_passkey_control_candidate_is_safe,
    authentication_passkey_control_evidence_is_safe, bind_authentication_page_observation_facts,
    classify_authentication_backup_codes_observation, classify_authentication_workflow,
    classify_authentication_workflow_candidates,
};
pub use authentication_workflow_response::{
    AuthenticationWorkflowRuntimeResponse, AuthenticationWorkflowRuntimeResponseDecodeError,
    AuthenticationWorkflowRuntimeResponseWire, AuthenticationWorkflowSnapshotResponse,
    AuthenticationWorkflowSnapshotResponseDecodeError, AuthenticationWorkflowSnapshotResponseKind,
    AuthenticationWorkflowSnapshotResponseWire, AuthenticationWorkflowSnapshotWire,
    WebsiteLoginMatchAvailability, WebsiteLoginMatchAvailabilityKind,
    WebsiteLoginMatchAvailabilityWire, WebsiteLoginMatchAvailabilityWithCountWire,
    WebsiteLoginMatchAvailabilityWithoutCountWire, decode_authentication_workflow_runtime_response,
    decode_authentication_workflow_snapshot_response,
};
pub use authenticator_backup_attach_response::{
    AuthenticatorBackupAttachResponse, AuthenticatorBackupAttachResponseDecodeError,
    AuthenticatorBackupAttachResponseKind, AuthenticatorBackupAttachResponseWire,
};
pub use authenticator_code_response::{
    AuthenticatorCodeExpiryEpochMilliseconds, AuthenticatorCodeResponse,
    AuthenticatorCodeResponseDecodeError, AuthenticatorCodeResponseKind,
    AuthenticatorCodeResponseWire,
};
pub use authenticator_enrollment_response::{
    AuthenticatorEnrollmentConfirmResponse, AuthenticatorEnrollmentConfirmResponseKind,
    AuthenticatorEnrollmentConfirmResponseWire, AuthenticatorEnrollmentResponseDecodeError,
    AuthenticatorEnrollmentStageResponse, AuthenticatorEnrollmentStageResponseKind,
    AuthenticatorEnrollmentStageResponseWire,
};
pub use authenticator_options_response::{
    AuthenticatorOptionsResponse, AuthenticatorOptionsResponseDecodeError,
    AuthenticatorOptionsResponseKind, AuthenticatorOptionsResponseWire, WebsiteAuthenticatorOption,
};
pub use authenticator_picker_open_response::{
    AuthenticatorPickerOpenResponse, AuthenticatorPickerOpenResponseDecodeError,
    AuthenticatorPickerOpenResponseKind, AuthenticatorPickerOpenResponseWire,
};
pub use authenticator_preview_response::{
    AuthenticatorEnrollmentPreview, AuthenticatorPreviewResponse,
    AuthenticatorPreviewResponseDecodeError, AuthenticatorPreviewResponseKind,
    AuthenticatorPreviewResponseWire,
};
pub use backup_code_candidates::{
    contains_backup_code_candidate, extract_backup_code_candidates, page_has_backup_code_hint,
};
pub use domain_numbers::{
    AuthenticationOutcomeElapsedMilliseconds, AuthenticationOutcomeTimeoutMilliseconds,
};
pub use extension_pairing_state::{
    ActiveExtensionVault, AuthorizedExtensionGrant, CreateExtensionPairingStateInput,
    EXTENSION_GRANT_KEY_PREFIX, EXTENSION_SETUP_KEY, ExtensionActiveVaultScope,
    ExtensionConnectScope, ExtensionGrantAuthority, ExtensionGrantAuthorityRequest,
    ExtensionPairingEntry, ExtensionPairingGrantApproval, ExtensionPairingGrantRemovalInput,
    ExtensionPairingRecord, ExtensionPairingState, ExtensionPairingStateError,
    ExtensionPairingVaultType, ExtensionReadySetup, ExtensionReadySetupStatus,
    ExtensionSetupAfterRemoval, GrantAuthorityResponseError, GrantAuthorityResponseJson,
    ImportedExtensionEventLog, PairingStorageJson, PairingVaultId,
    RefreshExtensionPairingGrantInput, SelectedExtensionPairingGrant, StoredExtensionPairingGrant,
};
pub use extension_persistence::{
    ExtensionPersistenceArea, ExtensionPersistenceDatabaseState, ExtensionPersistenceObservation,
    ExtensionPersistenceStoreState,
};
pub use extension_session_protocol::{
    ExtensionSessionRequestValidation, ExtensionSessionRequestWire, LoginPickerOpenResponse,
    LoginPickerOpenResponseDecodeError, LoginPickerOpenResponseWire,
    decode_login_picker_open_response, validate_extension_session_request_json,
};
pub use extension_session_status_response::{
    ExtensionSessionDeviceProtectionStatusWire, ExtensionSessionDeviceWire,
    ExtensionSessionStatusAvailability, ExtensionSessionStatusResponseWire,
    decode_extension_session_status_response,
};
pub use extension_vault_event::{EXTENSION_VAULT_EVENT_TYPESCRIPT, ExtensionVaultEventPayload};
pub use generated_password_response::{
    GeneratedPasswordResponse, GeneratedPasswordResponseDecodeError, GeneratedPasswordResponseKind,
    GeneratedPasswordResponseWire,
};
pub use oauth_origin_policy::{
    BrowserOAuthProvider, OAuthOriginSupport, OAuthOriginUnsupportedReason,
};
pub use outcome_evidence::{
    AuthenticationOutcomeClassification, AuthenticationOutcomeDecision,
    AuthenticationOutcomeObservation, AuthenticationOutcomeVerdict,
    DEFAULT_OUTCOME_EVIDENCE_TIMEOUT_MS, classify_authentication_outcome,
};
pub use page_field_classification::{
    AuthenticationAdvanceControlDecision, AuthenticationAdvanceControlObservation,
    AuthenticationUsernameEvidence, PageControlActionability, PageControlOwnership,
    PageControlSemantics, PageControlSubmissionMethod, authentication_advance_control_is_safe,
    authentication_username_evidence, strongest_authentication_username_evidence,
};
pub use page_field_classification::{
    CanonicalControlDestination, LoginContextObservation, MAX_AUTHENTICATION_CONTROL_TEXT_BYTES,
    PageInputFieldObservation, PageInputType, can_activate_authentication_route_control,
    canonicalize_control_destination, expand_identity_text, has_login_context,
    has_safe_authentication_route_identity, looks_like_email_verification_body,
    looks_like_login_advance_control_label, looks_like_manual_checkpoint_label,
    looks_like_non_authentication_submit_control_label,
    looks_like_one_time_code_auto_submit_signal, looks_like_one_time_code_field,
    looks_like_passkey_control_label, looks_like_passkey_enrollment_or_management_label,
    looks_like_username_field,
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
    WebsiteLoginOptionsWireValue,
};
pub use website_login_save_offer_response::{
    WebsiteLoginSaveActionResponse, WebsiteLoginSaveOfferResponse,
    WebsiteLoginSaveOfferResponseDecodeError, WebsiteLoginSavePendingResponse,
};
pub use website_passkey_account_list::{
    WebsitePasskeyAccount, WebsitePasskeyAccountList, WebsitePasskeyAccountListKind,
    WebsitePasskeyAccountListWire,
};
pub use website_passkey_proposal::{WebsitePasskeyProposal, propose_website_passkey};
