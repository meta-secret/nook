//! Thin WASM exports for portable auth-companion heuristics and host policy.

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
    clippy::must_use_candidate,
    clippy::uninlined_format_args
)]

use nook_companion_core::AuthenticationUsernameEvidence;
#[cfg(test)]
use nook_companion_core::BackupCodeCandidatePresence;
use nook_companion_core::BackupCodePageText;
use nook_companion_core::{
    ExtensionPairingState, ExtensionReadySetup, StoredExtensionPairingGrant,
};
use wasm_bindgen::prelude::wasm_bindgen;

mod account_picker_authorization;
mod authentication_observation_binding;
mod authentication_workflow;
mod authenticator_code_response;
mod companion_pairing;
mod companion_protocol;
mod credential_fill;
mod extension_persistence;
mod grant_authority;
mod page_form_policy;
mod response_decoding;
mod vault_host_policy;

pub use account_picker_authorization::*;
pub use authentication_observation_binding::*;
pub use authentication_workflow::*;
pub use authenticator_code_response::*;
pub use companion_pairing::*;
pub use companion_protocol::*;
pub use credential_fill::*;
pub use extension_persistence::*;
pub use grant_authority::*;
pub use page_form_policy::*;
pub use response_decoding::*;
pub use vault_host_policy::*;

#[wasm_bindgen]
#[must_use]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn page_has_backup_code_hint(text: &str) -> bool {
    BackupCodePageText::new(text).page_has_backup_code_hint()
}

#[wasm_bindgen]
#[must_use]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn contains_backup_code_candidate(text: &str) -> bool {
    BackupCodePageText::new(text).contains_backup_code_candidate()
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn extract_backup_code_candidates(text: String) -> Vec<String> {
    BackupCodePageText::new(&text).extract_backup_code_candidates()
}

#[wasm_bindgen]
#[must_use]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn authentication_username_evidence(
    field: &NookPageInputFieldObservation,
) -> nook_companion_core::AuthenticationUsernameEvidence {
    (field.as_core()).authentication_username_evidence()
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn strongest_authentication_username_evidence(
    evidence: Vec<nook_companion_core::AuthenticationUsernameEvidence>,
) -> nook_companion_core::AuthenticationUsernameEvidence {
    AuthenticationUsernameEvidence::strongest_authentication_username_evidence(&evidence)
}

#[wasm_bindgen]
#[must_use]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
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
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
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
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn validate_companion_authentication_outcome_decision(
    decision: nook_companion_core::AuthenticationOutcomeDecision,
) -> nook_companion_core::AuthenticationOutcomeDecision {
    decision
}

#[wasm_bindgen]
#[must_use]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn extension_pairing_grant_storage_key(vault_store_id: &str) -> String {
    StoredExtensionPairingGrant::storage_key_for(vault_store_id)
}

#[wasm_bindgen]
#[must_use]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn extension_pairing_setup_storage_key() -> String {
    nook_companion_core::EXTENSION_SETUP_KEY.to_owned()
}

#[wasm_bindgen]
#[must_use]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn extension_vault_access_scope() -> nook_companion_core::ExtensionConnectScope {
    nook_companion_core::ExtensionConnectScope::VaultAccess
}

#[wasm_bindgen]
#[must_use]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn extension_password_filling_scope() -> nook_companion_core::ExtensionConnectScope {
    nook_companion_core::ExtensionConnectScope::PasswordFilling
}

#[wasm_bindgen]
#[must_use]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn extension_passkey_management_scope() -> nook_companion_core::ExtensionConnectScope {
    nook_companion_core::ExtensionConnectScope::PasskeyManagement
}

#[wasm_bindgen]
#[must_use]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn extension_sync_provider_credentials_scope() -> nook_companion_core::ExtensionConnectScope {
    nook_companion_core::ExtensionConnectScope::SyncProviderCredentials
}

