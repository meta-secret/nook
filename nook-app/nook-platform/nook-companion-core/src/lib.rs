//! Portable extension pairing, session protocol, and vault host/OAuth origin policy.
//!
//! Page observations and authentication workflows belong to `nook-page-policy`.
//! Vault-key and signed-event semantics remain in their authentication/event owners.

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
mod authenticator_backup_attach_response;
mod authenticator_code_response;
mod authenticator_enrollment_response;
mod authenticator_options_response;
mod authenticator_picker_open_response;
mod authenticator_preview_response;
mod browser_tab_target;
mod companion_pairing;
mod domain_numbers;
mod extension_consent;
mod extension_pairing_state;
mod extension_persistence;
mod extension_session_protocol;
mod extension_session_status_response;
mod extension_vault_event;
mod generated_password_response;
mod oauth_origin_policy;
pub mod site_secret_listing;
mod vault_host_policy;
mod website_login_options_response;
mod website_login_save_offer_response;
mod website_passkey_account_list;

pub use nook_auth2::StoreId;

pub use site_secret_listing::{
    SitePageNeed, SiteSecretAccount, SiteSecretAction, SiteSecretActionLabels, SiteSecretEmptyHint,
    SiteSecretIdentity, SiteSecretIdentityDevice, SiteSecretIdentityHeader, SiteSecretIdentityName,
    SiteSecretItem, SiteSecretItemId, SiteSecretKind, SiteSecretListing, SiteSecretListingRequest,
    SiteSecretListingSummary, SiteSecretMatches, SiteSecretMessageKey, SiteSecretRow,
    SiteSecretSavedHost, SiteSecretSection, SiteSecretSectionContent, SiteSecretTitle,
    SiteSecretVault, SiteSecretVaultLabel, SiteSecretVaultName, SiteSecretVaults,
};

pub use account_picker_authorization::{
    AccountPickerAuthorizationLifecycle, AccountPickerAuthorizationTransition, CleanupEvidence,
    CleanupTransitionError, CleanupTransitionOutcome,
};
pub use authentication_outcome_response::{
    AuthenticationOutcomeResponse, AuthenticationOutcomeResponseDecodeError,
    AuthenticationOutcomeResponseKind, AuthenticationOutcomeResponseWire,
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
pub use browser_tab_target::{
    BrowserTabTarget, BrowserTabUrl, BrowserTabUrlObservation, WebTabDisplayHost, WebTabOrigin,
    WebTabTarget,
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
pub use domain_numbers::{ExtensionEventCount, ExtensionSyncProviderCount};
pub use extension_consent::{
    ExtensionConsentApprovalAvailability, ExtensionConsentEvent, ExtensionConsentObservation,
    ExtensionConsentPhase, ExtensionConsentTransitionFailure, ExtensionConsentTransitionOutcome,
    ExtensionConsentTransitionRequest, ExtensionConsentVaultReadiness,
};
pub use extension_pairing_state::{
    ActiveExtensionVault, AuthorizedExtensionGrant, CreateExtensionPairingStateInput,
    EXTENSION_GRANT_KEY_PREFIX, EXTENSION_KEYRING_KEY_PREFIX, EXTENSION_SETUP_KEY,
    ExtensionActiveVaultScope, ExtensionConnectScope, ExtensionDefaultVaultSelectionInput,
    ExtensionGrantAuthority, ExtensionGrantAuthorityRequest,
    ExtensionPairingApprovalEpochMilliseconds, ExtensionPairingEntry,
    ExtensionPairingGrantApproval, ExtensionPairingGrantRemovalInput, ExtensionPairingRecord,
    ExtensionPairingState, ExtensionPairingStateError, ExtensionPairingVaultType,
    ExtensionReadySetup, ExtensionReadySetupStatus, ExtensionSetupAfterRemoval,
    GrantAuthorityResponseError, GrantAuthorityResponseJson, ImportedExtensionEventLog,
    PairingStorageJson, PairingVaultId, RefreshExtensionPairingGrantInput,
    SelectedExtensionPairingGrant, StoredExtensionKeyring, StoredExtensionPairingGrant,
    UnknownExtensionConnectScope, UnknownExtensionPairingVaultType,
};
pub use extension_persistence::{
    ExtensionPersistenceArea, ExtensionPersistenceDatabaseState, ExtensionPersistenceObservation,
    ExtensionPersistenceStoreState,
};
pub use extension_session_protocol::{
    ExtensionEventLogRecord, ExtensionSessionRequest, ExtensionSessionRequestValidation,
    ExtensionSessionRequestWire, ExtensionVaultEventLogFailure,
    ExtensionVaultEventLogGrantDecision, ExtensionVaultEventLogGrantDecodeRequest,
    ExtensionVaultEventLogRequest, ExtensionVaultEventLogRequestMessage,
    ExtensionVaultEventLogResponse, ExtensionVaultEventLogResponseAdmission,
    ExtensionVaultEventLogResponseDecodeRequest, ExtensionVaultEventLogResponseError,
    LoginPickerOpenResponse, LoginPickerOpenResponseDecodeError, LoginPickerOpenResponseWire,
    SessionSecretText, SubmittedLoginSaveTarget, SubmittedWebsiteLoginSaveRequest,
};
pub use extension_session_status_response::{
    ExtensionSessionDeviceProtectionStatusWire, ExtensionSessionDeviceResponse,
    ExtensionSessionDeviceWire, ExtensionSessionOperationResponseWire, ExtensionSessionStatus,
    ExtensionSessionStatusAvailability, ExtensionSessionStatusResponseWire,
};
pub use extension_vault_event::ExtensionVaultEventPayload;
pub use generated_password_response::{
    GeneratedPasswordResponse, GeneratedPasswordResponseDecodeError, GeneratedPasswordResponseKind,
    GeneratedPasswordResponseWire,
};
pub use oauth_origin_policy::{
    BrowserOAuthLocation, BrowserOAuthLocationEvidence, BrowserOAuthProvider, OAuthOriginSupport,
    OAuthOriginUnsupportedReason,
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

pub use vault_host_policy::{
    SentinelVaultMatch, VaultAppBaseSelection, VaultHostObservation, VaultHostPolicy,
};

mod passkey_session_material;
pub use passkey_session_material::*;

pub use extension_pairing_state::ImportedExtensionEventLogError;

mod authenticator_session_response;
pub use authenticator_session_response::*;
