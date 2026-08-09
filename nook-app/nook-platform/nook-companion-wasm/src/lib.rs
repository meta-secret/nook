//! Thin WASM exports for portable auth-companion heuristics and host policy.

#![allow(
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::must_use_candidate,
    clippy::uninlined_format_args
)]

use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen(js_name = pageHasBackupCodeHint)]
#[must_use]
pub fn page_has_backup_code_hint(text: &str) -> bool {
    nook_companion_core::page_has_backup_code_hint(text)
}

#[wasm_bindgen(js_name = extractBackupCodeCandidates)]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
pub fn extract_backup_code_candidates(text: String) -> Vec<String> {
    nook_companion_core::extract_backup_code_candidates(&text)
}

#[wasm_bindgen]
#[derive(Clone, Debug)]
pub struct NookPageInputFieldObservation {
    inner: nook_companion_core::PageInputFieldObservation,
}

#[wasm_bindgen]
impl NookPageInputFieldObservation {
    #[wasm_bindgen(constructor)]
    #[allow(clippy::too_many_arguments, clippy::needless_pass_by_value)]
    pub fn new(
        input_type: nook_companion_core::PageInputType,
        disabled: bool,
        read_only: bool,
        autocomplete_tokens: Vec<String>,
        identity_text: String,
        login_context: bool,
    ) -> Self {
        Self {
            inner: nook_companion_core::PageInputFieldObservation {
                input_type,
                disabled,
                read_only,
                autocomplete_tokens,
                identity_text,
                login_context,
            },
        }
    }
}

#[wasm_bindgen(js_name = expandIdentityText)]
#[must_use]
pub fn expand_identity_text(value: &str) -> String {
    nook_companion_core::expand_identity_text(value)
}

#[wasm_bindgen]
#[derive(Clone, Debug)]
pub struct NookLoginContextObservation {
    inner: nook_companion_core::LoginContextObservation,
}

#[wasm_bindgen]
impl NookLoginContextObservation {
    #[wasm_bindgen(constructor)]
    #[allow(clippy::needless_pass_by_value)]
    pub fn new(
        form_identity: String,
        ancestor_identities: Vec<String>,
        advance_control_label: String,
        path_context: String,
    ) -> Self {
        Self {
            inner: nook_companion_core::LoginContextObservation {
                form_identity,
                ancestor_identities,
                advance_control_label,
                path_context,
            },
        }
    }
}

#[wasm_bindgen(js_name = hasLoginContext)]
#[must_use]
pub fn has_login_context(observation: &NookLoginContextObservation) -> bool {
    nook_companion_core::has_login_context(&observation.inner)
}

#[wasm_bindgen(js_name = looksLikeUsernameField)]
#[must_use]
pub fn looks_like_username_field(field: &NookPageInputFieldObservation) -> bool {
    nook_companion_core::looks_like_username_field(&field.inner)
}

#[wasm_bindgen(js_name = looksLikeOneTimeCodeField)]
#[must_use]
pub fn looks_like_one_time_code_field(field: &NookPageInputFieldObservation) -> bool {
    nook_companion_core::looks_like_one_time_code_field(&field.inner)
}

#[wasm_bindgen(js_name = looksLikePasskeyControlLabel)]
#[must_use]
pub fn looks_like_passkey_control_label(label: &str) -> bool {
    nook_companion_core::looks_like_passkey_control_label(label)
}

#[wasm_bindgen(js_name = looksLikeManualCheckpointLabel)]
#[must_use]
pub fn looks_like_manual_checkpoint_label(label: &str) -> bool {
    nook_companion_core::looks_like_manual_checkpoint_label(label)
}

#[wasm_bindgen(js_name = looksLikeEmailVerificationBody)]
#[must_use]
pub fn looks_like_email_verification_body(body: &str) -> bool {
    nook_companion_core::looks_like_email_verification_body(body)
}

#[wasm_bindgen(js_name = parsePageInputType)]
#[must_use]
pub fn parse_page_input_type(value: &str) -> nook_companion_core::PageInputType {
    nook_companion_core::PageInputType::parse(value)
}

#[wasm_bindgen(js_name = extensionPersistenceDatabaseName)]
#[must_use]
pub fn extension_persistence_database_name(
    area: nook_companion_core::ExtensionPersistenceArea,
) -> String {
    area.database_name().to_owned()
}

#[wasm_bindgen(js_name = extensionPersistenceStoreNames)]
#[must_use]
pub fn extension_persistence_store_names(
    area: nook_companion_core::ExtensionPersistenceArea,
) -> Vec<String> {
    area.store_names()
}

#[wasm_bindgen(js_name = classifyExtensionPersistenceDatabases)]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
pub fn classify_extension_persistence_databases(
    input: nook_companion_core::ExtensionPersistenceObservation,
) -> nook_companion_core::ExtensionPersistenceDatabaseState {
    nook_companion_core::classify_extension_database_names(input.area, &input.observed_names)
}

