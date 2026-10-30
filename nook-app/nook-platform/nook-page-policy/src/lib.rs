//! Portable page observations, authentication workflow, and form-fill policy.
//! Browser hosts supply page facts; vault access and extension pairing remain separate.

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

mod authentication_navigation_path;
mod authentication_workflow;
mod authentication_workflow_response;
mod backup_code_candidates;
pub mod credential_fill;
mod domain_numbers;
mod login_save;
mod outcome_evidence;
mod page_field_classification;
pub mod personal_field_classification;
mod recovery_code_language;
mod website_passkey_proposal;

pub use authentication_navigation_path::{
    AuthenticationNavigationPath, AuthenticationNavigationPathObservation,
    AuthenticationNavigationPathProjection, AuthenticationNavigationPathRequest,
    AuthenticationOutcomePathname, AuthenticationOutcomePathnameError,
};
pub use authentication_workflow::{
    ApprovedAuthenticationWorkflowDecision, ApprovedAuthenticationWorkflowRevalidation,
};
pub use authentication_workflow::{
    AuthenticationAdvanceControlEvidence, AuthenticationApprovalRequirement,
    AuthenticationAuthenticatorObservationFacts, AuthenticationAuthenticatorSetupBatch,
    AuthenticationAuthenticatorSetupBatchError, AuthenticationAuthenticatorSetupCopy,
    AuthenticationAuthenticatorSetupCopyError, AuthenticationAuthenticatorSetupEvidence,
    AuthenticationAuthenticatorSetupObservation, AuthenticationBackupCodesObservation,
    AuthenticationCeremonyContextObservation, AuthenticationCeremonyObservationFacts,
    AuthenticationCredentialSubmissionFacts, AuthenticationCredentialSubmissionObservation,
    AuthenticationDetailedAdvanceControlObservation,
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
    AuthenticationPilotPresentationCapability, AuthenticationQrMediaObservation,
    AuthenticationSavedLoginCapability, AuthenticationWorkflowAction, AuthenticationWorkflowKind,
    AuthenticationWorkflowMatch, AuthenticationWorkflowSnapshot,
    AuthenticationWorkflowSnapshotError, AuthenticationWorkflowStage,
    CurrentAuthenticationDisclosureControlRequest, MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT,
    MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS, VersionedAuthenticationDisclosureControlObservation,
};
pub use authentication_workflow::{
    AuthenticationBackupCodesEvidence, AuthenticationEnrollmentObservation,
};
pub use authentication_workflow::{
    AuthenticationDisplayProgress, AuthenticationLoginChecklistActivity,
    AuthenticationLoginChecklistMessageKey, AuthenticationLoginChecklistObservation,
    AuthenticationLoginChecklistOutcomePolling, AuthenticationLoginChecklistPresentation,
    AuthenticationLoginChecklistProjection, AuthenticationLoginChecklistResult,
    AuthenticationLoginChecklistRow, AuthenticationLoginChecklistRowState,
    AuthenticationLoginChecklistState, AuthenticationLoginChecklistStatus,
    AuthenticationLoginChecklistStep, AuthenticationWorkflowActivity,
    AuthenticationWorkflowProgress, AuthenticatorEnrollmentProgress,
    PasswordWorkflowActivityEvidence, PasswordWorkflowActivityPresentation,
};
pub use authentication_workflow::{
    AuthenticationRecoveryCopyEvidence, AuthenticationRecoveryCopyRequest,
    AuthenticationWorkflowSnapshotTransport, AuthenticationWorkflowTransportAdmission,
    AuthenticationWorkflowTransportPayload, AuthenticationWorkflowTransportType,
};
pub use authentication_workflow_response::SavedLoginActionPresentationRequest;
pub use authentication_workflow_response::{
    AuthenticationWorkflowRoutingResponse, AuthenticationWorkflowRoutingResponseWire,
    AuthenticationWorkflowRuntimeResponse, AuthenticationWorkflowRuntimeResponseDecodeError,
    AuthenticationWorkflowRuntimeResponseWire, AuthenticationWorkflowSelectedFacts,
    AuthenticationWorkflowSelectedFactsWire, AuthenticationWorkflowSnapshotResponse,
    AuthenticationWorkflowSnapshotResponseDecodeError, AuthenticationWorkflowSnapshotResponseKind,
    AuthenticationWorkflowSnapshotResponseWire, AuthenticationWorkflowSnapshotWire,
    WebsiteLoginMatchAvailability, WebsiteLoginMatchAvailabilityKind,
    WebsiteLoginMatchAvailabilityWire, WebsiteLoginMatchAvailabilityWithCountWire,
    WebsiteLoginMatchAvailabilityWithoutCountWire,
};
pub use backup_code_candidates::{
    AuthenticationBackupCodeExtraction, AuthenticationBackupCodeExtractionRequest,
    AuthenticationBackupCodeText, AuthenticationBackupCodeTextError, BackupCodePageText,
};
pub use domain_numbers::{
    AuthenticationFieldCount, AuthenticationOutcomeElapsedMilliseconds,
    AuthenticationOutcomeTimeoutMilliseconds, AuthenticationPasskeyAccountCount,
    AuthenticationSavedLoginAccountCount, AuthenticationSemanticSubmitControlCount,
    AuthenticationWorkflowCurrentStep, AuthenticationWorkflowObservationIndex,
    AuthenticationWorkflowTotalSteps, CompanionEpochMilliseconds,
};
pub use login_save::*;
pub use outcome_evidence::{
    AuthenticationOutcomeClassification, AuthenticationOutcomeDecision,
    AuthenticationOutcomeObservation, AuthenticationOutcomeVerdict,
    DEFAULT_OUTCOME_EVIDENCE_TIMEOUT_MS,
};
pub use page_field_classification::AuthenticationContainerIdentity;
pub use page_field_classification::AuthenticationControlText;
pub use page_field_classification::AuthenticationControlTransportability;
pub use page_field_classification::PasskeyControlMarking;
pub use page_field_classification::{
    AuthenticationAdvanceControlDecision, AuthenticationAdvanceControlObservation,
    AuthenticationUsernameEvidence, PageControlActionability, PageControlOwnership,
    PageControlSemantics, PageControlSubmissionDestinationSource, PageControlSubmissionMethod,
};
pub use page_field_classification::{
    AuthenticationRouteActuation, AuthenticationRouteEvidence, AutocompleteTokenQuery,
    CredentialUpdateRouteEvidence, OneTimeCodeRouteEvidence,
};
pub use page_field_classification::{
    AuthenticationRouteControlPresence, AuthenticationRoutePasswordPresence,
    AuthenticationRouteScope, AuthenticationRouteUsernamePresence, PageLoginContext,
};
pub use page_field_classification::{
    CanonicalControlDestination, ControlDestinationEvidence, InvalidControlDestination,
    LoginContextObservation, MAX_AUTHENTICATION_CONTROL_TEXT_BYTES,
    MAX_AUTHENTICATION_DESTINATION_TEXT_BYTES, OneTimeCodeEntryEvidence, OneTimeCodeEntrySignals,
    PageInputCharacterLimit, PageInputFieldObservation, PageInputMaxLength, PageInputMode,
    PageInputPattern, PageInputType, PageSecondFactorRoute,
};
pub use personal_field_classification::{
    ClassifiedPersonalField, PersonalFieldClassification, PersonalFieldEvidence,
    PersonalFieldGroup, PersonalFieldKind, PersonalFillField, PersonalFillOpportunity,
    PersonalFillPlan, PersonalFillScope, PersonalFillUnavailability,
};
pub use recovery_code_language::BackupCodeCandidatePresence;
pub use website_passkey_proposal::{WebsitePasskeyEvidence, WebsitePasskeyProposal};
