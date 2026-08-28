//! Thin WASM exports for portable auth-companion heuristics and host policy.

#![allow(
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::must_use_candidate,
    clippy::uninlined_format_args
)]

use wasm_bindgen::prelude::wasm_bindgen;

mod page_form_policy;

pub use page_form_policy::*;

#[wasm_bindgen(typescript_custom_section)]
const EXTENSION_VAULT_EVENT_TYPESCRIPT: &str =
    nook_companion_core::EXTENSION_VAULT_EVENT_TYPESCRIPT;

#[wasm_bindgen(typescript_custom_section)]
const AUTHENTICATION_WORKFLOW_COMPATIBILITY_TYPESCRIPT: &str =
    nook_companion_core::AUTHENTICATION_WORKFLOW_COMPATIBILITY_TYPESCRIPT;

#[wasm_bindgen]
#[must_use]
pub fn validate_extension_session_request(
    request: nook_companion_core::ExtensionSessionRequestWire,
) -> nook_companion_core::ExtensionSessionRequestValidation {
    drop(request);
    nook_companion_core::ExtensionSessionRequestValidation::Accepted
}

#[wasm_bindgen]
pub fn decode_website_login_options(
    response: nook_companion_core::WebsiteLoginOptionsWireValue,
) -> Result<nook_companion_core::WebsiteLoginOptions, wasm_bindgen::JsError> {
    nook_companion_core::decode_website_login_options(response)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
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
pub fn decode_authentication_workflow_snapshot_response(
    response: nook_companion_core::AuthenticationWorkflowSnapshotResponseWire,
) -> Result<nook_companion_core::AuthenticationWorkflowSnapshotResponse, wasm_bindgen::JsError> {
    nook_companion_core::decode_authentication_workflow_snapshot_response(response)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[wasm_bindgen]
pub fn decode_authentication_workflow_runtime_response(
    response: nook_companion_core::AuthenticationWorkflowRuntimeResponseWire,
) -> Result<nook_companion_core::AuthenticationWorkflowRuntimeResponse, wasm_bindgen::JsError> {
    nook_companion_core::decode_authentication_workflow_runtime_response(response)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[wasm_bindgen]
#[must_use]
pub fn authentication_workflow_saved_login_capability(
    snapshot: nook_companion_core::AuthenticationWorkflowSnapshot,
) -> nook_companion_core::AuthenticationSavedLoginCapability {
    snapshot.saved_login_capability()
}

#[wasm_bindgen]
pub fn decode_authenticator_backup_attach_response(
    response: nook_companion_core::AuthenticatorBackupAttachResponseWire,
) -> Result<nook_companion_core::AuthenticatorBackupAttachResponse, wasm_bindgen::JsError> {
    nook_companion_core::decode_authenticator_backup_attach_response(response)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[wasm_bindgen]
pub fn decode_authenticator_code_response(
    response: nook_companion_core::AuthenticatorCodeResponseWire,
) -> Result<nook_companion_core::AuthenticatorCodeResponse, wasm_bindgen::JsError> {
    nook_companion_core::decode_authenticator_code_response(response)
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
#[allow(clippy::needless_pass_by_value)]
pub fn classify_companion_authentication_workflow(
    input: nook_companion_core::AuthenticationPageObservationsCompatibility,
) -> nook_companion_core::AuthenticationWorkflowMatch {
    input.into_observations().classify()
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
pub fn classify_companion_authentication_workflow_facts(
    input: nook_companion_core::AuthenticationPageObservationFactsBatch,
) -> nook_companion_core::AuthenticationWorkflowMatch {
    input.classify()
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompanionAuthenticationWorkflowMatchKind {
    NoMatch,
    Rejected,
    Matched,
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
pub fn companion_authentication_workflow_match_kind(
    workflow_match: nook_companion_core::AuthenticationWorkflowMatch,
) -> CompanionAuthenticationWorkflowMatchKind {
    match workflow_match {
        nook_companion_core::AuthenticationWorkflowMatch::NoMatch => {
            CompanionAuthenticationWorkflowMatchKind::NoMatch
        }
        nook_companion_core::AuthenticationWorkflowMatch::Rejected => {
            CompanionAuthenticationWorkflowMatchKind::Rejected
        }
        nook_companion_core::AuthenticationWorkflowMatch::Matched(_) => {
            CompanionAuthenticationWorkflowMatchKind::Matched
        }
    }
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
    fn login_advance_control_compatibility_export_matches_core_policy() {
        let compatibility_export: fn(&str) -> bool = looks_like_login_advance_control_label;

        for label in ["Continue", "SignIn", "Log in", "Submit"] {
            assert_eq!(
                compatibility_export(label),
                nook_companion_core::looks_like_login_advance_control_label(label)
            );
            assert!(compatibility_export(label));
        }

        for label in [
            "Learn more",
            "Subscribe",
            "Delete account",
            "Continue to delete account",
            "Continue to reset password",
            "Continue with Google",
        ] {
            assert_eq!(
                compatibility_export(label),
                nook_companion_core::looks_like_login_advance_control_label(label)
            );
            assert!(!compatibility_export(label));
        }
        assert!(!compatibility_export(&"x".repeat(
            nook_companion_core::MAX_AUTHENTICATION_CONTROL_TEXT_BYTES + 1
        )));
    }

    #[test]
    fn current_main_workflow_compatibility_exports_remain_usable() {
        assert_eq!(
            nook_companion_core::AuthenticationWorkflowKind::Login as u32,
            0
        );
        assert_eq!(
            nook_companion_core::AuthenticationWorkflowStage::Credentials as u32,
            0
        );
        assert_eq!(
            nook_companion_core::AuthenticationWorkflowAction::ContinueWithNook as u32,
            0
        );
        assert_eq!(
            nook_companion_core::AuthenticationWorkflowSnapshotResponseKind::Matched as u32,
            0
        );

        let observation = nook_companion_core::AuthenticationPageObservationCompatibility {
            username_field_count: 1,
            current_password_field_count: 1,
            new_password_field_count: 0,
            generic_password_field_count: 0,
            one_time_code_field_count: 0,
            manual_checkpoint_present: false,
            authenticator_setup_hint: false,
            backup_codes_hint: false,
            passkey_control_present: false,
            matching_passkey_account_count: 0,
        };
        assert_eq!(authentication_form_observation_priority(observation), 4);

        let workflow = classify_companion_authentication_workflow(
            nook_companion_core::AuthenticationPageObservationsCompatibility {
                observations: vec![observation],
            },
        );
        assert!(matches!(
            workflow,
            nook_companion_core::AuthenticationWorkflowMatch::Matched(snapshot)
                if snapshot.kind == nook_companion_core::AuthenticationWorkflowKind::Login
                    && snapshot.action
                        == nook_companion_core::AuthenticationWorkflowAction::ContinueWithNook
        ));
    }

    #[test]
    fn saved_login_capability_export_rejects_impossible_login_snapshots() {
        let valid = nook_companion_core::AuthenticationWorkflowSnapshot {
            kind: nook_companion_core::AuthenticationWorkflowKind::Login,
            stage: nook_companion_core::AuthenticationWorkflowStage::Credentials,
            action: nook_companion_core::AuthenticationWorkflowAction::ContinueWithNook,
            current_step: 1,
            total_steps: 3,
            approval_requirement:
                nook_companion_core::AuthenticationApprovalRequirement::ExplicitUserApproval,
            observation_index: 0,
        };
        assert_eq!(
            authentication_workflow_saved_login_capability(valid),
            nook_companion_core::AuthenticationSavedLoginCapability::FillSavedLogin
        );

        let contradictory = nook_companion_core::AuthenticationWorkflowSnapshot {
            stage: nook_companion_core::AuthenticationWorkflowStage::Recovery,
            ..valid
        };
        assert_eq!(
            authentication_workflow_saved_login_capability(contradictory),
            nook_companion_core::AuthenticationSavedLoginCapability::Unavailable
        );
    }

    #[test]
    fn workflow_wasm_export_rejects_unbounded_observations() {
        let input = nook_companion_core::AuthenticationPageObservationFactsBatch {
            observations: vec![nook_companion_core::AuthenticationPageObservationFacts {
                fields: nook_companion_core::AuthenticationFieldObservationFacts {
                    one_time_code_field_count:
                        nook_companion_core::MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT + 1,
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
    fn workflow_wasm_export_rejects_forged_reduced_advance_control() {
        let input = nook_companion_core::AuthenticationPageObservationFactsBatch {
            observations: vec![nook_companion_core::AuthenticationPageObservationFacts {
                fields: nook_companion_core::AuthenticationFieldObservationFacts {
                    current_password_field_count: 1,
                    ..Default::default()
                },
                ceremony: nook_companion_core::AuthenticationCeremonyObservationFacts {
                    advance_control:
                        nook_companion_core::AuthenticationAdvanceControlEvidence::Present,
                    ..Default::default()
                },
                ..Default::default()
            }],
        };
        assert_eq!(
            companion_authentication_workflow_match_kind(
                classify_companion_authentication_workflow_facts(input)
            ),
            CompanionAuthenticationWorkflowMatchKind::NoMatch
        );

        let legitimate_submit = nook_companion_core::AuthenticationPageObservationFactsBatch {
            observations: vec![nook_companion_core::AuthenticationPageObservationFacts {
                fields: nook_companion_core::AuthenticationFieldObservationFacts {
                    username_field_count: 1,
                    current_password_field_count: 1,
                    ..Default::default()
                },
                detailed_advance_control:
                    nook_companion_core::AuthenticationDetailedAdvanceControlObservation::Observed(
                        nook_companion_core::AuthenticationAdvanceControlObservation {
                            actionability:
                                nook_companion_core::PageControlActionability::Actionable,
                            ownership: nook_companion_core::PageControlOwnership::OwnedForm,
                            semantics: nook_companion_core::PageControlSemantics::SemanticSubmit,
                            authentication_username:
                                nook_companion_core::AuthenticationUsernameEvidence::Strong,
                            password_field_count: 1,
                            new_password_field_count: 0,
                            one_time_code_field_count: 0,
                            semantic_submit_control_count: 1,
                            form_identity: String::new(),
                            destination_identity: String::new(),
                            label: "Continue".to_owned(),
                        },
                    ),
                ..Default::default()
            }],
        };
        assert!(matches!(
            classify_companion_authentication_workflow_facts(legitimate_submit),
            nook_companion_core::AuthenticationWorkflowMatch::Matched(snapshot)
                if snapshot.action
                    == nook_companion_core::AuthenticationWorkflowAction::ContinueWithNook
        ));
    }
}

#[cfg(all(test, target_arch = "wasm32"))]
mod wasm_tests {
    use nook_companion_core::{ExtensionPersistenceArea, ExtensionPersistenceObservation};
    use wasm_bindgen_test::wasm_bindgen_test;

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
}