#[wasm_bindgen(js_name = classifyExtensionPersistenceStores)]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
pub fn classify_extension_persistence_stores(
    input: nook_companion_core::ExtensionPersistenceObservation,
) -> nook_companion_core::ExtensionPersistenceStoreState {
    nook_companion_core::classify_extension_store_names(input.area, &input.observed_names)
}

#[wasm_bindgen(js_name = matchingExtensionPersistenceStores)]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
pub fn matching_extension_persistence_stores(
    input: nook_companion_core::ExtensionPersistenceObservation,
) -> Vec<String> {
    nook_companion_core::matching_extension_store_names(input.area, &input.observed_names)
}

#[wasm_bindgen(js_name = classifyCompanionAuthenticationWorkflow)]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
pub fn classify_companion_authentication_workflow(
    input: nook_companion_core::AuthenticationPageObservations,
) -> nook_companion_core::AuthenticationWorkflowViewMatch {
    nook_companion_core::classify_authentication_workflow_candidates(&input.observations).into()
}

#[wasm_bindgen(js_name = classifyCompanionAuthenticationOutcome)]
#[must_use]
pub fn classify_companion_authentication_outcome(
    input: nook_companion_core::AuthenticationOutcomeClassification,
) -> nook_companion_core::AuthenticationOutcomeDecision {
    nook_companion_core::AuthenticationOutcomeDecision::classify(
        input.observation,
        input.timeout_ms,
    )
}

#[wasm_bindgen(js_name = classifyCompanionAuthenticationOutcomeWithDefaultTimeout)]
#[must_use]
pub fn classify_companion_authentication_outcome_with_default_timeout(
    observation: nook_companion_core::AuthenticationOutcomeObservation,
) -> nook_companion_core::AuthenticationOutcomeDecision {
    nook_companion_core::AuthenticationOutcomeDecision::classify(
        observation,
        nook_companion_core::DEFAULT_OUTCOME_EVIDENCE_TIMEOUT_MS,
    )
}

#[wasm_bindgen(js_name = extensionPairingGrantStorageKey)]
#[must_use]
pub fn extension_pairing_grant_storage_key(vault_store_id: &str) -> String {
    nook_companion_core::grant_storage_key(vault_store_id)
}

#[wasm_bindgen(js_name = extensionPairingSetupStorageKey)]
#[must_use]
pub fn extension_pairing_setup_storage_key() -> String {
    nook_companion_core::EXTENSION_SETUP_KEY.to_owned()
}