#[wasm_bindgen]
#[must_use]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn is_extension_connect_scope(value: &str) -> bool {
    nook_companion_core::ExtensionConnectScope::parse(value).is_ok()
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn create_extension_pairing_state(
    input: nook_companion_core::CreateExtensionPairingStateInput,
) -> Result<nook_companion_core::ExtensionPairingState, wasm_bindgen::JsError> {
    ExtensionPairingState::create(input)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn refresh_extension_pairing_grant(
    input: nook_companion_core::RefreshExtensionPairingGrantInput,
) -> Result<nook_companion_core::ExtensionPairingState, wasm_bindgen::JsError> {
    ExtensionPairingState::refresh_grant(input)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn ordered_extension_pairing_grants(
    state: nook_companion_core::ExtensionPairingState,
) -> Vec<nook_companion_core::StoredExtensionPairingGrant> {
    state.ordered_grants()
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn selected_extension_pairing_grant(
    state: nook_companion_core::ExtensionPairingState,
) -> nook_companion_core::SelectedExtensionPairingGrant {
    state.selected_grant()
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn first_extension_pairing_grant(
    state: nook_companion_core::ExtensionPairingState,
) -> nook_companion_core::SelectedExtensionPairingGrant {
    state.first_grant()
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn extension_setup_after_pairing_grant_removal(
    input: nook_companion_core::ExtensionPairingGrantRemovalInput,
) -> nook_companion_core::ExtensionSetupAfterRemoval {
    input
        .state
        .setup_after_removal(&input.removed_vault_store_id)
}

#[wasm_bindgen]
#[must_use]
// Existing browser boolean projection; this outer boundary remains to be migrated.
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn is_stored_extension_pairing_grant_json(value: &str) -> bool {
    StoredExtensionPairingGrant::validate_json(value).is_ok()
}

#[wasm_bindgen]
#[must_use]
// Existing browser boolean projection; this outer boundary remains to be migrated.
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn is_extension_ready_setup_json(value: &str) -> bool {
    ExtensionReadySetup::validate_json(value).is_ok()
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn migrate_legacy_extension_pairing_state_json(
    value: &str,
) -> Result<nook_companion_core::ExtensionPairingState, wasm_bindgen::JsError> {
    ExtensionPairingState::migrate_legacy_json(value)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use nook_companion_core::{
        AuthenticationBackupCodesEvidence, AuthenticationBackupCodesObservation,
        AuthenticationEnrollmentObservation, AuthenticationWorkflowMatch, ExtensionEventCount,
    };
    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn workflow_wasm_export_rejects_unbounded_observations() {
        let input = nook_companion_core::AuthenticationPageObservations {
            observations: vec![nook_companion_core::AuthenticationPageObservation {
                one_time_code_field_count:
                    (nook_companion_core::MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT + 1).into(),
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
    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
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
    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
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
        let tesla = NookPageInputFieldObservation::new(
            nook_companion_core::PageInputType::Text,
            false,
            false,
            vec!["email".to_owned(), "webauthn".to_owned()],
            "identity".to_owned(),
            false,
        );
        assert_eq!(
            authentication_username_evidence(&tesla),
            nook_companion_core::AuthenticationUsernameEvidence::WebAuthnEmail
        );
        let airbnb = NookPageInputFieldObservation::new(
            nook_companion_core::PageInputType::Text,
            false,
            false,
            vec!["tel-national".to_owned()],
            "tel-national Phone number or email".to_owned(),
            true,
        );
        assert_eq!(
            authentication_username_evidence(&airbnb),
            nook_companion_core::AuthenticationUsernameEvidence::MixedPhoneOrEmail
        );
        assert_eq!(
            strongest_authentication_username_evidence(vec![
                nook_companion_core::AuthenticationUsernameEvidence::Absent,
                nook_companion_core::AuthenticationUsernameEvidence::StandardsBasedEmail,
                nook_companion_core::AuthenticationUsernameEvidence::MixedPhoneOrEmail,
                nook_companion_core::AuthenticationUsernameEvidence::WebAuthnEmail,
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
    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn saved_login_capability_export_rejects_impossible_snapshots() {
        let valid = nook_companion_core::AuthenticationWorkflowSnapshot {
            kind: nook_companion_core::AuthenticationWorkflowKind::Login,
            stage: nook_companion_core::AuthenticationWorkflowStage::Credentials,
            action: nook_companion_core::AuthenticationWorkflowAction::ContinueWithNook,
            current_step: 1.into(),
            total_steps: 3.into(),
            approval_requirement:
                nook_companion_core::AuthenticationApprovalRequirement::ExplicitUserApproval,
            saved_login_capability:
                nook_companion_core::AuthenticationSavedLoginCapability::FillSavedLogin,
            observation_index: 0.into(),
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
    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn backup_code_classifier_bridge_preserves_typed_variants() {
        assert_eq!(
            AuthenticationBackupCodesObservation::classify_authentication_backup_codes_observation(
                AuthenticationBackupCodesEvidence {
                    text: "Use a backup code instead",
                    candidate_presence: BackupCodeCandidatePresence::Absent
                }
            ),
            nook_companion_core::AuthenticationBackupCodesObservation::Absent
        );
        assert_eq!(
            AuthenticationBackupCodesObservation::classify_authentication_backup_codes_observation(
                AuthenticationBackupCodesEvidence {
                    text: "Save your recovery codes in a secure place",
                    candidate_presence: BackupCodeCandidatePresence::Absent
                }
            ),
            nook_companion_core::AuthenticationBackupCodesObservation::Present
        );
    }
    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn enrollment_match_bridge_preserves_selected_recovery_action() -> Result<(), String> {
        let nook_companion_core::AuthenticationWorkflowMatch::Matched(snapshot) =
            AuthenticationWorkflowMatch::authentication_enrollment_workflow_match(
                AuthenticationEnrollmentObservation {
                    authenticator_setup_hint: true.into(),
                    backup_codes_copy: "Save these recovery codes",
                    manual_checkpoint_present: false.into(),
                },
            )
        else {
            return Err("expected a selected enrollment workflow".to_owned());
        };
        assert_eq!(
            snapshot.action,
            nook_companion_core::AuthenticationWorkflowAction::SaveBackupCodes
        );
        Ok(())
    }
    fn pairing_approval() -> nook_companion_core::ExtensionPairingGrantApproval {
        nook_companion_core::ExtensionPairingGrantApproval {
            vault_type: nook_companion_core::ExtensionPairingVaultType::Simple,
            device_id: "device-test".to_owned(),
            device_public_key: "age1test".to_owned(),
            device_signing_public_key: "signing-test".to_owned(),
            device_label: "Nook Extension".to_owned(),
            vault_store_id: "store-test".to_owned(),
            vault_name: "Personal".to_owned(),
            approved_at: "2026-09-05T00:00:00.000Z".to_owned(),
            scopes: vec![nook_companion_core::ExtensionConnectScope::PasswordFilling],
            sync_provider_count: 1.into(),
        }
    }
    fn imported_event_log(event_count: u32) -> nook_companion_core::ImportedExtensionEventLog {
        nook_companion_core::ImportedExtensionEventLog {
            vault_store_id: "store-test".to_owned(),
            event_count: event_count.into(),
            heads: vec![format!("event-{event_count}")],
            access_granted: true,
        }
    }
    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn pairing_exports_preserve_creation_refresh_selection_and_json_validation()
    -> Result<(), String> {
        let created =
            create_extension_pairing_state(nook_companion_core::CreateExtensionPairingStateInput {
                grant: pairing_approval(),
                imported: imported_event_log(2),
                observed_at: "2026-09-05T00:00:01.000Z".to_owned(),
            })
            .map_err(|error| format!("create failed: {error:?}"))?;
        let grant = ordered_extension_pairing_grants(created.clone())[0].clone();
        assert_eq!(grant.event_count, ExtensionEventCount::from(2));
        assert!(matches!(
            first_extension_pairing_grant(created.clone()),
            nook_companion_core::SelectedExtensionPairingGrant::Selected { grant }
                if grant.vault_store_id == "store-test"
        ));
        assert!(matches!(
            selected_extension_pairing_grant(created.clone()),
            nook_companion_core::SelectedExtensionPairingGrant::Selected { grant }
                if grant.vault_store_id == "store-test"
        ));
        assert!(is_stored_extension_pairing_grant_json(
            &serde_json::to_string(&grant).map_err(|error| error.to_string())?
        ));
        assert!(!is_stored_extension_pairing_grant_json("{}"));
        let refreshed = refresh_extension_pairing_grant(
            nook_companion_core::RefreshExtensionPairingGrantInput {
                grant,
                imported: imported_event_log(4),
                observed_at: "2026-09-05T00:00:04.000Z".to_owned(),
                select: true,
            },
        )
        .map_err(|error| format!("refresh failed: {error:?}"))?;
        let refreshed_grants = ordered_extension_pairing_grants(refreshed.clone());
        assert_eq!(
            refreshed_grants[0].event_count,
            ExtensionEventCount::from(4)
        );
        assert!(matches!(
            extension_setup_after_pairing_grant_removal(
                nook_companion_core::ExtensionPairingGrantRemovalInput {
                    state: refreshed,
                    removed_vault_store_id: "store-test".to_owned(),
                }
            ),
            nook_companion_core::ExtensionSetupAfterRemoval::NoPairedVault
        ));
        assert!(migrate_legacy_extension_pairing_state_json("{").is_err());
        Ok(())
    }
    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn remaining_export_families_preserve_closed_policy_and_url_boundaries() -> Result<(), String> {
        let outcome = classify_companion_authentication_outcome(
            nook_companion_core::AuthenticationOutcomeClassification {
                observation: nook_companion_core::AuthenticationOutcomeObservation {
                    success_marker_present: true,
                    error_marker_present: true,
                    ..Default::default()
                },
                timeout_ms: 1_000.into(),
            },
        );
        assert_eq!(
            outcome.verdict,
            nook_companion_core::AuthenticationOutcomeVerdict::Conflicting
        );
        assert!(!outcome.allows_credential_commit);
        let validated = validate_companion_authentication_outcome_decision(outcome);
        assert_eq!(validated, outcome);
        assert_eq!(
            classify_companion_authentication_outcome_with_default_timeout(Default::default())
                .verdict,
            nook_companion_core::AuthenticationOutcomeVerdict::Insufficient
        );
        assert_eq!(
            extension_pairing_grant_storage_key("store-test"),
            "nook:extension-pairing-grant:store-test"
        );
        assert!(extension_pairing_setup_storage_key().ends_with("setup"));
        for scope in [
            extension_vault_access_scope(),
            extension_password_filling_scope(),
            extension_passkey_management_scope(),
            extension_sync_provider_credentials_scope(),
        ] {
            assert!(is_extension_connect_scope(scope.as_str()));
        }
        assert!(!is_extension_connect_scope("foreign-scope"));
        assert!(BackupCodePageText::new("A1B2-C3D4-E5F6").contains_backup_code_candidate());
        assert_eq!(default_simple_vault_url(), "https://simple.nokey.sh/");
        assert_eq!(
            VaultHostPolicy::new("https://simple.nokey.sh/root")
                .simple_vault_url("/login")
                .map_err(|error| format!("url failed: {error:?}"))?,
            "https://simple.nokey.sh/root/login"
        );
        assert_eq!(
            VaultHostPolicy::new("https://simple.nokey.sh/")
                .matching_sentinel_vault_base_url()
                .map_err(|error| format!("match failed: {error:?}"))?,
            SentinelVaultMatch::MatchingBaseUrl("https://sentinel.nokey.sh/".to_owned())
        );
        assert!(
            VaultHostPolicy::new("https://vault.example.test/simple/")
                .belongs_to_simple_vault("https://vault.example.test/simple/app")
                .map_err(|error| format!("membership failed: {error:?}"))?
        );
        assert!(
            VaultHostPolicy::new("http://example.test")
                .simple_vault_url("/app")
                .is_err()
        );
        let preview = resolve_oauth_origin_support(
            nook_companion_core::BrowserOAuthProvider::GoogleDrive,
            "https://pr-42.nokey-simple.pages.dev",
            "PR-42.NOKEY-SIMPLE.PAGES.DEV",
        );
        assert!(preview.is_unsupported());
        assert_eq!(
            preview.unsupported_reason(),
            OAuthOriginUnsupportedReason::CloudflarePrPreview
        );
        let preview_host = "PR-42.NOKEY-SIMPLE.PAGES.DEV";
        assert!(is_cloudflare_pr_preview_host(preview_host));
        assert!(!is_cloudflare_pr_preview_host(&format!(
            "{preview_host}.evil.test"
        )));
        Ok(())
    }
}

#[cfg(all(test, target_arch = "wasm32"))]
mod wasm_tests {
    use std::fmt;

    use nook_companion_core::{
        AuthenticationBackupCodesEvidence, AuthenticationBackupCodesObservation,
        BackupCodeCandidatePresence, ExtensionPersistenceArea, ExtensionPersistenceObservation,
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
    #[serde(untagged)]
    enum SessionFixtureDevice {
        Omitted,
        Identity(SessionDeviceFixture),
    }
    impl SessionFixtureDevice {
        fn omitted(&self) -> bool {
            matches!(self, Self::Omitted)
        }
    }
    #[derive(Serialize)]
    struct SessionStatusFixture {
        ok: bool,
        status: u8,
        #[serde(skip_serializing_if = "SessionFixtureDevice::omitted")]
        device: SessionFixtureDevice,
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

    fn js_error(error: impl fmt::Display) -> wasm_bindgen::JsError {
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
                device: SessionFixtureDevice::Omitted,
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
            device: SessionFixtureDevice::Identity(SessionDeviceFixture {
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
            let classified = AuthenticationBackupCodesObservation::classify_authentication_backup_codes_observation(AuthenticationBackupCodesEvidence { text: text, candidate_presence: BackupCodeCandidatePresence::Absent });
            let js_value = serde_wasm_bindgen::to_value(&classified)?;
            let decoded: AuthenticationBackupCodesObservation =
                serde_wasm_bindgen::from_value(js_value)?;
            assert_eq!(classified, expected);
            assert_eq!(decoded, expected);
        }
        Ok(())
    }
}

#[wasm_bindgen]
#[must_use]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn compare_extension_pairing_records(
    request: nook_companion_core::ExtensionPairingRecordComparisonRequest,
) -> nook_companion_core::ExtensionPairingRecordComparison {
    request.compare()
}

mod browser_material_admission;
pub use browser_material_admission::*;

mod bridge_coverage;
