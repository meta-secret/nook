//! Portable auth-companion heuristics and vault host/OAuth origin policy.
//!
//! Kept free of vault crypto and sync so a tiny companion WASM package can link
//! this crate without the full `nook-core` graph.

#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![allow(
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::uninlined_format_args
)]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_raw_numeric_api_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(raw_numeric_public_api))]

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
mod companion_pairing;
mod companion_protocol;
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
};
pub use authentication_workflow::{
    AuthenticationAdvanceControlEvidence, AuthenticationApprovalRequirement,
    AuthenticationAuthenticatorObservationFacts, AuthenticationAuthenticatorSetupObservation,
    AuthenticationBackupCodesObservation, AuthenticationCeremonyContextObservation,
    AuthenticationCeremonyObservationFacts, AuthenticationCredentialSubmissionFacts,
    AuthenticationCredentialSubmissionObservation, AuthenticationDetailedAdvanceControlObservation,
    AuthenticationDetailedPasskeyControlCandidateObservation,
    AuthenticationDetailedPasskeyControlObservation, AuthenticationDisclosureControlDecision,
    AuthenticationDisclosureObservationSchemaVersion, AuthenticationEnrollmentEvidence,
    AuthenticationFieldObservationFacts, AuthenticationFormObservationPriority,
    AuthenticationImplicitSubmitActuationObservation, AuthenticationManualCheckpoint,
    AuthenticationObservationBindingError, AuthenticationObservationBindingToken,
    AuthenticationOneTimeCodeProgressionEvidence, AuthenticationPageObservation,
    AuthenticationPageObservationFacts, AuthenticationPageObservationFactsBatch,
    AuthenticationPageObservations, AuthenticationPasskeyAccountAvailability,
    AuthenticationPasskeyControlObservation, AuthenticationPasskeyEvidence,
    AuthenticationPilotPresentationCapability, AuthenticationSavedLoginCapability,
    AuthenticationWorkflowAction, AuthenticationWorkflowKind, AuthenticationWorkflowMatch,
    AuthenticationWorkflowSnapshot, AuthenticationWorkflowSnapshotError,
    AuthenticationWorkflowStage, CurrentAuthenticationDisclosureControlRequest,
    MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT, MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS,
    VersionedAuthenticationDisclosureControlObservation,
};
pub use authentication_workflow_response::{
    AuthenticationWorkflowRuntimeResponse, AuthenticationWorkflowRuntimeResponseDecodeError,
    AuthenticationWorkflowRuntimeResponseWire, AuthenticationWorkflowSnapshotResponse,
    AuthenticationWorkflowSnapshotResponseDecodeError, AuthenticationWorkflowSnapshotResponseKind,
    AuthenticationWorkflowSnapshotResponseWire, AuthenticationWorkflowSnapshotWire,
    WebsiteLoginMatchAvailability, WebsiteLoginMatchAvailabilityKind,
    WebsiteLoginMatchAvailabilityWire, WebsiteLoginMatchAvailabilityWithCountWire,
    WebsiteLoginMatchAvailabilityWithoutCountWire,
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

pub use companion_pairing::{
    AdmittedCompanionPairingApproval, AuthorizedCompanionPairingApproval,
    AuthorizedCompanionWebsitePairing, CompanionExtensionPairingEndpoint, CompanionPairingApproval,
    CompanionPairingApprovalAttempt, CompanionPairingEpochMilliseconds, CompanionPairingError,
    CompanionPairingFailure, CompanionPairingInstallation, CompanionPairingIssue,
    CompanionPairingProviderManifestDigest, CompanionPairingRequest,
    CompanionPairingRequestObservation, CompanionPairingWebsiteAuthorization,
    CompanionPairingWebsiteAuthorizationOutcome, CompanionWebsitePairingEndpoint,
    ConsumedCompanionPairingAuthority,
};
pub use companion_protocol::{
    AuthorizedCompanionIdentityHandoff, CompanionAdmittedIdentityDiscovery,
    CompanionEpochMilliseconds, CompanionExtensionHandoffEndpoint, CompanionExtensionPresence,
    CompanionExtensionProtocol, CompanionHandoffResponseAdmission,
    CompanionIdentityDiscoveryObservation, CompanionIdentityDiscoveryRequest,
    CompanionIdentityHandoffAuthorization, CompanionIdentityHandoffContext,
    CompanionIdentityHandoffRequest, CompanionIdentityHandoffResponse,
    CompanionIdentityHandoffSealer, CompanionIdentityStatus, CompanionIdentityStatusAdmission,
    CompanionIdentityStatusAdmissionRequest, CompanionIdentityUnlockRequest,
    CompanionInstallationAppKey, CompanionProtocolError, CompanionProtocolFailure,
    CompanionUnlockedAppKey, CompanionWebsiteHandoffBegin,
};
pub use domain_numbers::{
    AuthenticationFieldCount, AuthenticationOutcomeElapsedMilliseconds,
    AuthenticationOutcomeTimeoutMilliseconds, AuthenticationPasskeyAccountCount,
    AuthenticationSavedLoginAccountCount, AuthenticationSemanticSubmitControlCount,
    AuthenticationWorkflowCurrentStep, AuthenticationWorkflowObservationIndex,
    AuthenticationWorkflowTotalSteps, ExtensionEventCount, ExtensionSyncProviderCount,
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
};
pub use extension_session_status_response::{
    ExtensionSessionDeviceProtectionStatusWire, ExtensionSessionDeviceWire,
    ExtensionSessionStatusAvailability, ExtensionSessionStatusResponseWire,
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
    DEFAULT_OUTCOME_EVIDENCE_TIMEOUT_MS,
};
pub use page_field_classification::{
    AuthenticationAdvanceControlDecision, AuthenticationAdvanceControlObservation,
    AuthenticationUsernameEvidence, PageControlActionability, PageControlOwnership,
    PageControlSemantics, PageControlSubmissionDestinationSource, PageControlSubmissionMethod,
};
pub use page_field_classification::{
    CanonicalControlDestination, ControlDestinationEvidence, LoginContextObservation,
    MAX_AUTHENTICATION_CONTROL_TEXT_BYTES, PageInputFieldObservation, PageInputType,
};
pub use vault_host_policy::{DEFAULT_SIMPLE_VAULT_URL, VaultHostPolicyError};
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
pub use website_passkey_proposal::{WebsitePasskeyEvidence, WebsitePasskeyProposal};

pub use page_field_classification::AuthenticationControlText;

pub use page_field_classification::{
    AuthenticationRouteActuation, AuthenticationRouteEvidence, AutocompleteTokenQuery,
    CredentialUpdateRouteEvidence, OneTimeCodeRouteEvidence,
};

pub use page_field_classification::PasskeyControlMarking;

pub use authentication_workflow::{
    AuthenticationBackupCodesEvidence, AuthenticationEnrollmentObservation,
};

pub use backup_code_candidates::BackupCodePageText;

pub use vault_host_policy::{VaultHostObservation, VaultHostPolicy};
