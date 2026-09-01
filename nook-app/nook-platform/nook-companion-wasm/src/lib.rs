//! Thin WASM exports for portable auth-companion heuristics and host policy.

#![allow(
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::must_use_candidate,
    clippy::uninlined_format_args
)]

use wasm_bindgen::prelude::wasm_bindgen;

mod account_picker_authorization;
mod page_form_policy;

mod authentication_observation_binding;
mod authentication_workflow;
mod authenticator_code_response;

pub use account_picker_authorization::*;
pub use authentication_observation_binding::*;
pub use authentication_workflow::*;
pub use authenticator_code_response::*;
pub use page_form_policy::*;

#[wasm_bindgen(typescript_custom_section)]
const EXTENSION_VAULT_EVENT_TYPESCRIPT: &str =
    nook_companion_core::EXTENSION_VAULT_EVENT_TYPESCRIPT;

#[wasm_bindgen]
#[must_use]
pub fn validate_extension_session_request(
    request: nook_companion_core::ExtensionSessionRequestWire,
) -> nook_companion_core::ExtensionSessionRequestValidation {
    drop(request);
    nook_companion_core::ExtensionSessionRequestValidation::Accepted
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen owns the decoded ABI value.
pub fn decode_extension_session_status_response(
    response: nook_companion_core::ExtensionSessionStatusResponseWire,
) -> nook_companion_core::ExtensionSessionStatusAvailability {
    nook_companion_core::decode_extension_session_status_response(&response)
}

#[wasm_bindgen]
pub fn decode_website_login_options(
    response: nook_companion_core::WebsiteLoginOptionsWireValue,
) -> Result<nook_companion_core::WebsiteLoginOptions, wasm_bindgen::JsError> {
    nook_companion_core::decode_website_login_options(response)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[wasm_bindgen]
#[must_use]
pub fn decode_website_passkey_account_list(
    response: wasm_bindgen::JsValue,
) -> nook_companion_core::WebsitePasskeyAccountList {
    serde_wasm_bindgen::from_value(response).map_or_else(
        |_| nook_companion_core::WebsitePasskeyAccountList::invalid(),
        nook_companion_core::decode_website_passkey_account_list,
    )
}

#[wasm_bindgen]
pub fn decode_website_login_save_offer_response(
    response: nook_companion_core::WebsiteLoginSaveOfferResponse,
) -> Result<nook_companion_core::WebsiteLoginSaveOfferResponse, wasm_bindgen::JsError> {
    nook_companion_core::decode_website_login_save_offer_response(response)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[wasm_bindgen]
pub fn decode_website_login_save_pending_response(
    response: nook_companion_core::WebsiteLoginSavePendingResponse,
) -> Result<nook_companion_core::WebsiteLoginSavePendingResponse, wasm_bindgen::JsError> {
    nook_companion_core::decode_website_login_save_pending_response(response)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[wasm_bindgen]
pub fn decode_website_login_save_action_response(
    response: nook_companion_core::WebsiteLoginSaveActionResponse,
) -> Result<nook_companion_core::WebsiteLoginSaveActionResponse, wasm_bindgen::JsError> {
    nook_companion_core::decode_website_login_save_action_response(response)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[wasm_bindgen]
pub fn decode_login_picker_open_response(
    response: nook_companion_core::LoginPickerOpenResponseWire,
) -> Result<nook_companion_core::LoginPickerOpenResponse, wasm_bindgen::JsError> {
    nook_companion_core::decode_login_picker_open_response(response)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[wasm_bindgen]
pub fn decode_authenticator_picker_open_response(
    response: nook_companion_core::AuthenticatorPickerOpenResponseWire,
) -> Result<nook_companion_core::AuthenticatorPickerOpenResponse, wasm_bindgen::JsError> {
    nook_companion_core::decode_authenticator_picker_open_response(response)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[wasm_bindgen]
pub fn decode_authentication_outcome_response(
    response: nook_companion_core::AuthenticationOutcomeResponseWire,
) -> Result<nook_companion_core::AuthenticationOutcomeResponse, wasm_bindgen::JsError> {
    nook_companion_core::decode_authentication_outcome_response(response)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[wasm_bindgen]
pub fn decode_authenticator_backup_attach_response(
    response: nook_companion_core::AuthenticatorBackupAttachResponseWire,
) -> Result<nook_companion_core::AuthenticatorBackupAttachResponse, wasm_bindgen::JsError> {
    nook_companion_core::decode_authenticator_backup_attach_response(response)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[wasm_bindgen]
pub fn decode_authenticator_enrollment_stage_response(
    response: nook_companion_core::AuthenticatorEnrollmentStageResponseWire,
) -> Result<nook_companion_core::AuthenticatorEnrollmentStageResponse, wasm_bindgen::JsError> {
    nook_companion_core::decode_authenticator_enrollment_stage_response(response)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[wasm_bindgen]
pub fn decode_authenticator_enrollment_confirm_response(
    response: nook_companion_core::AuthenticatorEnrollmentConfirmResponseWire,
) -> Result<nook_companion_core::AuthenticatorEnrollmentConfirmResponse, wasm_bindgen::JsError> {
    nook_companion_core::decode_authenticator_enrollment_confirm_response(response)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[wasm_bindgen]
pub fn decode_generated_password_response(
    response: nook_companion_core::GeneratedPasswordResponseWire,
) -> Result<nook_companion_core::GeneratedPasswordResponse, wasm_bindgen::JsError> {
    nook_companion_core::decode_generated_password_response(response)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[wasm_bindgen]
pub fn decode_authenticator_options_response(
    response: nook_companion_core::AuthenticatorOptionsResponseWire,
) -> Result<nook_companion_core::AuthenticatorOptionsResponse, wasm_bindgen::JsError> {
    nook_companion_core::decode_authenticator_options_response(response)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[wasm_bindgen]
pub fn decode_authenticator_preview_response(
    response: nook_companion_core::AuthenticatorPreviewResponseWire,
) -> Result<nook_companion_core::AuthenticatorPreviewResponse, wasm_bindgen::JsError> {
    nook_companion_core::decode_authenticator_preview_response(response)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[wasm_bindgen]
#[must_use]
pub fn page_has_backup_code_hint(text: &str) -> bool {
    nook_companion_core::page_has_backup_code_hint(text)
}

#[wasm_bindgen]
#[must_use]
pub fn contains_backup_code_candidate(text: &str) -> bool {
    nook_companion_core::contains_backup_code_candidate(text)
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
pub fn extract_backup_code_candidates(text: String) -> Vec<String> {
    nook_companion_core::extract_backup_code_candidates(&text)
}

#[wasm_bindgen]
#[must_use]
pub fn extension_persistence_database_name(
    area: nook_companion_core::ExtensionPersistenceArea,
) -> String {
    area.database_name().to_owned()
}

#[wasm_bindgen]
#[must_use]
pub fn extension_persistence_store_names(
    area: nook_companion_core::ExtensionPersistenceArea,
) -> Vec<String> {
    area.store_names()
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
pub fn classify_extension_persistence_databases(
    input: nook_companion_core::ExtensionPersistenceObservation,
) -> nook_companion_core::ExtensionPersistenceDatabaseState {
    nook_companion_core::classify_extension_database_names(input.area, &input.observed_names)
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
pub fn classify_extension_persistence_stores(
    input: nook_companion_core::ExtensionPersistenceObservation,
) -> nook_companion_core::ExtensionPersistenceStoreState {
    nook_companion_core::classify_extension_store_names(input.area, &input.observed_names)
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
pub fn matching_extension_persistence_stores(
    input: nook_companion_core::ExtensionPersistenceObservation,
) -> Vec<String> {
    nook_companion_core::matching_extension_store_names(input.area, &input.observed_names)
}

#[wasm_bindgen]
#[must_use]
pub fn authentication_username_evidence(
    field: &NookPageInputFieldObservation,
) -> nook_companion_core::AuthenticationUsernameEvidence {
    nook_companion_core::authentication_username_evidence(field.as_core())
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
pub fn strongest_authentication_username_evidence(
    evidence: Vec<nook_companion_core::AuthenticationUsernameEvidence>,
) -> nook_companion_core::AuthenticationUsernameEvidence {
    nook_companion_core::strongest_authentication_username_evidence(&evidence)
}

#[wasm_bindgen]
#[must_use]
pub fn classify_companion_authentication_outcome(
    input: nook_companion_core::AuthenticationOutcomeClassification,
) -> nook_companion_core::AuthenticationOutcomeDecision {
    nook_companion_core::AuthenticationOutcomeDecision::classify(
        input.observation,
        input.timeout_ms,
    )
}

#[wasm_bindgen]
#[must_use]
pub fn classify_companion_authentication_outcome_with_default_timeout(
    observation: nook_companion_core::AuthenticationOutcomeObservation,
) -> nook_companion_core::AuthenticationOutcomeDecision {
    nook_companion_core::AuthenticationOutcomeDecision::classify(
        observation,
        nook_companion_core::DEFAULT_OUTCOME_EVIDENCE_TIMEOUT_MS,
    )
}

#[wasm_bindgen]
#[must_use]
pub fn validate_companion_authentication_outcome_decision(
    decision: nook_companion_core::AuthenticationOutcomeDecision,
) -> nook_companion_core::AuthenticationOutcomeDecision {
    decision
}

#[wasm_bindgen]
#[must_use]
pub fn extension_pairing_grant_storage_key(vault_store_id: &str) -> String {
    nook_companion_core::grant_storage_key(vault_store_id)
}

#[wasm_bindgen]
#[must_use]
pub fn extension_pairing_setup_storage_key() -> String {
    nook_companion_core::EXTENSION_SETUP_KEY.to_owned()
}

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
#[allow(clippy::needless_pass_by_value)]
pub fn create_extension_pairing_state(
    input: nook_companion_core::CreateExtensionPairingStateInput,
) -> Result<nook_companion_core::ExtensionPairingState, wasm_bindgen::JsError> {
    nook_companion_core::create_pairing_state(input)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
pub fn refresh_extension_pairing_grant(
    input: nook_companion_core::RefreshExtensionPairingGrantInput,
) -> Result<nook_companion_core::ExtensionPairingState, wasm_bindgen::JsError> {
    nook_companion_core::refresh_pairing_grant(input)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
pub fn ordered_extension_pairing_grants(
    state: nook_companion_core::ExtensionPairingState,
) -> Vec<nook_companion_core::StoredExtensionPairingGrant> {
    state.ordered_grants()
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
pub fn selected_extension_pairing_grant(
    state: nook_companion_core::ExtensionPairingState,
) -> nook_companion_core::SelectedExtensionPairingGrant {
    state.selected_grant().map_or(
        nook_companion_core::SelectedExtensionPairingGrant::NotSelected,
        |grant| nook_companion_core::SelectedExtensionPairingGrant::Selected {
            grant: Box::new(grant),
        },
    )
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
pub fn first_extension_pairing_grant(
    state: nook_companion_core::ExtensionPairingState,
) -> nook_companion_core::SelectedExtensionPairingGrant {
    state.first_grant().map_or(
        nook_companion_core::SelectedExtensionPairingGrant::NotSelected,
        |grant| nook_companion_core::SelectedExtensionPairingGrant::Selected {
            grant: Box::new(grant),
        },
    )
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
pub fn extension_setup_after_pairing_grant_removal(
    input: nook_companion_core::ExtensionPairingGrantRemovalInput,
) -> nook_companion_core::ExtensionSetupAfterRemoval {
    input
        .state
        .setup_after_removal(&input.removed_vault_store_id)
        .map_or(
            nook_companion_core::ExtensionSetupAfterRemoval::NoPairedVault,
            |setup| nook_companion_core::ExtensionSetupAfterRemoval::Ready { setup },
        )
}

#[wasm_bindgen]
#[must_use]
pub fn is_stored_extension_pairing_grant_json(value: &str) -> bool {
    nook_companion_core::is_stored_pairing_grant_json(value)
}

#[wasm_bindgen]
#[must_use]
pub fn is_extension_ready_setup_json(value: &str) -> bool {
    nook_companion_core::is_ready_pairing_setup_json(value)
}

#[wasm_bindgen]
pub fn migrate_legacy_extension_pairing_state_json(
    value: &str,
) -> Result<nook_companion_core::ExtensionPairingState, wasm_bindgen::JsError> {
    nook_companion_core::migrate_legacy_pairing_state_json(value)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[wasm_bindgen]
#[must_use]
pub fn is_cloudflare_pr_preview_host(hostname: &str) -> bool {
    nook_companion_core::is_cloudflare_pr_preview_host(hostname)
}

#[wasm_bindgen]
#[derive(Clone, Debug)]
pub struct NookOAuthOriginSupport {
    inner: nook_companion_core::OAuthOriginSupport,
}

#[wasm_bindgen]
impl NookOAuthOriginSupport {
    #[wasm_bindgen]
    #[must_use]
    pub fn is_supported(&self) -> bool {
        matches!(
            self.inner,
            nook_companion_core::OAuthOriginSupport::LocationUnavailable
                | nook_companion_core::OAuthOriginSupport::Supported { .. }
        )
    }

    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn origin(&self) -> String {
        match &self.inner {
            nook_companion_core::OAuthOriginSupport::LocationUnavailable => String::new(),
            nook_companion_core::OAuthOriginSupport::Supported { origin }
            | nook_companion_core::OAuthOriginSupport::Unsupported { origin, .. } => origin.clone(),
        }
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn is_unsupported(&self) -> bool {
        matches!(
            self.inner,
            nook_companion_core::OAuthOriginSupport::Unsupported { .. }
        )
    }

    /// Reason when [`Self::is_unsupported`] is true; otherwise `UnregisteredOrigin`.
    #[wasm_bindgen]
    #[must_use]
    pub fn unsupported_reason(&self) -> nook_companion_core::OAuthOriginUnsupportedReason {
        match self.inner {
            nook_companion_core::OAuthOriginSupport::Unsupported { reason, .. } => reason,
            _ => nook_companion_core::OAuthOriginUnsupportedReason::UnregisteredOrigin,
        }
    }
}

#[wasm_bindgen]
#[must_use]
pub fn resolve_oauth_origin_support(
    provider: nook_companion_core::BrowserOAuthProvider,
    origin: &str,
    hostname: &str,
) -> NookOAuthOriginSupport {
    let (origin, hostname) = if origin.is_empty() || hostname.is_empty() {
        (None, None)
    } else {
        (Some(origin), Some(hostname))
    };
    NookOAuthOriginSupport {
        inner: nook_companion_core::resolve_oauth_origin_support(provider, origin, hostname),
    }
}

#[wasm_bindgen]
#[must_use]
pub fn default_simple_vault_url() -> String {
    nook_companion_core::DEFAULT_SIMPLE_VAULT_URL.to_owned()
}

#[wasm_bindgen]
pub fn normalize_simple_vault_base_url(value: &str) -> Result<String, wasm_bindgen::JsError> {
    Ok(nook_companion_core::normalize_simple_vault_base_url(value)?)
}

#[wasm_bindgen]
pub fn simple_vault_url(base_url: &str, path: &str) -> Result<String, wasm_bindgen::JsError> {
    Ok(nook_companion_core::simple_vault_url(base_url, path)?)
}

#[wasm_bindgen]
pub fn simple_vault_match_pattern(base_url: &str) -> Result<String, wasm_bindgen::JsError> {
    Ok(nook_companion_core::simple_vault_match_pattern(base_url)?)
}

/// Matching Sentinel base URL for `base_url`, or an empty string when none matches.
#[wasm_bindgen]
pub fn matching_sentinel_vault_base_url(base_url: &str) -> Result<String, wasm_bindgen::JsError> {
    Ok(nook_companion_core::matching_sentinel_vault_base_url(base_url)?.unwrap_or_default())
}

#[wasm_bindgen]
pub fn sentinel_vault_match_patterns(base_url: &str) -> Result<Vec<String>, wasm_bindgen::JsError> {
    Ok(nook_companion_core::sentinel_vault_match_patterns(
        base_url,
    )?)
}

#[wasm_bindgen]
#[must_use]
pub fn is_simple_vault_hostname(hostname: &str) -> bool {
    nook_companion_core::is_simple_vault_hostname(hostname)
}

#[wasm_bindgen]
#[must_use]
pub fn is_sentinel_vault_hostname(hostname: &str) -> bool {
    nook_companion_core::is_sentinel_vault_hostname(hostname)
}

#[wasm_bindgen]
pub fn nook_vault_app_exclude_match_patterns(
    base_url: &str,
) -> Result<Vec<String>, wasm_bindgen::JsError> {
    Ok(nook_companion_core::nook_vault_app_exclude_match_patterns(
        base_url,
    )?)
}

/// `base_url` may be empty when no configured vault base is available.
#[wasm_bindgen]
pub fn is_nook_vault_app_url(
    candidate_url: &str,
    base_url: &str,
) -> Result<bool, wasm_bindgen::JsError> {
    let base_url = if base_url.is_empty() {
        None
    } else {
        Some(base_url)
    };
    Ok(nook_companion_core::is_nook_vault_app_url(
        candidate_url,
        base_url,
    )?)
}

#[wasm_bindgen]
pub fn belongs_to_simple_vault(
    base_url: &str,
    candidate_url: &str,
) -> Result<bool, wasm_bindgen::JsError> {
    Ok(nook_companion_core::belongs_to_simple_vault(
        base_url,
        candidate_url,
    )?)
}

#[wasm_bindgen]
pub fn belongs_to_sentinel_vault(
    base_url: &str,
    candidate_url: &str,
) -> Result<bool, wasm_bindgen::JsError> {
    Ok(nook_companion_core::belongs_to_sentinel_vault(
        base_url,
        candidate_url,
    )?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backup_code_wasm_exports_match_core_policy() {
        let text = [
            "Save your backup codes",
            "A1B2-C3D4-E5F6",
            "This sentence should not become a code.",
        ]
        .join("\n");
        assert!(page_has_backup_code_hint(&text));
        assert_eq!(
            extract_backup_code_candidates(text),
            vec!["A1B2-C3D4-E5F6".to_owned()]
        );
    }

    #[test]
    fn oauth_origin_and_vault_host_wasm_exports_match_core_policy() {
        let supported = resolve_oauth_origin_support(
            nook_companion_core::BrowserOAuthProvider::GoogleDrive,
            "https://simple.nokey.sh",
            "simple.nokey.sh",
        );
        assert!(supported.is_supported());
        assert!(!supported.is_unsupported());

        assert!(is_simple_vault_hostname("simple.dev.nokey.sh"));
        assert!(is_sentinel_vault_hostname("sentinel.nokey.sh"));
        match normalize_simple_vault_base_url("https://simple.nokey.sh") {
            Ok(normalized) => assert_eq!(normalized, "https://simple.nokey.sh/"),
            Err(error) => panic!("normalize failed: {error:?}"),
        }
    }

    #[test]
    fn extension_persistence_wasm_exports_match_core_policy() {
        let area = nook_companion_core::ExtensionPersistenceArea::Pairing;
        assert_eq!(extension_persistence_database_name(area), "nook_extension");
        let database_observation = nook_companion_core::ExtensionPersistenceObservation {
            area,
            observed_names: vec!["nook_extension".to_owned()],
        };
        assert_eq!(
            classify_extension_persistence_databases(database_observation),
            nook_companion_core::ExtensionPersistenceDatabaseState::Present
        );
        let store_observation = nook_companion_core::ExtensionPersistenceObservation {
            area,
            observed_names: vec!["pairing".to_owned()],
        };
        assert_eq!(
            classify_extension_persistence_stores(store_observation),
            nook_companion_core::ExtensionPersistenceStoreState::Present
        );
    }

    #[test]
    fn workflow_wasm_export_rejects_unbounded_observations() {
        let input = nook_companion_core::AuthenticationPageObservations {
            observations: vec![nook_companion_core::AuthenticationPageObservation {
                one_time_code_field_count:
                    nook_companion_core::MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT + 1,
                ..Default::default()
            }],
        };
        assert_eq!(
            companion_authentication_workflow_match_kind(
                classify_companion_authentication_workflow(input)
            ),
            CompanionAuthenticationWorkflowMatchKind::Rejected
        );
    }

    #[test]
    fn detailed_workflow_wasm_export_rejects_unbounded_handler_facts() {
        let input = nook_companion_core::AuthenticationPageObservationFactsBatch {
            observations: vec![nook_companion_core::AuthenticationPageObservationFacts {
                ceremony: nook_companion_core::AuthenticationCeremonyObservationFacts {
                    one_time_code_handler_signal: "x"
                        .repeat(nook_companion_core::MAX_AUTHENTICATION_CONTROL_TEXT_BYTES + 1),
                    ..Default::default()
                },
                ..Default::default()
            }],
        };
        assert_eq!(
            companion_authentication_workflow_match_kind(
                classify_companion_authentication_workflow_facts(input)
            ),
            CompanionAuthenticationWorkflowMatchKind::Rejected
        );
    }

    #[test]
    fn username_evidence_exports_preserve_core_classification_and_ordering() {
        let field = NookPageInputFieldObservation::new(
            nook_companion_core::PageInputType::Email,
            false,
            false,
            vec!["email".to_owned()],
            "account email".to_owned(),
            true,
        );
        assert_eq!(
            authentication_username_evidence(&field),
            nook_companion_core::AuthenticationUsernameEvidence::Strong
        );
        assert_eq!(
            strongest_authentication_username_evidence(vec![
                nook_companion_core::AuthenticationUsernameEvidence::Absent,
                nook_companion_core::AuthenticationUsernameEvidence::StandardsBasedEmail,
                nook_companion_core::AuthenticationUsernameEvidence::Explicit,
                nook_companion_core::AuthenticationUsernameEvidence::Strong,
            ]),
            nook_companion_core::AuthenticationUsernameEvidence::Explicit
        );
        assert_eq!(
            strongest_authentication_username_evidence(Vec::new()),
            nook_companion_core::AuthenticationUsernameEvidence::Absent
        );
    }

    #[test]
    fn saved_login_capability_export_rejects_impossible_snapshots() {
        let valid = nook_companion_core::AuthenticationWorkflowSnapshot {
            kind: nook_companion_core::AuthenticationWorkflowKind::Login,
            stage: nook_companion_core::AuthenticationWorkflowStage::Credentials,
            action: nook_companion_core::AuthenticationWorkflowAction::ContinueWithNook,
            current_step: 1,
            total_steps: 3,
            approval_requirement:
                nook_companion_core::AuthenticationApprovalRequirement::ExplicitUserApproval,
            saved_login_capability:
                nook_companion_core::AuthenticationSavedLoginCapability::FillSavedLogin,
            observation_index: 0,
        };
        assert_eq!(
            authentication_workflow_saved_login_capability(valid),
            nook_companion_core::AuthenticationSavedLoginCapability::FillSavedLogin
        );
        assert!(!authentication_workflow_requires_login_match_availability(
            valid
        ));
        assert!(authentication_workflow_requires_login_match_availability(
            nook_companion_core::AuthenticationWorkflowSnapshot {
                action: nook_companion_core::AuthenticationWorkflowAction::UsePasskey,
                ..valid
            }
        ));
        assert_eq!(
            authentication_workflow_pilot_presentation_capability(valid),
            nook_companion_core::AuthenticationPilotPresentationCapability::ProposeAction
        );
        assert_eq!(
            authentication_workflow_saved_login_capability(
                nook_companion_core::AuthenticationWorkflowSnapshot {
                    stage: nook_companion_core::AuthenticationWorkflowStage::Recovery,
                    ..valid
                }
            ),
            nook_companion_core::AuthenticationSavedLoginCapability::Unavailable
        );
        assert_eq!(
            authentication_workflow_pilot_presentation_capability(
                nook_companion_core::AuthenticationWorkflowSnapshot {
                    stage: nook_companion_core::AuthenticationWorkflowStage::Recovery,
                    ..valid
                }
            ),
            nook_companion_core::AuthenticationPilotPresentationCapability::Hidden
        );
    }

    #[test]
    fn backup_code_classifier_bridge_preserves_typed_variants() {
        assert_eq!(
            classify_authentication_backup_codes_observation("Use a backup code instead", false),
            nook_companion_core::AuthenticationBackupCodesObservation::Absent
        );
        assert_eq!(
            classify_authentication_backup_codes_observation(
                "Save your recovery codes in a secure place",
                false,
            ),
            nook_companion_core::AuthenticationBackupCodesObservation::Present
        );
    }

    #[test]
    fn enrollment_match_bridge_preserves_selected_recovery_action() {
        let nook_companion_core::AuthenticationWorkflowMatch::Matched(snapshot) =
            authentication_enrollment_workflow_match(true, "Save these recovery codes", false)
        else {
            panic!("expected a selected enrollment workflow");
        };
        assert_eq!(
            snapshot.action,
            nook_companion_core::AuthenticationWorkflowAction::SaveBackupCodes
        );
    }
}

#[cfg(all(test, target_arch = "wasm32"))]
mod wasm_tests {
    use nook_companion_core::{
        AuthenticationBackupCodesObservation, ExtensionPersistenceArea,
        ExtensionPersistenceObservation,
    };
    use serde::{Deserialize, Serialize};
    use wasm_bindgen_test::wasm_bindgen_test;

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct SessionDeviceFixture {
        device_id: &'static str,
        device_public_key: &'static str,
        device_signing_public_key: &'static str,
    }

    #[derive(Serialize)]
    struct SessionStatusFixture {
        ok: bool,
        status: u8,
        #[serde(skip_serializing_if = "Option::is_none")]
        device: Option<SessionDeviceFixture>,
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct WorkflowSnapshotFixture {
        kind: u8,
        stage: u8,
        action: u8,
        current_step: u8,
        total_steps: u8,
        approval_requirement: &'static str,
        saved_login_capability: &'static str,
        observation_index: u32,
    }

    #[derive(Serialize)]
    struct WorkflowFixture {
        ok: bool,
        snapshot: WorkflowSnapshotFixture,
    }

    #[derive(Serialize)]
    struct LoginMatchesFixture {
        kind: &'static str,
        count: u32,
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct RuntimeResponseFixture {
        workflow: WorkflowFixture,
        login_matches: LoginMatchesFixture,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct RuntimeResponseResult {
        login_matches: LoginMatchesResult,
    }

    #[derive(Deserialize)]
    struct LoginMatchesResult {
        kind: String,
        count: u32,
    }

    #[derive(Serialize)]
    struct LockedLoginOptionsFixture {
        ok: bool,
        status: &'static str,
    }

    #[derive(Deserialize)]
    struct LoginAvailabilityResult {
        kind: String,
    }

    fn js_error(error: impl std::fmt::Display) -> wasm_bindgen::JsError {
        wasm_bindgen::JsError::new(&error.to_string())
    }

    #[wasm_bindgen_test]
    fn persistence_observation_round_trips_the_numeric_wasm_enum()
    -> Result<(), serde_wasm_bindgen::Error> {
        let observation = ExtensionPersistenceObservation {
            area: ExtensionPersistenceArea::EventLog,
            observed_names: vec!["events".to_owned()],
        };

        let js_value = serde_wasm_bindgen::to_value(&observation)?;
        let decoded: ExtensionPersistenceObservation = serde_wasm_bindgen::from_value(js_value)?;

        assert_eq!(decoded, observation);
        Ok(())
    }

    #[wasm_bindgen_test]
    fn session_status_bridge_classifies_supported_device_states()
    -> Result<(), wasm_bindgen::JsError> {
        for (status, expected) in [
            (
                0,
                nook_companion_core::ExtensionSessionStatusAvailability::Unavailable,
            ),
            (
                4,
                nook_companion_core::ExtensionSessionStatusAvailability::Locked,
            ),
            (
                5,
                nook_companion_core::ExtensionSessionStatusAvailability::Unavailable,
            ),
            (
                7,
                nook_companion_core::ExtensionSessionStatusAvailability::Unavailable,
            ),
        ] {
            let fixture = SessionStatusFixture {
                ok: true,
                status,
                device: None,
            };
            let js_input = serde_wasm_bindgen::to_value(&fixture).map_err(js_error)?;
            let wire = serde_wasm_bindgen::from_value(js_input).map_err(js_error)?;
            assert_eq!(
                super::decode_extension_session_status_response(wire),
                expected
            );
        }

        let unlocked = SessionStatusFixture {
            ok: true,
            status: 6,
            device: Some(SessionDeviceFixture {
                device_id: "device",
                device_public_key: "public",
                device_signing_public_key: "signing",
            }),
        };
        let js_input = serde_wasm_bindgen::to_value(&unlocked).map_err(js_error)?;
        let wire = serde_wasm_bindgen::from_value(js_input).map_err(js_error)?;
        assert_eq!(
            super::decode_extension_session_status_response(wire),
            nook_companion_core::ExtensionSessionStatusAvailability::Unlocked
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    fn runtime_response_bridge_accepts_the_complete_js_envelope()
    -> Result<(), wasm_bindgen::JsError> {
        let fixture = RuntimeResponseFixture {
            workflow: WorkflowFixture {
                ok: true,
                snapshot: WorkflowSnapshotFixture {
                    kind: 0,
                    stage: 0,
                    action: 4,
                    current_step: 1,
                    total_steps: 3,
                    approval_requirement: "explicit-user-approval",
                    saved_login_capability: "fill-saved-login",
                    observation_index: 0,
                },
            },
            login_matches: LoginMatchesFixture {
                kind: "ready",
                count: 2,
            },
        };
        let js_input = serde_wasm_bindgen::to_value(&fixture).map_err(js_error)?;
        let wire = serde_wasm_bindgen::from_value(js_input).map_err(js_error)?;
        let decoded = super::decode_authentication_workflow_runtime_response(wire)?;
        let js_output = serde_wasm_bindgen::to_value(&decoded).map_err(js_error)?;
        let result: RuntimeResponseResult =
            serde_wasm_bindgen::from_value(js_output).map_err(js_error)?;

        assert_eq!(result.login_matches.kind, "ready");
        assert_eq!(result.login_matches.count, 2);
        Ok(())
    }

    #[wasm_bindgen_test]
    fn login_match_bridge_accepts_the_website_options_js_envelope()
    -> Result<(), wasm_bindgen::JsError> {
        let js_input = serde_wasm_bindgen::to_value(&LockedLoginOptionsFixture {
            ok: true,
            status: "locked",
        })
        .map_err(js_error)?;
        let wire = serde_wasm_bindgen::from_value(js_input).map_err(js_error)?;
        let decoded = super::decode_website_login_match_availability(wire)?;
        let js_output = serde_wasm_bindgen::to_value(&decoded).map_err(js_error)?;
        let result: LoginAvailabilityResult =
            serde_wasm_bindgen::from_value(js_output).map_err(js_error)?;

        assert_eq!(result.kind, "locked");
        Ok(())
    }

    #[wasm_bindgen_test]
    fn backup_code_classifier_round_trips_both_typed_wasm_variants()
    -> Result<(), serde_wasm_bindgen::Error> {
        for (text, expected) in [
            (
                "Use a backup code instead",
                AuthenticationBackupCodesObservation::Absent,
            ),
            (
                "Save your backup codes in a secure place",
                AuthenticationBackupCodesObservation::Present,
            ),
        ] {
            let classified = super::classify_authentication_backup_codes_observation(text, false);
            let js_value = serde_wasm_bindgen::to_value(&classified)?;
            let decoded: AuthenticationBackupCodesObservation =
                serde_wasm_bindgen::from_value(js_value)?;
            assert_eq!(classified, expected);
            assert_eq!(decoded, expected);
        }
        Ok(())
    }
}