#[wasm_bindgen(js_name = createExtensionPairingState)]
#[allow(clippy::needless_pass_by_value)]
pub fn create_extension_pairing_state(
    input: nook_companion_core::CreateExtensionPairingStateInput,
) -> Result<nook_companion_core::ExtensionPairingState, wasm_bindgen::JsError> {
    nook_companion_core::create_pairing_state(input)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[wasm_bindgen(js_name = refreshExtensionPairingGrant)]
#[allow(clippy::needless_pass_by_value)]
pub fn refresh_extension_pairing_grant(
    input: nook_companion_core::RefreshExtensionPairingGrantInput,
) -> Result<nook_companion_core::ExtensionPairingState, wasm_bindgen::JsError> {
    nook_companion_core::refresh_pairing_grant(input)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[wasm_bindgen(js_name = orderedExtensionPairingGrants)]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
pub fn ordered_extension_pairing_grants(
    state: nook_companion_core::ExtensionPairingState,
) -> Vec<nook_companion_core::StoredExtensionPairingGrant> {
    state.ordered_grants()
}

#[wasm_bindgen(js_name = selectedExtensionPairingGrant)]
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

#[wasm_bindgen(js_name = firstExtensionPairingGrant)]
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

#[wasm_bindgen(js_name = extensionSetupAfterPairingGrantRemoval)]
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

#[wasm_bindgen(js_name = isStoredExtensionPairingGrantJson)]
#[must_use]
pub fn is_stored_extension_pairing_grant_json(value: &str) -> bool {
    nook_companion_core::is_stored_pairing_grant_json(value)
}

#[wasm_bindgen(js_name = isExtensionReadySetupJson)]
#[must_use]
pub fn is_extension_ready_setup_json(value: &str) -> bool {
    nook_companion_core::is_ready_pairing_setup_json(value)
}

#[wasm_bindgen(js_name = migrateLegacyExtensionPairingStateJson)]
pub fn migrate_legacy_extension_pairing_state_json(
    value: &str,
) -> Result<nook_companion_core::ExtensionPairingState, wasm_bindgen::JsError> {
    nook_companion_core::migrate_legacy_pairing_state_json(value)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[wasm_bindgen(js_name = isCloudflarePrPreviewHost)]
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
    #[wasm_bindgen(js_name = isSupported)]
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

    #[wasm_bindgen(js_name = isUnsupported)]
    #[must_use]
    pub fn is_unsupported(&self) -> bool {
        matches!(
            self.inner,
            nook_companion_core::OAuthOriginSupport::Unsupported { .. }
        )
    }

    /// Reason when [`Self::is_unsupported`] is true; otherwise `UnregisteredOrigin`.
    #[wasm_bindgen(js_name = unsupportedReason)]
    #[must_use]
    pub fn unsupported_reason(&self) -> nook_companion_core::OAuthOriginUnsupportedReason {
        match self.inner {
            nook_companion_core::OAuthOriginSupport::Unsupported { reason, .. } => reason,
            _ => nook_companion_core::OAuthOriginUnsupportedReason::UnregisteredOrigin,
        }
    }
}

#[wasm_bindgen(js_name = resolveOAuthOriginSupport)]
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

#[wasm_bindgen(js_name = defaultSimpleVaultUrl)]
#[must_use]
pub fn default_simple_vault_url() -> String {
    nook_companion_core::DEFAULT_SIMPLE_VAULT_URL.to_owned()
}

#[wasm_bindgen(js_name = normalizeSimpleVaultBaseUrl)]
pub fn normalize_simple_vault_base_url(value: &str) -> Result<String, wasm_bindgen::JsError> {
    Ok(nook_companion_core::normalize_simple_vault_base_url(value)?)
}

#[wasm_bindgen(js_name = simpleVaultUrl)]
pub fn simple_vault_url(base_url: &str, path: &str) -> Result<String, wasm_bindgen::JsError> {
    Ok(nook_companion_core::simple_vault_url(base_url, path)?)
}

#[wasm_bindgen(js_name = simpleVaultMatchPattern)]
pub fn simple_vault_match_pattern(base_url: &str) -> Result<String, wasm_bindgen::JsError> {
    Ok(nook_companion_core::simple_vault_match_pattern(base_url)?)
}

/// Matching Sentinel base URL for `base_url`, or an empty string when none matches.
#[wasm_bindgen(js_name = matchingSentinelVaultBaseUrl)]
pub fn matching_sentinel_vault_base_url(base_url: &str) -> Result<String, wasm_bindgen::JsError> {
    Ok(nook_companion_core::matching_sentinel_vault_base_url(base_url)?.unwrap_or_default())
}

#[wasm_bindgen(js_name = sentinelVaultMatchPatterns)]
pub fn sentinel_vault_match_patterns(base_url: &str) -> Result<Vec<String>, wasm_bindgen::JsError> {
    Ok(nook_companion_core::sentinel_vault_match_patterns(
        base_url,
    )?)
}

#[wasm_bindgen(js_name = isSimpleVaultHostname)]
#[must_use]
pub fn is_simple_vault_hostname(hostname: &str) -> bool {
    nook_companion_core::is_simple_vault_hostname(hostname)
}

#[wasm_bindgen(js_name = isSentinelVaultHostname)]
#[must_use]
pub fn is_sentinel_vault_hostname(hostname: &str) -> bool {
    nook_companion_core::is_sentinel_vault_hostname(hostname)
}

#[wasm_bindgen(js_name = nookVaultAppExcludeMatchPatterns)]
pub fn nook_vault_app_exclude_match_patterns(
    base_url: &str,
) -> Result<Vec<String>, wasm_bindgen::JsError> {
    Ok(nook_companion_core::nook_vault_app_exclude_match_patterns(
        base_url,
    )?)
}

/// `base_url` may be empty when no configured vault base is available.
#[wasm_bindgen(js_name = isNookVaultAppUrl)]
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

#[wasm_bindgen(js_name = belongsToSimpleVault)]
pub fn belongs_to_simple_vault(
    base_url: &str,
    candidate_url: &str,
) -> Result<bool, wasm_bindgen::JsError> {
    Ok(nook_companion_core::belongs_to_simple_vault(
        base_url,
        candidate_url,
    )?)
}

#[wasm_bindgen(js_name = belongsToSentinelVault)]
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
    fn page_field_wasm_exports_classify_otp_and_username() {
        let otp = NookPageInputFieldObservation::new(
            nook_companion_core::PageInputType::Text,
            false,
            false,
            Vec::new(),
            "Enter OTP Code".to_owned(),
            false,
        );
        assert!(looks_like_one_time_code_field(&otp));

        let username = NookPageInputFieldObservation::new(
            nook_companion_core::PageInputType::Text,
            false,
            false,
            Vec::new(),
            "loginfmt".to_owned(),
            false,
        );
        assert!(looks_like_username_field(&username));
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
}
