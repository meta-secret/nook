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
#[cfg(test)]
#[cfg(test)]
use nook_companion_core::ExtensionConnectScope;

use nook_companion_core::AuthenticationOutcomeDecision;
use tsify::Tsify;
use wasm_bindgen::JsError;

use nook_companion_core::AuthenticationUsernameEvidence;
#[cfg(test)]
#[cfg(test)]
use nook_companion_core::BackupCodeCandidatePresence;
use nook_companion_core::BackupCodePageText;
use wasm_bindgen::prelude::wasm_bindgen;

mod authentication_action_projection;
pub use authentication_action_projection::*;
mod account_picker_authorization;
mod authentication_control_actuation;
mod authentication_observation_binding;
mod authentication_workflow;
mod authenticator_code_response;
mod companion_pairing;
mod companion_protocol;
mod credential_fill;
mod extension_pairing;
mod extension_persistence;
mod grant_authority;
mod page_form_policy;
mod response_decoding;
mod vault_host_policy;

pub use account_picker_authorization::*;
pub use authentication_control_actuation::*;
pub use authentication_observation_binding::*;
pub use authentication_workflow::*;
pub use authenticator_code_response::*;
pub use companion_pairing::*;
pub use companion_protocol::*;
pub use credential_fill::*;
pub use extension_pairing::*;
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
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn authentication_username_evidence(
    field: &NookPageInputFieldObservation,
) -> Result<tsify::Ts<nook_companion_core::AuthenticationUsernameEvidence>, wasm_bindgen::JsError> {
    let result = { (field.as_core()).authentication_username_evidence() };
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn strongest_authentication_username_evidence(
    evidence: Vec<tsify::Ts<nook_companion_core::AuthenticationUsernameEvidence>>,
) -> Result<tsify::Ts<nook_companion_core::AuthenticationUsernameEvidence>, wasm_bindgen::JsError> {
    let evidence = evidence
        .into_iter()
        .map(|value| value.to_rust())
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let result =
        { AuthenticationUsernameEvidence::strongest_authentication_username_evidence(&evidence) };
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn classify_companion_authentication_outcome(
    input: &tsify::Ts<nook_companion_core::AuthenticationOutcomeClassification>,
) -> Result<tsify::Ts<nook_companion_core::AuthenticationOutcomeDecision>, wasm_bindgen::JsError> {
    let input = input
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let result = { AuthenticationOutcomeDecision::classify(input.observation, input.timeout_ms) };
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn classify_companion_authentication_outcome_with_default_timeout(
    observation: &tsify::Ts<nook_companion_core::AuthenticationOutcomeObservation>,
) -> Result<tsify::Ts<nook_companion_core::AuthenticationOutcomeDecision>, wasm_bindgen::JsError> {
    let observation = observation
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let result = {
        AuthenticationOutcomeDecision::classify(
            observation,
            nook_companion_core::DEFAULT_OUTCOME_EVIDENCE_TIMEOUT_MS,
        )
    };
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn validate_companion_authentication_outcome_decision(
    decision: &tsify::Ts<nook_companion_core::AuthenticationOutcomeDecision>,
) -> Result<tsify::Ts<nook_companion_core::AuthenticationOutcomeDecision>, wasm_bindgen::JsError> {
    let decision = decision
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let result = { decision };
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(test)]
    #[cfg(test)]
    use nook_companion_core::AuthenticationApprovalRequirement;
    use nook_companion_core::AuthenticationOutcomeDecision;
    #[cfg(test)]
    #[cfg(test)]
    use nook_companion_core::AuthenticationOutcomeObservation;
    #[cfg(test)]
    #[cfg(test)]
    use nook_companion_core::AuthenticationOutcomeVerdict;
    #[cfg(test)]
    #[cfg(test)]
    use nook_companion_core::AuthenticationPilotPresentationCapability;
    #[cfg(test)]
    #[cfg(test)]
    use nook_companion_core::AuthenticationSavedLoginCapability;
    use nook_companion_core::AuthenticationUsernameEvidence;
    #[cfg(test)]
    #[cfg(test)]
    use nook_companion_core::AuthenticationWorkflowAction;
    #[cfg(test)]
    #[cfg(test)]
    use nook_companion_core::AuthenticationWorkflowKind;
    #[cfg(test)]
    #[cfg(test)]
    use nook_companion_core::AuthenticationWorkflowStage;
    #[cfg(test)]
    #[cfg(test)]
    use nook_companion_core::BrowserOAuthProvider;
    #[cfg(test)]
    #[cfg(test)]
    use nook_companion_core::PageInputType;
    use nook_companion_core::{
        AuthenticationBackupCodesEvidence, AuthenticationBackupCodesObservation,
        AuthenticationEnrollmentObservation, AuthenticationWorkflowMatch,
        OAuthOriginUnsupportedReason, SentinelVaultMatch, VaultHostPolicy,
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
        assert!(matches!(
            AuthenticationWorkflowMatch::classify_authentication_workflow_candidates(
                &(input).observations
            ),
            AuthenticationWorkflowMatch::Rejected
        ));
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
        assert!(matches!(
            (input).classify(),
            AuthenticationWorkflowMatch::Rejected
        ));
    }
    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn username_evidence_exports_preserve_core_classification_and_ordering() {
        let field = NookPageInputFieldObservation::new(
            PageInputType::Email,
            false,
            false,
            vec!["email".to_owned()],
            "account email".to_owned(),
            true,
        );
        assert_eq!(
            field.as_core().authentication_username_evidence(),
            AuthenticationUsernameEvidence::Strong
        );
        let tesla = NookPageInputFieldObservation::new(
            PageInputType::Text,
            false,
            false,
            vec!["email".to_owned(), "webauthn".to_owned()],
            "identity".to_owned(),
            false,
        );
        assert_eq!(
            tesla.as_core().authentication_username_evidence(),
            AuthenticationUsernameEvidence::WebAuthnEmail
        );
        let airbnb = NookPageInputFieldObservation::new(
            PageInputType::Text,
            false,
            false,
            vec!["tel-national".to_owned()],
            "tel-national Phone number or email".to_owned(),
            true,
        );
        assert_eq!(
            airbnb.as_core().authentication_username_evidence(),
            AuthenticationUsernameEvidence::MixedPhoneOrEmail
        );
        assert_eq!(
            AuthenticationUsernameEvidence::strongest_authentication_username_evidence(
                &(vec![
                    AuthenticationUsernameEvidence::Absent,
                    AuthenticationUsernameEvidence::StandardsBasedEmail,
                    AuthenticationUsernameEvidence::MixedPhoneOrEmail,
                    AuthenticationUsernameEvidence::WebAuthnEmail,
                    AuthenticationUsernameEvidence::Explicit,
                    AuthenticationUsernameEvidence::Strong,
                ])
            ),
            AuthenticationUsernameEvidence::Explicit
        );
        assert_eq!(
            AuthenticationUsernameEvidence::strongest_authentication_username_evidence(
                &(Vec::new())
            ),
            AuthenticationUsernameEvidence::Absent
        );
    }
    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn saved_login_capability_export_preserves_classifier_contract() {
        let valid = nook_companion_core::AuthenticationWorkflowSnapshot {
            kind: AuthenticationWorkflowKind::Login,
            stage: AuthenticationWorkflowStage::Credentials,
            action: AuthenticationWorkflowAction::ContinueWithNook,
            current_step: 1.into(),
            total_steps: 3.into(),
            approval_requirement: AuthenticationApprovalRequirement::ExplicitUserApproval,
            saved_login_capability: AuthenticationSavedLoginCapability::FillSavedLogin,
            observation_index: 0.into(),
        };
        assert_eq!(
            (valid).saved_login_capability(),
            AuthenticationSavedLoginCapability::FillSavedLogin
        );
        assert!((valid).requires_login_match_availability());
        assert!(
            (nook_companion_core::AuthenticationWorkflowSnapshot {
                action: AuthenticationWorkflowAction::UsePasskey,
                ..valid
            })
            .requires_login_match_availability()
        );
        assert_eq!(
            (valid).pilot_presentation_capability(),
            AuthenticationPilotPresentationCapability::ProposeAction
        );
        assert_eq!(
            (nook_companion_core::AuthenticationWorkflowSnapshot {
                stage: AuthenticationWorkflowStage::Recovery,
                ..valid
            })
            .saved_login_capability(),
            AuthenticationSavedLoginCapability::Unavailable
        );
        assert_eq!(
            (nook_companion_core::AuthenticationWorkflowSnapshot {
                stage: AuthenticationWorkflowStage::Recovery,
                ..valid
            })
            .pilot_presentation_capability(),
            AuthenticationPilotPresentationCapability::Hidden
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
            AuthenticationBackupCodesObservation::Absent
        );
        assert_eq!(
            AuthenticationBackupCodesObservation::classify_authentication_backup_codes_observation(
                AuthenticationBackupCodesEvidence {
                    text: "Save your recovery codes in a secure place",
                    candidate_presence: BackupCodeCandidatePresence::Absent
                }
            ),
            AuthenticationBackupCodesObservation::Present
        );
    }
    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn enrollment_match_bridge_preserves_selected_recovery_action() -> Result<(), String> {
        let AuthenticationWorkflowMatch::Matched(snapshot) =
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
            AuthenticationWorkflowAction::SaveBackupCodes
        );
        Ok(())
    }
    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn remaining_export_families_preserve_closed_policy_and_url_boundaries() -> Result<(), String> {
        let outcome = AuthenticationOutcomeDecision::classify(
            (nook_companion_core::AuthenticationOutcomeClassification {
                observation: nook_companion_core::AuthenticationOutcomeObservation {
                    success_marker_present: true,
                    error_marker_present: true,
                    ..Default::default()
                },
                timeout_ms: 1_000.into(),
            })
            .observation,
            (nook_companion_core::AuthenticationOutcomeClassification {
                observation: nook_companion_core::AuthenticationOutcomeObservation {
                    success_marker_present: true,
                    error_marker_present: true,
                    ..Default::default()
                },
                timeout_ms: 1_000.into(),
            })
            .timeout_ms,
        );
        assert_eq!(outcome.verdict, AuthenticationOutcomeVerdict::Conflicting);
        assert!(!outcome.allows_credential_commit);
        let validated = outcome;
        assert_eq!(validated, outcome);
        assert_eq!(
            AuthenticationOutcomeDecision::classify(
                AuthenticationOutcomeObservation::default(),
                nook_companion_core::DEFAULT_OUTCOME_EVIDENCE_TIMEOUT_MS
            )
            .verdict,
            AuthenticationOutcomeVerdict::Insufficient
        );
        assert_eq!(
            extension_pairing_grant_storage_key("store_abcdefghijk")
                .map_err(|error| format!("{error:?}"))?,
            "nook:extension-pairing-grant:store_abcdefghijk"
        );
        assert!(extension_pairing_setup_storage_key().ends_with("setup"));
        for scope in [
            ExtensionConnectScope::VaultAccess,
            ExtensionConnectScope::PasswordFilling,
            ExtensionConnectScope::PasskeyManagement,
            ExtensionConnectScope::SyncProviderCredentials,
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
            BrowserOAuthProvider::GoogleDrive,
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
    #[cfg(all(test, target_arch = "wasm32"))]
    #[cfg(all(test, target_arch = "wasm32"))]
    use nook_companion_core::AuthenticationWorkflowSelectedFacts;
    #[cfg(all(test, target_arch = "wasm32"))]
    #[cfg(all(test, target_arch = "wasm32"))]
    use nook_companion_core::ExtensionSessionStatusAvailability;
    use std::fmt;
    #[cfg(all(test, target_arch = "wasm32"))]
    use tsify::Ts;
    use wasm_bindgen::JsError;

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
        selected_facts: nook_companion_core::AuthenticationWorkflowSelectedFacts,
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
        JsError::new(&error.to_string())
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
            (0, ExtensionSessionStatusAvailability::Unavailable),
            (4, ExtensionSessionStatusAvailability::Locked),
            (5, ExtensionSessionStatusAvailability::Unavailable),
            (7, ExtensionSessionStatusAvailability::Unavailable),
        ] {
            let fixture = SessionStatusFixture {
                ok: true,
                status,
                device: SessionFixtureDevice::Omitted,
            };
            let js_input = serde_wasm_bindgen::to_value(&fixture).map_err(js_error)?;
            let wire = Ts::new_unchecked(js_input);
            assert_eq!(
                super::decode_extension_session_status_response(&wire)?,
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
        let wire = Ts::new_unchecked(js_input);
        assert_eq!(
            super::decode_extension_session_status_response(&wire)?,
            ExtensionSessionStatusAvailability::Unlocked
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
            selected_facts: AuthenticationWorkflowSelectedFacts::Selected {
                facts: Box::default(),
            },
        };
        let js_input = serde_wasm_bindgen::to_value(&fixture).map_err(js_error)?;
        let wire = Ts::new_unchecked(js_input);
        let decoded = super::decode_authentication_workflow_runtime_response(&wire)?;
        let js_output = decoded.js_value();
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
        let wire = Ts::new_unchecked(js_input);
        let decoded = super::decode_website_login_match_availability(&wire)?;
        let js_output = decoded.js_value();
        let result: LoginAvailabilityResult =
            serde_wasm_bindgen::from_value(js_output).map_err(js_error)?;
        assert_eq!(result.kind, "locked");
        Ok(())
    }

    #[wasm_bindgen_test]
    fn unavailable_login_match_bridge_returns_the_generated_typed_variant()
    -> Result<(), wasm_bindgen::JsError> {
        let availability = super::unavailable_website_login_match_availability()?;
        let js_output = availability.js_value();
        let result: LoginAvailabilityResult =
            serde_wasm_bindgen::from_value(js_output).map_err(js_error)?;

        assert_eq!(result.kind, "unavailable");
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
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn compare_extension_pairing_records(
    request: &tsify::Ts<nook_companion_core::ExtensionPairingRecordComparisonRequest>,
) -> Result<tsify::Ts<nook_companion_core::ExtensionPairingRecordComparison>, wasm_bindgen::JsError>
{
    let request = request
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let result = { request.compare() };
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

mod browser_material_admission;
pub use browser_material_admission::*;

mod bridge_coverage;

#[cfg(all(test, target_arch = "wasm32"))]
mod ingress_tests {
    use super::*;
    use nook_companion_core::{
        AuthenticationOutcomeClassification, AuthenticationOutcomeObservation,
        AuthenticationOutcomeVerdict, AuthenticationUsernameEvidence, PageInputType,
    };
    use serde::Serialize;
    use serde_wasm_bindgen::Serializer;
    use tsify::{Ts, Tsify};
    use wasm_bindgen::JsValue;
    use wasm_bindgen_test::wasm_bindgen_test;
    #[wasm_bindgen_test]
    fn username_exports_preserve_field_evidence_and_reject_invalid_vector_members()
    -> Result<(), JsError> {
        let field = NookPageInputFieldObservation::new(
            PageInputType::Email,
            false,
            false,
            vec!["email".into()],
            "account email".into(),
            true,
        );
        assert_eq!(
            authentication_username_evidence(&field)?.to_rust()?,
            AuthenticationUsernameEvidence::Strong
        );
        let strong = AuthenticationUsernameEvidence::Strong;
        let explicit = AuthenticationUsernameEvidence::Explicit;
        assert_eq!(
            strongest_authentication_username_evidence(vec![
                strong.into_ts()?,
                explicit.into_ts()?
            ])?
            .to_rust()?,
            explicit
        );
        assert!(
            strongest_authentication_username_evidence(vec![
                strong.into_ts()?,
                Ts::new_unchecked(JsValue::NULL)
            ])
            .is_err()
        );
        Ok(())
    }
    #[wasm_bindgen_test]
    fn outcome_exports_preserve_success_and_reject_contradictory_external_decisions()
    -> Result<(), JsError> {
        let observation = AuthenticationOutcomeObservation {
            success_marker_present: true,
            ..Default::default()
        };
        let classification = AuthenticationOutcomeClassification {
            observation,
            timeout_ms: 1000u32.into(),
        };
        let decision =
            classify_companion_authentication_outcome(&classification.into_ts()?)?.to_rust()?;
        assert_eq!(decision.verdict, AuthenticationOutcomeVerdict::Sufficient);
        assert!(decision.allows_credential_commit);
        assert_eq!(
            classify_companion_authentication_outcome_with_default_timeout(
                &observation.into_ts()?
            )?
            .to_rust()?,
            decision
        );
        assert_eq!(
            validate_companion_authentication_outcome_decision(&decision.into_ts()?)?.to_rust()?,
            decision
        );
        assert!(
            classify_companion_authentication_outcome(&Ts::new_unchecked(JsValue::NULL)).is_err()
        );
        assert!(
            classify_companion_authentication_outcome_with_default_timeout(&Ts::new_unchecked(
                JsValue::TRUE
            ))
            .is_err()
        );
        let contradictory = serde_json::json!({"verdict": AuthenticationOutcomeVerdict::Sufficient,"allowsCredentialCommit":false});
        let raw = contradictory.serialize(&Serializer::json_compatible())?;
        assert!(
            validate_companion_authentication_outcome_decision(&Ts::new_unchecked(raw)).is_err()
        );
        assert!(decision.allows_credential_commit);
        Ok(())
    }
}
